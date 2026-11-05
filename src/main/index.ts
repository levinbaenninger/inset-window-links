import { existsSync } from "node:fs";
import path from "node:path";

import {
  app,
  BrowserWindow,
  session as electronSession,
  globalShortcut,
  Menu,
  Notification,
  powerMonitor,
  shell,
  systemPreferences,
  webContents,
} from "electron";

import type { IconPlace, SettingsView } from "../shared/settings";
import type { PageCommand } from "../shared/shortcuts";
import type { AppMenuActions, KeyAction } from "./app-menu";
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
import { wireMenuKeys } from "./menu-keys";
import { SessionController } from "./session/controller";
import { openSettingsStore } from "./settings-store";
import { startSnoozeClock } from "./snooze-clock";
import { failingWrites, nodeStoreFs, slowWrites } from "./store/fs";
import type { CaptureRecord } from "./store/schema";
import { CaptureStore } from "./store/store";
import type { UpdateState } from "./update/state";
import type { Updater } from "./update/updater";
import { startUpdater, updatesOff } from "./update/updater";
import { LibraryWindow } from "./windows/library-window";
import { PopoverWindow } from "./windows/popover-window";
import { rendererPage } from "./windows/renderer-page";
import { SettingsWindow } from "./windows/settings-window";
import { registerCaptureShortcut } from "./windows/shortcut";
import type { AppTray } from "./windows/tray";
import { createTray, savedConfirmer } from "./windows/tray";

const e2e = process.env["INSET_E2E"] === "1";
const e2eUserData = e2e ? process.env["INSET_E2E_USER_DATA"] : undefined;

// Named after the app, so a test build with its own productName keeps its own data.
app.setPath(
  "userData",
  e2eUserData ?? path.join(app.getPath("appData"), app.getName())
);

// Matches the installer's shortcut, so Windows names notifications after the app, not Electron.
if (process.platform === "win32") {
  app.setAppUserModelId("ch.inset.prototype.windowlinks");
}

/** Shown notifications, held so they are not collected while on screen, which drops the click. */
const shownNotifications = new Set<Notification>();

const notify = (
  content: { title: string; body: string },
  onClick: () => void
) => {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification(content);
  const release = () => shownNotifications.delete(notification);

  notification.on("click", () => {
    release();
    onClick();
  });
  notification.on("close", release);
  shownNotifications.add(notification);
  notification.show();
};

/** One notification for everything one sweep woke; clicking it opens the first of them. */
const announceWoken = (
  woken: readonly CaptureRecord[],
  open: (route: string) => void
) => {
  const [first] = woken;

  if (first === undefined) {
    return;
  }

  notify(
    {
      body:
        woken.length === 1
          ? "Back from snooze"
          : woken.map((record) => record.relationship).join("\n"),
      title:
        woken.length === 1
          ? first.relationship
          : `${woken.length} captures are back from snooze`,
    },
    () => open(`/captures/${first.id}`)
  );
};

const updateFeedUrl = process.env["INSET_UPDATE_FEED_URL"];

/**
 * Only a packaged app updates, and on Windows only one the installer put there: a portable copy
 * would get the installer's copy instead. Harness runs reach the feed only when given their own.
 */
