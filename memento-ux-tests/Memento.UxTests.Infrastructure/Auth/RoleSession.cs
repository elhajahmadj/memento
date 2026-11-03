using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Microsoft.Playwright;

namespace Memento.UxTests.Infrastructure.Auth
{
    /// <summary>
    /// Roles supported by memento. The string value matches the seeded
    /// usernames so a test can map straight from a role to credentials.
    /// </summary>
    public enum MementoRole
    {
        MementoAdmin,
        Admin,
        LimitedAdmin,
        User,
    }

    /// <summary>
    /// Caches a Playwright storage-state JSON file per role so each test
    /// can launch with an already-signed-in cookie instead of paying for
    /// a fresh UI login. The cache lives on disk under
    /// <c>TestResults/Storage/&lt;role&gt;.json</c> and is regenerated
    /// when missing.
    ///
    /// The login itself is driven through the real <c>/login</c> form
    /// (the api-server's <c>POST /api/auth/login</c> endpoint) using a
    /// short-lived headless context. We don't depend on the dev-only
    /// <c>/auth/dev-login</c> shortcut so the suite works against
    /// production-style builds too.
    /// </summary>
    public static class RoleSession
    {
        private static readonly ConcurrentDictionary<MementoRole, string> _cache =
            new ConcurrentDictionary<MementoRole, string>();
        private static readonly SemaphoreSlim _lock = new SemaphoreSlim(1, 1);

        public static RoleCredentials CredentialsFor(MementoRole role) => role switch
        {
            MementoRole.MementoAdmin => MementoSettings.MementoAdminCredentials,
            MementoRole.Admin        => MementoSettings.AdminCredentials,
            MementoRole.LimitedAdmin => MementoSettings.LimitedAdminCredentials,
            MementoRole.User         => MementoSettings.UserCredentials,
            _ => throw new ArgumentOutOfRangeException(nameof(role)),
        };

        /// <summary>
        /// Ensures a storage-state JSON file exists for the given role
        /// and returns the absolute path. Safe to call concurrently.
        /// </summary>
        public static async Task<string> EnsureStorageStateAsync(MementoRole role)
        {
            if (_cache.TryGetValue(role, out var cached) && File.Exists(cached))
                return cached;

            await _lock.WaitAsync();
            try
            {
                if (_cache.TryGetValue(role, out cached) && File.Exists(cached))
                    return cached;

                var dir = StorageDirectory();
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, $"{role}.json");

                await SignInToStorageAsync(role, path);
                _cache[role] = path;
                return path;
            }
            finally
            {
                _lock.Release();
            }
        }

        /// <summary>
        /// Forces a fresh login for the role (e.g. after a role change in
        /// a test). The next caller of <see cref="EnsureStorageStateAsync"/>
        /// will rebuild the cached storage state.
        /// </summary>
        public static void InvalidateCachedStorage(MementoRole role)
        {
            if (_cache.TryRemove(role, out var path) && File.Exists(path))
            {
                try { File.Delete(path); } catch { /* best-effort */ }
            }
        }

        private static async Task SignInToStorageAsync(MementoRole role, string path)
        {
            var creds = CredentialsFor(role);

            using var pw = await Playwright.CreateAsync();
            await using var browser = await pw.Chromium.LaunchAsync(new()
            {
                Headless = true,
            });
            await using var ctx = await browser.NewContextAsync();
            var page = await ctx.NewPageAsync();

            await page.GotoAsync(MementoSettings.BaseUrl + "/login");
            // Two-step sign-in: type the username, click Next, then
            // wait for the password field to appear before filling.
            await page.GetByTestId("input-username").FillAsync(creds.Username);
            await page.GetByTestId("button-next").ClickAsync();
            await page.GetByTestId("input-password").WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = MementoSettings.PlaywrightTimeout,
            });
            await page.GetByTestId("input-password").FillAsync(creds.Password);
            await page.GetByTestId("button-sign-in").ClickAsync();

            // Wait for the splash redirect to land somewhere authenticated.
            await page.WaitForURLAsync(url => !url.Contains("/login"), new()
            {
                Timeout = MementoSettings.PlaywrightTimeout,
            });

            await ctx.StorageStateAsync(new() { Path = path });
        }

        private static string StorageDirectory() =>
            Path.Combine(AppContext.BaseDirectory, "TestResults", "Storage");
    }
}
