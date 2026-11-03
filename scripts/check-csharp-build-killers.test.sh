#!/usr/bin/env bash
# Synthetic regression tests for scripts/check-duplicate-test-classes.mjs.
# Builds tiny .cs fixtures in temp dirs and asserts the scanner's exit code
# and that the right error fires. Each scenario covers one of the build-killer
# checks the scanner is responsible for.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
scanner="$here/check-duplicate-test-classes.mjs"

passed=0
failed=0

# run_case <label> <fixture-dir> <expected-exit-code> [grep-pattern]
run_case() {
  local label="$1"
  local dir="$2"
  local expected="$3"
  local pattern="${4:-}"

  local out
  out="$(node "$scanner" --scan "$dir" 2>&1)"
  local actual=$?

  if [ "$actual" -ne "$expected" ]; then
    echo "FAIL: $label — expected exit $expected, got $actual"
    echo "$out" | sed 's/^/  | /'
    failed=$((failed + 1))
    return
  fi
  if [ -n "$pattern" ] && ! echo "$out" | grep -qE "$pattern"; then
    echo "FAIL: $label — output did not match /$pattern/"
    echo "$out" | sed 's/^/  | /'
    failed=$((failed + 1))
    return
  fi
  echo "PASS: $label"
  passed=$((passed + 1))
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# ---------------------------------------------------------------------------
# 1. Clean fixture passes.
clean="$tmp/clean"
mkdir -p "$clean"
cat >"$clean/Good.cs" <<'CS'
using NUnit.Framework;
namespace Demo
{
    [TestFixture]
    public sealed class GoodTests
    {
        [Test] public void A() { }
        [Test] public void B() { }
        [TestCase("x")]
        [TestCase("y")]
        public void Param(string s) { }
    }
}
CS
run_case "clean fixture passes" "$clean" 0 "OK"

# ---------------------------------------------------------------------------
# 2. Duplicate type across files (CS0101) — pre-existing check still works.
duptype="$tmp/duptype"
mkdir -p "$duptype"
cat >"$duptype/A.cs" <<'CS'
namespace Demo { public class Widget { } }
CS
cat >"$duptype/B.cs" <<'CS'
namespace Demo { public class Widget { } }
CS
run_case "duplicate type across files fails" "$duptype" 1 "duplicate type declaration"

# ---------------------------------------------------------------------------
# 3. Duplicate [Test] method names with the same signature (CS0111).
dupmethod="$tmp/dupmethod"
mkdir -p "$dupmethod"
cat >"$dupmethod/Tests.cs" <<'CS'
using NUnit.Framework;
namespace Demo
{
    [TestFixture]
    public sealed class DupTests
    {
        [Test] public void Same() { }
        [Test] public void Same() { }
    }
}
CS
run_case "duplicate [Test] method names fail" "$dupmethod" 1 "duplicate \\[Test\\]"

# ---------------------------------------------------------------------------
# 4. Stacked [TestCase] on a single method must NOT trip the duplicate-method
#    check — those are NUnit parameterizations of one declaration.
stacked="$tmp/stacked"
mkdir -p "$stacked"
cat >"$stacked/Tests.cs" <<'CS'
using NUnit.Framework;
namespace Demo
{
    [TestFixture]
    public sealed class ParamTests
    {
        [TestCase("a")]
        [TestCase("b")]
        [TestCase("c")]
        public void Param(string s) { }
    }
}
CS
run_case "stacked [TestCase] passes" "$stacked" 0 "OK"

# ---------------------------------------------------------------------------
# 5. Class declared both `abstract` and `sealed` (CS0418).
absSealed="$tmp/abstract-sealed"
mkdir -p "$absSealed"
cat >"$absSealed/Base.cs" <<'CS'
namespace Demo
{
    public abstract sealed class WrongBase { }
}
CS
run_case "abstract+sealed class fails" "$absSealed" 1 "abstract.*sealed"

# ---------------------------------------------------------------------------
# 6. Modifier-order independence: `sealed abstract` is the same problem.
absSealed2="$tmp/sealed-abstract"
mkdir -p "$absSealed2"
cat >"$absSealed2/Base.cs" <<'CS'
namespace Demo
{
    public sealed abstract class AlsoWrong { }
}
CS
run_case "sealed+abstract class (reversed order) fails" "$absSealed2" 1 "abstract.*sealed"

# ---------------------------------------------------------------------------
echo
echo "check-csharp-build-killers tests: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
