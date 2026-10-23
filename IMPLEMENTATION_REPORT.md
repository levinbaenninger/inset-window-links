# Implementation report

This report covers the Inset Window Links prototype. It separates what was verified on a real desktop, what works only through the explicit fallback, what is blocked, and what is untested.

## What was tested

- macOS 27.0.1 on Apple silicon, one display. Electron 45.0.0, get-windows 9.3.0, Node 24.22.1.
- Development mode means the electron-vite production build, run unpackaged. `pnpm verify:desktop` drives it.
- Packaged mode means `release/mac-arm64/Inset Window Links.app` from `pnpm package:dir`. It is ad-hoc signed and not notarized. `pnpm verify:packaged` drives it.
- The Vite dev server path was exercised once by hand. The built main process loaded both pages from the renderer dev server. Capture, typing, the chip preview image, Discard, and the library list worked there. No console messages were captured, but the listener was attached only after the popover had loaded, and the library page had no listener.
- Every shortcut press in the harness went through the `INSET_E2E` seam, which calls the same function the global shortcut calls. A physical press of the key combination was not exercised.
- Windows 11 Enterprise 10.0.26100, x64, one 1920 by 1080 display at 100% scale, dark mode. Same Electron, get-windows and Node versions. See "Windows round" below. The macOS sections were not rerun after that round.

## Real capabilities on macOS

- Ordinary launch opens no window and shows no dock icon. The tray menu has its entries.
- The shortcut path samples the foreground window with get-windows before Inset shows or focuses anything. It maps the native window id to exactly one `desktopCapturer` source. Titles are never used for matching.
- The still is requested at the window's pixel size. A 603 by 505 point TextEdit window produced a 1206 by 1010 PNG on a 2x display.
- The popover opens beside the source window on that window's display. It settles at 380 by 282 pixels with one chip. Inset becomes the active app and the relationship field has focus. In one early run the popover was read at 220 pixels right after it appeared. It shows at the height of its previous content and then grows to fit the new chip.
- Clicking into another window hides the popover and keeps the draft. Pressing the shortcut there adds a second view to the same draft. The typed text survives.
- A chip expands to show its captured image. Removing a chip drops only that view and keeps the text.
- Pressing the shortcut while the popover is focused hides it and captures nothing. Show Draft in the menu reopens the draft and captures nothing.
- A changed view of the same window is kept as a separate view. It is labelled "same window as view 1".
- Cmd+Enter saves the relationship and the optional next step. The popover hides, no other window opens, and focus returns to TextEdit. The record is one directory with `record.json` and one PNG per view.
- A record survives a restart after its source documents are closed. Recent Captures shows the thought, then the next step, then the sources with title, app, capture time, and fallback label. The readable image view shows the full-resolution PNG and returns to the record.
- Editing both text fields, Delete after confirmation, the missing-record state, and Copy note work in the library window.
- Escape keeps the draft. Discard clears it.
- A forced write failure keeps the draft, shows Retry, and publishes no partial record.
- Quit with a meaningful draft is held for a native Save, Discard, or Cancel dialog.
- The same capture path works in the packaged app. The get-windows helper runs from `app.asar.unpacked`.
- With Screen Recording off, the popover shows guidance. Its "Open Screen Recording settings" button opened the Screen Recording pane on macOS 27, and Inset Window Links was listed there with its switch off.

## Explicit fallback

Add View from Window List in the menu, and any failed direct capture, open a chooser inside the popover. The chooser is titled "Fallback: choose the window to add" and states the reason. A view added this way carries a "Chosen from list" badge in the popover and in the saved record. The note says "chosen from the window list". These views do not count as direct foreground capture. The harness verified one fallback view from the menu entry. No direct capture fell back during the runs.

## Blockers

- The packaged app's first run needs a manual Screen Recording grant. Launched through LaunchServices with `open`, the packaged app reports Screen Recording as `denied`. The get-windows helper then exits with an error. The app treats this as missing permission and shows the guidance. Capture after a grant and relaunch has not been verified.
- A grant probably does not survive a rebuild. The user reported granting the permissions. `pnpm verify:packaged` then rebuilt and re-signed the app ad hoc, and the new build reported `denied` through LaunchServices. The grant database could not be read, so it is not known which copy was granted. The likely cause is that macOS ties the grant to the exact ad-hoc build, so every new build or update would need the entry removed and added again. The popover notice and the README now say so. `pnpm verify:packaged:current` reruns the packaged checks without rebuilding.
- When Playwright launches the packaged app as a child of the terminal, it reports Screen Recording as `granted`. This is probably the terminal's grant. The packaged capture checks therefore prove the packaged capture path, not a user's first run.

