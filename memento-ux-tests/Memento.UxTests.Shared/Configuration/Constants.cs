namespace Memento.UxTests.Shared.Configuration
{
    /// <summary>
    /// Compile-time identifiers shared by the infrastructure and tests
    /// projects. Mirrors the convention from memento's Default C#
    /// architecture (a slim Constants class — runtime defaults belong on
    /// <see cref="MementoSettings"/>).
    /// </summary>
    public static class Constants
    {
        /// <summary>
        /// NUnit category name. Tag a test with
        /// <c>[Category(Constants.STARTTRACER)]</c> to force-enable
        /// Playwright tracing for just that test.
        /// </summary>
        public const string STARTTRACER = "StartTracer";

        // Memento role usernames — match the seeded users created on every
        // api-server boot via seedUsers().
        public const string MementoAdminUsername = "MementoAdminRole";
        public const string AdminUsername = "AdminRole";
        public const string LimitedAdminUsername = "LimitedAdminRole";
        public const string UserUsername = "UserRole";
        public const string SeedPassword = "Temporary1!";

        // Test category names used to opt into the non-functional layers.
        public const string CategoryAccessibility = "Accessibility";
        public const string CategoryPerformance = "Performance";
        public const string CategoryVisual = "Visual";
        public const string CategoryResilience = "Resilience";
        public const string CategoryFunctional = "Functional";
    }
}
