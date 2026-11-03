using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Shared.Configuration;

namespace Memento.UxTests.Infrastructure.Api
{
    /// <summary>
    /// Thin HTTP wrapper around memento's <c>/api/*</c> surface for test
    /// setup / teardown that doesn't need to go through the UI (creating
    /// the UX-tests project, seeding forks, resetting mocks, ...). Holds
    /// a session cookie per role.
    ///
    /// Tests should NOT use this for assertions — assertions belong on
    /// the UI via page objects. This is purely an idempotent setup /
    /// teardown helper.
    /// </summary>
    public sealed class MementoApiClient : IAsyncDisposable
    {
        private readonly HttpClient _http;
        private readonly HttpClientHandler _handler;

        public MementoApiClient(string baseUrl)
        {
            _handler = new HttpClientHandler { UseCookies = true, AllowAutoRedirect = true };
            _http = new HttpClient(_handler) { BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/") };
        }

        /// <summary>Construct, log in as the given role, and return.</summary>
        public static async Task<MementoApiClient> SignedInAsAsync(MementoRole role)
        {
            var client = new MementoApiClient(MementoSettings.BaseUrl);
            await client.LoginAsync(role);
            return client;
        }

        public async Task LoginAsync(MementoRole role)
        {
            var creds = RoleSession.CredentialsFor(role);
            var resp = await _http.PostAsJsonAsync("api/auth/login", new
            {
                username = creds.Username,
                password = creds.Password,
            });
            resp.EnsureSuccessStatusCode();
        }

        public async Task<HttpResponseMessage> GetAsync(string path) =>
            await _http.GetAsync(path.TrimStart('/'));

        public async Task<HttpResponseMessage> PostJsonAsync(string path, object body) =>
            await _http.PostAsJsonAsync(path.TrimStart('/'), body);

        public async Task<HttpResponseMessage> PatchJsonAsync(string path, object body)
        {
            var req = new HttpRequestMessage(HttpMethod.Patch, path.TrimStart('/'))
            {
                Content = JsonContent.Create(body),
            };
            return await _http.SendAsync(req);
        }

        public async Task<HttpResponseMessage> DeleteAsync(string path) =>
            await _http.DeleteAsync(path.TrimStart('/'));

        public async Task<HttpResponseMessage> PutJsonAsync(string path, object body) =>
            await _http.PutAsJsonAsync(path.TrimStart('/'), body);

        /// <summary>
        /// GET <paramref name="path"/> and deserialize the JSON body into
        /// <typeparamref name="T"/>. Throws on non-2xx responses so test
        /// setup fails fast instead of silently returning <c>default</c>.
        /// </summary>
        public async Task<T> GetJsonAsync<T>(string path)
        {
            var resp = await GetAsync(path);
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<T>(_jsonOptions);
            if (body is null)
                throw new InvalidOperationException($"GET {path} returned null body");
            return body;
        }

        /// <summary>
        /// POST a JSON body to <paramref name="path"/> and deserialize the
        /// response into <typeparamref name="T"/>. Throws on non-2xx so
        /// test setup fails fast.
        /// </summary>
        public async Task<T> PostJsonAsync<T>(string path, object body)
        {
            var resp = await PostJsonAsync(path, body);
            resp.EnsureSuccessStatusCode();
            var parsed = await resp.Content.ReadFromJsonAsync<T>(_jsonOptions);
            if (parsed is null)
                throw new InvalidOperationException($"POST {path} returned null body");
            return parsed;
        }

        private static readonly JsonSerializerOptions _jsonOptions =
            new(JsonSerializerDefaults.Web);

        // ------------------------------------------------------------
        // Onboarding tour helpers — used by tests to reset the
        // `users.has_seen_tour` flag so the overlay reliably auto-launches
        // (or doesn't) for a per-test seeded user.
        // ------------------------------------------------------------

        private static readonly JsonSerializerOptions s_json = new()
        {
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        public sealed record TourState(
            [property: JsonPropertyName("hasSeenTour")] bool HasSeenTour);

        public async Task<TourState> GetTourStateAsync()
        {
            var resp = await _http.GetAsync("api/users/me/tour-state");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<TourState>(body, s_json)
                ?? new TourState(false);
        }

        public async Task<TourState> SetTourSeenAsync(bool hasSeenTour)
        {
            var resp = await _http.PostAsJsonAsync(
                "api/users/me/tour-seen",
                new { hasSeenTour });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<TourState>(body, s_json)
                ?? new TourState(hasSeenTour);
        }

        /// <summary>
        /// Convenience: log in as the given role, force tour state to
        /// the requested value, and return the resulting state. The
        /// HTTP session is disposed before the method returns so it
        /// does not interfere with parallel tests.
        /// </summary>
        public static async Task<TourState> ForceTourSeenAsync(
            MementoRole role, bool hasSeenTour)
        {
            await using var client = await SignedInAsAsync(role);
            return await client.SetTourSeenAsync(hasSeenTour);
        }

        public static async Task<TourState> ReadTourStateAsync(MementoRole role)
        {
            await using var client = await SignedInAsAsync(role);
            return await client.GetTourStateAsync();
        }

        // ------------------------------------------------------------
        // User creation — used for first-run scenarios (e.g. profile
        // completion) where we cannot mutate a seeded account.
        // ------------------------------------------------------------

        public sealed record CreatedUserAdmin(
            [property: JsonPropertyName("id")] string Id,
            [property: JsonPropertyName("username")] string Username,
            [property: JsonPropertyName("role")] string Role);

        public sealed record CreatedUserResponse(
            [property: JsonPropertyName("user")] CreatedUserAdmin User,
            [property: JsonPropertyName("temporaryPassword")] string TemporaryPassword);

        public async Task<CreatedUserResponse> CreateUserAsync(
            string username, string role)
        {
            var resp = await _http.PostAsJsonAsync(
                "api/users",
                new { username, role });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<CreatedUserResponse>(body, s_json)
                ?? throw new InvalidOperationException(
                    "POST /api/users returned no body.");
        }

        public static async Task<CreatedUserResponse> CreateUserAsAdminAsync(
            string username, string role = "limited")
        {
            // Role values come from AdminUserRole in the OpenAPI spec:
            // admin | limited_admin | limited. The seeded plain-User
            // fixture uses "limited", so default to that.
            await using var client = await SignedInAsAsync(MementoRole.Admin);
            return await client.CreateUserAsync(username, role);
        }

        public static async Task DeleteUserAsAdminAsync(string userId)
        {
            // Delete a per-test user via DELETE /api/users/:id. 404 is
            // tolerated so repeated teardown attempts (or tests that
            // already removed the row through the UI) stay idempotent.
            await using var client = await SignedInAsAsync(MementoRole.Admin);
            var resp = await client._http.DeleteAsync(
                $"api/users/{Uri.EscapeDataString(userId)}");
            if ((int)resp.StatusCode != 204 && (int)resp.StatusCode != 404)
            {
                resp.EnsureSuccessStatusCode();
            }
        }

        // ------------------------------------------------------------
        // Tier-3 — Route mocks. CRUD against /api/route-mocks. Used by
        // Tier3FeatureTests both as a SETUP / TEARDOWN tool (drain a
        // user's mocks for a given project before driving the UI) and
        // as an ASSERTION channel (after driving the UI, fetch the
        // server-side state to confirm persistence).
        // ------------------------------------------------------------

        public sealed record RouteMockDto(
            [property: JsonPropertyName("id")] string Id,
            [property: JsonPropertyName("userId")] string UserId,
            [property: JsonPropertyName("projectName")] string ProjectName,
            [property: JsonPropertyName("name")] string Name,
            [property: JsonPropertyName("method")] string Method,
            [property: JsonPropertyName("urlPattern")] string UrlPattern,
            [property: JsonPropertyName("status")] int Status,
            [property: JsonPropertyName("enabled")] bool Enabled);

        public sealed record RouteMockListResponse(
            [property: JsonPropertyName("mocks")] System.Collections.Generic.List<RouteMockDto> Mocks);

        public async Task<System.Collections.Generic.List<RouteMockDto>> ListRouteMocksAsync(
            string projectName)
        {
            var resp = await _http.GetAsync(
                $"api/route-mocks?projectName={Uri.EscapeDataString(projectName)}");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return (JsonSerializer.Deserialize<RouteMockListResponse>(body, s_json)
                    ?? new RouteMockListResponse(new())).Mocks;
        }

        public async Task<RouteMockDto> CreateRouteMockAsync(
            string projectName,
            string name,
            string method,
            string urlPattern,
            int status,
            bool enabled = true,
            object? bodyJson = null)
        {
            var resp = await _http.PostAsJsonAsync("api/route-mocks", new
            {
                projectName,
                name,
                method,
                urlPattern,
                status,
                enabled,
                bodyJson,
            });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<RouteMockDto>(body, s_json)
                ?? throw new InvalidOperationException(
                    "POST /api/route-mocks returned no body.");
        }

        public async Task DeleteRouteMockAsync(string id)
        {
            var resp = await _http.DeleteAsync($"api/route-mocks/{Uri.EscapeDataString(id)}");
            // 404 is fine on cleanup — row may have already been removed
            // by the UI under test.
            if ((int)resp.StatusCode != 204 && (int)resp.StatusCode != 404)
                resp.EnsureSuccessStatusCode();
        }

        /// <summary>
        /// Best-effort drain of every route mock the signed-in user owns
        /// for <paramref name="projectName"/>. Safe to call from
        /// <c>[SetUp]</c> and <c>[TearDown]</c> to keep the
        /// per-user / per-project state deterministic across tests.
        /// </summary>
        public async Task ClearRouteMocksAsync(string projectName)
        {
            var mocks = await ListRouteMocksAsync(projectName);
            foreach (var m in mocks)
            {
                await DeleteRouteMockAsync(m.Id);
            }
        }

        // ------------------------------------------------------------
        // Tier-3 — Demo project. Idempotent scaffold + load of the
        // `MementoDemo` sample C# solution that pre-seeds the Tier-3
        // assertion catalog (route-mock + apiAssertion + axe + visual
        // baseline). Kept here so tests can prove the demo-card flow
        // end-to-end without driving the home page UI directly when a
        // headless driver is too slow / flaky.
        // ------------------------------------------------------------

        public sealed record DemoProjectResponse(
            [property: JsonPropertyName("slnPath")] string SlnPath,
            [property: JsonPropertyName("solutionName")] string SolutionName,
            [property: JsonPropertyName("seededTestMethods")]
                System.Collections.Generic.List<string> SeededTestMethods,
            [property: JsonPropertyName("seededMocks")]
                System.Collections.Generic.List<string> SeededMocks);

        public async Task<DemoProjectResponse> EnsureDemoProjectAsync()
        {
            var resp = await _http.PostAsJsonAsync(
                "api/projects/demo", new { });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<DemoProjectResponse>(body, s_json)
                ?? throw new InvalidOperationException(
                    "POST /api/projects/demo returned no body.");
        }

        // ------------------------------------------------------------
        // Tier-3 — Files API. Read-only access used to spot-check the
        // generated test source for per-language Tier-3 codegen calls
        // (Page.RouteAsync, Page.APIRequest, AxeBuilder, ToHaveScreenshot...).
        // ------------------------------------------------------------

        public sealed record FileContentResponse(
            [property: JsonPropertyName("path")] string Path,
            [property: JsonPropertyName("content")] string Content);

        public async Task<string> ReadProjectFileAsync(string path)
        {
            var resp = await _http.GetAsync(
                $"api/files?path={Uri.EscapeDataString(path)}");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            var parsed = JsonSerializer.Deserialize<FileContentResponse>(body, s_json);
            return parsed?.Content ?? string.Empty;
        }

        // ------------------------------------------------------------
        // Tier-3 — Validation runs polling. Replicates the per-row UI
        // poll in C#: queues a run, then waits for the server-side row
        // to reach a terminal status. Used by the codegen-driven
        // end-to-end tests so we can drive the same path the workbench
        // does without depending on the WebSocket subscription.
        // ------------------------------------------------------------

        public sealed record ValidationRunCreated(
            [property: JsonPropertyName("id")] string Id);

        public sealed record ValidationRunRow(
            [property: JsonPropertyName("id")] string Id,
            [property: JsonPropertyName("status")] string Status);

        public async Task<string> EnqueueValidationRunAsync(
            string filePath,
            string kind,
            string? methodName)
        {
            var resp = await _http.PostAsJsonAsync("api/validation/runs", new
            {
                filePath,
                kind,
                methodName,
            });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            var parsed = JsonSerializer.Deserialize<ValidationRunCreated>(body, s_json)
                ?? throw new InvalidOperationException(
                    "POST /api/validation/runs returned no body.");
            return parsed.Id;
        }

        public async Task<string?> WaitForRunTerminalAsync(
            string runId, int timeoutMs = 90000)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                var resp = await _http.GetAsync($"api/validation/runs/{runId}");
                if (resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync();
                    var row = JsonSerializer.Deserialize<ValidationRunRow>(body, s_json);
                    var status = row?.Status ?? "";
                    if (status is "passed" or "failed" or "error" or "Passed" or "Failed" or "Error")
                        return status;
                }
                await Task.Delay(750);
            }
            return null;
        }