## Untested or not observed

- Windows: see "Windows round" for what was observed and what was not.
- The menu bar icon was not seen. The menu bar on the test machine hides status items behind a collapse control, and Electron reported the item at zero height. The tray menu entries were read through the seam.
- A physical press of the shortcut has not been observed. The harness now has one check that sends a real ⌥⌘W through System Events, which Accessibility now allows. It has not run to completion yet (see Harness results).
- Shortcut conflict: macOS let two processes register Option+Command+W, and both reported success. The conflict message in the menu and popover was never triggered.
- The quit dialog's buttons were not clicked on the desktop. The reducer tests cover Save, Discard, and Cancel.
- Copy image and native drag of a saved image are built. Neither has been checked against a receiving app.
- Quit and reopen, from the permission notice, has not been exercised.
- Several displays: only one display was available. Clamping on a display with a negative origin is covered by unit tests only.
- Browser tabs: the same-window repeat was tested by resizing a TextEdit window, not by switching browser tabs.
- A source that vanishes during capture is covered by reducer tests only.
- The `not-determined` Screen Recording state was not observed. The packaged app was already `denied`.
- Legibility was checked by eye for one packaged capture of a TextEdit window at 1206 by 1010 pixels. Its 12 point text was readable. The harness checks only pixel sizes.

## Observed focus behaviour

Values come from get-windows in the harness, read after each step.

| Step | Frontmost window afterwards (dev) | Frontmost window afterwards (packaged) |
| --- | --- | --- |
| Shortcut press in TextEdit | Inset popover | Inset popover |
| Click into another TextEdit window | That TextEdit window | That TextEdit window |
| Shortcut while the popover is focused | TextEdit | TextEdit |
| Save with Cmd+Enter | TextEdit | TextEdit |
| Escape | TextEdit | TextEdit |
| Discard | TextEdit | TextEdit |

On macOS the popover hides itself and then hides the app, so the previous app becomes active again. Inset never forces focus to another app.

## Harness results

These numbers come from the build before the UX changes below. `pnpm verify:desktop` ran 54 checks. `pnpm verify:packaged` ran the same 54 and one more, which launches the app through LaunchServices.

| Run               | Pass | Fail | Blocked |
| ----------------- | ---- | ---- | ------- |
| Development build | 54   | 0    | 0       |
| Packaged app      | 54   | 0    | 1       |

| Check | Dev | Packaged | Observed |
| --- | --- | --- | --- |
| Ordinary launch shows no window | pass | pass | Only the hidden popover exists |
| Ordinary launch shows no dock icon | pass | pass | `dockVisible: false` |
| Tray menu has the expected entries | pass | pass | Show Draft, Add View from Window List…, Recent Captures…, shortcut status, Screen Recording Settings…, Quit |
| TextEdit document A is frontmost before the press | pass | pass | get-windows reports TextEdit |
| Popover is visible after the press | pass | pass |  |
| Popover width 340 to 420, height below 600 | pass | pass | 380 by 282 |
| Popover is on the display that contains TextEdit | pass | pass | Display 1 |
| One chip titled with the front TextEdit document | pass | pass |  |
| View captured directly | pass | pass | `source.kind: direct` |
| sampledAt precedes capturedAt | pass | pass | About 200 ms apart |
| Image at least the window's DIP size | pass | pass | 1206 by 1010 for 603 by 505 |
| Inset is the OS-active app after the press | pass | pass | Popover pid equals the app pid |
| Relationship input has focus | pass | pass |  |
| Label and hint copy | pass | pass |  |
| Typed relationship is mirrored in main | pass | pass |  |
| Activating document B hides the popover | pass | pass |  |
| Focus is with TextEdit after the blur | pass | pass |  |
| Two chips with distinct view ids | pass | pass |  |
| Relationship text survives the switch | pass | pass |  |
| Second chip is document B | pass | pass |  |
| Relationship input has focus after the second press | pass | pass |  |
| Expanding a chip shows the captured image | pass | pass | 1206 by 1010 |
| Removing a view drops only that view | pass | pass | Three views, then documents A and B remain |
| Self press adds nothing | pass | pass | Two views before and after |
| Self press hides the popover | pass | pass |  |
| Show Draft reopens without capturing | pass | pass | Two chips |
| Relationship input has focus after Show Draft | pass | pass |  |
| Cmd+Enter saves and hides | pass | pass |  |
| No window visible after save | pass | pass |  |
| Focus returns to TextEdit after save | pass | pass |  |
| One record directory with metadata and two PNGs | pass | pass |  |
| Saved metadata has the relationship, next step, and both titles | pass | pass |  |
| Saved PNG sizes match the metadata | pass | pass |  |
| Record shows the thought, then the next step, then the sources | pass | pass | Text positions 17, 100, 204 |
| After restart the record shows the relationship | pass | pass | Source documents closed first |
| After restart the record shows both titles | pass | pass |  |
| Record URL carries only the capture id | pass | pass | `/captures/<uuid>` |
| Readable image view shows the full PNG | pass | pass | 1206 by 1010 |
| Copy note puts the thought first | pass | pass |  |
| Editing both text fields persists to disk | pass | pass |  |
| Delete after confirmation removes the record | pass | pass |  |
| Deleted record shows the missing state | pass | pass |  |
| Escape hides the popover | pass | pass |  |
| Focus returns to TextEdit after Escape | pass | pass |  |
| Show Draft restores text and views after Escape | pass | pass |  |
| Discard hides and clears the draft | pass | pass |  |
| Window list from the menu is labelled as fallback | pass | pass |  |
| A chosen window is recorded as a fallback view | pass | pass | `reason: menu`, badge shown |
| Changed view of the same window is a second view | pass | pass | 1206 by 1010, then 1600 by 800 |
| The repeat is labelled as the same window | pass | pass |  |
| Failed write shows Retry and keeps the popover | pass | pass |  |
| Failed write keeps the draft | pass | pass |  |
| Failed write publishes no partial record | pass | pass |  |
| Quit with a draft is held for the dialog | pass | pass | Process still running 1.5 s later |
| Packaged app launched through LaunchServices captures |  | blocked | Screen Recording `denied`, helper exited with an error |

