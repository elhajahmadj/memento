using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace Memento.UxTests.Infrastructure.Api
{
    /// <summary>
    /// Tiny loopback HTTP server that returns <c>401 Unauthorized</c>
    /// with a Basic auth challenge for every request. Used by the
    /// Settings → Git Repos UX tests to drive the
    /// <c>auth_failed</c> classification end-to-end without needing
    /// real Azure Repos / GitHub credentials.
    ///
    /// The api-server's dev-mode repo-URL validator
    /// (<c>isAllowedTestModeRepoUrl</c>) accepts loopback
    /// (<c>http://127.0.0.1:*</c>) URLs alongside <c>file://</c>; this
    /// server's URL is only valid when <c>APP_ENVIRONMENT</c> is
    /// <c>local</c> or <c>development</c>.
    /// </summary>
    public sealed class LocalAuthFailingHttpServer : IAsyncDisposable
    {
        private readonly HttpListener _listener;
        private readonly CancellationTokenSource _cts = new();
        private Task? _loop;

        /// <summary>
        /// Full URL ending with <c>/repo.git</c> that can be passed as a
        /// repo URL when configuring git on a memento project.
        /// </summary>
        public string Url { get; }

        private LocalAuthFailingHttpServer(HttpListener listener, string url)
        {
            _listener = listener;
            Url = url;
        }

        public static Task<LocalAuthFailingHttpServer> CreateAsync()
        {
            // Bind a TcpListener on port 0 to discover a free loopback
            // port. We then immediately release it and reuse the port
            // for HttpListener — there's a tiny race window but it's
            // good enough for an in-process test fixture.
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            var port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();

            var prefix = $"http://127.0.0.1:{port}/";
            var listener = new HttpListener();
            listener.Prefixes.Add(prefix);
            listener.Start();

            var url = $"{prefix}repo.git";
            var server = new LocalAuthFailingHttpServer(listener, url);
            server._loop = Task.Run(server.LoopAsync);
            return Task.FromResult(server);
        }

        private async Task LoopAsync()
        {
            try
            {
                while (_listener.IsListening && !_cts.IsCancellationRequested)
                {
                    HttpListenerContext ctx;
                    try
                    {
                        ctx = await _listener.GetContextAsync().ConfigureAwait(false);
                    }
                    catch
                    {
                        break;
                    }
                    try
                    {
                        ctx.Response.StatusCode = 401;
                        ctx.Response.AddHeader(
                            "WWW-Authenticate",
                            "Basic realm=\"memento-ux\"");
                        ctx.Response.ContentLength64 = 0;
                        ctx.Response.OutputStream.Close();
                    }
                    catch
                    {
                        // Best-effort: the test fixture is going down.
                    }
                }
            }
            catch
            {
                // Listener disposed mid-loop; ignore.
            }
        }

        public ValueTask DisposeAsync()
        {
            try { _cts.Cancel(); } catch { }
            try { _listener.Stop(); } catch { }
            try { _listener.Close(); } catch { }
            return ValueTask.CompletedTask;
        }
    }
}
