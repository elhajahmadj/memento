#!/usr/bin/env bash
# Synthetic regression tests for check-unscoped-user-writes.mjs.
# Each fixture exercises one branch of the scanner (clean, unscoped
# delete, unscoped update, role-only filter) so future refactors of
# the scanner don't silently weaken the guard.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/check-unscoped-user-writes.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/clean"
cat > "$tmp/clean/ok.test.ts" <<'EOF'
const PREFIX = "vitest-clean-";
await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
await db.update(usersTable).set({ role: "limited" }).where(eq(usersTable.id, someId));
EOF

mkdir -p "$tmp/unscoped-delete"
cat > "$tmp/unscoped-delete/bad.test.ts" <<'EOF'
await db.delete(usersTable);
EOF

mkdir -p "$tmp/unscoped-update"
cat > "$tmp/unscoped-update/bad.test.ts" <<'EOF'
await db.update(usersTable).set({ role: "limited" });
EOF

mkdir -p "$tmp/role-filter"
cat > "$tmp/role-filter/bad.test.ts" <<'EOF'
await db.delete(usersTable).where(eq(usersTable.role, "admin"));
EOF

assert_exit() {
  local label="$1" dir="$2" expected="$3"
  set +e
  node "$script" --scan "$dir" >/dev/null 2>&1
  local got=$?
  set -e
  if [[ "$got" -ne "$expected" ]]; then
    echo "FAIL [$label]: expected exit $expected, got $got" >&2
    node "$script" --scan "$dir" >&2 || true
    exit 1
  fi
  echo "PASS [$label] (exit $got)"
}

assert_exit "clean fixture" "$tmp/clean" 0
assert_exit "unscoped delete" "$tmp/unscoped-delete" 1
assert_exit "unscoped update" "$tmp/unscoped-update" 1
assert_exit "role-only filter" "$tmp/role-filter" 1

echo
echo "All check-unscoped-user-writes scanner tests passed."
