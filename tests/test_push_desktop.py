#!/usr/bin/env python3
"""Black-box checks for scripts/push-desktop.sh (copies desktop/plugin.js to the app machine over SSH).

No test opens a real SSH connection: a fake `ssh` first on PATH records its arguments and stdin and, when the
test asks for it, runs the remote command locally with HOME pointed at a temporary directory.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "push-desktop.sh"
NOT_ON_WINDOWS = unittest.skipIf(os.name == "nt", "push-desktop.sh is a bash script")

# The one statement README.md and install.sh both make about the desktop half.
STATEMENT = (
    "Hermes Desktop copies the desktop half only from the plugins folder of the Hermes home on the machine "
    "where the app runs; it never fetches it from a remote backend."
)

FAKE_SSH = r"""#!/usr/bin/env bash
# Fake ssh: records argv (one per line) and stdin; FAKE_SSH_MODE=run executes the last argument locally.
: "${FAKE_SSH_LOG:?}"
{ echo "CALL"; for a in "$@"; do printf 'ARG:%s\n' "$a"; done; } >> "$FAKE_SSH_LOG"
if [[ "${FAKE_SSH_FAIL:-}" == 1 ]]; then echo "ssh: connect to host nowhere: Connection refused" >&2; exit 255; fi
if [[ "${FAKE_SSH_MODE:-}" == run ]]; then
  for last in "$@"; do :; done
  exec sh -c "$last"
