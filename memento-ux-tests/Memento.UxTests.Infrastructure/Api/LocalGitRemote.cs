using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace Memento.UxTests.Infrastructure.Api
{
    /// <summary>
    /// Stand-up helper for a local bare git repository served over the
    /// <c>file://</c> URL scheme. Used by the Settings → Git Repos UX
    /// tests so the suite can exercise pull / push end-to-end without
    /// real Azure Repos / GitHub credentials.
    ///
    /// The api-server only accepts <c>file://</c> URLs when
    /// <c>APP_ENVIRONMENT</c> is <c>local</c> or <c>development</c> (see
    /// <c>gitConfigService.validateRepoUrl</c>); production deployments
    /// keep the strict HTTPS-only validation.
    /// </summary>
    public sealed class LocalGitRemote : IAsyncDisposable
    {
        public string BareDir { get; }
        public string FileUrl => "file://" + BareDir;
        /// <summary>Working clone owned by the test harness, used to seed and to run out-of-band pushes.</summary>
        public string ScratchClone { get; }
        public string Branch { get; } = "main";

        private LocalGitRemote(string bareDir, string scratchClone)
        {
            BareDir = bareDir;
            ScratchClone = scratchClone;
        }

        /// <summary>
        /// Create a brand-new bare repository on disk and seed it with
        /// a commit containing the memento project marker file
        /// (<c>.testbuilder.json</c>) so a fresh pull into a memento
        /// project directory passes the "looks like a memento project"
        /// validation.
        /// </summary>
        public static async Task<LocalGitRemote> CreateAsync(
            string projectName,
            string solutionFileName)
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                $"memento-ux-git-{projectName}-{Guid.NewGuid():N}");
            var bare = Path.Combine(root, "remote.git");
            var scratch = Path.Combine(root, "scratch");
            Directory.CreateDirectory(bare);
            Directory.CreateDirectory(scratch);

            await RunGitAsync(bare, "init", "--bare", "--initial-branch=main");

            await RunGitAsync(scratch, "init", "--initial-branch=main");
            await RunGitAsync(scratch, "config", "user.email", "uxtest@local");
            await RunGitAsync(scratch, "config", "user.name", "uxtest");

            // Seed: marker + a stub solution file so the project layout
            // matches what the api-server expects on pull.
            await File.WriteAllTextAsync(
                Path.Combine(scratch, ".testbuilder.json"),
                "{\"language\":\"csharp\",\"solutionType\":\"playwright\"}\n");
            await File.WriteAllTextAsync(
                Path.Combine(scratch, solutionFileName),
                "// seeded by LocalGitRemote\n");

            await RunGitAsync(scratch, "add", "-A");
            await RunGitAsync(scratch, "commit", "-m", "seed");
            await RunGitAsync(scratch, "remote", "add", "origin", "file://" + bare);
            await RunGitAsync(scratch, "push", "-u", "origin", "main");

            return new LocalGitRemote(bare, scratch);
        }

        /// <summary>
        /// Push an out-of-band commit straight into the bare remote.
        /// (Kept for completeness; not used by the push_rejected test
        /// because the api-server re-clones the bare on every push and
        /// would fast-forward on top of the out-of-band commit.)
        /// </summary>
        public async Task PushOutOfBandCommitAsync(string filename, string content)
        {
            await File.WriteAllTextAsync(Path.Combine(ScratchClone, filename), content);
            await RunGitAsync(ScratchClone, "add", "-A");
            await RunGitAsync(ScratchClone, "commit", "-m", "out-of-band");
            await RunGitAsync(ScratchClone, "push", "origin", "main");
        }

        /// <summary>
        /// Install a <c>pre-receive</c> hook in the bare that rejects
        /// every push with stderr containing the keywords
        /// <c>rejected</c> and <c>non-fast-forward</c> so the
        /// api-server's <c>classifyPushError</c> categorises the
        /// failure as <c>push_rejected</c>. Used by the push_rejected
        /// error-toast UX test, which can't reproduce a real
        /// non-fast-forward (the api re-clones the bare on every push
        /// and always fast-forwards on top of whatever it finds).
        /// </summary>
        public async Task InstallRejectingPreReceiveHookAsync()
        {
            var hooks = Path.Combine(BareDir, "hooks");
            Directory.CreateDirectory(hooks);
            var hookPath = Path.Combine(hooks, "pre-receive");
            await File.WriteAllTextAsync(
                hookPath,
                "#!/bin/sh\n"
                + "echo 'rejected: non-fast-forward (ux-test fixture)' >&2\n"
                + "exit 1\n");
            // chmod +x via shell (no portable .NET API for unix mode bits in
            // older runtimes; chmod is always present in our CI image).
            var psi = new ProcessStartInfo("chmod")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            psi.ArgumentList.Add("+x");
            psi.ArgumentList.Add(hookPath);
            using var proc = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to spawn chmod");
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
                throw new InvalidOperationException(
                    "chmod +x on pre-receive hook failed with exit "
                    + proc.ExitCode);
        }

        public ValueTask DisposeAsync()
        {
            try
            {
                var parent = Path.GetDirectoryName(BareDir);
                if (!string.IsNullOrEmpty(parent) && Directory.Exists(parent))
                    Directory.Delete(parent, recursive: true);
            }
            catch
            {
                // best-effort cleanup
            }
            return ValueTask.CompletedTask;
        }

        private static async Task RunGitAsync(string cwd, params string[] args)
        {
            var psi = new ProcessStartInfo("git")
            {
                WorkingDirectory = cwd,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var a in args) psi.ArgumentList.Add(a);
            // Avoid being prompted for credentials in unattended runs.
            psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

            using var proc = Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to spawn git");
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                var sb = new StringBuilder();
                sb.Append("git ");
                sb.AppendJoin(' ', args);
                sb.Append(" failed (exit ").Append(proc.ExitCode).Append("): ");
                sb.Append(await stderrTask);
                sb.Append(await stdoutTask);
                throw new InvalidOperationException(sb.ToString());
            }
        }
    }
}
