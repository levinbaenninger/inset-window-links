# Implementation report

This report covers the Inset Window Links prototype. It separates what was verified on a real desktop, what works only through the explicit fallback, what is blocked, and what is untested.

## What was tested

- macOS 27.0.1 on Apple silicon, one display. Electron 45.0.0, get-windows 9.3.0, Node 24.22.1.
- Development mode means the electron-vite production build, run unpackaged. `pnpm verify:desktop` drives it.
- Packaged mode means `release/mac-arm64/Inset Window Links.app` from `pnpm package:dir`. It is ad-hoc signed and not notarized. `pnpm verify:packaged` drives it.
- The Vite dev server path was exercised once by hand. The built main process loaded both pages from the renderer dev server. Capture, typing, the chip preview image, Discard, and the library list worked there. No console messages were captured, but the listener was attached only after the popover had loaded, and the library page had no listener.
- Every shortcut press in the harness went through the `INSET_E2E` seam, which calls the same function the global shortcut calls. A physical press of the key combination was not exercised.
- Windows was not tested. No Windows build was launched. Nothing in this report is a Windows result.

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
- When Playwright launches the packaged app as a child of the terminal, it reports Screen Recording as `granted`. This is probably the terminal's grant. The packaged capture checks therefore prove the packaged capture path, not a user's first run.

## Untested or not observed

- Windows: HWND mapping is covered by unit tests only. The native addon, tray icon, DPI geometry, focus return, and installer are untested.
- The menu bar icon was not seen. The menu bar on the test machine hides status items behind a collapse control, and Electron reported the item at zero height. The tray menu entries were read through the seam.
- A physical press of the shortcut was not exercised.
- Shortcut conflict: macOS let two processes register Option+Command+W, and both reported success. The conflict message in the menu and popover was never triggered.
- The quit dialog's buttons were not clicked on the desktop, because the harness has no Accessibility permission. The reducer tests cover Save, Discard, and Cancel.
- Native drag of a saved image was not built. A receiving app could not be verified here.
- Several displays: only one display was available. Clamping on a display with a negative origin is covered by unit tests only.
- Browser tabs: the same-window repeat was tested by resizing a TextEdit window, not by switching browser tabs.
- A source that vanishes during capture is covered by reducer tests only.
- The `not-determined` Screen Recording state was not observed. The packaged app was already `denied`.
- The app is re-signed ad hoc on every build. Whether a Screen Recording grant survives a rebuild was not measured.
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

`pnpm verify:desktop` ran 52 checks. `pnpm verify:packaged` ran the same 52 and one more, which launches the app through LaunchServices.

| Run               | Pass | Fail | Blocked |
| ----------------- | ---- | ---- | ------- |
| Development build | 52   | 0    | 0       |
| Packaged app      | 52   | 0    | 1       |

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
| Expanding a chip shows the captured image | pass | pass | 1206 by 1010 |
| Removing a view drops only that view | pass | pass | Three views, then documents A and B remain |
| Self press adds nothing | pass | pass | Two views before and after |
| Self press hides the popover | pass | pass |  |
| Show Draft reopens without capturing | pass | pass | Two chips |
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

The desktop harness is sensitive to other activity on the machine. Other programs were using the desktop during this work. In two discarded runs, another app took focus or typed into the harness's document. The reported numbers come from runs without that interference.

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
