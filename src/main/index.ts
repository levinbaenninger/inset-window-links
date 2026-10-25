import path from "node:path";

import { app, session as electronSession, globalShortcut } from "electron";

import { loadAppState, saveAppState } from "./app-state";
import {
  capturePlatform,
  openScreenSettings,
  WindowCapturer,
} from "./capture/capturer";
import { handleImageProtocol, registerImageScheme } from "./ipc/protocol";
import {
  registerLibraryChannels,
  registerPopoverChannels,
  trustedSender,
} from "./ipc/register";
import { SessionController } from "./session/controller";
import { failingWrites, nodeStoreFs } from "./store/fs";
import { CaptureStore } from "./store/store";
import { LibraryWindow } from "./windows/library-window";
import { PopoverWindow } from "./windows/popover-window";
import { rendererPage } from "./windows/renderer-page";
import { registerCaptureShortcut } from "./windows/shortcut";
import { createTray, savedConfirmer } from "./windows/tray";

const e2e = process.env["INSET_E2E"] === "1";
const e2eUserData = e2e ? process.env["INSET_E2E_USER_DATA"] : undefined;

app.setPath(
  "userData",
  e2eUserData ?? path.join(app.getPath("appData"), "Inset Window Links")
);

// Matches the installer's shortcut, so Windows names notifications after the app, not Electron.
if (process.platform === "win32") {
  app.setAppUserModelId("ch.inset.prototype.windowlinks");
}

/** Every harness launch has a fresh profile, so the first-run window opens there only when asked for. */
const welcomeAllowed = !e2e || process.env["INSET_E2E_WELCOME"] === "1";

registerImageScheme();

const denyEverything = () => {
  const ses = electronSession.defaultSession;

  ses.setPermissionRequestHandler((_contents, _permission, respond) =>
    respond(false)
  );
  ses.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
};

const start = async () => {
  await app.whenReady();
  app.dock?.hide();
  denyEverything();

  const storeFs =
    e2e && process.env["INSET_E2E_FAIL_WRITE"] === "1"
      ? failingWrites(nodeStoreFs, () => true)
      : nodeStoreFs;

  const store = await CaptureStore.open(
    path.join(app.getPath("userData"), "captures"),
    storeFs
  );

  const library = new LibraryWindow(rendererPage("library"));

  const popover = new PopoverWindow(rendererPage("popover"), () =>
    library.isFocused()
  );

  const capturer = new WindowCapturer(
    () =>
      new Set(
        [popover.mediaSourceId(), library.mediaSourceId()].filter(
          (id) => id !== null
        )
      )
  );

  const session = new SessionController(capturer, store, popover);

  store.onChange(() => library.notifyChanged());
  handleImageProtocol(session, store);
  registerPopoverChannels(
    session,
    (height) => popover.fitHeight(height),
    () => popover.hide(),
    trustedSender(() => popover.webContents, popover.page)
  );
  registerLibraryChannels(
    store,
    (file, icon) => library.window()?.webContents.startDrag({ file, icon }),
    trustedSender(() => library.window()?.webContents ?? null, library.page)
  );
  await popover.load();

  const showDraft = () => session.dispatch({ type: "showDraftRequested" });
  const openRecent = () => library.open();

  const actions = {
    addFromWindowList: () => session.dispatch({ type: "chooserRequested" }),
    openHome: () => {
      if (session.hasMeaningfulDraft()) {
        showDraft();
      } else {
        openRecent();
      }
    },
    openRecent,
    openWelcome: () => library.open("/welcome"),
    openScreenSettings:
      capturePlatform === "macos"
        ? () => {
            void openScreenSettings();
          }
        : null,
    pressShortcut: () => session.pressShortcut(),
    quit: () => app.quit(),
    showDraft,
  };

  const shortcut = registerCaptureShortcut(actions.pressShortcut);

  const { menu, tray } = createTray(actions, shortcut);

  session.onSaved(
    savedConfirmer(tray, (captureId) => library.open(`/captures/${captureId}`))
  );

  // Opening the app again, from the Start menu or a shortcut, is how a lost tray icon gets found.
  app.on("second-instance", actions.openHome);
  app.on("before-quit", (event) => session.interceptQuit(event));
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    tray.destroy();
  });

  const userData = app.getPath("userData");
  const appState = await loadAppState(userData);

  if (welcomeAllowed && !appState.welcomed) {
    actions.openWelcome();
    await saveAppState(userData, { ...appState, welcomed: true });
  }

  if (e2e) {
    Object.assign(globalThis, {
      __insetE2E: {
        ...actions,
        diagnostics: () => capturer.diagnostics,
        snapshot: () => session.snapshot(),
        trayBounds: () => tray.getBounds(),
        trayPopUp: () => tray.popUpContextMenu(),
        trayMenu: () =>
          menu.items.map((item) =>
            item.type === "separator" ? "---" : item.label
          ),
      },
    });
  }
};

// The main module must finish evaluating before Electron emits ready, so start() is not awaited here.
if (app.requestSingleInstanceLock()) {
  void start();
} else {
  app.quit();
}