### Measured timings

Each value comes from one run. The probe and source times come from the app's own diagnostics. The press-to-view time comes from the harness.

| Measure | Dev | Packaged |
| --- | --- | --- |
| get-windows probe | 37 ms | 42 ms |
| `getSources` at window pixel size | 160 ms, 9 windows | 162 ms, 9 windows |
| Press to view in the draft, first and second capture | 313 ms, 206 ms | 313 ms, 206 ms |

The harness polls the draft every 100 ms over the inspector, so press-to-view can overstate the real time by up to about 100 ms. Most of the capture time is spent in `getSources`, which renders a thumbnail of every open window at the requested size. It will grow with the number of open windows. One earlier packaged run measured 3005 ms for the first `getSources` call. That was not reproduced and is not explained.

After the UX changes, the harness has 56 checks. Two development runs have not finished. The first passed its first 43 checks, then crashed on a bug in the harness's own Discard helper, which is fixed. In the second, a stack of macOS screen-access prompts for the host terminal held the foreground, so the first press sampled a `UserNotificationCenter` window and the run stopped. Those prompts need the user's answer. `pnpm check` passes, with 62 unit tests.

The desktop harness is sensitive to other activity on the machine. Other programs were using the desktop during this work. In two discarded runs, another app took focus or typed into the harness's document. The reported numbers come from runs without that interference.

## Windows round

This round made the prototype usable by someone who has never seen it, on Windows first, and checked it there with real input.

### What a first-time Windows user hit before

Observed on the machine above, with the build from the previous commit:

- Launching showed nothing. Windows 11 put the tray icon behind the ^ overflow next to the clock, and nothing said so.
- After the shortcut, nothing visible happened for about 1.9 seconds. `desktopCapturer.getSources` took 1.0 to 1.7 seconds on every call, at 0 by 0 thumbnails as well as at window size, with three to six windows open. It blocks Electron's main process for that time.
- Recent Captures had Electron's title bar, Electron's icon, and its default File, Edit, View and Window menu. There was no app icon anywhere, and the save notification was titled "Electron".
- The quit question was a native message box.
- With the window list open, or a chip preview expanded, the whole popover scrolled under a light system scrollbar.
- The image view showed captures only at actual size.
- In a Windows checkout `pnpm check` failed on every file, because git converted line endings to CRLF.

### What changed

