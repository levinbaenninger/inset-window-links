# Inset Window Links

A small menu bar utility for keeping one thought that connects several windows. While you work, press the shortcut in each window that matters. Inset Window Links adds a still image of that exact window to a draft and opens a small popover. You write what connects the views once and save. Captures stay on this computer.

This is a research prototype. See `IMPLEMENTATION_REPORT.md` for what has been verified and what has not.

## Use

- Shortcut: `⌥⌘W` on macOS, `Ctrl+Alt+W` on Windows.
- Press it in a window. The popover opens beside that window with a chip for the view and the question "What connects these views?".
- Click back into your work to hide the popover. The draft stays. Switch to another window and press the shortcut again to add it.
- Save with `⌘↵` (`Ctrl+Enter` on Windows) or the Save button. Escape or clicking outside hides the popover without saving. Discard clears the draft.
- The menu bar icon has Show Draft, Add View from Window List (a labelled fallback), Recent Captures, and Quit. If your menu bar collapses status items, the icon sits behind that control.

Captures are stored as JSON and PNG files in `~/Library/Application Support/Inset Window Links/captures` on macOS and `%APPDATA%\Inset Window Links\captures` on Windows.

## Develop

Node and pnpm come from the machine's toolchain. Then:

```sh
pnpm install
pnpm dev          # run with the Vite dev server
pnpm check        # format check, lint, typecheck, unit tests
pnpm build        # production build into out/
```

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
```

The harness opens TextEdit documents, moves focus between windows, and overwrites the clipboard during the Copy note check. Leave the machine alone while it runs. The terminal that runs it needs Screen Recording permission. It writes a JSON report to `release/verify-dev.json` or `release/verify-packaged.json`.

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
4. Open System Settings, then Privacy & Security, then Screen Recording. Turn on Inset Window Links.
5. Quit and reopen the app.

### Windows first run

The installer is unsigned, so SmartScreen may warn. Choose More info, then Run anyway. The Windows build has not been tested.
