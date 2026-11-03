using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Playwright;
using NUnit.Framework;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Memento.UxTests.Tests.Tests.Visual
{
    /// <summary>
    /// Outcome of a single visual-regression compare.
    /// </summary>
    public enum VisualOutcome
    {
        /// <summary>No baseline existed; the current screenshot was written as the new baseline.</summary>
        BaselineCreated,
        /// <summary>Diff ratio was within the configured threshold.</summary>
        Match,
        /// <summary>Diff ratio exceeded the threshold; diff/actual PNGs were attached.</summary>
        Mismatch,
    }

    /// <summary>
    /// Result of <see cref="VisualBaseline.CaptureAndCompareAsync"/>.
    /// </summary>
    public sealed record VisualResult(
        VisualOutcome Outcome,
        double DiffRatio,
        string BaselinePath,
        string? ActualPath,
        string? DiffPath,
        string Message);

    /// <summary>
    /// Capture/compare/write-diff helper for the visual-regression suite.
    ///
    /// Baselines live under
    /// <c>Memento.UxTests.Tests/visual-baselines/&lt;role&gt;/&lt;slug&gt;.png</c>
    /// (resolved relative to the test project source so they're committed
    /// alongside the tests). On the first run for a slug the current
    /// screenshot is saved as the baseline and the test passes with a
    /// "baseline created" message. On subsequent runs we compare per-pixel
    /// and produce a side-by-side diff PNG when the ratio of differing
    /// pixels exceeds the per-test threshold.
    /// </summary>
    public static class VisualBaseline
    {
        private const int PerChannelTolerance = 24; // 0–255 per RGB channel

        /// <summary>
        /// Capture a full-page screenshot for <paramref name="page"/>,
        /// compare it against the baseline at
        /// <c>visual-baselines/&lt;role&gt;/&lt;slug&gt;.png</c>, and
        /// attach baseline/actual/diff PNGs to the current NUnit test
        /// context. CSS selectors in <paramref name="maskSelectors"/> are
        /// blacked out before the screenshot is taken so known-dynamic
        /// regions (timestamps, sparklines) don't trip the diff.
        /// </summary>
        public static async Task<VisualResult> CaptureAndCompareAsync(
            IPage page,
            string role,
            string slug,
            double threshold,
            IEnumerable<string>? maskSelectors = null)
        {
            var baselinePath = BaselinePath(role, slug);
            Directory.CreateDirectory(Path.GetDirectoryName(baselinePath)!);

            var screenshotOpts = new PageScreenshotOptions
            {
                FullPage = true,
                Animations = ScreenshotAnimations.Disabled,
                Caret = ScreenshotCaret.Hide,
            };

            var masks = (maskSelectors ?? Array.Empty<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => page.Locator(s))
                .ToArray();
            if (masks.Length > 0)
            {
                screenshotOpts.Mask = masks;
            }

            var actualBytes = await page.ScreenshotAsync(screenshotOpts);

            if (!File.Exists(baselinePath))
            {
                await File.WriteAllBytesAsync(baselinePath, actualBytes);
                AttachIfPresent(baselinePath, $"visual-{role}-{slug}-baseline-created");
                return new VisualResult(
                    VisualOutcome.BaselineCreated,
                    0d,
                    baselinePath,
                    ActualPath: null,
                    DiffPath: null,
                    Message: $"Baseline created at {baselinePath}");
            }

            using var actual = Image.Load<Rgba32>(actualBytes);
            using var baseline = Image.Load<Rgba32>(baselinePath);

            // Resize the actual to the baseline if the viewport produced
            // a different size — this keeps the comparison meaningful when
            // a flaky scroll bar or DPR shift changes the pixel count by
            // a few rows.
            if (actual.Width != baseline.Width || actual.Height != baseline.Height)
            {
                actual.Mutate(x => x.Resize(baseline.Width, baseline.Height));
            }

            using var diff = new Image<Rgba32>(baseline.Width, baseline.Height);
            long diffPixels = 0;
            for (int y = 0; y < baseline.Height; y++)
            {
                for (int x = 0; x < baseline.Width; x++)
                {
                    var b = baseline[x, y];
                    var a = actual[x, y];
                    var dr = Math.Abs(b.R - a.R);
                    var dg = Math.Abs(b.G - a.G);
                    var db = Math.Abs(b.B - a.B);
                    if (dr > PerChannelTolerance
                        || dg > PerChannelTolerance
                        || db > PerChannelTolerance)
                    {
                        diff[x, y] = new Rgba32((byte)255, (byte)0, (byte)0, (byte)255);
                        diffPixels++;
                    }
                    else
                    {
                        // Faded baseline so the eye can find the red pixels.
                        diff[x, y] = new Rgba32(b.R, b.G, b.B, (byte)96);
                    }
                }
            }

            var totalPixels = (long)baseline.Width * baseline.Height;
            var ratio = totalPixels == 0 ? 0d : (double)diffPixels / totalPixels;

            if (ratio <= threshold)
            {
                return new VisualResult(
                    VisualOutcome.Match,
                    ratio,
                    baselinePath,
                    ActualPath: null,
                    DiffPath: null,
                    Message: $"Diff {ratio:P3} within threshold {threshold:P3}");
            }

            var dir = Path.GetDirectoryName(baselinePath)!;
            var actualPath = Path.Combine(dir, slug + ".actual.png");
            var diffPath = Path.Combine(dir, slug + ".diff.png");
            await File.WriteAllBytesAsync(actualPath, actualBytes);
            await diff.SaveAsPngAsync(diffPath);

            AttachIfPresent(baselinePath, $"visual-{role}-{slug}-baseline");
            AttachIfPresent(actualPath, $"visual-{role}-{slug}-actual");
            AttachIfPresent(diffPath, $"visual-{role}-{slug}-diff");

            return new VisualResult(
                VisualOutcome.Mismatch,
                ratio,
                baselinePath,
                actualPath,
                diffPath,
                Message: $"Diff {ratio:P3} exceeds threshold {threshold:P3}; "
                    + $"baseline={baselinePath}, actual={actualPath}, diff={diffPath}");
        }

        /// <summary>
        /// Resolves the on-disk path for a baseline. Defaults to a
        /// committed location next to the test project source so that
        /// `git diff` shows what changed; can be overridden by the
        /// <c>MEMENTO_VISUAL_BASELINES_DIR</c> env var.
        /// </summary>
        public static string BaselinePath(string role, string slug)
        {
            var root = Environment.GetEnvironmentVariable("MEMENTO_VISUAL_BASELINES_DIR");
            if (string.IsNullOrWhiteSpace(root))
            {
                // bin/Debug/net8.0/  ->  ../../../visual-baselines (project source)
                root = Path.GetFullPath(Path.Combine(
                    AppContext.BaseDirectory, "..", "..", "..", "visual-baselines"));
            }
            return Path.Combine(root, SafeSegment(role), SafeSegment(slug) + ".png");
        }

        /// <summary>
        /// Turn a route like <c>/tools/test-runs</c> into the slug
        /// <c>tools_test-runs</c> (and <c>/</c> into <c>home</c>) so it
        /// can be used as a filename on every OS.
        /// </summary>
        public static string SlugForRoute(string route)
        {
            if (string.IsNullOrWhiteSpace(route) || route == "/") return "home";
            var trimmed = route.Trim('/');
            return trimmed.Replace('/', '_');
        }

        private static string SafeSegment(string s)
        {
            foreach (var bad in Path.GetInvalidFileNameChars())
            {
                s = s.Replace(bad, '_');
            }
            return s;
        }

        private static void AttachIfPresent(string path, string description)
        {
            try
            {
                if (File.Exists(path))
                {
                    TestContext.AddTestAttachment(path, description);
                }
            }
            catch
            {
                // TestContext may be unavailable in odd hosts; never fail
                // the test for an attachment problem.
            }
        }
    }
}
