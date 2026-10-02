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
#
# A folder that holds `.hermes-package.json` is one Desktop manages for a local Hermes plugin install (the marker is
# its PACKAGE_MARKER, written by desktop-plugins-root.ts): the next rescan overwrites the copy with that package, or
# deletes it when the package is gone. Pushing there would be undone, so the script refuses unless told to
# --replace-managed, which drops the marker and leaves a standalone plugin Desktop never overwrites.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$(cd "$SCRIPT_DIR/.." && pwd -P)/desktop/plugin.js"
# shellcheck disable=SC2088  # a literal ~ on purpose: it is expanded on the remote side
DEFAULT_DIR='~/.hermes/desktop-plugins'
DIR="$DEFAULT_DIR"
HOST=""
DRY_RUN=0
REPLACE_MANAGED=0
MARKER=".hermes-package.json"

usage() {
  cat <<'USAGE'
Usage: push-desktop.sh [--dir DIR] [--source FILE] [--replace-managed] [--dry-run] HOST

Copy desktop/plugin.js to HOST (anything `ssh` accepts: user@machine or a ~/.ssh/config alias), the machine that
runs Hermes Desktop, into DIR/prompt-studio/plugin.js.

  --dir DIR      desktop-plugins folder on HOST: absolute, or starting with ~/ (default: ~/.hermes/desktop-plugins;
                 use <HERMES_HOME>/desktop-plugins when HERMES_HOME is set there)
  --source FILE  file to copy (default: desktop/plugin.js of this checkout)
  --replace-managed
                 when DIR/prompt-studio holds .hermes-package.json (Desktop manages that folder for a plugin
                 installed locally on HOST, and overwrites or deletes the pushed file on its next rescan), the push
                 is refused by default; this flag removes the marker so the folder becomes a standalone plugin
                 (still refused when a local prompt-studio package under the Hermes home, the parent of DIR, holds a
                 byte-identical desktop/plugin.js: Desktop would adopt the folder again; remove that install first)
                 (close Hermes Desktop on HOST while converting: a rescan that overlaps the conversion can undo it)
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
    --replace-managed) REPLACE_MANAGED=1; shift ;;
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
# shellcheck disable=SC2088  # literal ~ is what the user types
if [[ "$DIR" != "~" && "$DIR" != "~/"* && "$DIR" != /* ]]; then
  usage_die "--dir must be an absolute path or start with ~/ (got '$DIR')"
fi
[[ -f "$SOURCE" ]] || die 1 "Source file not found: $SOURCE (run 'node scripts/build.mjs' in a checkout, or pass --source)"

TARGET="$DIR/prompt-studio/plugin.js"

# shellcheck disable=SC2088  # literal ~ is what the user types
if [[ "$DIR" == "~" || "$DIR" == "~/"* ]]; then
  REMOTE_DIR="\"\$HOME\"$(shq "${DIR#\~}/prompt-studio")"
else
  REMOTE_DIR="$(shq "$DIR/prompt-studio")"
fi
# Checksum of what is sent (POSIX cksum: "<crc> <bytes>"), compared on the remote side with the staged file before
# it replaces the old one, and with the installed plugin.js after the mv.
EXPECTED="$(cksum < "$SOURCE")"
# Stage beside the target, then mv: Desktop never reads a half-written plugin.js. Remote exit codes: 3 = the folder
# is managed for a local package (marker present) and the user did not ask to replace that; 4 = plugin.js is a
# directory; 5 = the staged or installed file does not match the checksum; 6 = a prompt-studio package installed
# locally on the app machine (its Hermes home, or a profile's) holds a byte-identical desktop/plugin.js; 7 = after --replace-managed the
# folder changed again (a Desktop rescan deleted it or stamped the marker back).
REMOTE_SCRIPT="set -e; d=$REMOTE_DIR; mkdir -p \"\$d\"; m=\"\$d/$MARKER\"; sum=$(shq "$EXPECTED"); if [ -d \"\$d/plugin.js\" ]; then exit 4; fi"
if [[ "$REPLACE_MANAGED" == 1 ]]; then
  REMOTE_SCRIPT+='; rm_marker=1'
else
  REMOTE_SCRIPT+='; rm_marker=0; if [ -e "$m" ] || [ -L "$m" ]; then exit 3; fi'
fi
REMOTE_SCRIPT+='; t="$d/.plugin.js.$$"; trap '"'"'rm -f "$t"'"'"' EXIT; cat > "$t"; [ "$(cksum < "$t")" = "$sum" ] || exit 5'
# A prompt-studio package installed locally on the app machine (its Hermes home, or a profile's) with the very bytes
# being pushed: Desktop's reconcile would adopt the folder (stamp the marker back) and delete it with the package.
REMOTE_SCRIPT+='; h=$(dirname "$(dirname "$d")"); for p in "$h"/plugins/prompt-studio/desktop/plugin.js "$h"/profiles/*/plugins/prompt-studio/desktop/plugin.js; do if [ -f "$p" ] && cmp -s "$t" "$p"; then exit 6; fi; done'
# The new file goes in BEFORE the marker is removed: Desktop may rescan at any moment, and the old plugin.js without
# its marker could match the local package's and be adopted again. The final check also catches a folder Desktop
# deleted in between.
REMOTE_SCRIPT+='; mv -f "$t" "$d/plugin.js"; if [ "$rm_marker" = 1 ]; then rm -f "$m"; fi; [ -f "$d/plugin.js" ] && [ "$(cksum < "$d/plugin.js")" = "$sum" ] || exit 5'
# A Desktop rescan that read the old marker just before the conversion can still delete the folder or stamp the
# marker back a moment later (its reconcile does not recheck): wait a beat and look again before claiming success.
REMOTE_SCRIPT+='; if [ "$rm_marker" = 1 ]; then sleep 1; [ -f "$d/plugin.js" ] && [ ! -e "$m" ] && [ ! -L "$m" ] && [ "$(cksum < "$d/plugin.js")" = "$sum" ] || exit 7; fi'
REMOTE_COMMAND="sh -c $(shq "$REMOTE_SCRIPT")"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "[DRY RUN] would copy $SOURCE"
  echo "[DRY RUN]   to $HOST:$TARGET"
  echo "[DRY RUN]   with: ssh -- $HOST $REMOTE_COMMAND"
  exit 0
fi

rc=0
ssh -- "$HOST" "$REMOTE_COMMAND" < "$SOURCE" || rc=$?
if [[ "$rc" == 3 ]]; then
  die 1 "$HOST:$DIR/prompt-studio holds $MARKER: Hermes Desktop manages that folder for a plugin installed locally on $HOST and, on its next rescan, would overwrite the file just pushed with that older copy or delete it. Nothing was copied. Either remove the local install on $HOST (hermes plugins remove prompt-studio; Desktop then drops its managed copy on the next rescan) and rerun, or rerun with --replace-managed to remove the marker and make the folder a standalone plugin."
elif [[ "$rc" == 4 ]]; then
  die 1 "$HOST:$TARGET is a directory, not a file; nothing was copied (remove or rename that directory, then rerun)"
elif [[ "$rc" == 6 ]]; then
  die 1 "$HOST has a locally installed prompt-studio package whose desktop/plugin.js is identical to $SOURCE. Hermes Desktop would adopt $DIR/prompt-studio as that package's managed copy on its next rescan and delete it when the package is removed, so nothing was copied (the local package's own copy already serves Desktop). To push instead, remove the local install first (hermes plugins remove prompt-studio), then rerun."
elif [[ "$rc" == 7 ]]; then
  die 1 "Hermes Desktop on $HOST changed $DIR/prompt-studio right after the conversion (it deleted the folder or stamped $MARKER back during a rescan), so the push did not hold. Close Hermes Desktop on $HOST and rerun with --replace-managed."
elif [[ "$rc" == 5 ]]; then
  die 1 "the plugin.js received by $HOST does not match $SOURCE (checksum $EXPECTED); do not trust $HOST:$TARGET, rerun the script"
elif [[ "$rc" != 0 ]]; then
  die 1 "ssh to $HOST failed; nothing was copied (check that 'ssh $HOST' works and its login shell is POSIX)"
fi

echo "[OK] copied $SOURCE to $HOST:$TARGET (checksum verified on $HOST)"
echo "Hermes Desktop on $HOST rescans its desktop-plugins folder every few seconds; if Prompt Studio does not appear, close and reopen Desktop."
