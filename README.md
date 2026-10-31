# Inset Window Links

A small Mac and Windows app for keeping one thought together with the windows it is about. Add the windows that matter, either one at a time with a shortcut or several at once from a list. Write what connects them, list the next steps, and save. Later, Recent Captures reopens the pages, files and apps the windows showed, and lets you check the steps off. Captures stay on this computer.

This is a research prototype. See `IMPLEMENTATION_REPORT.md` for what has been verified and what has not.

## Use

- **Capture panel.** `⌥⌘W` (`Ctrl+Alt+W` on Windows) in any window adds a picture of that window and opens the capture panel. File > New Capture (`⌘N`) or the Dock icon opens the panel without adding anything.
  - The panel opens centred on the screen you are working on, a little above the middle. Drag it by its header to move it; it reopens where you left it until the app quits.
  - It stays open when you click another window, and floats above other windows, so you can keep adding windows. Turn either off in Settings. Escape, or the − button, hides it and keeps the draft.
- **Several windows at once.** Add windows, the dashed tile in the panel (File > Add Windows…, `⇧⌘N`), lists every open window. Click the windows you want, then Add. Select all (`⌘A`) picks all of them; double-click adds just one.
- **Write and save.** Write what connects the views. Next steps is a list: Return starts the next step, Backspace in an empty one removes it. Save with `⌘↵` (`Ctrl+Enter` on Windows), the Save button, or File > Save Capture (`⌘S`). Discard asks once; while it asks, Escape keeps the draft.
- **Quit** with an unsaved draft asks inside the panel: Save and quit, Discard and quit, or Cancel.
- **Recent Captures** (View > Recent Captures, `⌘2`) lists captures by day in a sidebar, with search (`⌘F`) over the text, next steps, window titles and apps.
  - Check off next steps right in a capture; each check is saved at once.
  - Reopen all opens the web page, file or app each view came from. Each view also has its own link.
  - Copy note puts the thought, its steps as a checklist, and the sources with their addresses on the clipboard. Each image can be copied, dragged into another app, or opened at full size (`Z` switches to actual size, the arrow keys step between views).
- **Settings** (`⌘,`):
  - Open at Login.
  - Show the app icon in the Dock, the menu bar, or both (macOS). Menu Bar Only works as before, with no Dock icon and no menu bar.
  - Keep the panel on top, and hide it when you click away.
  - Remember pages and files. This needs Accessibility. Without it, Reopen brings back only the app. On Windows the setting is Remember web pages, a switch that starts off.
- **Menus.** The app has the usual Mac menus: File, Edit, View, Window and Help. Window > Keep Capture Panel on Top does the same as the setting. The menu-bar icon has Capture Panel, Add Windows…, Recent Captures…, How It Works, Settings… and Quit.
- **Windows.**
  - The icon sits in the notification area. Windows 11 puts new icons behind the ^ next to the clock; drag it onto the taskbar to keep it in view. A left click opens the draft when it holds something, otherwise Recent Captures. Starting the app again while it runs does the same.
  - There is no menu bar, but Inset's windows answer the menu keys with Ctrl: `Ctrl+N` and `Ctrl+1` open the panel, `Ctrl+Shift+N` adds windows, `Ctrl+S` saves, `Ctrl+F` finds, `Ctrl+2` opens Recent Captures, `Ctrl+,` opens Settings, and `Ctrl+W` closes the window or hides the panel. Alt+F4 also hides the panel and keeps the draft.
  - Recent Captures and Settings open on the screen the pointer is on.
  - Reopen starts each view's app again, once per app. Windows starts a new window of it rather than bringing a running one forward. With Remember web pages on, a page in Chrome, Edge, Brave, Vivaldi or Opera opens again, in the browser it was in. Firefox pages are not read. Inset reads the address from the browser's address bar, which hides `https://`. An address without a scheme is stored as https, or as http for localhost and IP addresses. Files other apps had open are not remembered.

Captures are stored as JSON and PNG files in `~/Library/Application Support/Inset Window Links/captures` on macOS and `%APPDATA%\Inset Window Links\captures` on Windows.

## Develop

Node and pnpm come from the machine's toolchain. Then:

```sh
pnpm install
pnpm dev          # run with the Vite dev server
pnpm check        # format check, lint, typecheck, unit tests
pnpm build        # production build into out/
pnpm icon         # re-render build/icon.png from build/icon.svg
```

