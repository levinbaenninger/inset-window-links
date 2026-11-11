# Inset Window Links

A small Mac and Windows app for keeping one thought together with the windows it is about. Add the windows that matter, either one at a time with a shortcut or several at once from a list. Give the capture a title that says what connects them, add an optional description, next steps and a due date, and save. Later, Recent Captures reopens the pages, files and apps the windows showed, and lets you check the steps off. Captures stay on this computer.

This is a research prototype. See `IMPLEMENTATION_REPORT.md` for what has been verified and what has not.

## Use

- **Setup (macOS).** The first launch opens a small setup window instead of anything else: Welcome, **Allow access** and Done, with **Back**, one dot per page and **Not now** on each. Allow access lists what is still missing:
  - **Screen Recording** (required), which takes the picture of each window you add, and **Accessibility** (optional), which lets Reopen bring back pages and files and also turns on Remember pages and files.
  - **Allow** shows macOS's prompt and opens the exact pane in System Settings. The window then moves to the right edge of the screen and floats beside System Settings, on every Space and over full-screen apps, without taking the keyboard. In a packaged app, "↑ Drag Inset Window Links into the … list" offers the app's tile to drag into the list when it isn't there.
  - Accessibility turns green by itself about half a second after you turn it on. Screen Recording only applies after a restart, so its row then offers **Reopen to finish**, which quits through the usual unsaved-draft check and opens the app again on Allow access.
  - Done hands over: **Start Capturing**, or **Show Me Around** for the walkthrough. A first run then opens Recent Captures.
  - **Set Up Permissions…** (Help menu and menu-bar icon), the capture panel's Screen Recording notice (**Set Up…**) and Settings' **Turn on** open it at Allow access, with that permission picked out. Until Screen Recording is on, neither the shortcut nor Add Windows asks macOS, so the setup is where its prompt comes from.
  - On Windows there is no setup window: nothing needs allowing.
