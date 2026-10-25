import path from "node:path";

import {
  app,
  BrowserWindow,
  session as electronSession,
  globalShortcut,
  Menu,
  shell,
  systemPreferences,
} from "electron";
import type { Tray } from "electron";

import type { IconPlace, SettingsView } from "../shared/settings";
import { appMenuTemplate } from "./app-menu";
import { loadAppState, saveAppState } from "./app-state";
import {
  capturePlatform,
  openScreenSettings,
  WindowCapturer,
} from "./capture/capturer";
import { canReadOrigins } from "./capture/origin";
import { handleImageProtocol, registerImageScheme } from "./ipc/protocol";
import {
  registerLibraryChannels,
  registerPopoverChannels,
  registerSettingsChannels,
  trustedSender,
} from "./ipc/register";
import { SessionController } from "./session/controller";
import { openSettingsStore } from "./settings-store";
import { failingWrites, nodeStoreFs } from "./store/fs";
import { CaptureStore } from "./store/store";
import { LibraryWindow } from "./windows/library-window";
import { PopoverWindow } from "./windows/popover-window";
import { rendererPage } from "./windows/renderer-page";
import { SettingsWindow } from "./windows/settings-window";
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

const mac = process.platform === "darwin";

const SAVED_BADGE_MS = 2500;

const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