- First run: the first launch opens a "How it works" page with the shortcut, the three steps, and where the tray icon lives. A ? button in Recent Captures and a "How It Works…" menu entry reopen it. `app-state.json` in the app's data folder records that it was shown.
- Finding the app again: a left click on the tray icon, and starting the app while it runs, open the draft when it holds something, otherwise Recent Captures.
- Capture feedback on Windows: once get-windows has identified the foreground window, about 50 ms after the press, the popover shows without taking focus. It carries a "Capturing this window…" chip with the window's title, and source listing waits until the page has painted. When the image is ready the popover takes focus as before. macOS keeps the previous behaviour, because its source listing took about 160 ms.
- On Windows the popover is always on top while shown, so other always-on-top windows do not cover it. Shown from the tray, it sits above the notification area instead of at the top right. When it hides, it blurs first, so Windows activates the window underneath. Without that, focus stayed on the hidden popover after Save.
- Recent Captures on Windows: no title text, icon or menu bar. The caption buttons are drawn over a draggable strip and follow the light or dark theme. Scrollbars are thin and themed on both platforms.
- Quit with an unsaved draft asks inside the popover: Save and quit, Discard and quit, Cancel. Escape, clicking away, or any other hide counts as Cancel, so the app cannot get stuck in the question.
- Popover: the window list replaces the form while it is open, and the list of views scrolls inside itself past about four chips.
- Image view: fits the capture to the window, never enlarged past actual size. Actual size, a click on the image, or Z switches.
- App icon (`build/icon.svg`, rendered by `pnpm icon`) for the installer, the Windows window, and the Windows tray. The app sets its AppUserModelID, and clicking the save notification opens that capture.
- `.gitattributes` keeps LF line endings.

### Windows harness

`pnpm verify:windows`, and `pnpm verify:windows:packaged` for `release/win-unpacked`, drive the app against two windows owned by a separate fixture process. Activation is a real mouse click. The shortcut, Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+Enter and Escape are real SendInput keystrokes. Quit goes through the real tray menu, opened with `popUpContextMenu` and chosen with the arrow and Enter keys. The window strip is dragged, and the caption close button clicked, with the real mouse.

The harness takes a desktop lock, `%TEMP%\inset-desktop-test.lock`, shared with the other prototypes' harnesses on the same machine. Every click and drag is refused unless the window under the pointer belongs to the fixture or to Inset. Every keystroke is refused unless one of them is in front. This was added after one run clicked into another app that had come to the front.

Both runs passed all 31 checks. The packaged run used the build before the last spacing change on the How it works page.

| Check | Dev | Packaged |
| --- | --- | --- |
| Ordinary launch shows no window | pass | pass |
| Tray menu has the expected entries | pass | pass |
| A click brings Doc A to the front | pass | pass |
| Popover appears within 400 ms of a real Ctrl+Alt+W | pass, 44 ms | pass, 20 ms |
| While capturing, the popover names the window and leaves focus with it | pass | pass |
| The first press adds Doc A as a direct view | pass | pass |
| After capture the popover has focus and the text field is ready | pass | pass |
| Ctrl+A and Ctrl+C work in the popover's text field | pass | pass |
| Clicking into Doc B hides the popover and gives Doc B focus | pass | pass |
| The second press adds Doc B and keeps the text | pass | pass |
| A real Ctrl+Enter saves one record and hides the popover | pass | pass |
| Focus returns to Doc B after saving | pass | pass |
| The record holds the text and both views | pass | pass |
| Doc A's image shows Doc A where the preview overlapped it | pass | pass |
| Recent Captures opens without the File/Edit/View menu | pass | pass |
| The window has a draggable strip under the caption buttons | pass | pass |
| The viewer fits the whole capture in the window first | pass | pass |
| Actual size shows one image pixel per device pixel | pass | pass |
| How it works is one click from Recent Captures | pass | pass |
| Dragging the strip moves Recent Captures | pass | pass |
| Ctrl+V and Ctrl+Z work in Recent Captures without an app menu | pass | pass |
| The caption close button closes Recent Captures and Inset keeps running | pass | pass |
| Recent Captures opens again afterwards | pass | pass |
| Quit from the tray menu asks inside the popover, and the prompt stays | pass | pass |
| Escape cancels the quit and keeps the app and the draft | pass | pass |
| Clicking into another window also cancels the quit and keeps the draft | pass | pass |
| Quit asks again after a cancel | pass | pass |
| Discard and quit ends the app | pass | pass |
| The first launch opens How it works | pass | pass |
| The second launch opens no window | pass | pass |
| Launching it again while it runs opens Recent Captures | pass | pass |

Press to finished view took 1652 ms in development and 1572 ms packaged, almost all of it in `getSources`. Each value comes from one run. The screenshots in `release/verify-windows-*/` were checked by eye:

- An OS-level screenshot taken while capture runs shows the popover above another always-on-top window that sat in the same place.
- The Recent Captures strip shows the three caption buttons in the dark theme, with no title or icon.
- The save notification was titled "Inset Window Links", with this round's text.
- The How it works page, the popover, and the quit prompt were also checked in light mode, as renderer screenshots. The caption buttons in light mode were not seen.

