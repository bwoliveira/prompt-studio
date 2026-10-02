#!/usr/bin/env python3
"""Black-box checks for scripts/push-desktop.sh (copies desktop/plugin.js to the app machine over SSH).

No test opens a real SSH connection: a fake `ssh` first on PATH records its arguments and stdin and, when the
test asks for it, runs the remote command locally with HOME pointed at a temporary directory.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "push-desktop.sh"
NOT_ON_WINDOWS = unittest.skipIf(os.name == "nt", "push-desktop.sh is a bash script")

# Hermes Desktop (apps/desktop/electron/desktop-plugins-root.ts): a folder holding PACKAGE_MARKER is a copy managed
# for a local unified package; the next rescan overwrites it with that package or deletes it when the package is gone.
MARKER = ".hermes-package.json"
DESKTOP_ROOT_TS = Path("/usr/local/lib/hermes-agent/apps/desktop/electron/desktop-plugins-root.ts")

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
        self.assertNotIn(".hermes/", remote)

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

    # --- the final file is the one that was sent (review P3) -----------------------------------------------

    def test_a_directory_in_place_of_plugin_js_is_refused_not_filled(self) -> None:
        target = self.fakehome / ".hermes" / "desktop-plugins" / "prompt-studio"
        (target / "plugin.js").mkdir(parents=True)
        result = self.run_script("me@laptop", mode="run")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("[OK]", result.stdout)
        self.assertIn("[ERROR]", result.stderr)
        self.assertIn("directory", result.stderr)
        self.assertEqual(list((target / "plugin.js").iterdir()), [], "the staged file must not be moved into the directory")
        self.assertEqual([p.name for p in target.iterdir()], ["plugin.js"], "no staging file left")

    def test_success_is_claimed_only_when_the_installed_file_matches_the_source(self) -> None:
        fake_mv = self.bin / "mv"  # moves the file, then loses its tail: a transfer that went wrong after the copy
        fake_mv.write_text('#!/bin/sh\n/bin/mv "$@" || exit $?\nfor last in "$@"; do :; done\nhead -c 5 "$last" > "$last.cut" && /bin/mv "$last.cut" "$last"\n', encoding="utf-8")
        fake_mv.chmod(0o755)
        result = self.run_script("me@laptop", mode="run")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("[OK]", result.stdout)
        self.assertIn("does not match", result.stderr)

    def test_a_sent_file_that_arrives_short_is_refused_before_it_replaces_the_old_one(self) -> None:
        target = self.fakehome / ".hermes" / "desktop-plugins" / "prompt-studio"
        target.mkdir(parents=True)
        (target / "plugin.js").write_text("old", encoding="utf-8")
        fake_cat = self.bin / "cat"  # a stdin that is cut off half way
        fake_cat.write_text('#!/bin/sh\n/bin/cat | head -c 5\n', encoding="utf-8")
        fake_cat.chmod(0o755)
        result = self.run_script("me@laptop", mode="run")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("[OK]", result.stdout)
        self.assertEqual((target / "plugin.js").read_text(encoding="utf-8"), "old")
        self.assertEqual([p.name for p in target.iterdir()], ["plugin.js"], "no staging file left")

    # --- a folder Desktop manages for a local package (review R7) ------------------------------------------

    def managed_target(self, package_alive: bool = True) -> tuple[Path, Path, Path]:
        """A desktop-plugins folder whose prompt-studio copy carries Desktop's marker for a local package.

        Returns (app root = <home>/desktop-plugins, target folder, local package desktop half)."""
        app = self.fakehome / "desktop-plugins"
        target = app / "prompt-studio"
        target.mkdir(parents=True)
        package = self.fakehome / "plugins" / "prompt-studio" / "desktop"
        if package_alive:
            package.mkdir(parents=True)
            (package / "plugin.js").write_text("OLD_VERSION\n", encoding="utf-8")
        (target / "plugin.js").write_text("OLD_VERSION\n", encoding="utf-8")
        (target / MARKER).write_text(
            json.dumps({"package": "prompt-studio", "source": str(package), "sourceMtimeMs": 0}), encoding="utf-8"
        )
        (target / "notes.txt").write_text("keep me\n", encoding="utf-8")
        return app, target, package

    def test_a_folder_managed_for_a_local_package_is_refused_with_migration_steps(self) -> None:
        app, target, _ = self.managed_target()
        result = self.run_script("me@laptop", "--dir", str(app), mode="run")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertNotIn("[OK]", result.stdout)
        self.assertIn("[ERROR]", result.stderr)
        for needle in (MARKER, "--replace-managed", "hermes plugins"):
            self.assertIn(needle, result.stderr)
        self.assertEqual((target / "plugin.js").read_text(encoding="utf-8"), "OLD_VERSION\n")
        self.assertTrue((target / MARKER).exists(), "the marker stays unless the user asked to replace it")
        self.assertEqual([p.name for p in target.iterdir() if p.name.startswith(".plugin.js")], [], "no staging file left")

    def test_a_local_package_with_the_identical_file_is_refused_not_adopted_later(self) -> None:
        """Desktop adopts a marker-less folder whose plugin.js equals a local package's desktop half (it stamps the
        marker back), so removing that package would later delete the pushed file. Review round 1, P2."""
        for flag in ((), ("--replace-managed",)):
            with self.subTest(flags=flag):
                shutil.rmtree(self.fakehome)
                self.fakehome.mkdir()
                app, target, package = self.managed_target()
                (package / "plugin.js").write_bytes(self.source.read_bytes())
                if not flag:
                    (target / MARKER).unlink()  # a standalone folder: only the identical local package is the trap
                before = (target / "plugin.js").read_bytes()
                result = self.run_script("me@laptop", "--dir", str(app), *flag, mode="run")
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertNotIn("[OK]", result.stdout)
                for needle in ("identical", "hermes plugins remove"):
                    self.assertIn(needle, result.stderr)
                self.assertEqual((target / "plugin.js").read_bytes(), before, "nothing was copied")
                self.assertEqual((target / MARKER).exists(), bool(flag), "the marker is untouched")
                self.assertEqual([p.name for p in target.iterdir() if p.name.startswith(".plugin.js")], [])

    def test_an_identical_package_in_a_profile_home_is_refused_too(self) -> None:
        app, target, _ = self.managed_target()
        profile_pkg = self.fakehome / "profiles" / "work" / "plugins" / "prompt-studio" / "desktop"
        profile_pkg.mkdir(parents=True)
        (profile_pkg / "plugin.js").write_bytes(self.source.read_bytes())
        (target / MARKER).unlink()
        result = self.run_script("me@laptop", "--dir", str(app), mode="run")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual((target / "plugin.js").read_text(encoding="utf-8"), "OLD_VERSION\n")

    def test_replace_managed_makes_the_folder_a_standalone_plugin(self) -> None:
        app, target, _ = self.managed_target()
        result = self.run_script("me@laptop", "--dir", str(app), "--replace-managed", mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((target / "plugin.js").read_bytes(), self.source.read_bytes())
        self.assertFalse((target / MARKER).exists())
        self.assertEqual((target / "notes.txt").read_text(encoding="utf-8"), "keep me\n", "other files are left alone")
        self.assertIn("[OK]", result.stdout)

    def test_replace_managed_on_an_unmarked_folder_is_a_plain_push(self) -> None:
        result = self.run_script("me@laptop", "--replace-managed", mode="run")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        landed = self.fakehome / ".hermes" / "desktop-plugins" / "prompt-studio" / "plugin.js"
        self.assertEqual(landed.read_bytes(), self.source.read_bytes())

    def test_help_documents_replace_managed(self) -> None:
        result = self.run_script("--help")
        self.assertIn("--replace-managed", result.stdout)
        self.assertIn(MARKER, result.stdout)

    def test_dry_run_with_replace_managed_runs_no_ssh(self) -> None:
        result = self.run_script("me@laptop", "--dry-run", "--replace-managed")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [])

    @unittest.skipUnless(DESKTOP_ROOT_TS.is_file() and shutil.which("node"), "needs node and the installed Hermes Desktop sources")
    def test_the_pushed_file_survives_the_next_desktop_rescan(self) -> None:
        """Runs Desktop's own reconcileUnifiedDesktopHalves against fixture homes (it writes only under them)."""

        def rescan(home: Path, app: Path) -> None:
            js = (
                f"import {{reconcileUnifiedDesktopHalves as r}} from {json.dumps(DESKTOP_ROOT_TS.as_uri())};"
                "await r(process.argv[1], process.argv[2]);"
            )
            done = subprocess.run(
                ["node", "--input-type=module", "-e", js, str(home), str(app)], text=True, capture_output=True, check=False
            )
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

        for alive in (True, False):
            with self.subTest(local_package_still_installed=alive):
                shutil.rmtree(self.fakehome)
                self.fakehome.mkdir()
                app, target, _ = self.managed_target(package_alive=alive)
                self.assertEqual(self.run_script("me@laptop", "--dir", str(app), mode="run").returncode, 1)
                result = self.run_script("me@laptop", "--dir", str(app), "--replace-managed", mode="run")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                rescan(self.fakehome, app)
                self.assertEqual((target / "plugin.js").read_bytes(), self.source.read_bytes())


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
