# Visual baselines

PNG baselines for the visual-regression suite, organized by role:

```
visual-baselines/
  admin/<slug>.png
  user/<slug>.png
  anonymous/<slug>.png
```

The first run for any (role, slug) tuple writes the current screenshot
as the new baseline and the test passes with a "baseline created"
message. Later runs compare per-pixel against the saved baseline; on
mismatch the suite drops `<slug>.actual.png` and `<slug>.diff.png` next
to the baseline and attaches all three to the NUnit test result.

Tunables:

- `MementoSettings.VisualThreshold` — fraction of differing pixels
  allowed before the test fails (default 2%).
- `MEMENTO_SKIP_VISUAL=1` — skip the visual suite entirely (cases are
  reported as Skipped, not Failed).
- `MEMENTO_VISUAL_BASELINES_DIR` — override the baseline root (defaults
  to this directory).

When intentionally re-baselining a screen, delete the baseline PNG and
re-run the suite; commit the regenerated PNG with the change.