        // ------------------------------------------------------------
        // Tier-3 — Validation event subscription. Connects to the
        // /ws/validation/<runId> stream the workbench uses, drains
        // events until run-finished or the timeout expires, and hands
        // them back as parsed dictionaries. Lets a UX test prove that
        // the recorder produced the per-Tier-3-feature step events
        // (route-mock install, step-passed/failed for accessibility,
        // visual-baseline, apiAssertion).
        // ------------------------------------------------------------

        public sealed record ValidationEvent(
            string Type,
            string? AssertKind,
            int? Index,
            string? Status,
            string? Error,
            JsonElement Raw);

        public async Task<List<ValidationEvent>> CollectValidationEventsAsync(
            string runId,
            int timeoutMs = 120000)
        {
            var events = new List<ValidationEvent>();
            var baseUri = new Uri(MementoSettings.BaseUrl);
            var wsScheme = baseUri.Scheme == "https" ? "wss" : "ws";
            var wsUri = new Uri($"{wsScheme}://{baseUri.Authority}/ws/validation/{runId}");

            using var ws = new ClientWebSocket();
            // Forward the session cookie so the WS upgrade is authorized.
            var cookies = _handler.CookieContainer.GetCookieHeader(baseUri);
            if (!string.IsNullOrEmpty(cookies))
            {
                ws.Options.SetRequestHeader("Cookie", cookies);
            }

            using var cts = new CancellationTokenSource(timeoutMs);
            try
            {
                await ws.ConnectAsync(wsUri, cts.Token);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"Could not open validation WS at {wsUri}: {ex.Message}", ex);
            }

