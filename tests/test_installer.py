#!/usr/bin/env python3
"""Black-box checks for Prompt Studio's distributable installer."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PYTHON = Path(os.environ.get("PYTHON_BIN", sys.executable))


def make_hermes(directory: Path, version: str) -> Path:
    executable = directory / "hermes"
    executable.write_text(f"#!/usr/bin/env bash\necho 'Hermes Agent v{version}'\n", encoding="utf-8")
    executable.chmod(0o755)
    return executable


def copy_repo(directory: Path) -> Path:
    destination = directory / "prompt-studio"
    shutil.copytree(REPO, destination, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache", "assets"))
    return destination


REAL_HERMES = Path(shutil.which("hermes") or "/usr/local/bin/hermes")
# install.sh is a bash script (Linux and macOS). On native Windows the plugin is installed with
# `hermes plugins install` (see the README), so these installer tests do not apply there.
NOT_ON_WINDOWS = unittest.skipIf(os.name == "nt", "install.sh is a bash script; on Windows use hermes plugins install")


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _unique_mapping(loader: UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False) -> dict:
    keys = [loader.construct_object(k, deep=deep) for k, _ in node.value]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        raise AssertionError(f"duplicate YAML keys: {sorted(duplicates)}")
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping)


def load_config(home: Path) -> dict:
    return yaml.load((home / "config.yaml").read_text(encoding="utf-8"), Loader=UniqueKeyLoader)


@NOT_ON_WINDOWS
@unittest.skipUnless(REAL_HERMES.exists(), "requires the real hermes CLI")
class InstallerTests(unittest.TestCase):
    def run_install(self, source: Path, home: Path, hermes: Path) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update({"PYTHON_BIN": str(PYTHON), "HERMES_BIN": str(hermes), "HERMES_HOME": str(home)})
        return subprocess.run(
            ["bash", "install.sh", "--home", str(home)], cwd=source, env=environment,
            text=True, capture_output=True, check=False,
        )

    def test_unsupported_hermes_fails_before_registration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "untouched-home"
            result = self.run_install(copy_repo(root), home, make_hermes(root, "0.19.9"))
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("[ERROR] Incompatible Hermes version: requires >=0.21.5, running 0.19.9", result.stderr)
            self.assertFalse(home.exists(), "pre-flight must not create target home")

    def test_malformed_manifest_fails_before_registration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = copy_repo(root)
            (source / "plugin.yaml").write_text("version: 0.1.0\ndescription: broken\n", encoding="utf-8")
            home = root / "untouched-home"
            result = self.run_install(source, home, make_hermes(root, "0.21.2"))
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("[ERROR] Invalid plugin manifest: missing 'name'", result.stderr)
            self.assertFalse(home.exists(), "invalid manifest must not create target home")

    def install_real(self, home: Path, config: str | None = None, source: Path | None = None) -> subprocess.CompletedProcess[str]:
        if config is not None:
            home.mkdir(parents=True, exist_ok=True)
            (home / "config.yaml").write_text(config, encoding="utf-8")
        source = source or copy_repo(home.parent)
        return self.run_install(source, home, REAL_HERMES)

    def assert_ok(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_legacy_self_made_desktop_folder_is_removed_but_electron_one_kept(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            ours = home / "desktop-plugins/prompt-studio"
            ours.mkdir(parents=True)
            (ours / "plugin.js").write_text("old", encoding="utf-8")
            (ours / ".hermes-package.json").write_text('{"name": "prompt-studio", "version": "0.3.0", "main": "plugin.js"}', encoding="utf-8")
            self.assert_ok(self.install_real(home))
            self.assertFalse(ours.exists())
            ours.mkdir(parents=True)
            marker = '{"package": "prompt-studio", "source": "x", "sourceMtimeMs": 1}'
            (ours / ".hermes-package.json").write_text(marker, encoding="utf-8")
            # a marker with `package` was written by Electron; the installer must leave it alone
            self.assert_ok(self.run_install(copy_repo(home.parent / "again"), home, REAL_HERMES))
            self.assertEqual((ours / ".hermes-package.json").read_text(encoding="utf-8"), marker)

    def test_inline_enabled_list_keeps_other_plugin(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            self.assert_ok(self.install_real(home, "plugins:\n  enabled: [other-plugin]\n"))
            config = load_config(home)
            self.assertEqual(config["plugins"]["enabled"], ["other-plugin", "prompt-studio"])

    def test_disabled_plugin_becomes_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            self.assert_ok(self.install_real(home, "plugins:\n  enabled:\n    - a\n  disabled:\n    - prompt-studio\n    - b\n"))
            plugins = load_config(home)["plugins"]
            self.assertIn("prompt-studio", plugins["enabled"])
            self.assertNotIn("prompt-studio", plugins.get("disabled") or [])
            self.assertIn("b", plugins["disabled"])

    def test_empty_plugins_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            self.assert_ok(self.install_real(home, "plugins: {}\nauxiliary: {}\n"))
            config = load_config(home)
            self.assertEqual(config["plugins"]["enabled"], ["prompt-studio"])
            self.assertEqual(config["auxiliary"]["prompt_studio"]["provider"], "auto")

    def test_other_auxiliary_blocks_are_not_copied(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            self.assert_ok(self.install_real(home,
                "model:\n  provider: openrouter\n"
                "auxiliary:\n  vision:\n    provider: gemini\n    model: gemini-3.8-flash\n"
                "display:\n  compact: false\n"))
            config = load_config(home)
            self.assertEqual(config["auxiliary"]["prompt_studio"], {"provider": "auto", "timeout": 20})
            self.assertEqual(config["auxiliary"]["vision"]["model"], "gemini-3.8-flash")
            self.assertEqual(config["display"], {"compact": False})

    def test_existing_prompt_studio_block_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            self.assert_ok(self.install_real(home,
                "auxiliary:\n  vision:\n    provider: openrouter\n  prompt_studio:\n    provider: nous\n    timeout: 99\n"))
            self.assertEqual(load_config(home)["auxiliary"]["prompt_studio"], {"provider": "nous", "timeout": 99})

    def test_second_install_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            source = copy_repo(root)
            self.assert_ok(self.install_real(home, "plugins:\n  enabled: [other-plugin]\n", source=source))
            first = load_config(home)
            self.assert_ok(self.run_install(source, home, REAL_HERMES))
            second = load_config(home)
            self.assertEqual(first, second)
            self.assertEqual(second["plugins"]["enabled"].count("prompt-studio"), 1)

    def install_into_home(self, home: Path) -> Path:
        """Lay the whole repo out as `hermes plugins install` does: home/plugins/prompt-studio."""
        installed = home / "plugins/prompt-studio"
        shutil.copytree(REPO, installed, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache", "assets"))
        return installed

    def snapshot(self, directory: Path) -> dict[str, bytes]:
        return {str(p.relative_to(directory)): p.read_bytes() for p in sorted(directory.rglob("*")) if p.is_file()}

    def test_running_from_the_installed_plugin_directory_keeps_every_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / "tmp_home"
            installed = self.install_into_home(home)
            before = self.snapshot(installed)
            result = self.run_install(installed, home, REAL_HERMES)
            self.assert_ok(result)
            self.assertIn("already installed here", result.stdout)
            self.assertEqual(self.snapshot(installed), before)
            self.assertIn("prompt-studio", load_config(home)["plugins"]["enabled"])
            self.assertEqual(sorted(p.name for p in installed.parent.iterdir()), ["prompt-studio"])

    def test_running_through_a_symlink_to_the_installed_directory_keeps_every_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            installed = self.install_into_home(home)
            link = root / "link"
            link.symlink_to(installed)
            before = self.snapshot(installed)
            self.assert_ok(self.run_install(link, home, REAL_HERMES))
            self.assertEqual(self.snapshot(installed), before)

    def test_failed_copy_leaves_the_previous_install_intact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            source = copy_repo(root)
            previous = home / "plugins/prompt-studio"
            (previous / "dashboard").mkdir(parents=True)
            (previous / "plugin.yaml").write_text("name: old\n", encoding="utf-8")
            (previous / "dashboard/old.py").write_text("OLD = 1\n", encoding="utf-8")
            before = self.snapshot(previous)
            shim = root / "shim"
            shim.mkdir()
            cp = shim / "cp"
            cp.write_text(
                f'#!/usr/bin/env bash\ncase "$*" in *desktop/plugin.js*) echo "simulated cp failure" >&2; exit 1;; esac\n'
                f'exec {shutil.which("cp")} "$@"\n', encoding="utf-8")
            cp.chmod(0o755)
            environment = os.environ.copy()
            environment.update({"PYTHON_BIN": str(PYTHON), "HERMES_BIN": str(REAL_HERMES), "HERMES_HOME": str(home),
                                "PATH": f"{shim}{os.pathsep}{environment['PATH']}"})
            result = subprocess.run(["bash", "install.sh", "--home", str(home)], cwd=source, env=environment,
                                    text=True, capture_output=True, check=False)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.snapshot(previous), before)
            self.assertEqual(sorted(p.name for p in previous.parent.iterdir()), ["prompt-studio"], "no staging leftovers")

    def test_reinstall_replaces_files_and_leaves_no_staging_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "tmp_home"
            source = copy_repo(root)
            self.assert_ok(self.run_install(source, home, REAL_HERMES))
            stale = home / "plugins/prompt-studio/stale.txt"
            stale.write_text("leftover", encoding="utf-8")
            self.assert_ok(self.run_install(source, home, REAL_HERMES))
            self.assertFalse(stale.exists())
            self.assertTrue((home / "plugins/prompt-studio/desktop/plugin.js").is_file())
            self.assertEqual(sorted(p.name for p in (home / "plugins").iterdir()), ["prompt-studio"])

    def test_missing_hermes_cli_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home = root / "untouched-home"
            result = self.run_install(copy_repo(root), home, root / "no-such-hermes")
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("Hermes CLI not found", result.stderr)
            self.assertFalse(home.exists())

@NOT_ON_WINDOWS
class InstallerDefaultInstallTests(unittest.TestCase):
    """Read-only checks on ONE default install (shared via setUpClass; CT-09).

    Tests here must not mutate the install; anything needing a special starting
    state or a second install lives in InstallerTests with its own fresh home.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls._temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls._temporary.cleanup)
        cls.home = Path(cls._temporary.name) / "tmp_home"
        cls.source = copy_repo(Path(cls._temporary.name))
        cls.result = InstallerTests.run_install(None, cls.source, cls.home, REAL_HERMES)  # type: ignore[arg-type]

    def assert_ok(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_successful_install_creates_all_artifacts_and_config(self) -> None:
        home = self.home
        self.assert_ok(self.result)
        self.assertTrue((home / "plugins/prompt-studio/plugin.yaml").is_file())
        self.assertTrue((home / "plugins/prompt-studio/dashboard/plugin_api.py").is_file())
        config = load_config(home)
        self.assertIn("prompt-studio", config["plugins"]["enabled"])
        self.assertEqual(config["auxiliary"]["prompt_studio"], {"provider": "auto", "timeout": 20})
        self.assertEqual(set(config["auxiliary"]), {"prompt_studio"})

    def test_desktop_half_ships_inside_package_without_marker(self) -> None:
        home, source = self.home, self.source
        self.assert_ok(self.result)
        installed = home / "plugins/prompt-studio/desktop/plugin.js"
        self.assertTrue(installed.is_file())
        self.assertEqual(installed.read_bytes(), (source / "desktop/plugin.js").read_bytes())
        self.assertFalse(list(home.rglob(".hermes-package.json")))
        self.assertFalse((home / "desktop-plugins/prompt-studio").exists())
        package = home / "plugins/prompt-studio"
        self.assertFalse(list(package.rglob("*.pyc")))
        self.assertFalse(list(package.rglob("__pycache__")))
        self.assertFalse((package / "tests").exists())


@NOT_ON_WINDOWS
class InstallerArgumentTests(unittest.TestCase):
    """Bad --home / --profile values are refused before anything is created or removed."""

    def run_args(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update({"PYTHON_BIN": str(PYTHON), "HERMES_BIN": str(root / "no-such-hermes"), "HERMES_HOME": str(root / "base")})
        return subprocess.run(["bash", str(REPO / "install.sh"), *args], cwd=root, env=environment, text=True, capture_output=True, check=False)

    def test_bad_arguments_exit_2_before_touching_anything(self) -> None:
        cases = [
            ("--profile", "../.."), ("--profile", "a/b"), ("--profile", "Work"), ("--profile", ""), ("--profile", "-x"),
            ("--profile", "a" * 65), ("--home", ""), ("--home", "relative/dir"),
        ]
        for args in cases:
            with self.subTest(args=args), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                victim = root / "base" / "plugins" / "prompt-studio"
                victim.mkdir(parents=True)
                result = self.run_args(root, *args)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn("[ERROR]", result.stderr)
                self.assertTrue(victim.exists())
                self.assertEqual(sorted(p.name for p in root.iterdir()), ["base"])

    def test_home_and_profile_together_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_args(root, "--home", str(root / "h"), "--profile", "work")
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("[ERROR]", result.stderr)
            self.assertIn("--home", result.stderr)
            self.assertFalse((root / "h").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