A crash found by the harness: opening Recent Captures while its previous window was still closing ended the app with exit code 0xFFFF7003. The window now waits for the old one's closed event before opening again. The harness reproduced the crash three times out of three before the fix and not after it.

### Not verified on Windows

- The installer. Another build of the app was already installed on the test machine, so the new installer was not run over it. The notification's title may come from that installed copy's Start menu entry, which uses the same AppUserModelID. The taskbar icon after a fresh install and the Start menu entry are unobserved. The unpacked app's exe carries the new icon, but the taskbar showed Electron's icon for its window. That is probably Windows caching an icon per AppUserModelID from development runs; it was not confirmed.
- Clicking the save notification. `balloon-click` is wired but was not clicked.
- A physical left click on the tray icon. It sat in the overflow, so the harness used the menu instead.
- Displays other than one at 100% scale, and keyboard layouts where Ctrl+Alt is AltGr. W is free on the German layout used here.
- The macOS harness was not rerun after this round. Its expected tray menu now has How It Works, and its quit check now looks for the prompt in the popover instead of a native dialog. Its window-list check only reads the chooser, the chosen view and its badge, so the form being hidden while the list is open should not affect it.

## Continuous integration

- The first CI run on pull request 1 passed on both GitHub-hosted runners. On the Windows runner, the get-windows N-API addon installed as a prebuilt download, and electron-builder produced the NSIS installer and the zip. No Windows build has been launched.
- Pull request builds first skipped signing. The arm64 artifact then carried only the Electron linker signature and failed `codesign --verify --deep --strict`. With `CSC_FOR_PULL_REQUEST` set, the downloaded arm64 artifact is ad-hoc signed as `ch.inset.prototype.windowlinks` and passes that check.
- The release workflow has not run yet. No `v*` tag exists.

## Fixes found in review

- Focus after reopening. The first harness checked focus only after the first press. After the second press and after Show Draft, Chromium put focus on the first chip's preview button, so typed text went nowhere. Main now asks the popover to focus the relationship field every time it shows. Two harness checks cover this.

## UX iteration

The second round followed the app-screen rules of the taste skill. That meant quiet borders, colour only on the primary action, sentence case, and the brief's fixed wording kept.

- Popover: each chip shows a thumbnail. A dashed row under the chips marks where the next view lands and carries the brief's hint and the shortcut. When Save is disabled, a line under the text field says why. Discard asks once when the draft holds views or text. Escape and clicking outside still only hide.
- Permission: the notice gives the steps. When macOS still refuses after the user has allowed the app, it explains the rebuilt-app case and offers Quit and reopen. That goes through the unsaved-draft check.
- Save: the menu bar item shows "Saved" for 2.5 seconds on macOS, and Windows shows a tray balloon. Saving still opens no window. The macOS title has not been seen; the Windows notification was seen in the Windows round. On the test machine the status item is collapsed and reports zero height, so the confirmation is probably invisible there.
- Recent captures: rows carry thumbnails of the first two views, are grouped by day, and can be searched by text and window title. The empty state teaches the three steps and shows the shortcut.
- Record: the thought is the page heading, the next step sits in its own block, and the actions sit in one row beside the saved time. Delete keeps the preset's pale destructive style and asks before deleting. Each source has Copy image and can be dragged into another app.
- Image viewer: shows "Source 1 of 2", and steps between sources with buttons and the arrow keys.

The taste skill's lint finds 0 failures in the renderer. Its 3 warnings are in generated shadcn components. Its browser inspector was not run, because the screens need the Electron preload bridge. The screens were checked from Electron screenshots in light and dark mode instead.

## Design notes

- Main owns the draft. The renderer is the only writer of the text and mirrors every edit to main. Save carries the text too, so quit protection never needs a round trip to the renderer.
- A pure reducer holds the draft lifecycle. A thin controller runs its effects. The capture id equals the draft id, so a retried save cannot create a second record.
- Each capture is written to a staging directory and published by one rename. Edits replace `record.json` atomically. Deletes move the directory to a trash folder first. Records with an unknown schema version are listed and never changed.
- Images are served by an `inset://` protocol for known ids only. A saved image is served only if its record lists the view.
- Both windows run with context isolation, the sandbox, and no Node integration. Each IPC call checks the sender frame URL and parses its arguments with Zod.

## User-test outcomes

No user test has been run. This table stays empty until one is observed.

| Participant | Task | Direct or fallback | Time to collect views | Relationship explained afterwards | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