On Windows, the repository's `.gitattributes` keeps line endings LF, which `pnpm check` expects. If a host sets `ELECTRON_RUN_AS_NODE` (some editors and agent hosts do), unset it before `pnpm dev`; the harnesses strip it themselves.

## Package

```sh
pnpm package:mac  # dmg and zip for arm64 and x64, ad-hoc signed
pnpm package:win  # NSIS installer and zip for x64, unsigned
pnpm package:dir  # unpacked app for the current platform, in release/
```

## Verify on the desktop (macOS)

```sh
pnpm verify:desktop   # builds, then drives the real popover path against TextEdit
pnpm verify:packaged  # packages with package:dir, then runs the same checks on the app
pnpm verify:packaged:current  # the packaged checks on the existing build, without rebuilding
```

The harness opens TextEdit documents, moves focus between windows, and overwrites the clipboard during the Copy note check. Leave the machine alone while it runs. The terminal that runs it needs Screen Recording permission, and Accessibility for the one check that sends a real ⌥⌘W keystroke. That check runs only when Inset holds the shortcut and the harness document is in front, because ⌥⌘W closes windows in TextEdit. It writes a JSON report to `release/verify-dev.json` or `release/verify-packaged.json`.

## Verify on the desktop (Windows)

```sh
pnpm verify:windows           # builds, then drives the real capture path against two test windows
pnpm verify:windows:packaged  # packages with package:dir, then runs the same checks on release/win-unpacked
node scripts/verify-windows.ts --exe "<path to an installed Inset Window Links.exe>"
```

The test windows belong to a separate fixture process. The harness refuses any click or keystroke unless a test window or Inset is the target, so your own apps are not touched even if one comes to the front. The harness clicks with the real mouse and sends real `Ctrl+Alt+W`, `Ctrl+Enter` and Escape keystrokes, opens the tray menu, and copies text once (it puts your clipboard text back afterwards). Unlock the desktop and leave the machine alone while it runs, about a minute. Before any input it takes the lock directory `%TEMP%\inset-desktop-test.lock`, which the other Inset prototypes' harnesses on this machine also use, and waits while another run holds it. It writes `release/verify-windows-<mode>.json` and screenshots to `release/verify-windows-<mode>/`.

## Download

- Download macOS and Windows builds from the [Releases page](https://github.com/levinbaenninger/inset-window-links/releases). The **Preview build** prerelease is replaced after each successful release workflow on `main`. These downloads need no login.
- Every push to `main` and every pull request also builds installers as GitHub Actions artifacts: `inset-window-links-mac-arm64` (Apple silicon), `inset-window-links-mac-x64` (Intel), and `inset-window-links-win-x64`. Downloading artifacts needs a GitHub login. They are kept for 14 days.

### Publish a versioned release

1. Set `version` in `package.json` to the release version, for example `0.2.0`, and merge the change into `main`.
2. Tag that commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The release workflow checks that the tag matches `version` in `package.json`, then publishes the dmg, zip, and exe files as a versioned release. A mismatch fails before packaging. To rebuild the preview manually, run the Release workflow from GitHub Actions with `main` selected.

### macOS first run

The app is ad-hoc signed and not notarized, so Gatekeeper blocks the first launch.

1. Move `Inset Window Links.app` to `/Applications`.
2. Remove the quarantine flag:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Inset Window Links.app"
   ```

   Or right-click the app, choose Open, then confirm.

3. Press the shortcut once. Inset Window Links shows that Screen Recording is off.
4. Choose Open Screen Recording settings and turn on Inset Window Links.
5. Choose Quit and reopen in the panel, or quit from the menu bar and open the app again.
6. Optional: in Settings, Remember pages and files > Turn On… asks for Accessibility, so Reopen can bring back web pages and files. Browsers such as Safari and Chrome also ask once whether Inset Window Links may read their address.

macOS ties the Screen Recording grant to the exact build of an ad-hoc signed app. After you install a new build, or run `pnpm package:dir` again, the switch can still show as on while macOS refuses capture. Select Inset Window Links in that list, remove it with −, add the new app with +, and reopen it. `tccutil reset ScreenCapture ch.inset.prototype.windowlinks` clears the stale entry from the command line.

### Windows first run

The installer is unsigned, so SmartScreen may warn. Choose More info, then Run anyway. The app opens Recent Captures with a short guide on its first launch. The development build and the unpacked package were tested on Windows 11 (see `IMPLEMENTATION_REPORT.md`); the installer itself has not been run.
