#!/usr/bin/env node
// Pre-merge guard against parallel api-server test files stepping on
// each other's seeded users.
//
// Vitest runs api-server test files in parallel forks against a single
// shared Postgres database. Any test that writes to the global
// `usersTable` without scoping the write (e.g. `db.delete(usersTable)`
// with no `where(...)`, or a `where(eq(usersTable.role, 'admin'))`
// matrix-wide demote) will silently delete or mutate rows owned by
// other test files mid-run, producing flakes that only reproduce in the
// full-suite run.
//
// This scanner walks every `*.test.ts` under the api-server src tree
// and fails fast when it finds:
//
//   1. `db.delete(usersTable)` or `db.update(usersTable)` with no
//      `.where(...)` clause at all (would touch every row).
//   2. A `.where(...)` clause on `usersTable` that does not name
//      `usersTable.username` or `usersTable.id` somewhere inside it —
//      the only safe per-suite scoping columns. Anything else (role,
//      email, authSource, …) is shared by definition and can match
//      another suite's rows.
//
// Each finding prints `<file>:<line>` plus the offending statement so
// the fix is one search away. Exit code is 0 on a clean tree, 1 on any
// finding.
//
// Usage:
//   node scripts/check-unscoped-user-writes.mjs
//   node scripts/check-unscoped-user-writes.mjs --scan <dir>   # tests
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const DEFAULT_SCAN_ROOT = resolve(root, "artifacts/api-server/src");

function parseArgs(argv) {
  const out = { scan: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scan" && argv[i + 1]) {
      out.scan = resolve(argv[i + 1]);
      i++;
    }
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// Find the matching closing paren for an opening paren at `start` in
// `src` (the char at `start` must be '('). Returns the index of the
// matching ')' or -1 if unbalanced.
function matchParen(src, start) {
  let depth = 0;
  let inStr = null; // null | "'" | '"' | '`'
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "/" && prev === "*") inBlockComment = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineNumberOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

const WRITE_RE = /\bdb\s*\.\s*(delete|update)\s*\(\s*usersTable\s*\)/g;

// Scan a single source file. Returns an array of { line, kind,
// reason, snippet } findings.
function scanFile(file) {
  const src = readFileSync(file, "utf8");
  const findings = [];
  let m;
  while ((m = WRITE_RE.exec(src))) {
    const verbStart = m.index;
    // Walk forward over chained calls. We want to know whether ANY
    // `.where(...)` follows in the same chain, and if so whether it
    // mentions a safe column.
    // The chain ends when we hit ';' at top level, or end of file.
    // We scan token-by-token.
    let i = m.index + m[0].length;
    let where = null; // { argSrc, line } | null
    let depth = 0;
    let inStr = null;
    let inLineComment = false;
    let inBlockComment = false;
    let stop = false;
    while (i < src.length && !stop) {
      const c = src[i];
      const prev = i > 0 ? src[i - 1] : "";
      if (inLineComment) {
        if (c === "\n") inLineComment = false;
        i++;
        continue;
      }
      if (inBlockComment) {
        if (c === "/" && prev === "*") inBlockComment = false;
        i++;
        continue;
      }
      if (inStr) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === inStr) inStr = null;
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        inStr = c;
        i++;
        continue;
      }
      if (c === "(") {
        depth++;
        i++;
        continue;
      }
      if (c === ")") {
        depth--;
        i++;
        continue;
      }
      if (depth === 0 && c === ";") {
        stop = true;
        break;
      }
      if (depth === 0 && c === ".") {
        // Look ahead for ".where(" — allow whitespace.
        const rest = src.slice(i);
        const wm = /^\.\s*where\s*\(/.exec(rest);
        if (wm) {
          const openParen = i + wm[0].length - 1;
          const closeParen = matchParen(src, openParen);
          if (closeParen < 0) {
            stop = true;
            break;
          }
          where = {
            argSrc: src.slice(openParen + 1, closeParen),
            line: lineNumberOf(src, i),
          };
          i = closeParen + 1;
          continue;
        }
      }
      i++;
    }

    const verb = m[1];
    const startLine = lineNumberOf(src, verbStart);
    // Build a one-line snippet of the offending statement.
    const stmtStart = src.lastIndexOf("\n", verbStart) + 1;
    const stmtEndCandidate = src.indexOf(";", verbStart);
    const stmtEnd =
      stmtEndCandidate === -1
        ? Math.min(src.length, verbStart + 200)
        : stmtEndCandidate + 1;
    const snippet = src
      .slice(stmtStart, stmtEnd)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

    if (!where) {
      findings.push({
        line: startLine,
        kind: `db.${verb}(usersTable) without .where(...)`,
        reason:
          "Unscoped write to the global users table — would touch every row from every other parallel test file.",
        snippet,
      });
      continue;
    }

    // The where(...) clause must mention a safe per-suite column.
    // We accept usersTable.username and usersTable.id as the only
    // identifier-style columns that test suites can prefix-scope.
    const usesSafeColumn =
      /\busersTable\s*\.\s*username\b/.test(where.argSrc) ||
      /\busersTable\s*\.\s*id\b/.test(where.argSrc);
    if (!usesSafeColumn) {
      findings.push({
        line: where.line,
        kind: `db.${verb}(usersTable).where(...) does not filter by usersTable.username or usersTable.id`,
        reason:
          "Filtering on a shared column (role, email, authSource, …) can match another parallel test file's seeded rows. Scope by username prefix or by an id this suite created itself.",
        snippet,
      });
    }
  }
  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scanRoot = args.scan ?? DEFAULT_SCAN_ROOT;
  const files = walk(scanRoot);
  const allFindings = [];
  for (const file of files) {
    const findings = scanFile(file);
    for (const f of findings) {
      allFindings.push({ file, ...f });
    }
  }
  if (allFindings.length === 0) {
    const where = relative(root, scanRoot) || scanRoot;
    console.log(
      `check-unscoped-user-writes: OK (${files.length} test file(s) under ${where})`,
    );
    return 0;
  }
  console.error(
    `check-unscoped-user-writes: ${allFindings.length} unscoped write(s) to usersTable found:\n`,
  );
  for (const f of allFindings) {
    const rel = relative(root, f.file) || f.file;
    console.error(`  ${rel}:${f.line}`);
    console.error(`    ${f.kind}`);
    console.error(`    ${f.reason}`);
    console.error(`    > ${f.snippet}`);
    console.error("");
  }
  return 1;
}

process.exit(main());
