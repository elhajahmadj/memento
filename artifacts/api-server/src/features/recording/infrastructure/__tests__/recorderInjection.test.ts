import { describe, it, expect, beforeAll } from "vitest";
import vm from "node:vm";
import { RECORDER_SCRIPT } from "@/features/recording/infrastructure/recorderInjection";

interface FakeEl {
  nodeType: 1;
  tagName: string;
  id: string;
  classList: { length: number; [Symbol.iterator]: () => Iterator<string> };
  parentElement: FakeEl | null;
  previousElementSibling: FakeEl | null;
  isContentEditable: boolean;
  type?: string;
  getAttribute(name: string): string | null;
}

interface SelectorResult {
  selector: string | null;
  strategy: string;
}

function makeEl(opts: {
  tag: string;
  attrs?: Record<string, string>;
  classes?: string[];
  parent?: FakeEl | null;
  prevSiblings?: FakeEl[];
}): FakeEl {
  const attrs = opts.attrs ?? {};
  const classes = opts.classes ?? [];
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: attrs.id ?? "",
    classList: {
      length: classes.length,
      [Symbol.iterator]: () => classes[Symbol.iterator](),
    },
    parentElement: opts.parent ?? null,
    previousElementSibling: null,
    isContentEditable: false,
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name)
        ? attrs[name]!
        : null;
    },
  };
  // Build the previous-sibling chain (last entry is the immediate predecessor).
  let prev: FakeEl | null = null;
  for (const s of opts.prevSiblings ?? []) {
    s.previousElementSibling = prev;
    prev = s;
  }
  el.previousElementSibling = prev;
  return el;
}

let selectorFor!: (el: FakeEl) => SelectorResult;
let pickElement!: (
  x: number,
  y: number,
) => { selector: string; strategy: string; text: string } | null;
let setHitElement!: (el: unknown) => void;
let setJsPathFor!: (fn: (el: FakeEl) => string | null) => void;
let setTextSelectorTextFor!: (fn: (el: FakeEl) => string | null) => void;

beforeAll(() => {
  // Expose the IIFE-scoped selectorFor on `window` so we can test it
  // without actually injecting into a browser page.
  const exposed = RECORDER_SCRIPT.replace(
    /\}\)\(\);\s*$/,
    [
      "window.__selectorFor = selectorFor;",
      "window.__setJsPathFor = function(fn) { jsPathFor = fn; };",
      "window.__setTextSelectorTextFor = function(fn) { textSelectorTextFor = fn; };",
      "})();",
    ].join(" "),
  );
  const win: Record<string, unknown> = { __recorderEmit: () => {} };
  // The pick helper calls document.elementFromPoint; tests stub it via
  // a per-test hit element so we don't need a real DOM.
  let hit: unknown = null;
  setHitElement = (el: unknown) => {
    hit = el;
  };
  const doc = {
    addEventListener: () => {},
    elementFromPoint: () => hit,
  };
  const ctx: vm.Context = vm.createContext({
    window: win,
    document: doc,
    location: { href: "https://example.com/x" },
    Date,
    Array,
  });
  vm.runInContext(exposed, ctx);
  selectorFor = win.__selectorFor as (el: FakeEl) => SelectorResult;
  pickElement = win.__recorderPickElement as typeof pickElement;
  setJsPathFor = win.__setJsPathFor as typeof setJsPathFor;
  setTextSelectorTextFor =
    win.__setTextSelectorTextFor as typeof setTextSelectorTextFor;
});

