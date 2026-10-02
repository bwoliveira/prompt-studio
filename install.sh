#!/usr/bin/env bash
# Install Prompt Studio (prompt-studio) from a local checkout into a Hermes home.
# Supports the default home, named profiles (--profile) and custom homes (--home); needs the
# hermes CLI on PATH or HERMES_BIN.
set -Eeuo pipefail

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for cand in "python3" "python3.12" "$HOME/.hermes/hermes-agent/venv/bin/python" "$HOME/.local/bin/python3.12" "$HOME/.local/bin/python3" "/opt/homebrew/bin/python3.12" "/usr/local/bin/python3.12"; do
    if command -v "$cand" >/dev/null 2>&1 || [[ -x "$cand" ]]; then
      if "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
        PYTHON_BIN="$cand"
        break
      fi
    fi
  done
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi
HERMES_BIN="${HERMES_BIN:-hermes}"

usage() {
  cat <<'USAGE'
Usage: install.sh [--home DIR] [--profile NAME]

Install Prompt Studio (prompt-studio) into a Hermes home. With --profile NAME, installs into
$HERMES_HOME/profiles/NAME (or $HOME/.hermes/profiles/NAME).
USAGE
}

TARGET_HOME=""
PROFILE=""
HOME_GIVEN=0
PROFILE_GIVEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) [[ $# -ge 2 ]] || { echo "[ERROR] --home requires a directory" >&2; exit 2; }; TARGET_HOME="$2"; HOME_GIVEN=1; shift 2 ;;
    --profile) [[ $# -ge 2 ]] || { echo "[ERROR] --profile requires a name" >&2; exit 2; }; PROFILE="$2"; PROFILE_GIVEN=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Validate the target before anything is created or removed (the plugin folder is rm -rf'd below).
if [[ -n "$TARGET_HOME" && -n "$PROFILE" ]]; then
  echo "[ERROR] --home and --profile cannot be used together; pick one" >&2; exit 2
fi
if [[ "$HOME_GIVEN" == 1 && ( -z "$TARGET_HOME" || "$TARGET_HOME" != /* ) ]]; then
  echo "[ERROR] --home must be a non-empty absolute path" >&2; exit 2
fi
if [[ "$PROFILE_GIVEN" == 1 ]] && ! [[ "$PROFILE" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]; then
  echo "[ERROR] Invalid profile name '$PROFILE': use lowercase letters, numbers, '-' or '_', starting with a letter or number, up to 64 characters" >&2; exit 2
fi

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ ! -f "$SOURCE/plugin.yaml" || ! -f "$SOURCE/scripts/validate_install.py" ]]; then
  echo "[ERROR] Run install.sh from a Prompt Studio checkout (plugin.yaml not found beside the script)" >&2
  exit 1
fi

# Pre-flight must complete before the target home is created or any of its files are changed.
if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
  echo "[ERROR] Python 3.12+ is required (set PYTHON_BIN to a compatible interpreter)" >&2
  exit 1
fi
if ! "$PYTHON_BIN" "$SOURCE/scripts/validate_install.py" --source "$SOURCE" --hermes-bin "$HERMES_BIN"; then
  exit 1
fi

BASE_HOME="${HERMES_HOME:-$HOME/.hermes}"
if [[ -z "$TARGET_HOME" ]]; then TARGET_HOME="$BASE_HOME"; fi
if [[ -n "$PROFILE" ]]; then TARGET_HOME="$BASE_HOME/profiles/$PROFILE"; fi

# Registration starts only after all compatibility checks pass. The desktop half ships inside the
# package (plugins/prompt-studio/desktop/plugin.js); Hermes Desktop copies it into desktop-plugins/
# and writes its own .hermes-package.json marker, so this script never touches desktop-plugins/.
PLUGIN_DIR="$TARGET_HOME/plugins/prompt-studio"
LEGACY_DESKTOP_DIR="$TARGET_HOME/desktop-plugins/prompt-studio"
# A SIGTERM between the two mv of an earlier swap leaves only "$PLUGIN_DIR.old": that is the previous
# install, so put it back before anything else; a .old is deleted only while PLUGIN_DIR exists.
if [[ ! -e "$PLUGIN_DIR" && ! -L "$PLUGIN_DIR" ]] && [[ -e "$PLUGIN_DIR.old" || -L "$PLUGIN_DIR.old" ]]; then
  echo "[WARN] an earlier install was interrupted; restoring the previous install from $PLUGIN_DIR.old" >&2
  mv "$PLUGIN_DIR.old" "$PLUGIN_DIR"
fi
# Running this script from inside the installed plugin (the layout `hermes plugins install` leaves)
# means source and destination are the same folder: copying would delete the source first.
INSTALLED_REAL=""
if [[ -d "$PLUGIN_DIR" ]]; then INSTALLED_REAL="$(cd -P "$PLUGIN_DIR" && pwd -P)"; fi
if [[ "$INSTALLED_REAL" == "$SOURCE" ]]; then
  echo "[OK] prompt-studio is already installed here ($PLUGIN_DIR); nothing to copy, registering only"
else
  # Stage next to the target, then swap with mv: a failed copy never touches the previous install.
  STAGE_DIR="$PLUGIN_DIR.new"
  OLD_DIR="$PLUGIN_DIR.old"
  trap 'rm -rf "$STAGE_DIR"' EXIT
  rm -rf "$STAGE_DIR" "$OLD_DIR"
  mkdir -p "$STAGE_DIR/dashboard" "$STAGE_DIR/desktop"
  # Only the shipped files: a local __pycache__ or test leftovers never reach the target home.
  cp "$SOURCE/__init__.py" "$SOURCE/plugin.yaml" "$STAGE_DIR/"
  cp "$SOURCE"/dashboard/*.py "$SOURCE/dashboard/manifest.json" "$STAGE_DIR/dashboard/"
  cp "$SOURCE/desktop/plugin.js" "$STAGE_DIR/desktop/plugin.js"
  if [[ -e "$PLUGIN_DIR" || -L "$PLUGIN_DIR" ]]; then mv "$PLUGIN_DIR" "$OLD_DIR"; fi
  if ! mv "$STAGE_DIR" "$PLUGIN_DIR"; then
    if [[ -e "$OLD_DIR" || -L "$OLD_DIR" ]]; then mv "$OLD_DIR" "$PLUGIN_DIR" || true; fi
    echo "[ERROR] could not move the new install into $PLUGIN_DIR; the previous install was kept" >&2
    exit 1
  fi
  trap - EXIT
  rm -rf "$OLD_DIR"
fi

# Earlier versions of this script wrote desktop-plugins/prompt-studio/ with a {name,version,main}
# marker. Electron's marker always has `package`; only remove the folder when the marker is ours.
if [[ -f "$LEGACY_DESKTOP_DIR/.hermes-package.json" ]]; then
  if "$PYTHON_BIN" - "$LEGACY_DESKTOP_DIR/.hermes-package.json" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except (OSError, ValueError):
    raise SystemExit(1)
raise SystemExit(0 if isinstance(data, dict) and "package" not in data and data.get("name") == "prompt-studio" else 1)
PY
  then
    rm -rf "$LEGACY_DESKTOP_DIR"
  fi
fi

# Hermes config is edited only through the Hermes CLI (never by text edits).
hermes_cli() { HERMES_HOME="$TARGET_HOME" "$HERMES_BIN" "$@"; }

if ! hermes_cli plugins enable prompt-studio >/dev/null; then
  echo "[ERROR] 'hermes plugins enable prompt-studio' failed for $TARGET_HOME" >&2
  exit 1
fi

# auxiliary.prompt_studio: keep an existing block; else write the defaults.
if ! hermes_cli config get --json auxiliary.prompt_studio >/dev/null 2>&1; then
  hermes_cli config set --force auxiliary.prompt_studio.provider auto >/dev/null
  hermes_cli config set --force auxiliary.prompt_studio.timeout 20 >/dev/null
fi

cat <<DONE
[OK] prompt-studio installed
  package: $PLUGIN_DIR (desktop half: $PLUGIN_DIR/desktop/plugin.js)
  config:  $TARGET_HOME/config.yaml (via hermes plugins enable / hermes config set)
Restart Hermes Desktop (or its backend) to load the plugin; Desktop materializes the desktop half.
DONE
