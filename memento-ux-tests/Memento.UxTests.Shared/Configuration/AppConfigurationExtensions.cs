using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;

namespace Memento.UxTests.Shared.Configuration
{
    /// <summary>
    /// Configuration helpers shared by the infrastructure and test
    /// projects. Mirrors memento's own AppConfigurationExtensions: builds
    /// the <see cref="IConfigurationRoot"/> the same way no matter where
    /// the test host is launched from, then projects it onto the
    /// strongly-typed <see cref="MementoSettings"/> surface.
    /// </summary>
    public static class AppConfigurationExtensions
    {
        public static IConfigurationRoot GetConfiguration()
        {
            return new ConfigurationBuilder()
                .SetBasePath(AppContext.BaseDirectory)
                .AddJsonFile("appsettings.json", optional: true, reloadOnChange: false)
                // appsettings.local.json is .gitignored — used to override
                // BaseUrl / credentials for a developer's local box without
                // mutating the committed defaults.
                .AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: false)
                .AddEnvironmentVariables(prefix: "MEMENTO_UX_")
                .AddEnvironmentVariables()
                .Build();
        }

        public static string GetAppSetting(this IConfiguration configuration, string key)
        {
            return configuration[key] ?? string.Empty;
        }

        public static bool IsLocalEnv(this IConfiguration configuration)
        {
            var env = configuration["Environment"]
                ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
                ?? "Local";

            return string.Equals(env, "Local", StringComparison.OrdinalIgnoreCase)
                || string.Equals(env, "Development", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Hydrate <see cref="MementoSettings"/> from the supplied
        /// configuration. Missing or malformed entries leave the existing
        /// default in place so the call is safe to repeat.
        /// </summary>
        public static IConfiguration LoadMementoSettings(this IConfiguration configuration)
        {
            if (configuration == null) throw new ArgumentNullException(nameof(configuration));

            MementoSettings.DefaultBrowser =
                configuration["DefaultBrowser"] ?? MementoSettings.DefaultBrowser;

            if (bool.TryParse(configuration["UseChromium"], out var useChromium))
                MementoSettings.UseChromium = useChromium;

            if (bool.TryParse(configuration["RunHeadless"], out var headless))
                MementoSettings.RunHeadless = headless;
            else if (bool.TryParse(configuration["Headless"], out headless))
                MementoSettings.RunHeadless = headless;

            if (bool.TryParse(configuration["StartTracer"], out var startTracer))
                MementoSettings.StartTracer = startTracer;

            if (int.TryParse(configuration["PlaywrightTimeout"], out var timeout))
                MementoSettings.PlaywrightTimeout = timeout;

            if (int.TryParse(configuration["PerformanceBudgetMs"], out var perfBudget))
                MementoSettings.PerformanceBudgetMs = perfBudget;

            if (int.TryParse(configuration["UnauthenticatedPerformanceBudgetMs"], out var unauthBudget))
                MementoSettings.UnauthenticatedPerformanceBudgetMs = unauthBudget;

            if (int.TryParse(configuration["LargestContentfulPaintBudgetMs"], out var lcpBudget))
                MementoSettings.LargestContentfulPaintBudgetMs = lcpBudget;

            if (int.TryParse(
                    configuration["UnauthenticatedLargestContentfulPaintBudgetMs"],
                    out var unauthLcpBudget))
                MementoSettings.UnauthenticatedLargestContentfulPaintBudgetMs = unauthLcpBudget;

            if (double.TryParse(
                    configuration["CumulativeLayoutShiftBudget"],
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var clsBudget))
                MementoSettings.CumulativeLayoutShiftBudget = clsBudget;

            if (int.TryParse(configuration["TimeToInteractiveBudgetMs"], out var ttiBudget))
                MementoSettings.TimeToInteractiveBudgetMs = ttiBudget;

            if (int.TryParse(
                    configuration["UnauthenticatedTimeToInteractiveBudgetMs"],
                    out var unauthTtiBudget))
                MementoSettings.UnauthenticatedTimeToInteractiveBudgetMs = unauthTtiBudget;

            if (double.TryParse(
                    configuration["VisualThreshold"],
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var visualThreshold))
                MementoSettings.VisualThreshold = visualThreshold;

            // MEMENTO_SKIP_VISUAL=1 (or true) opts out of the visual suite
            // for fast dev loops. Honor either the prefixed or unprefixed
            // env var, plus a plain appsettings key for parity.
            var skipVisualRaw =
                Environment.GetEnvironmentVariable("MEMENTO_SKIP_VISUAL")
                ?? configuration["SkipVisual"];
            MementoSettings.SkipVisual = ParseSkipFlag(skipVisualRaw);

            MementoSettings.BaseUrl =
                configuration["BaseUrl"] ?? MementoSettings.BaseUrl;

            MementoSettings.Environment =
                configuration["Environment"] ?? MementoSettings.Environment;

            MementoSettings.MementoAdminCredentials = ResolveRole(
                configuration, "Roles:MementoAdmin",
                fallback: MementoSettings.MementoAdminCredentials);

            MementoSettings.AdminCredentials = ResolveRole(
                configuration, "Roles:Admin",
                fallback: MementoSettings.AdminCredentials);

            MementoSettings.LimitedAdminCredentials = ResolveRole(
                configuration, "Roles:LimitedAdmin",
                fallback: MementoSettings.LimitedAdminCredentials);

            MementoSettings.UserCredentials = ResolveRole(
                configuration, "Roles:User",
                fallback: MementoSettings.UserCredentials);

            var urls = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var entry in configuration.GetSection("Urls").GetChildren())
            {
                urls[entry.Key] = entry.Value ?? string.Empty;
            }
            if (urls.Count > 0) MementoSettings.Urls = urls;

            return configuration;
        }

        private static bool ParseSkipFlag(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return false;
            var trimmed = raw.Trim();
            if (trimmed == "0") return false;
            if (string.Equals(trimmed, "false", StringComparison.OrdinalIgnoreCase))
                return false;
            return true;
        }

        private static RoleCredentials ResolveRole(
            IConfiguration configuration,
            string sectionPath,
            RoleCredentials fallback)
        {
            var section = configuration.GetSection(sectionPath);
            if (!section.Exists()) return fallback;

            var username = section["Username"];
            var password = section["Password"];
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return fallback;

            return new RoleCredentials(username, password);
        }
    }
}