const start = async () => {
  await app.whenReady();
  denyEverything();

  const settings = await openSettingsStore(
    app.getPath("userData"),
    nodeStoreFs
  );

  const storeFs =
    e2e && process.env["INSET_E2E_FAIL_WRITE"] === "1"
      ? failingWrites(nodeStoreFs, () => true)
      : nodeStoreFs;

  const store = await CaptureStore.open(
    path.join(app.getPath("userData"), "captures"),
    storeFs
  );

  const library = new LibraryWindow(rendererPage("library"));
  const settingsWindow = new SettingsWindow(rendererPage("settings"));

  const popover = new PopoverWindow(rendererPage("popover"), {
    otherWindowFocused: () => library.isFocused() || settingsWindow.isFocused(),
    settings: () => settings.current(),
  });

  const capturer = new WindowCapturer(
    () =>
      new Set(
        [
          popover.mediaSourceId(),
          library.mediaSourceId(),
          settingsWindow.window()?.getMediaSourceId() ?? null,
        ].filter((id) => id !== null)
      )
  );

  const session = new SessionController(capturer, store, popover);

  store.onChange(() => library.notifyChanged());
  handleImageProtocol(session, store);
  const showDraft = () => session.dispatch({ type: "showDraftRequested" });
  const addWindows = () => session.dispatch({ type: "chooserRequested" });
  const openRecent = () => library.open();
  const openSettings = () => settingsWindow.open();

  registerPopoverChannels(
    session,
    {
      onDismiss: () => popover.hide(),
      onHeight: (height) => popover.fitHeight(height),
      openRecent,
      openSettings,
    },
    trustedSender(() => popover.webContents, popover.page)
  );
  registerLibraryChannels(
    store,
    {
      addWindows,
      newCapture: showDraft,
      openSettings,
      startDrag: (file, icon) =>
        library.window()?.webContents.startDrag({ file, icon }),
    },
    trustedSender(() => library.window()?.webContents ?? null, library.page)
  );
  await popover.load();

  const actions = {
    addFromWindowList: addWindows,
    openHome: () => {
      if (session.hasMeaningfulDraft()) {
        showDraft();
      } else {
        openRecent();
      }
    },
    openRecent,
    openSettings,
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

  let appTray: {
    tray: Tray;
    menu: Electron.Menu;
    confirmSaved: (captureId: string) => void;
  } | null = null;

  const confirmSaved = (captureId: string) => {
    if (appTray === null) {
      // With only the Dock icon, the Dock carries the confirmation.
      app.dock?.setBadge("✓");
      setTimeout(() => app.dock?.setBadge(""), SAVED_BADGE_MS);
    } else {
      appTray.confirmSaved(captureId);
    }
  };

  /**
   * Shows the app's icon in the Dock, the menu bar or both. Without the Dock icon the app is an
   * accessory, so it has no menu bar of its own either. On Windows the notification-area icon
   * is the app's only icon, so it always stays.
   */
  const placeIcon = (place: IconPlace) => {
    const wantsTray = !mac || place !== "dock";

    if (wantsTray && appTray === null) {
      const created = createTray(actions, shortcut);

      appTray = {
        ...created,
        confirmSaved: savedConfirmer(created.tray, (captureId) =>
          library.open(`/captures/${captureId}`)
        ),
      };
    } else if (!wantsTray && appTray !== null) {
      appTray.tray.destroy();
      appTray = null;
    }

    if (mac) {
      app.setActivationPolicy(place === "menuBar" ? "accessory" : "regular");
    }
  };

  const refreshAppMenu = () => {
    if (!mac) {
      return;
    }

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(
          {
            floatOnTop: settings.current().floatOnTop,
            shortcut: shortcut.kind === "registered" ? shortcut.label : null,
          },
          {
            addWindows,
            closeWindow: () => {
              if (popover.isFocused()) {
                popover.hide();
              } else {
                BrowserWindow.getFocusedWindow()?.close();
              }
            },
            find: () => library.find(),
            newCapture: showDraft,
            openHelp: actions.openWelcome,
            openRecent,
            openScreenSettings: () => {
              void openScreenSettings();
            },
            openSettings,
            saveCapture: () => session.saveDraft(),
            setFloatOnTop: (on) => {
              void settings.update({ floatOnTop: on });
            },
          }
        )
      )
    );
  };

  const settingsView = (): SettingsView => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    originsReadable: canReadOrigins(),
    platform: capturePlatform,
    settings: settings.current(),
    shortcut,
    version: app.getVersion(),
  });

  const pushSettings = () => settingsWindow.pushView(settingsView());

  settings.onChange((before) => {
    if (settings.current().iconIn !== before.iconIn) {
      placeIcon(settings.current().iconIn);
      // Turning into an accessory can send the app's windows away.
      settingsWindow.open();
    }

    popover.refreshFloat();
    refreshAppMenu();
    pushSettings();
  });

  registerSettingsChannels(
    {
      allowOrigins: async () => {
        // Adds the app to the Accessibility list and asks once; later calls open the pane instead.
        if (mac && !systemPreferences.isTrustedAccessibilityClient(true)) {
          await shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
        }

        pushSettings();
      },
      fitHeight: (height) => settingsWindow.fitHeight(height),
      getView: () => Promise.resolve(settingsView()),
      setOpenAtLogin: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        pushSettings();

        return Promise.resolve();
      },
      update: async (change) => {
        await settings.update(change);
      },
    },
    trustedSender(
      () => settingsWindow.window()?.webContents ?? null,
      settingsWindow.page
    )
  );

  placeIcon(settings.current().iconIn);
  refreshAppMenu();
  session.onSaved(confirmSaved);

  // A click on the Dock icon opens the draft, or Recent Captures when there is none.
  app.on("activate", (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) {
      actions.openHome();
    }
  });
  // Accessibility can be turned on in System Settings while the window is open.
  app.on("browser-window-focus", pushSettings);

  // Opening the app again, from the Start menu or a shortcut, is how a lost tray icon gets found.
  app.on("second-instance", actions.openHome);
  app.on("before-quit", (event) => session.interceptQuit(event));
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    appTray?.tray.destroy();
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
        trayBounds: () => appTray?.tray.getBounds() ?? null,
        trayPopUp: () => appTray?.tray.popUpContextMenu(),
        trayMenu: () =>
          appTray?.menu.items.map((item) =>
            item.type === "separator" ? "---" : item.label
          ) ?? [],
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
