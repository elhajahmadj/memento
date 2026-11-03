using System.Threading.Tasks;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Shared.Configuration;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Infrastructure.Fixtures
{
    /// <summary>
    /// Concrete fixture base that signs the browser in as a specific
    /// memento role before every test by reusing a cached storage state
    /// JSON file (see <see cref="RoleSession"/>). Tests inheriting from
    /// <c>RoleFixture</c> always start at the home page (<c>/</c>) of
    /// memento, already authenticated.
    ///
    /// Subclasses override <see cref="Role"/> to pick which seeded user
    /// to drive the test as. Override <see cref="StartPath"/> to land on
    /// a deeper page than <c>/</c>.
    /// </summary>
    public abstract class RoleFixture : TestFixture
    {
        protected abstract MementoRole Role { get; }
        protected virtual string StartPath => "/";

        protected sealed override BrowserNewContextOptions BuildContextOptions()
        {
            var path = RoleSession.EnsureStorageStateAsync(Role).GetAwaiter().GetResult();
            return new BrowserNewContextOptions
            {
                StorageStatePath = path,
                BaseURL = MementoSettings.BaseUrl,
            };
        }

        protected override async Task OnTestFixtureSetupAsync()
        {
            Assert.That(Page, Is.Not.Null, "Page must be initialized before navigation.");
            await Page.GotoAsync(MementoSettings.BaseUrl + StartPath);
            // Splash auto-redirects to home after ~3s; if we land on
            // splash, wait it out.
            if (Page.Url.Contains("/splash"))
            {
                await Page.WaitForURLAsync(url => !url.Contains("/splash"));
            }
            await OnRoleFixtureSetupAsync();
        }

        protected virtual Task OnRoleFixtureSetupAsync() => Task.CompletedTask;
    }

    public abstract class MementoAdminFixture : RoleFixture
    {
        protected override MementoRole Role => MementoRole.MementoAdmin;
    }

    public abstract class AdminFixture : RoleFixture
    {
        protected override MementoRole Role => MementoRole.Admin;
    }

    public abstract class LimitedAdminFixture : RoleFixture
    {
        protected override MementoRole Role => MementoRole.LimitedAdmin;
    }

    public abstract class UserFixture : RoleFixture
    {
        protected override MementoRole Role => MementoRole.User;
    }
}