fi
cat > "${FAKE_SSH_LOG}.stdin"
"""


def squash(text: str) -> str:
    """Join wrapped lines and drop comment markers so a sentence can be searched for."""
    return re.sub(r"\s+", " ", re.sub(r"^\s*#", " ", text, flags=re.M))


@NOT_ON_WINDOWS
class PushDesktopTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        fake = self.bin / "ssh"
        fake.write_text(FAKE_SSH, encoding="utf-8")
        fake.chmod(0o755)
        for name in ("scp", "rsync"):  # the script must not need these; a fake that fails loudly proves it
            tool = self.bin / name
            tool.write_text(f"#!/usr/bin/env bash\necho 'unexpected {name}' >> \"$FAKE_SSH_LOG\"\nexit 97\n", encoding="utf-8")
            tool.chmod(0o755)
        self.log = self.root / "ssh.log"
        self.fakehome = self.root / "apphome"
        self.fakehome.mkdir()
        self.source = self.root / "plugin.js"
        self.source.write_bytes(b"export default { id: 'prompt-studio' }\n")

    def run_script(self, *args: str, mode: str = "", fail: bool = False, source: bool = True) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update({"PATH": f"{self.bin}:{env['PATH']}", "FAKE_SSH_LOG": str(self.log), "HOME": str(self.fakehome)})
        if mode:
            env["FAKE_SSH_MODE"] = mode
        if fail:
            env["FAKE_SSH_FAIL"] = "1"
        cmd = ["bash", str(SCRIPT)]
        if source:
            cmd += ["--source", str(self.source)]
        return subprocess.run([*cmd, *args], env=env, text=True, capture_output=True, check=False)

    def calls(self) -> list[list[str]]:
        if not self.log.exists():
            return []
        calls: list[list[str]] = []
        for line in self.log.read_text(encoding="utf-8").splitlines():
            if line == "CALL":
                calls.append([])
            elif line.startswith("ARG:"):
                calls[-1].append(line[4:])
        return calls

    def assert_refused(self, result: subprocess.CompletedProcess[str], code: int = 2) -> None:
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertIn("[ERROR]", result.stderr)
        self.assertEqual(self.calls(), [], "ssh must not run when the arguments are refused")

    # --- argument handling -------------------------------------------------------------------------------

    def test_help_prints_usage_and_exits_0(self) -> None:
        result = self.run_script("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Usage: push-desktop.sh", result.stdout)
        self.assertEqual(self.calls(), [])

    def test_missing_host_is_refused(self) -> None:
        result = self.run_script()
        self.assert_refused(result)
        self.assertIn("Usage:", result.stderr)

    def test_extra_positional_argument_is_refused(self) -> None:
        self.assert_refused(self.run_script("me@laptop", "other-host"))

    def test_unknown_option_is_refused(self) -> None:
        self.assert_refused(self.run_script("--bogus", "me@laptop"))

    def test_option_without_value_is_refused(self) -> None:
        self.assert_refused(self.run_script("me@laptop", "--dir"))
        self.assert_refused(self.run_script("me@laptop", "--source"))

    def test_host_that_looks_like_an_ssh_option_is_refused(self) -> None:
        self.assert_refused(self.run_script("-oProxyCommand=evil"))

    def test_empty_or_spaced_host_is_refused(self) -> None:
        self.assert_refused(self.run_script(""))
        self.assert_refused(self.run_script("me@lap top"))

    def test_relative_dir_is_refused(self) -> None:
        self.assert_refused(self.run_script("me@laptop", "--dir", "plugins/here"))
        self.assert_refused(self.run_script("me@laptop", "--dir", ""))

    def test_missing_source_file_fails_before_ssh(self) -> None:
        self.source.unlink()
        self.assert_refused(self.run_script("me@laptop"), code=1)

    # --- what is sent ------------------------------------------------------------------------------------

    def test_default_push_targets_the_default_desktop_plugins_folder(self) -> None:
        result = self.run_script("me@laptop")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = self.calls()
        self.assertEqual(len(calls), 1)
        self.assertIn("--", calls[0])
        self.assertEqual(calls[0][calls[0].index("--") + 1], "me@laptop")
        remote = calls[0][-1]
        self.assertIn('"$HOME"', remote)
        self.assertIn("/.hermes/desktop-plugins/prompt-studio", remote)
        self.assertIn("mkdir -p", remote)
        self.assertEqual(Path(f"{self.log}.stdin").read_bytes(), self.source.read_bytes())
        self.assertIn("me@laptop", result.stdout)
        self.assertIn("~/.hermes/desktop-plugins/prompt-studio/plugin.js", result.stdout)

    def test_custom_dir_is_used_instead_of_the_default(self) -> None:
        result = self.run_script("me@laptop", "--dir", "/srv/hermes/desktop-plugins")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        remote = self.calls()[0][-1]
        self.assertIn("/srv/hermes/desktop-plugins/prompt-studio", remote)
        self.assertNotIn(".hermes", remote)

    def test_options_may_come_before_or_after_the_host(self) -> None:
        a = self.run_script("--dir", "/d", "me@laptop")
        b = self.run_script("me@laptop", "--dir", "/d")
        self.assertEqual((a.returncode, b.returncode), (0, 0), a.stderr + b.stderr)
        calls = self.calls()
        self.assertEqual(calls[0], calls[1])

    def test_dry_run_prints_the_plan_and_never_runs_ssh(self) -> None:
        result = self.run_script("me@laptop", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertIn("[DRY RUN]", result.stdout)
        self.assertIn("me@laptop", result.stdout)
        self.assertIn("~/.hermes/desktop-plugins/prompt-studio/plugin.js", result.stdout)

    def test_ssh_failure_is_reported_and_fails_the_script(self) -> None:
        result = self.run_script("me@nowhere", fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("[ERROR]", result.stderr)
        self.assertIn("Connection refused", result.stderr)
        self.assertNotIn("[OK]", result.stdout)

    # --- the remote command really lands the file -------------------------------------------------------

    def test_remote_command_installs_the_file_under_the_default_path(self) -> None:
        result = self.run_script("me@laptop", mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        target = self.fakehome / ".hermes" / "desktop-plugins" / "prompt-studio"
        self.assertEqual((target / "plugin.js").read_bytes(), self.source.read_bytes())
        self.assertEqual([p.name for p in target.iterdir()], ["plugin.js"], "no staging file may be left behind")
        self.assertIn("[OK]", result.stdout)

    def test_remote_command_replaces_an_older_copy(self) -> None:
        target = self.fakehome / ".hermes" / "desktop-plugins" / "prompt-studio"
        target.mkdir(parents=True)
        (target / "plugin.js").write_text("old", encoding="utf-8")
        result = self.run_script("me@laptop", mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((target / "plugin.js").read_bytes(), self.source.read_bytes())

    def test_remote_command_survives_spaces_and_quotes_in_the_dir(self) -> None:
        odd = self.root / "my plugins" / "it's here"
        result = self.run_script("me@laptop", "--dir", str(odd), mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((odd / "prompt-studio" / "plugin.js").read_bytes(), self.source.read_bytes())

    def test_tilde_dir_expands_on_the_remote_side(self) -> None:
        result = self.run_script("me@laptop", "--dir", "~/custom-home/desktop-plugins", mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        landed = self.fakehome / "custom-home" / "desktop-plugins" / "prompt-studio" / "plugin.js"
        self.assertEqual(landed.read_bytes(), self.source.read_bytes())

    def test_script_does_not_use_scp_or_rsync(self) -> None:
        self.run_script("me@laptop")
        self.assertNotIn("unexpected", self.log.read_text(encoding="utf-8"))

    def test_default_source_is_the_checkouts_built_desktop_plugin(self) -> None:
        result = self.run_script("me@laptop", "--dry-run", source=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(str(REPO / "desktop" / "plugin.js"), result.stdout)


class RemoteStatementTests(unittest.TestCase):
    """README and the installer say the same, verified thing about who copies the desktop half."""

    def test_readme_remote_section_states_it(self) -> None:
        readme = squash((REPO / "README.md").read_text(encoding="utf-8"))
        self.assertIn(STATEMENT, readme)
        self.assertIn("scripts/push-desktop.sh", readme)

    def test_installer_states_it_in_its_comment_and_in_its_final_message(self) -> None:
        text = (REPO / "install.sh").read_text(encoding="utf-8")
        comment_part, _, message_part = text.partition("cat <<DONE")
        self.assertIn(STATEMENT, squash(comment_part))
        self.assertIn(STATEMENT, squash(message_part))

    def test_nobody_claims_the_desktop_fetches_the_half_from_the_backend(self) -> None:
        for name in ("README.md", "install.sh"):
            text = squash((REPO / name).read_text(encoding="utf-8"))
            self.assertNotIn("Desktop materializes the desktop half", text, name)
            self.assertNotIn("copies the desktop half out", text, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
