namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    public static class DocumentationSelectors
    {
        public const string Layout = "documentation-layout";
        public const string Sidebar = "documentation-sidebar";
        public const string Main = "documentation-main";
        public const string Title = "text-documentation-title";
        public const string Empty = "documentation-empty";
        public static string Nav(string sectionId) => $"documentation-nav-{sectionId}";
        public static string Section(string sectionId) => $"documentation-section-{sectionId}";
        public static string Heading(string sectionId) => $"documentation-heading-{sectionId}";
    }

    public static class AboutSelectors
    {
        public const string CardCreator = "card-about-creator";
        public const string LinkCreatorEmail = "link-about-creator-email";
        public const string TextCreatorName = "text-about-creator-name";
        public const string TextCreatorTitle = "text-about-creator-title";
        public const string TextTitle = "text-about-title";
        public const string TextVersion = "text-about-version";
    }

    public static class OnboardingTourSelectors
    {
        public const string Overlay = "onboarding-tour-overlay";
        public const string Card = "onboarding-tour-card";
        public const string Title = "text-tour-title";
        public const string Body = "text-tour-body";
        public const string ButtonNext = "button-tour-next";
        public const string ButtonPrev = "button-tour-prev";
        public const string ButtonFinish = "button-tour-finish";
        public const string ButtonClose = "button-tour-close";
    }
}
