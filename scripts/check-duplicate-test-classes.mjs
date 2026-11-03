#!/usr/bin/env node
// Pre-build guard for the C# UX test project. Runs a handful of cheap
// scans against the source tree to catch mistakes that the C# compiler
// reports with confusing line numbers (or only after a slow restore +
// build). Each check produces a clear "<file>:<line>" message.
//
// Checks:
//   1. Duplicate type declarations across files (CS0101).
//   2. Duplicate `[Test]` method names within the same fixture (CS0111).
//   3. Classes accidentally marked both `abstract` and `sealed` (CS0418).
//
// Usage:
//   node scripts/check-duplicate-test-classes.mjs
//   node scripts/check-duplicate-test-classes.mjs --scan <dir>   # for tests
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DEFAULT_TEST_ROOT = resolve(root, 'memento-ux-tests/Memento.UxTests.Tests');

function parseArgs(argv) {
  const out = { scan: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scan' && argv[i + 1]) {
      out.scan = resolve(argv[i + 1]);
      i++;
    }
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'bin' || entry === 'obj' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (entry.endsWith('.cs')) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
    } else if (c === '/' && c2 === '*') {
      i += 2;
      out += '  ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
    } else if (c === '@' && c2 === '"') {
      out += '  ';
      i += 2;
      while (i < n) {
        if (src[i] === '"' && src[i + 1] === '"') {
          out += '  ';
          i += 2;
        } else if (src[i] === '"') {
          out += ' ';
          i += 1;
          break;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
    } else if (c === '"') {
      out += ' ';
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          out += '  ';
          i += 2;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      if (i < n) {
        out += ' ';
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function buildOffsetToLine(src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') lineStarts.push(i + 1);
  }
  return (off) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Parse a single .cs file and report:
//   - type declarations (for the duplicate-types check),
//   - [Test]-attributed methods (for the duplicate-methods check),
//   - sealed-abstract class declarations (for the modifier-conflict check).
function parseFile(file) {
  const raw = readFileSync(file, 'utf8');
  const src = stripCommentsAndStrings(raw);
  const offsetToLine = buildOffsetToLine(src);

  const types = [];
  const testMethods = [];
  const sealedAbstract = [];

  const scope = [];
  let depth = 0;

  // Pending attributes accumulated since the last semicolon/brace, e.g.
  // `[Test] [Category("x")]`. Cleared once we attach them to a member.
  let pendingAttrs = [];

  const re =
    /\b(namespace|class|struct|record|interface)\b|\[\s*([A-Za-z_]\w*)\b[^\]]*\]|[{};]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    const idx = m.index;

    if (tok[0] === '[') {
      pendingAttrs.push(m[2]);
      continue;
    }
    if (tok === '{') {
      depth++;
      pendingAttrs = [];
      continue;
    }
    if (tok === '}') {
      depth--;
      while (scope.length && scope[scope.length - 1].depth >= depth) {
        scope.pop();
      }
      pendingAttrs = [];
      continue;
    }
    if (tok === ';') {
      pendingAttrs = [];
      continue;
    }

    if (tok === 'namespace') {
      const rest = src.slice(idx + 'namespace'.length);
      const nameMatch = rest.match(/^\s+([A-Za-z_][\w.]*)\s*([{;])/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const terminator = nameMatch[2];
      scope.push({ kind: 'ns', name, depth: terminator === '{' ? depth : -1 });
      pendingAttrs = [];
      continue;
    }

    // class / struct / record / interface
    const after = src.slice(idx + tok.length);
    const idMatch = after.match(/^\s+([A-Za-z_]\w*)/);
    if (!idMatch) continue;
    const typeName = idMatch[1];

    const restAfterId = src.slice(idx + tok.length + idMatch[0].length);
    const term = restAfterId.match(/[{;]/);
    if (!term) continue;

    // Inspect the modifiers immediately preceding the keyword. Walk
    // backward to the previous statement boundary (`;`, `{`, `}`, or `]`).
    const head = src.slice(0, idx);
    let start = head.length;
    while (start > 0) {
      const ch = head[start - 1];
      if (ch === ';' || ch === '{' || ch === '}' || ch === ']') break;
      start--;
    }
    const modifierRegion = head.slice(start);
    const modifiers = new Set(
      modifierRegion
        .split(/\s+/)
        .filter(Boolean),
    );
    if (tok === 'class' && modifiers.has('abstract') && modifiers.has('sealed')) {
      sealedAbstract.push({ file, line: offsetToLine(idx), typeName });
    }

    const ns = scope.map((s) => (s.kind === 'ns' ? s.name : s.name)).join('.');
    const fqn = ns ? `${ns}.${typeName}` : typeName;
    types.push({ fqn, line: offsetToLine(idx), file });

    if (term[0] === '{') {
      scope.push({ kind: 'type', name: typeName, depth });
      re.lastIndex = idx + tok.length + idMatch[0].length + term.index;
    }
    pendingAttrs = [];
  }

  // Second pass for `[Test]`-attributed methods. We need member-level
  // detail (method name + parameter list), which is awkward to interleave
  // with the type-tracking pass above, so we do a focused scan here. We
  // re-derive class scope from brace depth to attribute each method.
  const attrRe = /\[\s*(Test|TestCase)\b[^\]]*\]/g;
  const innerOffsetToLine = offsetToLine;
  let am;
  while ((am = attrRe.exec(src)) !== null) {
    // Skip past further attributes/modifiers/whitespace, then read the
    // return type and method name. We bail if we hit `{` or `;` first
    // (attribute on a property/field/etc).
    let j = am.index + am[0].length;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '[') {
        const end = src.indexOf(']', j);
        if (end < 0) { j = src.length; break; }
        j = end + 1;
        continue;
      }
      if (/\s/.test(ch)) { j++; continue; }
      break;
    }
    // From j, capture identifiers/dots/`<...>` (modifiers + return type +
    // method name). Stop at `(`. Last identifier before `(` is the method.
    const sig = src.slice(j);
    const open = sig.indexOf('(');
    if (open < 0) continue;
    const before = sig.slice(0, open);
    if (/[{};]/.test(before)) continue;
    // Identifiers that are not generic-arg lists.
    const idents = before.match(/[A-Za-z_]\w*/g);
    if (!idents || idents.length < 2) continue;
    const methodName = idents[idents.length - 1];

    // Owning class: nearest type scope at the brace depth implied by
    // counting unclosed `{` between the start of the file and `am.index`.
    const head = src.slice(0, am.index);
    let d = 0;
    const owners = [];
    // Track type/namespace open declarations as we go.
    const decRe = /\b(namespace|class|struct|record|interface)\s+([A-Za-z_]\w*)|[{}]/g;
    let dm;
    const stack = [];
    while ((dm = decRe.exec(head)) !== null) {
      if (dm[0] === '{') {
        if (stack.length && stack[stack.length - 1].pending) {
          stack[stack.length - 1].pending = false;
          stack[stack.length - 1].depth = d;
        }
        d++;
      } else if (dm[0] === '}') {
        d--;
        while (stack.length && stack[stack.length - 1].depth !== undefined && stack[stack.length - 1].depth >= d) {
          stack.pop();
        }
      } else if (dm[1] === 'namespace') {
        // Peek for `;` (file-scoped) vs `{`.
        const tail = head.slice(dm.index + dm[0].length);
        const t = tail.match(/^\s*([{;])/);
        if (t && t[1] === ';') {
          stack.push({ kind: 'ns', name: dm[2], depth: -1, pending: false });
        } else {
          stack.push({ kind: 'ns', name: dm[2], pending: true });
        }
      } else {
        stack.push({ kind: 'type', name: dm[2], pending: true });
      }
    }
    for (const s of stack) if (s.kind === 'type') owners.push(s.name);
    if (owners.length === 0) continue;
    const owner = owners.join('+');

    // Parameter list (best-effort — only count parameter type tokens, no nested generics).
    let depthP = 1;
    let k = j + open + 1;
    let paramSrc = '';
    while (k < src.length && depthP > 0) {
      const ch = src[k];
      if (ch === '(') depthP++;
      else if (ch === ')') depthP--;
      if (depthP > 0) paramSrc += ch;
      k++;
    }
    const paramSig = normalizeParamList(paramSrc);

    // Anchor each method to its declaration site (the `(` after the
    // method name) rather than the attribute line. NUnit's `[TestCase]`
    // is commonly stacked on one method — those are parameterizations
    // of a single declaration, not duplicates.
    const declOffset = j + open;
    testMethods.push({
      file,
      declOffset,
      line: innerOffsetToLine(j),
      owner,
      methodName,
      paramSig,
    });
  }

  // Collapse multiple `[Test]`/`[TestCase]` attributes on the same method
  // to a single entry, keyed by declOffset.
  const seen = new Set();
  const uniqMethods = [];
  for (const m of testMethods) {
    const k = `${m.file}::${m.declOffset}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqMethods.push(m);
  }

  return { types, testMethods: uniqMethods, sealedAbstract };
}

// Reduce a raw parameter source string to a comparable signature: the
// sequence of parameter types, ignoring names, defaults, and `params`/`ref`/
// `out`/`in` modifiers. Good enough to detect CS0111-style overload clashes
// in typical UX test code (no exotic generics).
function normalizeParamList(src) {
  const trimmed = src.trim();
  if (!trimmed) return '';
  const params = splitTopLevel(trimmed, ',');
  const types = [];
  for (const p of params) {
    let s = p.trim();
    if (!s) continue;
    s = s.replace(/=.*$/s, '').trim();
    s = s.replace(/^\[[^\]]*\]\s*/, '');
    const tokens = s.split(/\s+/).filter(Boolean);
    const skip = new Set(['this', 'ref', 'out', 'in', 'params', 'scoped']);
    const filtered = tokens.filter((t) => !skip.has(t));
    if (filtered.length < 2) {
      types.push(filtered.join(' '));
    } else {
      // Last token is the parameter name; everything else is the type.
      types.push(filtered.slice(0, -1).join(' '));
    }
  }
  return types.join(',');
}

function splitTopLevel(src, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function checkDuplicateTypes(allTypes) {
  const byFqn = new Map();
  for (const d of allTypes) {
    if (!byFqn.has(d.fqn)) byFqn.set(d.fqn, []);
    byFqn.get(d.fqn).push(d);
  }
  const dupes = [];
  for (const [fqn, locs] of byFqn) {
    // Multiple declarations across different files = real duplicate;
    // multiple in the same file are usually `partial` and harmless.
    const distinctFiles = new Set(locs.map((l) => l.file));
    if (distinctFiles.size > 1) dupes.push({ fqn, locs });
  }
  return dupes;
}

function checkDuplicateTestMethods(allMethods) {
  const byKey = new Map();
  for (const m of allMethods) {
    const key = `${m.file}::${m.owner}::${m.methodName}(${m.paramSig})`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  const dupes = [];
  for (const [, locs] of byKey) {
    if (locs.length > 1) dupes.push(locs);
  }
  return dupes;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scanRoot = args.scan ?? DEFAULT_TEST_ROOT;
  const files = walk(scanRoot);

  const allTypes = [];
  const allMethods = [];
  const allSealedAbstract = [];
  for (const f of files) {
    let parsed;
    try {
      parsed = parseFile(f);
    } catch (err) {
      console.error(`check-csharp-build-killers: failed to parse ${relative(root, f)}: ${err.message}`);
      process.exit(2);
    }
    allTypes.push(...parsed.types);
    allMethods.push(...parsed.testMethods);
    allSealedAbstract.push(...parsed.sealedAbstract);
  }

  const dupTypes = checkDuplicateTypes(allTypes);
  const dupMethods = checkDuplicateTestMethods(allMethods);
  const sealedAbstract = allSealedAbstract;

  const errors = [];

  if (dupTypes.length) {
    let buf = `Found ${dupTypes.length} duplicate type declaration(s):`;
    for (const { fqn, locs } of dupTypes) {
      buf += `\n  ${fqn} is declared in:`;
      for (const l of locs) buf += `\n    - ${relative(root, l.file)}:${l.line}`;
    }
    buf += `\nDuplicate type names in the same namespace cause CS0101 and break the entire UX test build.`;
    errors.push(buf);
  }

  if (dupMethods.length) {
    let buf = `Found ${dupMethods.length} duplicate [Test]/[TestCase] method name(s):`;
    for (const locs of dupMethods) {
      const first = locs[0];
      buf += `\n  ${first.owner}.${first.methodName}(${first.paramSig}) is declared in:`;
      for (const l of locs) buf += `\n    - ${relative(root, l.file)}:${l.line}`;
    }
    buf += `\nDuplicate method names with the same signature inside a fixture cause CS0111.`;
    errors.push(buf);
  }

  if (sealedAbstract.length) {
    let buf = `Found ${sealedAbstract.length} class(es) marked both \`abstract\` and \`sealed\`:`;
    for (const s of sealedAbstract) {
      buf += `\n  - ${relative(root, s.file)}:${s.line}  (class ${s.typeName})`;
    }
    buf += `\nA class cannot be both abstract and sealed (CS0418); abstract base fixtures must not be sealed.`;
    errors.push(buf);
  }

  if (errors.length === 0) {
    console.log(
      `check-csharp-build-killers: OK — scanned ${files.length} .cs files (no duplicate types, no duplicate test methods, no sealed-abstract classes).`,
    );
    return;
  }

  console.error(`check-csharp-build-killers: FAILED in ${relative(root, scanRoot) || scanRoot}`);
  for (const e of errors) {
    console.error('');
    console.error(e);
  }
  process.exit(1);
}

main();