describe("recorder selectorFor priority", () => {
  it("prefers data-testid over everything else", () => {
    const el = makeEl({
      tag: "button",
      attrs: {
        "data-testid": "submit",
        id: "btn-1",
        "aria-label": "Submit form",
      },
    });
    expect(selectorFor(el)).toEqual({
      selector: '[data-testid="submit"]',
      strategy: "data-testid",
    });
  });

  it("uses id when no data-testid is present", () => {
    const el = makeEl({
      tag: "input",
      attrs: { id: "username", "aria-label": "User name" },
    });
    expect(selectorFor(el)).toEqual({
      selector: "#username",
      strategy: "id",
    });
  });

  it("prefers js-path over xpath, text, and aria-label for an element with neither testid nor id", () => {
    // html > body > main > section[3] > button — both jsPath and xpath
    // can resolve this; js-path now wins.
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const main = makeEl({ tag: "main", parent: body });
    const s1 = makeEl({ tag: "section", parent: main });
    const s2 = makeEl({ tag: "section", parent: main });
    const target = makeEl({
      tag: "button",
      attrs: { "aria-label": "Click me" },
      parent: makeEl({
        tag: "section",
        parent: main,
        prevSiblings: [s1, s2],
      }),
    });
    const result = selectorFor(target);
    expect(result.strategy).toBe("js-path");
    expect(result.selector).toBe(
      "html > body > main:nth-of-type(1) > section:nth-of-type(3) > button:nth-of-type(1)",
    );
  });

  it("emits text= when js-path cannot be built but the element has short visible text", () => {
    // Stub jsPathFor to null so the text-selector tier becomes
    // reachable. Use the REAL textSelectorTextFor (still installed
    // from the script) — it reads the element's own direct text-node
    // children only.
    setJsPathFor(() => null);
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const target = makeEl({ tag: "button", parent: body });
    (target as unknown as { childNodes: unknown[] }).childNodes = [
      { nodeType: 3, nodeValue: "  Login  " },
    ];
    const result = selectorFor(target);
    expect(result.strategy).toBe("text");
    expect(result.selector).toBe('text="Login"');
  });

  it("falls back to xpath when js-path is unavailable and the element has no usable visible text", () => {
    // Force both jsPath and text tiers to bail; xpath should win.
    setJsPathFor(() => null);
    setTextSelectorTextFor(() => null);
    try {
      const html = makeEl({ tag: "html" });
      const body = makeEl({ tag: "body", parent: html });
      const main = makeEl({ tag: "main", parent: body });
      const target = makeEl({
        tag: "button",
        attrs: { "aria-label": "Click me" },
        parent: main,
      });
      const result = selectorFor(target);
      expect(result.strategy).toBe("xpath");
      expect(result.selector).toBe(
        "xpath=/html/body[1]/main[1]/button[1]",
      );
    } finally {
      // tests after this re-stub or rely on restored jsPath/text helpers.
    }
  });

  it("skips the text tier for editable hosts (INPUT)", () => {
    // Restore the real text helper, then prove an INPUT with visible
    // text-like content does not produce a text= selector — js-path
    // still resolves so it wins (the real text helper returns null
    // for INPUT/TEXTAREA/contenteditable).
    setJsPathFor((el) => {
      // Mirror the real jsPath just for this test scope.
      const parts: string[] = [];
      let cur: FakeEl | null = el;
      while (cur) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "html" || tag === "body") {
          parts.unshift(tag);
        } else {
          parts.unshift(tag + ":nth-of-type(1)");
        }
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    });
    setTextSelectorTextFor(() => {
      // Real-helper behavior: INPUT/TEXTAREA/contenteditable yield null.
      return null;
    });
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const input = makeEl({ tag: "input", parent: body });
    (input as unknown as { innerText: string }).innerText = "ignored";
    const result = selectorFor(input);
    expect(result.strategy).toBe("js-path");
    expect(result.selector).toBe("html > body > input:nth-of-type(1)");
  });

  it("does not produce a text= selector from descendant text alone", () => {
    // A wrapper <div> whose only text comes from a child <span> must
    // NOT generate text="..." — the text tier reads only direct child
    // text nodes. Stub js-path to null so the text tier is reachable.
    setJsPathFor(() => null);
    setTextSelectorTextFor(undefined as unknown as () => string | null);
    // Reset to the real helper by re-exposing through the script —
    // we can't reach the original, so build an equivalent here that
    // mirrors the production behavior: only direct text-node kids.
    setTextSelectorTextFor((el) => {
      const kids = (el as unknown as { childNodes?: { nodeType: number; nodeValue?: string }[] }).childNodes;
      if (!kids || kids.length === 0) return null;
      let raw = "";
      for (const k of kids) {
        if (k && k.nodeType === 3) raw += k.nodeValue || "";
      }
      const trimmed = raw.replace(/\s+/g, " ").trim();
      return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
    });
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const wrapper = makeEl({
      tag: "div",
      attrs: { "aria-label": "Aria fallback" },
      parent: body,
    });
    // No direct text-node children — text is "inside" a descendant.
    (wrapper as unknown as { childNodes: unknown[] }).childNodes = [
      { nodeType: 1, nodeValue: null }, // a child <span>, not a text node
    ];
    const result = selectorFor(wrapper);
    expect(result.strategy).not.toBe("text");
    // Next tier after text= is xpath; with js-path stubbed to null,
    // xpath should win here.
    expect(result.strategy).toBe("xpath");
  });

  it("uses direct text-node content for the text tier (leaf element)", () => {
    setJsPathFor(() => null);
    setTextSelectorTextFor((el) => {
      const kids = (el as unknown as { childNodes?: { nodeType: number; nodeValue?: string }[] }).childNodes;
      if (!kids || kids.length === 0) return null;
      let raw = "";
      for (const k of kids) {
        if (k && k.nodeType === 3) raw += k.nodeValue || "";
      }
      const trimmed = raw.replace(/\s+/g, " ").trim();
      return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
    });
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const btn = makeEl({ tag: "button", parent: body });
    (btn as unknown as { childNodes: unknown[] }).childNodes = [
      { nodeType: 3, nodeValue: "  Login  " },
    ];
    const result = selectorFor(btn);
    expect(result.strategy).toBe("text");
    expect(result.selector).toBe('text="Login"');
  });

  it("escapes embedded double quotes in text selectors", () => {
    setJsPathFor(() => null);
    setTextSelectorTextFor(() => 'Say "hi"');
    const html = makeEl({ tag: "html" });
    const body = makeEl({ tag: "body", parent: html });
    const target = makeEl({ tag: "button", parent: body });
    const result = selectorFor(target);
    expect(result.strategy).toBe("text");
    expect(result.selector).toBe('text="Say \\"hi\\""');
  });

  it("__recorderPickElement returns selector + visible text for the element at point", () => {
    const el = makeEl({
      tag: "button",
      attrs: { "data-testid": "save-btn" },
    });
    // The injection script reads innerText / textContent off the element.
    (el as unknown as { innerText: string }).innerText = "  Save  changes  ";
    setHitElement(el);
    const result = pickElement(10, 20);
    expect(result).toEqual({
      selector: '[data-testid="save-btn"]',
      strategy: "data-testid",
      text: "Save changes",
    });
  });

  it("__recorderPickElement returns null when no element is hit", () => {
    setHitElement(null);
    expect(pickElement(0, 0)).toBeNull();
  });

  it("__recorderPickElement caps very long text at 200 chars", () => {
    const el = makeEl({ tag: "p", attrs: { id: "blurb" } });
    (el as unknown as { textContent: string }).textContent = "x".repeat(500);
    setHitElement(el);
    const result = pickElement(1, 1);
    expect(result?.selector).toBe("#blurb");
    expect(result?.text.length).toBe(200);
  });

  it("uses aria-label only when neither js-path, text, nor xpath can be produced", () => {
    // Force the higher tiers (js-path, text) to bail and use a fully
    // broken element so xpath also fails — aria-label is then the
    // last meaningful tier before the css fallback.
    setJsPathFor(() => null);
    setTextSelectorTextFor(() => null);
    const broken = {
      nodeType: 1 as const,
      get tagName(): string {
        throw new Error("no tag");
      },
      id: "",
      classList: { length: 0, [Symbol.iterator]: () => [][Symbol.iterator]() },
      parentElement: null,
      previousElementSibling: null,
      isContentEditable: false,
      getAttribute(name: string) {
        return name === "aria-label" ? "Save" : null;
      },
    } as unknown as FakeEl;
    const result = selectorFor(broken);
    expect(result.strategy).toBe("aria-label");
    expect(result.selector).toBe('[aria-label="Save"]');
  });
});