const updatable =
  app.isPackaged &&
  (!e2e || updateFeedUrl !== undefined) &&
  (process.platform !== "win32" ||
    existsSync(
      path.join(
        path.dirname(process.execPath),
        `Uninstall ${app.getName()}.exe`
      )
    ));

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

  /** Set once the app's actions exist; until then a key press reaches the page as usual. */
  let answerMenuKeys: ((action: KeyAction) => void) | null = null;

  // Windows has no menu bar, so every Inset page answers the Mac menu's keys itself: each
  // page's contents, including any made before this line, so no window can miss them.
  if (!mac) {
    wireMenuKeys(app, webContents.getAllWebContents(), () => answerMenuKeys);
  }

  const settings = await openSettingsStore(
    app.getPath("userData"),
    nodeStoreFs
  );

  const slowWriteMs = Number(process.env["INSET_E2E_SLOW_WRITE_MS"] ?? 0);

  const writes =
    e2e && slowWriteMs > 0 ? slowWrites(nodeStoreFs, slowWriteMs) : nodeStoreFs;

  const storeFs =
    e2e && process.env["INSET_E2E_FAIL_WRITE"] === "1"
      ? failingWrites(writes, () => true)
      : writes;

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
      ),
    () => settings.current().rememberPages
  );

  const session = new SessionController(capturer, store, popover);

  store.onChange(() => library.notifyChanged());

  const snoozeClock = startSnoozeClock<NodeJS.Timeout>({
    notify: (woken) => announceWoken(woken, (route) => library.open(route)),
    now: () => new Date(),
    store,
    timers: {
      clear: (handle) => clearTimeout(handle),
      set: (run, ms) => setTimeout(run, ms),
    },
  });

  void snoozeClock.sweep();
  powerMonitor.on("resume", () => {
    void snoozeClock.sweep();
  });
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
    trustedSender(() => library.contents(), library.page)
  );
  await popover.load();

  /** Replaced by the running updater once the menus that show its state exist. */
  let updater: Updater = updatesOff;

  /** Set by Restart to Update, so the quit that follows installs and reopens the app. */
  let installOnQuit = false;

  const restartToUpdate = () => {
    installOnQuit = true;
    app.quit();
  };

  /**
   * A menu key for a page goes to the Inset window in front. With none in front, the field keys
   * open the panel, and the sheet opens in Recent Captures; the keys for an open capture or the
   * sidebar need Recent Captures to be open already.
   */
  const toPage = (command: PageCommand) => {
    if (popover.isFocused()) {
      popover.command(command);

      return;
    }

    if (library.isFocused() || command === "showShortcuts") {
      library.command(command);

      return;
    }

    if (
      command === "focusDescription" ||
      command === "setDue" ||
      command === "focusSteps"
    ) {
      showDraft();
      popover.command(command);
    } else if (library.window() !== null) {
      library.command(command);
    }
  };

  const actions = {
    addFromWindowList: addWindows,
    checkForUpdates: () => updater.check(),
    openHome: () => {
      if (session.hasMeaningfulDraft()) {
        showDraft();
      } else {
        openRecent();
      }
    },
    openRecent,
    openSettings,
    openShortcuts: () => toPage("showShortcuts"),
    openWelcome: () => library.open("/welcome"),
    openScreenSettings:
      capturePlatform === "macos"
        ? () => {
            void openScreenSettings();
          }
        : null,
    pressShortcut: () => session.pressShortcut(),
    quit: () => app.quit(),
    restartToUpdate,
    showDraft,
  };

  const shortcut = registerCaptureShortcut(actions.pressShortcut);

  let appTray:
    | (AppTray & { confirmSaved: (captureId: string) => void })
    | null = null;

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
      const created = createTray(actions, shortcut, updater.state());

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

  const menuActions: AppMenuActions = {
    addWindows,
    checkForUpdates: actions.checkForUpdates,
    copyNote: () => toPage("copyNote"),
    focusDescription: () => toPage("focusDescription"),
    focusSteps: () => toPage("focusSteps"),
    reopen: () => toPage("reopen"),
    setDue: () => toPage("setDue"),
    showShortcuts: actions.openShortcuts,
    toggleDone: () => toPage("toggleDone"),
    toggleSidebar: () => toPage("toggleSidebar"),
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
    restartToUpdate,
    saveCapture: () => session.saveDraft(),
    setFloatOnTop: (on) => {
      void settings.update({ floatOnTop: on });
    },
  };

  answerMenuKeys = (action) => menuActions[action]();

  const refreshAppMenu = () => {
    if (!mac) {
      return;
    }

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(
          {
            captureOpen: library.showsCapture() && !popover.isFocused(),
            floatOnTop: settings.current().floatOnTop,
            shortcut: shortcut.kind === "registered" ? shortcut.label : null,
            update: updater.state(),
          },
          menuActions
        )
      )
    );
  };

  const settingsView = (): SettingsView => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    originsReadable: mac ? canReadOrigins() : settings.current().rememberPages,
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

  let accessibilityAsked = false;

  registerSettingsChannels(
    {
      allowOrigins: async () => {
        // The first click adds the app to the Accessibility list and lets macOS ask; while the
        // switch is still off, later clicks open the pane instead of asking again.
        if (mac && !accessibilityAsked) {
          accessibilityAsked = true;
          systemPreferences.isTrustedAccessibilityClient(true);
        } else if (mac && !canReadOrigins()) {
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

  const showUpdate = (state: UpdateState, before: UpdateState) => {
    appTray?.showUpdate(state);
    refreshAppMenu();

    if (state.kind === "ready" && before.kind !== "ready") {
      notify(
        {
          body: "Click to restart now. Otherwise it installs when you quit.",
          title: `Inset Window Links ${state.version} is ready`,
        },
        restartToUpdate
      );
    }
  };

  if (updatable) {
    updater = startUpdater({
      feedUrl: updateFeedUrl,
      logDir: app.getPath("logs"),
      onChange: showUpdate,
    });
  }

  // A click on the Dock icon opens the draft, or Recent Captures when there is none.
  app.on("activate", (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) {
      actions.openHome();
    }
  });
  // Accessibility can be turned on in System Settings while the window is open.
  app.on("browser-window-focus", pushSettings);
  // The Capture menu's items for an open capture follow Recent Captures' page and the panel's focus.
  library.onRouteChange(refreshAppMenu);
  app.on("browser-window-focus", refreshAppMenu);
  app.on("browser-window-blur", refreshAppMenu);

  // Opening the app again, from the Start menu or a shortcut, is how a lost tray icon gets found.
  app.on("second-instance", actions.openHome);
  app.on("before-quit", (event) => session.interceptQuit(event));
  app.on("will-quit", (event) => {
    // The library's last save arrives as its window closes; quitting waits for it to be written.
    if (store.busy) {
      event.preventDefault();
      void store.idle().then(() => app.quit());

      return;
    }

    // Squirrel relaunches only when asked to install, so Restart to Update hands this quit over.
    if (installOnQuit && updater.state().kind === "ready") {
      installOnQuit = false;
      event.preventDefault();
      updater.install();

      return;
    }

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
        updateState: () => updater.state(),
        trayBounds: () => appTray?.tray.getBounds() ?? null,
        trayPopUp: () => appTray?.tray.popUpContextMenu(),
        trayMenu: () =>
          appTray
            ?.menu()
            .items.map((item) =>
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