            var buffer = new byte[16 * 1024];
            var sb = new StringBuilder();
            while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
            {
                WebSocketReceiveResult result;
                try
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                if (result.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue;

                var payload = sb.ToString();
                sb.Clear();
                JsonElement root;
                try
                {
                    root = JsonDocument.Parse(payload).RootElement;
                }
                catch
                {
                    continue;
                }
                var ev = ParseValidationEvent(root);
                events.Add(ev);
                if (ev.Type == "run-finished") break;
            }
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None); } catch { }
            return events;
        }

        private static ValidationEvent ParseValidationEvent(JsonElement root)
        {
            string type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";
            string? assertKind = root.TryGetProperty("assertKind", out var ak) && ak.ValueKind == JsonValueKind.String ? ak.GetString() : null;
            int? index = root.TryGetProperty("index", out var idx) && idx.ValueKind == JsonValueKind.Number ? idx.GetInt32() : null;
            string? status = root.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
            string? error = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
            return new ValidationEvent(type, assertKind, index, status, error, root.Clone());
        }

        // ------------------------------------------------------------
        // Tier-3 — Project scaffolding. Used by the Node.js codegen
        // spot-check (covers the "alongside C#" half of the task) and
        // by the demo-card UI test that wants to read the freshly
        // loaded project's name back through the public API.
        // ------------------------------------------------------------

        public sealed record CreatedProjectResponse(
            [property: JsonPropertyName("project")] CreatedProject Project);

        public sealed record CreatedProject(
            [property: JsonPropertyName("solutionName")] string SolutionName,
            [property: JsonPropertyName("language")] string Language);

        public sealed record CurrentProjectResponse(
            [property: JsonPropertyName("project")] CurrentProject? Project);

        public sealed record CurrentProject(
            [property: JsonPropertyName("solutionName")] string SolutionName,
            [property: JsonPropertyName("language")] string Language);

        public async Task<CreatedProject> CreateProjectAsync(
            string solutionName,
            string language,
            string? @namespace = null)
        {
            var resp = await _http.PostAsJsonAsync("api/projects", new
            {
                solutionName,
                language,
                @namespace = @namespace ?? solutionName,
            });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            var parsed = JsonSerializer.Deserialize<CreatedProjectResponse>(body, s_json)
                ?? throw new InvalidOperationException("POST /api/projects returned no body.");
            return parsed.Project;
        }

        public async Task<CurrentProject?> GetCurrentProjectAsync()
        {
            var resp = await _http.GetAsync("api/projects/current");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            var parsed = JsonSerializer.Deserialize<CurrentProjectResponse>(body, s_json);
            return parsed?.Project;
        }

        // ------------------------------------------------------------
        // Tier-3 — Visual baseline / diff PNG persistence. Lets the
        // visual-baseline lifecycle test confirm the recorder wrote
        // (or refreshed) the baseline image on disk.
        // ------------------------------------------------------------

        public async Task<bool> VisualDiffPngExistsAsync(string runId, string absPath)
        {
            var resp = await _http.GetAsync(
                $"api/validation/runs/{runId}/visual-diff?path={Uri.EscapeDataString(absPath)}");
            // 200 = PNG present and readable; 404 = path doesn't exist
            // yet; anything else (403/400) is a real error and we treat
            // it as "not present" so callers can re-poll without throwing.
            return resp.StatusCode == HttpStatusCode.OK;
        }

        public ValueTask DisposeAsync()
        {
            _http.Dispose();
            _handler.Dispose();
            return ValueTask.CompletedTask;
        }
    }
}
