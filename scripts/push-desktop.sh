#!/usr/bin/env bash
# Copy Prompt Studio's desktop half (desktop/plugin.js) to the machine that runs Hermes Desktop, over SSH.
#
# Why this exists: Hermes Desktop copies the desktop half only from the plugins folder of the Hermes home on the
# machine where the app runs; it never fetches it from a remote backend. With a remote backend the half therefore
# has to be put on the app machine by hand: this script does that with one ssh call (no scp/rsync needed).
# Evidence (Hermes Desktop sources, apps/desktop/electron): desktop-plugins-root.ts reconcileUnifiedDesktopHalves
# walks only the local homes' plugins/ folders, and fs-ipc.ts resolves the desktop-plugins root from the app's own
# HERMES_HOME, never from the backend's.
#
# The target is a plain `<dir>/prompt-studio/plugin.js`, which Desktop loads as a standalone desktop plugin; it
# rescans that folder every few seconds. The remote login shell must be POSIX (Linux, macOS); for a Windows app
# machine copy the file by hand (path in the README).
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$(cd "$SCRIPT_DIR/.." && pwd -P)/desktop/plugin.js"
DEFAULT_DIR='~/.hermes/desktop-plugins'
DIR="$DEFAULT_DIR"
HOST=""
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: push-desktop.sh [--dir DIR] [--source FILE] [--dry-run] HOST

Copy desktop/plugin.js to HOST (anything `ssh` accepts: user@machine or a ~/.ssh/config alias), the machine that
runs Hermes Desktop, into DIR/prompt-studio/plugin.js.

  --dir DIR      desktop-plugins folder on HOST: absolute, or starting with ~/ (default: ~/.hermes/desktop-plugins;
                 use <HERMES_HOME>/desktop-plugins when HERMES_HOME is set there)
  --source FILE  file to copy (default: desktop/plugin.js of this checkout)
  --dry-run      print what would happen; open no connection
  -h, --help     show this help
USAGE
}

die() { local code="$1"; shift; echo "[ERROR] $*" >&2; exit "$code"; }
usage_die() { echo "[ERROR] $*" >&2; usage >&2; exit 2; }

# Single-quote a string for a POSIX shell.
shq() { local s="${1//\'/\'\\\'\'}"; printf "'%s'" "$s"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) [[ $# -ge 2 ]] || usage_die "--dir requires a directory"; DIR="$2"; shift 2 ;;
    --source) [[ $# -ge 2 ]] || usage_die "--source requires a file"; SOURCE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) usage_die "Unknown argument: $1" ;;
    *)
      [[ -z "$HOST" ]] || usage_die "Only one HOST is accepted (got '$HOST' and '$1')"
      HOST="$1"; shift ;;
  esac
done

[[ -n "$HOST" ]] || usage_die "HOST is required"
if [[ "$HOST" == -* || "$HOST" =~ [[:space:]] ]]; then
  usage_die "Invalid HOST '$HOST': use user@machine or an ssh config alias, with no spaces and no leading '-'"
fi
DIR="${DIR%/}"
if [[ "$DIR" != "~" && "$DIR" != "~/"* && "$DIR" != /* ]]; then
  usage_die "--dir must be an absolute path or start with ~/ (got '$DIR')"
fi
[[ -f "$SOURCE" ]] || die 1 "Source file not found: $SOURCE (run 'node scripts/build.mjs' in a checkout, or pass --source)"

TARGET="$DIR/prompt-studio/plugin.js"

if [[ "$DIR" == "~" || "$DIR" == "~/"* ]]; then
  REMOTE_DIR="\"\$HOME\"$(shq "${DIR#\~}/prompt-studio")"
else
  REMOTE_DIR="$(shq "$DIR/prompt-studio")"
fi
# Stage beside the target, then mv: Desktop never reads a half-written plugin.js.
REMOTE_SCRIPT="set -e; d=$REMOTE_DIR; mkdir -p \"\$d\"; t=\"\$d/.plugin.js.\$\$\"; trap 'rm -f \"\$t\"' EXIT; cat > \"\$t\"; mv -f \"\$t\" \"\$d/plugin.js\""
REMOTE_COMMAND="sh -c $(shq "$REMOTE_SCRIPT")"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "[DRY RUN] would copy $SOURCE"
  echo "[DRY RUN]   to $HOST:$TARGET"
  echo "[DRY RUN]   with: ssh -- $HOST $REMOTE_COMMAND"
  exit 0
fi

if ! ssh -- "$HOST" "$REMOTE_COMMAND" < "$SOURCE"; then
  die 1 "ssh to $HOST failed; nothing was copied (check that 'ssh $HOST' works and its login shell is POSIX)"
fi

echo "[OK] copied $SOURCE to $HOST:$TARGET"
echo "Hermes Desktop on $HOST rescans its desktop-plugins folder every few seconds; if Prompt Studio does not appear, close and reopen Desktop."
