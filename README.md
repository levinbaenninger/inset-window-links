# Inset Window Links

A small menu bar utility for keeping one thought that connects several windows. While you work, press the shortcut in each window that matters. Inset Window Links adds a still image of that exact window to a draft and opens a small popover. You write what connects the views once and save. Captures stay on this computer.

This is a research prototype. See `IMPLEMENTATION_REPORT.md` for what has been verified and what has not.

## Use

- Shortcut: `⌥⌘W` on macOS, `Ctrl+Alt+W` on Windows.
- The first launch opens a short "How it works" page. It is also in the menu, and behind the ? button in Recent Captures.
- Press the shortcut in a window. The popover opens beside that window with a chip for the view and the question "What connects these views?". On Windows, where taking the picture takes about a second, the popover appears at once with a "Capturing this window…" chip and takes focus when the picture is ready. The window being captured keeps focus until then.
- Click back into your work to hide the popover. The draft stays. Switch to another window and press the shortcut again to add it. The dashed row under the chips marks where the next view lands.
- Click a chip's thumbnail to see the whole capture, or × to remove that view.
- Save with `⌘↵` (`Ctrl+Enter` on Windows) or the Save button. Saving opens no window. On macOS the menu bar item shows "Saved" for a moment, if the menu bar has room to show it. On Windows a notification says "Capture saved"; clicking it opens that capture. Escape or clicking outside hides the popover without saving. Discard asks once, then clears the draft.
- Quit with an unsaved draft asks inside the popover: Save and quit, Discard and quit, or Cancel. Escape or clicking away counts as Cancel.
- Recent Captures groups captures by day and searches their text and window titles. A record can copy its note, and copy or drag each image into another app. The image view fits the whole capture in the window; Actual size, a click on the image, or `Z` switches to one image pixel per screen pixel. The arrow keys step between sources.
- The menu bar or tray icon has Show Draft, Add View from Window List (a labelled fallback), Recent Captures, How It Works, and Quit. If your menu bar collapses status items, the icon sits behind that control.
- On Windows the icon sits in the notification area. Windows 11 puts new icons behind the ^ next to the clock; drag it onto the taskbar to keep it in view. A left click opens the draft when it holds something, otherwise Recent Captures. Starting the app again while it runs does the same, so the Start menu entry finds a hidden icon.

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

- Every push to `main` and every pull request builds macOS and Windows installers. Open the run on the GitHub Actions page and download `inset-window-links-mac-arm64` (Apple silicon), `inset-window-links-mac-x64` (Intel), or `inset-window-links-win-x64`. Downloading artifacts needs a GitHub login. They are kept for 14 days.
- Pushing a `v*` tag publishes the dmg, zip, and exe files as a prerelease on the GitHub Releases page. These downloads need no login.

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
5. Choose Quit and reopen in the popover, or quit from the menu bar and open the app again.

macOS ties the Screen Recording grant to the exact build of an ad-hoc signed app. After you install a new build, or run `pnpm package:dir` again, the switch can still show as on while macOS refuses capture. Select Inset Window Links in that list, remove it with −, add the new app with +, and reopen it. `tccutil reset ScreenCapture ch.inset.prototype.windowlinks` clears the stale entry from the command line.

### Windows first run

The installer is unsigned, so SmartScreen may warn. Choose More info, then Run anyway. The app opens a short "How it works" page on its first launch. The development build and the unpacked package were tested on Windows 11 (see `IMPLEMENTATION_REPORT.md`); the installer itself has not been run.