- **Getting started.** Recent Captures teaches itself, on macOS and Windows, with the keys of each:
  - A **Getting started** checklist at the top of the list: add a window with `⌥⌘W`, add several from the list (`⇧⌘N`), save a capture with a title (`⌘↵`), reopen a capture (`⌘O`) and check off a next step. Each ticks itself off only when you really do it; clicking one shows how. The ⋯ menu has Remove Examples, and × closes it. **Getting Started** in the Help menu and the tray brings it back.
  - **One-time tips** show beside real controls the first time they appear, one at a time, and never again: the capture panel's Add windows tile and title field, Recent Captures' list, search (with `due:` filters) and Reopen all.
  - **Show Me Around** (Help menu, tray, or the setup's Done) is a spotlight walkthrough of Recent Captures: the list, search, a capture's windows, Reopen, next steps, and Settings. A stop whose control isn't on screen is skipped.
  - A fresh install gets one **example capture**, tagged Example, whose title, description and steps say what to try. Its pictures are drawn from bundled SVGs, and its one reopenable page is this repository on GitHub. It is saved like any capture, never added again, and Remove Examples deletes it.
  - **Settings › Tips** has **Show tips** and **Reset Tutorial**, which starts the checklist and tips over (the example stays gone).
- **Capture panel.** `⌥⌘W` (`Ctrl+Alt+W` on Windows) in any window adds a picture of that window and opens the capture panel. The Add tile shows the shortcut. File > New Capture (`⌘N`) or the Dock icon opens the panel without adding anything.
  - The panel opens centred on the screen you are working on, a little above the middle. Drag it by its header to move it; it reopens where you left it until the app quits.
  - It stays open when you click another window, and floats above other windows, so you can keep adding windows. Turn either off in Settings. Escape, or the − button, hides it and keeps the draft.
- **Several windows at once.** The dashed Add tile in the panel (File > Add Windows…, `⇧⌘N`) lists every open window. Click the windows you want, then Add. Select all (`⌘A`) picks all of them; double-click adds just one.
- **Write and save.** The title says what connects the windows; Return moves on to the optional Description. Next steps is a list: Return starts the next step, Backspace in an empty one removes it. Save with `⌘↵` (`Ctrl+Enter` on Windows), the Save button, or File > Save Capture (`⌘S`). Without a window or a title, Save says what is missing. Discard asks once, in a small prompt over the panel; Return and Escape keep the draft, so only a click or Space on Discard throws it away. While a save is on its way the fields are locked, so nothing typed then is lost.
- **Optional fields.** The add chips reveal Description (`⌘D`), Next steps (`⇧⌘S`) and Due (`⇧⌘D`). On Windows, use Ctrl in place of ⌘. Each window tile shows its own description, or **+ Description** under its title; click it to write one beside that window. Recent Captures shows the same line under each window. A description reads as plain text: click it to edit, Return or a click elsewhere goes back to the text (Shift-Return starts a new line), and Escape puts back what it said. A click outside the window tiles closes the open window's preview.
- **Search.** The field reads "Search or due:today", or just "Search" when the sidebar is too narrow for that.
- **Due.** Pick Today, Tomorrow, This weekend, Next week or a date. Pick a date… opens a calendar whose week starts on your system's first day: the arrow keys move the day, Return picks it, and Escape closes only the calendar. Clear removes it. Today uses the accent colour; overdue dates use red. Due keeps the capture visible. Search with `due:today`, `due:overdue`, `due:week` (overdue, today and the next six days), `due:any` or `due:none`. While a `due:` word is being typed, the filters it can become show under the search field, each with what it means; Return picks the first, a click any of them. The filter button offers the same choices.
- **Keyboard Shortcuts.** Open the sheet with `⌘/` (`Ctrl+/` on Windows), Help, the tray menu or the ⌘ button at the foot of Recent Captures' sidebar. The capture panel has no button for it. Save stays `⌘S`; the sidebar stays `⌃⌘S`.
- **Quit** with an unsaved draft, or a window still being added, asks in a prompt over the panel, with the panel's fields locked behind it: Save, Discard, or Cancel. Save waits for that window, then saves it with the rest. Return always saves, whichever button has focus; Escape cancels; Space presses the focused button. If the save hasn't reached the disk after 3 seconds, the panel asks again ("Saving didn't finish in time.") instead of quitting: **Retry** waits again, **Cancel** keeps the save going without quitting, and **Discard** quits at once, and the capture never appears later. Discard in the panel also works while a save is on its way, even while its folder is being moved into place: an empty `<id>.withdrawn` marker makes the next start remove it if the app stops halfway. Keyboard Shortcuts waits until a prompt is answered.
- **Recent Captures** (View > Recent Captures, `⌘2`) opens on the newest capture, or, with none yet, says how to add one. The captures are listed by day in a sidebar, with search (`⌘F`) over the title, descriptions, next steps, window titles and apps. A row found by something other than its title shows the line that matched. Settings sits at the foot of the sidebar.
  - Drag the sidebar's edge to make it wider or narrower; double-click the edge for the default width. Hide it with the sidebar button or `⌃⌘S` (`Ctrl+B` on Windows), or by dragging the edge far to the left. The width and whether it is hidden are kept.
  - Edit the title, Description and next steps right in the capture. When it was captured and last edited sits in a quiet line at its foot. Changes save as you type; a blank title goes back to the saved one. Each checked step is saved at once.
  - Words that can't be saved stay with their capture while Recent Captures is open, even after you open another one. The capture shows them with the reason in plain words ("The disk is full."), **Retry** and **Discard changes**, and its row in the sidebar says "Not saved". **Discard changes** works at once, even while a save is still on its way, and puts every field back to the saved words. It never writes your words: a save of the discarded words still on its way is dropped, and one that already reached the disk is undone by putting the previous file back (each save keeps it as `record.json.prev`), which works on a full disk too. An empty `record.json.discard` marker goes down first, so a crash at any point still ends with the saved words at the next start. If the previous file can't be put back, the discarded words come back as "Not saved" with "Couldn’t discard your changes." and the reason, **Keep changes** and **Discard again**. Keep changes saves what is on screen, and Return picks it. Discard again asks again for the version the first Discard was putting back and never saves the discarded words. Until you pick one, nothing of that capture is saved, typing included, so the saved version stays ready to put back; if you pick neither, the next start finishes the Discard. Edits made while a Discard is still on its way wait for it in the same way, and are not sent as the page goes away. Closing or quitting while a Discard is on its way waits up to 3 seconds for it, and while one couldn't finish asks "1 change couldn’t be discarded" with Keep changes (Return), Discard again, which holds the close until the saved version is back, and Cancel. If the app hasn't answered a Discard after those 3 seconds, it asks "1 change isn’t discarded yet" with **Wait** (Return), which says it is waiting and waits again, **Close anyway** (**Quit anyway**), which leaves now and lets the app finish the Discard in the background or at the next start, and **Cancel**. Quit anyway and Restart to Update don't ask again once the Discard's marker is on disk; only if the disk refused the marker does the app still ask "is still saving". A Recent Captures window opened again while the app still owes a Discard shows that capture as not discarded, with Keep changes and Discard again, before anything else, and its copies stay refused until you pick one. If the window can't find out which Discards the app still owes, it shows no capture, says “Recent Captures can’t open yet”, and asks again every second until it can.
  - A Due picked on the page or from a row's menu is saved with the words, so one that can't be saved stays on screen as "Not saved" with Retry and Discard changes, like any other edit.
  - Closing Recent Captures, or quitting the app from the menu, the tray or Restart to Update, first waits up to 3 seconds for the saves on their way. If some words still can't be saved, or saving didn't finish in time, the window stays open and asks: "2 changes couldn't be saved", with the reason, **Retry**, **Discard and close** (**Discard and quit**) and **Cancel**. Return always retries, whichever button has focus, and closes once they are saved; Escape cancels; Space presses the focused button. Retry waits up to 3 seconds too, and Cancel and Discard work at once. A quit with an unsaved draft in the panel asks there first.
  - If Recent Captures doesn't answer at all while it holds unsaved words, or its page crashed or reloaded with unsaved words, the app asks itself: "Inset Window Links couldn't confirm your changes were saved", with **Wait**, **Quit anyway** (**Close anyway**) and **Cancel**. A crash is never taken as saved: the app remembers the last count the page reported until a freshly loaded page reports its own. A last write still going to disk at quit gets 3 seconds, then **Wait** or **Quit anyway**.
  - Reopen all opens the web page, file or app each window showed. Each window also has its own link.
  - Right-click a capture in the sidebar, or open the capture's `…` menu, for Reopen, Copy, Copy as text, Due, Snooze, Mark as done and Delete. Delete asks first. A right-click also focuses that row, so `⌘C`, `⌥⌘C`, `⌘O`, Space and `⌫` act on it; with no row in focus they act on the open capture.
  - Inside an open menu, Space and Return pick the highlighted item, in a submenu too. The keys the menu shows (`⌘C`, `⌥⌘C`, `⌘O`, and `⌫` in a row's menu) run that item for the menu's row, or for the open capture in its `…` menu, whatever is highlighted. Any other app key, such as `⇧⌘D`, `⌘N` or `⌘W` (`Ctrl+Shift+D`, `Ctrl+N` or `Ctrl+W` on Windows), does nothing while a menu is open, or while the dropdown in Settings is. Escape or a click outside gives focus back to the row.
  - Space on a row in the sidebar marks it done, or takes a done one back, and moves to the next row. `⌫` (Delete on Windows) on a row asks, naming the capture, before it deletes it. `⌘C` with no text selected copies the row's, or the open capture's, title and description.
  - Every copy (`⌘C`, Copy as text, Copy image, from a menu, a key or a button) copies the words on screen at that moment, once they have reached the disk; words typed while it waits are not part of it. If they can't be saved, or saving takes more than 3 seconds, or the capture holds words that couldn't be saved, nothing is copied: it says "Couldn’t save your changes, so nothing was copied." and why, at once for words that already failed, with **Retry** beside it. Retry saves them, and the next copy copies them. A copy also takes the Due and windows as they were when it started; if a Due picked just before can't be saved, or a change before the copy takes more than 3 seconds to reach the disk, nothing is copied either, and Retry copies again. After a Discard that couldn't finish, copies are refused with “Couldn’t discard your changes, so nothing was copied.” until you keep the changes or discard again. On the capture's page the banner just below gives the reason and **Keep changes**; a row and the image viewer show both beside the refusal. While the app hasn't finished a Discard after 3 seconds, a copy says “Couldn’t discard your changes, so nothing was copied. Inset is still putting the earlier version back.” Dragging an image out doesn't wait.
  - A due date in a narrow sidebar row keeps its whole label: the time makes room first, then the step count, and a date too long for the row gets a line of its own.
  - Mark as done (the check button in the capture's header) keeps a capture without leaving it in the list. Snooze hides it until in an hour, this evening, tomorrow at 9:00 or next Monday at 9:00; then it comes back to the list with a notification, also after the computer slept or the app was closed. Snoozed and Done sit at the foot of the sidebar and open their own lists.
  - Copy as text (`⌥⌘C`, or the `…` menu) first saves what is being typed, copying nothing if that save fails, then puts the title, Description, Due, the steps as a checklist, and the windows with their addresses and descriptions on the clipboard. Each image can be copied, dragged into another app, or opened at full size (`Z` switches to actual size, the arrow keys step between windows).
- **Settings** (`⌘,`):
  - Open at login.
  - Show the app icon in the Dock, the menu bar, or both (macOS). Menu bar only means no Dock icon and no menu bar.
  - Keep the panel on top, and hide it when you click away.
  - Remember pages and files. This needs Accessibility; Turn on opens the permission guide at Accessibility. Without it, Reopen brings back only the app. On Windows the setting is Remember web pages, a switch that starts off.
- **Menus.** The app has the usual Mac menus: File, Edit, Capture, View, Window and Help. Window > Keep Capture Panel on Top does the same as the setting. The menu-bar icon has Capture Panel, Add Windows…, Recent Captures…, Set Up Permissions… (macOS), Getting Started, Show Me Around, Keyboard Shortcuts, Settings… and Quit. Help has Getting Started, Show Me Around, Keyboard Shortcuts and Set Up Permissions….
- **Windows.**
  - The icon sits in the notification area. Windows 11 puts new icons behind the ^ next to the clock; drag it onto the taskbar to keep it in view. A left click opens the draft when it holds something, otherwise Recent Captures. Starting the app again while it runs does the same.
  - There is no menu bar, but Inset's windows answer the menu keys with Ctrl: `Ctrl+N` and `Ctrl+1` open the panel, `Ctrl+Shift+N` opens Add Windows while an Inset window has focus, `Ctrl+Alt+C` copies as text, `Ctrl+S` saves, `Ctrl+F` finds, `Ctrl+2` opens Recent Captures, `Ctrl+,` opens Settings, and `Ctrl+W` closes the window or hides the panel. Alt+F4 also hides the panel and keeps the draft.
  - `Ctrl+Shift+N` while a window is still being added opens the list at once; the window being added still lands in the capture, and Save waits for it. When Windows keeps another app in front, the panel's title says to click the panel before using its keys; the tray's Add Windows… always works.
  - Recent Captures and Settings open on the screen the pointer is on.
  - Reopen starts each window's app again, once per app. Windows starts a new window of it rather than bringing a running one forward. With Remember web pages on, a page in Chrome, Edge, Brave, Vivaldi or Opera opens again, in the browser it was in. Firefox pages are not read. Inset reads the address from the browser's address bar, which hides `https://`. An address without a scheme is stored as https, or as http for localhost and IP addresses. Files other apps had open are not remembered.

The new Windows shortcut changes have unit coverage and Chromium fixture checks, but have not been verified on real Windows.

Captures are stored as JSON and PNG files in `~/Library/Application Support/Inset Window Links/captures` on macOS and `%APPDATA%\Inset Window Links\captures` on Windows.

## Develop

Node and pnpm come from the machine's toolchain. Then:

```sh
pnpm install
pnpm dev          # run with the Vite dev server
pnpm check        # format check, lint, typecheck, unit tests
pnpm build        # production build into out/
pnpm icon         # re-render build/icon.png from build/icon.svg
pnpm screens      # build, then screenshot every window into release/screens
```

On Windows, the repository's `.gitattributes` keeps line endings LF, which `pnpm check` expects. If a host sets `ELECTRON_RUN_AS_NODE` (some editors and agent hosts do), unset it before `pnpm dev`; the harnesses strip it themselves.

## Package

```sh
pnpm package:mac  # dmg and zip for arm64 and x64, signed with the shared prototype certificate
pnpm package:win  # NSIS installer and zip for x64, unsigned
pnpm package:dir  # unpacked app for the current platform, in release/
```

`scripts/sign-mac.mjs` signs every macOS build with the self-signed "Inset Prototype Signing" certificate. Locally it uses `~/Library/Keychains/inset-signing.keychain-db`. In the release workflow, `scripts/import-signing-key.sh` imports the `MAC_SIGNING_P12_BASE64` secret into a temporary keychain. Without either, the build is signed ad hoc and cannot update an installed copy.

## Verify on the desktop (macOS)

```sh
pnpm verify:desktop   # builds, then drives the real popover path against TextEdit
pnpm verify:packaged  # packages with package:dir, then runs the same checks on the app
pnpm verify:packaged:current  # the packaged checks on the existing build, without rebuilding
```

The harness opens TextEdit documents, moves focus between windows, and overwrites the clipboard during the Copy as text check. Leave the machine alone while it runs. The terminal that runs it needs Screen Recording permission, and Accessibility for the one check that sends a real ⌥⌘W keystroke. That check runs only when Inset holds the shortcut and the harness document is in front, because ⌥⌘W closes windows in TextEdit. It writes a JSON report to `release/verify-dev.json` or `release/verify-packaged.json`.

## Verify on the desktop (Windows)

```sh
pnpm verify:windows           # builds, then drives the real capture path against two test windows
pnpm verify:windows:packaged  # packages with package:dir, then runs the same checks on release/win-unpacked
node scripts/verify-windows.ts --exe "<path to an installed Inset Window Links.exe>"
```

The test windows belong to a separate fixture process. The harness refuses any click or keystroke unless a test window or Inset is the target, so your own apps are not touched even if one comes to the front. The harness clicks with the real mouse and sends real `Ctrl+Alt+W`, `Ctrl+Enter` and Escape keystrokes, opens the tray menu, and copies text once (it puts your clipboard text back afterwards). Unlock the desktop and leave the machine alone while it runs, about a minute. Before any input it takes the lock directory `%TEMP%\inset-desktop-test.lock`, which the other Inset prototypes' harnesses on this machine also use, and waits while another run holds it. It writes `release/verify-windows-<mode>.json` and screenshots to `release/verify-windows-<mode>/`.

## Download

- Download macOS and Windows builds from the [Releases page](https://github.com/levinbaenninger/inset-window-links/releases). The **Preview build** prerelease gets each successful release workflow on `main`. These downloads need no login.
- Install once, then the app updates itself. It checks the Preview build at launch and every four hours, downloads a newer build in the background, and installs it when you quit. When a build is ready, a notification and the menu-bar menu offer Restart to Update. The menu-bar menu also shows the running version and Check for Updates.
- Installs of version 0.1.0 cannot update themselves. They are signed ad hoc, and macOS only accepts an update signed like the running app. Replace them once by hand with the current Preview build, as in macOS first run below. Builds after that update on their own.
- On Windows, only the NSIS installer (`.exe`) updates itself. The portable zip does not, so download a new zip to update it.
- Every push to `main` and every pull request also builds installers as GitHub Actions artifacts: `inset-window-links-mac-arm64` (Apple silicon), `inset-window-links-mac-x64` (Intel), and `inset-window-links-win-x64`. Downloading artifacts needs a GitHub login. They are kept for 14 days.

### Publish a versioned release

1. Set `version` in `package.json` to the release version, for example `0.2.0`, and merge the change into `main`.
2. Tag that commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The release workflow checks that the tag matches `version` in `package.json`, then publishes the dmg, zip, exe and update files as a versioned release. A mismatch fails before packaging. To rebuild the preview manually, run the Release workflow from GitHub Actions with `main` selected.

Preview builds from `main` take the major and minor version from `package.json` and the workflow's run number as the patch, for example `0.1.57`. The run number only grows, so every installed preview sees the next one as newer. Installed apps follow the Preview build, also those installed from a versioned release. After a tag such as `v0.2.0`, previews continue at `0.2.<run number>`.

`pnpm verify:update` proves the update loop on a Mac. It builds 0.1.900 and 0.1.901 for arm64, installs 0.1.900 under `~/Library/Caches/inset-update-test/inset-window-links`, serves 0.1.901 on `http://127.0.0.1:8703`, and drives the app through Restart to Update. It checks the new version is installed and relaunched with the same designated requirement, then removes what it created. `INSET_UPDATE_FEED_URL` points any packaged build at another feed.

### macOS first run

The app is signed with a self-signed certificate and not notarized, so Gatekeeper blocks the first launch.

1. Move `Inset Window Links.app` to `/Applications`.
2. Remove the quarantine flag:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Inset Window Links.app"
   ```

   Or right-click the app, choose Open, then confirm.

3. The setup window opens. Choose Get Started, then Allow for Screen Recording, turn on Inset Window Links in the pane that opens (or drag the tile into the list), then choose Reopen to finish. The app opens again on Allow access.
4. Optional: Allow Accessibility, so Reopen can bring back web pages and files. Browsers such as Safari and Chrome also ask once, on a later capture, whether Inset Window Links may read their address.
5. Skipped a step? Set Up Permissions… in the Help menu or the menu-bar icon opens the setup again.

Remove the quarantine flag rather than only using Open. macOS can run a quarantined app from a hidden read-only copy, and that copy cannot replace itself with an update.

Builds signed with the shared certificate keep their Screen Recording and Accessibility grants across updates. A 0.1.0 install was signed ad hoc, and macOS ties its grants to that exact build. After you replace it, or run `pnpm package:dir` again, the switch can still show as on while macOS refuses capture. Select Inset Window Links in that list, remove it with −, add the new app with +, and reopen it. `tccutil reset ScreenCapture ch.inset.prototype.windowlinks` clears the stale entry from the command line.

### Windows first run

The installer is unsigned, so SmartScreen may warn. Choose More info, then Run anyway. The app opens Recent Captures on its first launch, with Getting started and an example capture; Windows needs no permission setup. The development build and the unpacked package were tested on Windows 11 (see `IMPLEMENTATION_REPORT.md`); the installer itself has not been run.
