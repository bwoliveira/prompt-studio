# Remote backend: put the desktop half on the app machine

Moved from the README, which keeps the short version in its *Install* section.

**Remote backend** (Desktop connected over SSH or a URL): run the install on the backend host as in the README's Install section. Hermes
Desktop copies the desktop half only from the plugins folder of the Hermes home on the machine where the app runs;
it never fetches it from a remote backend. So the desktop half has to be put on the app machine. From a
checkout (on the backend host or anywhere with `ssh` access to the app machine), run:

```bash
scripts/push-desktop.sh me@my-laptop                       # user@machine or an ~/.ssh/config alias
scripts/push-desktop.sh me@my-laptop --dir /path/to/desktop-plugins   # when HERMES_HOME is set on that machine
scripts/push-desktop.sh me@my-laptop --replace-managed     # the folder is managed for a local install: see below
scripts/push-desktop.sh me@my-laptop --dry-run             # print the plan, open no connection
```

It copies `desktop/plugin.js` to `<desktop-plugins>/prompt-studio/plugin.js` on the app machine with one `ssh`
call (no `scp`), through a temporary file, so Desktop never reads a half-written file. The app machine compares
a checksum of the temporary file and of the installed `plugin.js` with the source before the script says `[OK]`;
a directory named `plugin.js` is refused. Desktop rescans that folder
every few seconds; if *Prompt Studio* does not appear, close and reopen it. Repeat after each update of the
plugin. The script needs a POSIX login shell on the app machine (Linux, macOS).

If that machine also has Prompt Studio installed locally (`hermes plugins install` there), Desktop manages the
`desktop-plugins/prompt-studio` folder for that install and marks it with `.hermes-package.json`. On its next rescan
Desktop would overwrite a pushed file with the local install's older copy, or delete it once that install is gone, so
the script refuses such a folder and copies nothing. Either remove the local install on the app machine
(`hermes plugins remove prompt-studio`; Desktop then drops its managed copy) and push again, or add
`--replace-managed`, which removes the marker so the folder becomes a standalone plugin that Desktop never
overwrites. If the local install's own `desktop/plugin.js` is byte-identical to the file being pushed, Desktop
would adopt the folder as that install's managed copy again (and delete it with the install), so the script refuses
that case too, even with `--replace-managed`: remove the local install first, then push. The script looks in
`<Hermes home>/plugins` and `<Hermes home>/profiles/*/plugins`, the Hermes home being the parent of `--dir`. Other
files in the folder are left alone. Convert with `--replace-managed` only after you close Hermes Desktop on the app
machine: a rescan that overlaps the conversion could delete the folder or mark it again, which the script checks for
a second after the conversion and reports instead of `[OK]`.

The `desktop-plugins` folder is `<Hermes home>/desktop-plugins`, where the Hermes home on the app machine is
`$HERMES_HOME` when set, else `~/.hermes` on Linux and macOS and `%LOCALAPPDATA%\hermes` on Windows (an existing
`%USERPROFILE%\.hermes` is still used there when the new folder does not exist). On Windows copy the file by hand
to `%LOCALAPPDATA%\hermes\desktop-plugins\prompt-studio\plugin.js`; the script does not support it.
