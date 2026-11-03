/**
 * Script injected into the recorded page that captures user interactions
 * and reports them back through window.__recorderEmit (which is bound from
 * Node via page.exposeBinding).
 *
 * Selector priority:
 *   data-testid -> id -> js-path -> text= -> xpath -> aria-label -> css fallback.
 *
 * XPath selectors are emitted with a leading `xpath=` prefix so Playwright's
 * locator() accepts them directly. JS-path selectors are valid CSS using
 * `:nth-of-type(...)` indexing and need no prefix. Text selectors use
 * Playwright's `text="..."` engine and are only used for non-editable
 * elements with short, single-line visible text.
 */
export const RECORDER_SCRIPT = `
(function() {
  if (window.__recorderInstalled) return;
  window.__recorderInstalled = true;

  // Build an absolute XPath from the element up to <html>, indexing by
  // nth-of-type among same-tag siblings. Returns null on failure.
  function xpathFor(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      var parts = [];
      var cur = el;
      while (cur && cur.nodeType === 1) {
        var tag = cur.tagName.toLowerCase();
        if (tag === 'html') {
          parts.unshift('html');
          break;
        }
        var idx = 1;
        var sib = cur.previousElementSibling;
        while (sib) {
          if (sib.tagName === cur.tagName) idx++;
          sib = sib.previousElementSibling;
        }
        parts.unshift(tag + '[' + idx + ']');
        cur = cur.parentElement;
      }
      if (parts.length === 0 || parts[0] !== 'html') return null;
      return '/' + parts.join('/');
    } catch (e) { return null; }
  }

  // Build a full CSS / JS path rooted at <html> using :nth-of-type
  // indexing. Returns null on failure.
  function jsPathFor(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      var parts = [];
      var cur = el;
      while (cur && cur.nodeType === 1) {
        var tag = cur.tagName.toLowerCase();
        if (tag === 'html' || tag === 'body') {
          parts.unshift(tag);
        } else {
          var idx = 1;
          var sib = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === cur.tagName) idx++;
            sib = sib.previousElementSibling;
          }
          parts.unshift(tag + ':nth-of-type(' + idx + ')');
        }
        cur = cur.parentElement;
      }
      if (parts.length === 0) return null;
      return parts.join(' > ');
    } catch (e) { return null; }
  }

  function shallowCssFor(el) {
    var path = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && path.length < 5) {
      var part = cur.tagName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        part += '.' + Array.from(cur.classList).slice(0, 2).join('.');
      }
      path.unshift(part);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  }

  // Read this element's OWN trimmed text content — only direct child
  // text nodes, never descendants. This keeps \`text="..."\` selectors
  // anchored to leaf-ish elements (e.g. \`<button>Login</button>\`) and
  // avoids generating a selector from the concatenated rendered text
  // of a wrapper. Returns null when the text is empty, multi-line,
  // too long (> 64 chars), or when the element is an editable host
  // (visible text isn't meaningful for inputs).
  function textSelectorTextFor(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return null;
      if (el.isContentEditable) return null;
      var kids = el.childNodes;
      if (!kids || kids.length === 0) return null;
      var raw = '';
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        // 3 === Node.TEXT_NODE; we only concatenate direct text nodes.
        if (k && k.nodeType === 3) {
          raw += k.nodeValue || '';
        }
      }
      if (!raw) return null;
      // Reject multi-line text BEFORE whitespace collapsing so we
      // don't silently turn a 2-line label into a one-line selector.
      if (/[\\r\\n]/.test(raw)) return null;
      var trimmed = raw.replace(/\\s+/g, ' ').trim();
      if (!trimmed) return null;
      if (trimmed.length > 64) return null;
      return trimmed;
    } catch (e) { return null; }
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return { selector: null, strategy: 'css' };
    var testid = el.getAttribute('data-testid');
    if (testid) return { selector: '[data-testid="' + testid + '"]', strategy: 'data-testid' };
    if (el.id) return { selector: '#' + el.id, strategy: 'id' };
    var jp = jsPathFor(el);
    if (jp) return { selector: jp, strategy: 'js-path' };
    var txt = textSelectorTextFor(el);
    if (txt) {
      var escaped = txt.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
      return { selector: 'text="' + escaped + '"', strategy: 'text' };
    }
    var xp = xpathFor(el);
    if (xp) return { selector: 'xpath=' + xp, strategy: 'xpath' };
    var aria = el.getAttribute('aria-label');
    if (aria) return { selector: '[aria-label="' + aria + '"]', strategy: 'aria-label' };
    return { selector: shallowCssFor(el), strategy: 'css' };
  }

  // Walk up from the click target to find the nearest editable host
  // (input/textarea/contenteditable root). Returns the host element or null.
  function findEditableHost(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var tag = cur.tagName;
      if (tag === 'TEXTAREA') return cur;
      if (tag === 'INPUT') {
        var type = (cur.getAttribute('type') || 'text').toLowerCase();
        var TEXT_TYPES = [
          'text','search','email','tel','url','password',
          'number','date','datetime-local','month','time','week'
        ];
        return TEXT_TYPES.indexOf(type) === -1 ? null : cur;
      }
      // contenteditable host: the element where contentEditable is set true
      if (cur.isContentEditable && cur.getAttribute('contenteditable') !== null) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function editableInfoFor(host) {
    if (!host) return null;
    var tag = host.tagName;
    var kind = tag === 'TEXTAREA'
      ? 'textarea'
      : (tag === 'INPUT' ? 'input' : 'contenteditable');
    var label =
      host.getAttribute('data-testid') ||
      host.id ||
      host.getAttribute('aria-label') ||
      host.getAttribute('name') ||
      host.getAttribute('placeholder') ||
      tag.toLowerCase();
    return { kind: kind, label: String(label) };
  }

  function emit(action) {
    try {
      action.ts = Date.now();
      action.url = location.href;
      window.__recorderEmit(action);
    } catch (e) {}
  }

  // Expose a helper used by the server-side "pick-element" WebSocket
  // message. Given viewport-relative coordinates, returns a selector and
  // the element's visible text so the workbench can pre-fill an
  // "element has text" assertion without the user typing CSS by hand.
  // Returns null when no element is hit at that point.
  window.__recorderPickElement = function(x, y) {
    try {
      var el = document.elementFromPoint(x, y);
      if (!el || el.nodeType !== 1) return null;
      var s = selectorFor(el);
      if (!s.selector) return null;
      // Prefer innerText (respects CSS visibility / line breaks); fall
      // back to textContent for nodes innerText doesn't compute on (e.g.
      // some inline SVG). Trim and cap so we don't seed an essay into
      // the assertion form.
      var raw = (typeof el.innerText === 'string' && el.innerText.length > 0)
        ? el.innerText
        : (el.textContent || '');
      var text = raw.replace(/\\s+/g, ' ').trim();
      if (text.length > 200) text = text.slice(0, 200);
      return { selector: s.selector, strategy: s.strategy, text: text };
    } catch (e) { return null; }
  };

  document.addEventListener('click', function(ev) {
    // If the click hit (or descended into) an editable text host, anchor
    // the selector to that host so the recorded action and any subsequent
    // server-side .fill() target the same element.
    var host = findEditableHost(ev.target);
    var anchor = host || ev.target;
    var s = selectorFor(anchor);
    var editable = editableInfoFor(host);
    var payload = { type: 'click', selector: s.selector, strategy: s.strategy };
    if (editable) payload.editable = editable;
    emit(payload);
  }, true);

  document.addEventListener('change', function(ev) {
    var t = ev.target;
    if (!t) return;
    var s = selectorFor(t);
    if (t.tagName === 'SELECT') {
      emit({ type: 'select', selector: s.selector, strategy: s.strategy, value: t.value });
    } else if (t.type === 'checkbox' || t.type === 'radio') {
      emit({ type: 'check', selector: s.selector, strategy: s.strategy, value: String(t.checked) });
    } else {
      emit({ type: 'fill', selector: s.selector, strategy: s.strategy, value: t.value });
    }
  }, true);
})();
`;
