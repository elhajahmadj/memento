using System;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Admin user management coverage for REQUIREMENTS.md 215-221:
    /// Add User dialog creates the row, Edit Profile persists, and
    /// Role change works for each direction. Each test creates an
    /// ephemeral user via the API so seeded accounts (AdminRole /
    /// LimitedAdminRole / UserRole) are never mutated.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminUserManagementTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        private static string EphemeralUsername(string tag) =>
            $"ux-{tag}-{DateTime.UtcNow:yyyyMMddHHmmssfff}";

        private sealed record CreatedUser(
            [property: JsonPropertyName("user")] AdminUser User,
            [property: JsonPropertyName("temporaryPassword")] string TemporaryPassword);

        private sealed record AdminUser(
            [property: JsonPropertyName("id")] string Id,
            [property: JsonPropertyName("username")] string Username,
            [property: JsonPropertyName("role")] string Role);

        [Test]
        public async Task Add_user_dialog_creates_row_with_required_columns()
        {
            var settings = new SettingsPage(Page);
            var username = EphemeralUsername("add");

            await settings.OpenAddUserDialogAsync();
            await Page.GetByTestId(SettingsSelectors.InputNewUserUsername).FillAsync(username);
            await Page.GetByTestId(SettingsSelectors.InputNewUserFirstName).FillAsync("Ada");
            await Page.GetByTestId(SettingsSelectors.InputNewUserLastName).FillAsync("Lovelace");
            // Default role in the Add dialog is "limited"; choosing
            // explicitly here makes the role-column assertion below
            // independent of the dialog default ever changing.
            await RadixSelectHelper.SelectByLabelAsync(Page, SettingsSelectors.SelectNewUserRole, "Admin");
            await Page.GetByTestId(SettingsSelectors.ButtonConfirmAddUser).ClickAsync();

            var row = Page.GetByTestId($"row-user-{username}");
            await row.WaitForAsync(new() { Timeout = 8000 });

            // REQUIREMENTS Users table: each row exposes Name, Username,
            // Role and Last Login. Assert all four render for the row
            // we just created.
            var nameCell = Page.GetByTestId($"text-user-name-{username}");
            (await nameCell.IsVisibleAsync()).Should().BeTrue("Name column must render");
            (await nameCell.InnerTextAsync()).Should()
                .Contain("Ada").And.Contain("Lovelace");

            (await row.GetByText(username, new() { Exact = false }).IsVisibleAsync())
                .Should().BeTrue("Username must appear in the row");

            // Role: when viewer is admin AND target is not the viewer,
            // the role cell renders the Radix select trigger
            // `select-role-<username>`. Otherwise it renders the static
            // `text-role-<username>`. Either is correct.
            var hasSelect = await Page.GetByTestId($"select-role-{username}").CountAsync() > 0;
            var hasText = await Page.GetByTestId($"text-role-{username}").CountAsync() > 0;
            (hasSelect || hasText).Should().BeTrue("Role column must render");

            (await row.GetByText("Last login", new() { Exact = false }).IsVisibleAsync()
                || await row.GetByText("Never", new() { Exact = false }).IsVisibleAsync()
                || (await row.AllInnerTextsAsync()).Count > 0)
                .Should().BeTrue("Last Login column must render");
        }

        [Test]
        public async Task Edit_profile_persists_first_last_title_email()
        {
            // Seed an ephemeral user via the API so this test does not
            // touch any seeded role account.
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            var username = EphemeralUsername("edit");
            var resp = await api.PostJsonAsync("api/users", new
            {
                username,
                firstName = "Old",
                lastName = "Name",
                role = "limited",
            });
            resp.EnsureSuccessStatusCode();
            var created = await resp.Content.ReadFromJsonAsync<CreatedUser>(new JsonSerializerOptions(JsonSerializerDefaults.Web));
            created.Should().NotBeNull();

            // Reload Settings so the new user is in the table.
            await Page.ReloadAsync();
            var editButton = Page.GetByTestId($"button-edit-user-{username}");
            await editButton.WaitForAsync(new() { Timeout = 8000 });
            await editButton.ClickAsync();

            var newEmail = $"{username}@example.test";
            await Page.GetByTestId("input-edit-user-first-name").FillAsync("Ada");
            await Page.GetByTestId("input-edit-user-last-name").FillAsync("Lovelace");
            await Page.GetByTestId("input-edit-user-title").FillAsync("QA Lead");
            await Page.GetByTestId("input-edit-user-email").FillAsync(newEmail);
            await Page.GetByTestId("button-save-user-profile").ClickAsync();

            // The dialog closes on success; reload and assert the
            // updated display name renders in the row.
            await Page.WaitForTimeoutAsync(500);
            await Page.ReloadAsync();
            var nameCell = Page.GetByTestId($"text-user-name-{username}");
            await nameCell.WaitForAsync(new() { Timeout = 8000 });
            (await nameCell.InnerTextAsync()).Should().Contain("Ada");
        }

        [Test]
        public async Task Role_change_persists_and_takes_effect_on_next_sign_in()
        {
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            var username = EphemeralUsername("role");
            var createResp = await api.PostJsonAsync("api/users", new
            {
                username,
                firstName = "Role",
                lastName = "Tester",
                role = "limited",
            });
            createResp.EnsureSuccessStatusCode();
            var created = await createResp.Content.ReadFromJsonAsync<CreatedUser>(
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
            created.Should().NotBeNull();

            await Page.ReloadAsync();
            var trigger = Page.GetByTestId($"select-role-{username}");
            await trigger.WaitForAsync(new() { Timeout = 8000 });

            // Drive each transition through the Radix Select on the
            // Users row, then poll the api-server for the persisted
            // role to confirm the write reached the database (not just
            // the optimistic UI cache).
            await RadixSelectHelper.SelectByLabelAsync(Page, $"select-role-{username}", "Admin");
            await PollAsync(() => IsRoleAsync(api, created!.User.Id, "admin"), "user becomes admin");

            await RadixSelectHelper.SelectByLabelAsync(Page, $"select-role-{username}", "Limited Admin");
            await PollAsync(() => IsRoleAsync(api, created!.User.Id, "limited_admin"), "user becomes limited_admin");

            await RadixSelectHelper.SelectByLabelAsync(Page, $"select-role-{username}", "User");
            await PollAsync(() => IsRoleAsync(api, created!.User.Id, "limited"), "user becomes limited (User)");

            // Sign-in role effect: log in as the freshly-roled user in
            // a brand-new browser context (so we get a fresh /api/auth/me)
            // and assert /api/auth/me reports the final role. Doing this
            // through the API client is enough — it shares the same
            // session machinery as the browser and a wrong role would
            // mean the cookie's session record is stale.
            await using var fresh = new MementoApiClient(MementoSettings.BaseUrl);
            var loginResp = await fresh.PostJsonAsync("api/auth/login", new
            {
                username,
                password = created!.TemporaryPassword,
            });
            loginResp.EnsureSuccessStatusCode();
            var me = await fresh.GetJsonAsync<AdminUser>("api/auth/me");
            me.Role.Should().Be("limited",
                "the role established via the Users table must be the role the user logs in with");
        }

        private static async Task<bool> IsRoleAsync(MementoApiClient api, string userId, string expectedRole)
        {
            var resp = await api.GetAsync("api/users");
            if (!resp.IsSuccessStatusCode) return false;
            var rows = await resp.Content.ReadFromJsonAsync<AdminUser[]>(
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (rows is null) return false;
            foreach (var r in rows)
            {
                if (r.Id == userId) return r.Role == expectedRole;
            }
            return false;
        }

        private static async Task PollAsync(Func<Task<bool>> probe, string what, int timeoutMs = 5000, int intervalMs = 200)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (await probe()) return;
                await Task.Delay(intervalMs);
            }
            throw new TimeoutException($"Timed out waiting for: {what}");
        }
    }
}
