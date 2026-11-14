import { existsSync } from "node:fs";
import path from "node:path";

import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  session as electronSession,
  globalShortcut,
  Menu,
  Notification,
  powerMonitor,
  shell,
  systemPreferences,
  webContents,
} from "electron";
import type { WebContents } from "electron";

import { newDraftId } from "../shared/ids";
import type { DraftId } from "../shared/ids";
import type { IconPlace, SettingsView } from "../shared/settings";
import type { PageCommand } from "../shared/shortcuts";
import type { AppMenuActions, KeyAction } from "./app-menu";
import { appMenuTemplate } from "./app-menu";
import { openAppState } from "./app-state";
import type { AppStateStore } from "./app-state";
import { capturePlatform, WindowCapturer } from "./capture/capturer";
import { canReadOrigins } from "./capture/origin";
import { saveExampleCapture } from "./examples/example-capture";
import { removeExampleCaptures } from "./examples/remove-examples";
import { handleImageProtocol, registerImageScheme } from "./ipc/protocol";
import {
  registerLibraryChannels,
  registerOnboardingChannels,
  registerPopoverChannels,
  registerSettingsChannels,
  trustedSender,
} from "./ipc/register";
import {
  LINKS_HANDOFF,
  LINKS_PERMISSIONS,
  LINKS_TAGLINE,
  osMajor,
} from "./links-onboarding";
import {
  CHECKLIST_TITLE,
  checklistDoneText,
  HOME_PAGE,
  LINKS_TASK_IDS,
  linksHints,
  linksSpotlight,
  linksTasks,
  PANEL_PAGE,
} from "./links-tutorial";
import { wireMenuKeys } from "./menu-keys";
import { OpenMenus } from "./menu-open";
import { pageCommandTarget } from "./page-commands";
import { appBundlePath, createAppTile } from "./permissions/bundle";
import { createOnboarding } from "./permissions/onboarding";
import { createPoller } from "./permissions/poller";
import { createPermissionChecks } from "./permissions/system";
import { settleWrites, writesDialog } from "./quit-writes";
import { SessionController } from "./session/controller";
import { openSettingsStore } from "./settings-store";
import { startSnoozeClock } from "./snooze-clock";
import { failingWrites, nodeStoreFs, slowWrites } from "./store/fs";
import type { CaptureRecord } from "./store/schema";
import { CaptureStore } from "./store/store";
import { createTutorial } from "./tutorial/tutorial";
import type { Tutorial } from "./tutorial/tutorial";
import type { UpdateState } from "./update/state";
import type { Updater } from "./update/updater";
import { startUpdater, updatesOff } from "./update/updater";
import { LibraryWindow } from "./windows/library-window";
import { OnboardingWindow } from "./windows/onboarding-window";
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

/** Stands in for a callback until what it calls exists. */
const notYet = (): boolean => false;

const setTimer = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);

  return () => clearTimeout(timer);
};

/** No first run handled yet, and no captures: the very first launch. Harness runs never count. */
const isFreshInstall = (
  appState: AppStateStore,
  store: CaptureStore
): boolean =>
  welcomeAllowed && !appState.current().welcomed && store.list().length === 0;

/**
 * The in-app tutorial (src/main/tutorial/, shared with the other Inset apps): the Getting started
 * checklist in Recent Captures, one-time tips in the capture panel and Recent Captures, Show Me
 * Around, and the first run's example capture. Its progress is kept in app-state.json.
 */
const startTutorial = async (deps: {
  readonly appState: AppStateStore;
  readonly store: CaptureStore;
  readonly popover: PopoverWindow;
  readonly library: LibraryWindow;
  readonly session: SessionController;
  readonly freshInstall: boolean;
}): Promise<Tutorial> => {
  const { library, popover, session, store } = deps;

  /** Pushes each page with tips its own part of the tutorial; set once the tutorial exists. */
  const push = { emit: notYet };

  /** Draws and saves the example capture in the background, like any save, then shows it as one. */
  const saveExample = async (id: DraftId): Promise<void> => {
    const saved = await saveExampleCapture({
      id,
      now: new Date(),
      platform: capturePlatform,
      store,
    }).catch(() => false);

    if (!saved) {
      console.warn("The example capture could not be saved");
    }

    push.emit();
  };

  const tutorial = createTutorial({
    doneText: checklistDoneText(capturePlatform),
    examples: {
      exists: (id) => store.get(id)?.kind === "current",
      remove: async (ids) => await removeExampleCaptures(store, ids),
      // The id is known at once; the capture follows.
      seed: () => {
        const id = newDraftId();

        void saveExample(id);

        return [id];
      },
    },
    firstRun: () => Promise.resolve(deps.freshInstall),
    hints: linksHints(capturePlatform),
    home: HOME_PAGE,
    onChange: () => push.emit(),
    pageVisible: (page) =>
      page === HOME_PAGE
        ? library.isVisible()
        : page === PANEL_PAGE && popover.isVisible(),
    spotlight: linksSpotlight(capturePlatform),
    store: deps.appState.tutorial,
    tasks: linksTasks(capturePlatform),
    title: CHECKLIST_TITLE,
    warn: (message) => console.warn(message),
  });

  push.emit = () => {
    popover.pushTutorial(tutorial.view(PANEL_PAGE));
    library.pushTutorial(tutorial.view(HOME_PAGE));

    return true;
  };

  await tutorial.load();

  // The harnesses drive the app without tips or the checklist in the way.
  if (e2e && !welcomeAllowed) {
    tutorial.setTips(false);
    tutorial.act(HOME_PAGE, { kind: "dismissChecklist" });
  }

  // A hidden window lets go of the tip it held, so it never blocks the others.
  popover.onHidden(() => tutorial.pageClosed(PANEL_PAGE));
  library.onHidden(() => tutorial.pageClosed(HOME_PAGE));

  // Tasks tick off where the app really does them.
  session.onCaptured((via) =>
    tutorial.complete(
      via === "shortcut" ? LINKS_TASK_IDS.addWindow : LINKS_TASK_IDS.addSeveral
    )
  );
  session.onSaved(() => tutorial.complete(LINKS_TASK_IDS.save));

  return tutorial;
};

const start = async () => {
  await app.whenReady();
  denyEverything();

  /** Set once the app's actions exist; until then a key press reaches the page as usual. */
  let answerMenuKeys: ((action: KeyAction) => void) | null = null;

  const menus = new OpenMenus<WebContents>((contents) =>
    BrowserWindow.fromWebContents(contents)
  );

  // Windows has no menu bar, so every Inset page answers the Mac menu's keys itself: each
  // page's contents, including any made before this line, so no window can miss them.
  if (!mac) {
    wireMenuKeys(
      app,
      webContents.getAllWebContents(),
      () => answerMenuKeys,
      (contents) => menus.isOpen(contents)
    );
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

  const appState = await openAppState(app.getPath("userData"));
  const library = new LibraryWindow(rendererPage("library"));
  const settingsWindow = new SettingsWindow(rendererPage("settings"));
  const onboardingWindow = new OnboardingWindow(rendererPage("onboarding"));

  const popover = new PopoverWindow(rendererPage("popover"), {
    // The setup window counts while it shows: hiding the panel must not hide the app, and the setup with it.
    otherWindowFocused: () =>
      library.isFocused() ||
      settingsWindow.isFocused() ||
      onboardingWindow.isVisible(),
    settings: () => settings.current(),
  });

  const capturer = new WindowCapturer(
    () =>
      new Set(
        [
          popover.mediaSourceId(),
          library.mediaSourceId(),
          settingsWindow.window()?.getMediaSourceId() ?? null,
          onboardingWindow.mediaSourceId(),
        ].filter((id) => id !== null)
      ),
    () => settings.current().rememberPages
  );

  const session = new SessionController(capturer, store, popover, library);

  /**
   * A fresh install: no first run handled yet and no captures. Only it gets the example capture,
   * and only it opens Recent Captures by itself once the setup is over. Harness runs never count.
   */
  const freshInstall = isFreshInstall(appState, store);

  /**
   * Whether an earlier run left data behind, read before this launch adds the example capture:
   * the example can be saved before the setup asks, and would count as an earlier run's.
   */
  const ranBefore = appState.current().welcomed || store.list().length > 0;

  /**
   * A setup that was under way when the app last quit: the first run's, after Reopen to finish.
   * By then welcomed is set, so it isn't a fresh install, yet its Done still ends in Recent Captures.
   */
  const resumedSetup = appState.current().onboarding?.status === "active";

  const tutorial = await startTutorial({
    appState,
    freshInstall,
    library,
    popover,
    session,
    store,
  });

  const appTile = createAppTile({
    bundlePath: mac
      ? appBundlePath(app.getPath("exe"), { packaged: app.isPackaged })
      : null,
    loadIcon: async (bundle) =>
      await app.getFileIcon(bundle, { size: "normal" }),
    startDrag: (item) => onboardingWindow.startDrag(item),
  });

  /** The kit's exit callback for Reopen to finish, while that quit is under way. */
  const reopening = { atExit: notYet, armed: false };

  /** The permission poll's speed; the poll is made once the setup it reads exists. */
  const permissionSpeed = { set: (_on: boolean): boolean => false };

  /**
   * The permission setup (src/main/permissions/, shared with the other Inset apps), macOS only:
   * Welcome, Allow access (Screen Recording, Accessibility), Done. Its place is kept in
   * app-state.json, so Reopen to finish lands back on Allow access.
   */
  const onboarding = createOnboarding({
    appName: app.getName(),
    checks: createPermissionChecks({
      desktopCapturer,
      osMajor: mac ? osMajor(process.getSystemVersion()) : 0,
      platform: process.platform,
      setTimer,
      shell,
      systemPreferences,
    }),
    handOff: LINKS_HANDOFF,
    mac,
    onClosed: (how) => {
      if (how === "showAround") {
        library.open();
        tutorial.showMeAround();
      }
    },
    // The first run ends in Recent Captures, where Getting started and the example are, also
    // when its setup came back after Reopen to finish.
    onEnded: () => {
      if (freshInstall || resumedSetup) {
        library.open();
      }
    },
    onView: (view) => onboardingWindow.pushView(view),
    osMajor: mac ? osMajor(process.getSystemVersion()) : 0,
    permissions: LINKS_PERMISSIONS,
    pollFast: (on) => {
      permissionSpeed.set(on);
    },
    // Reopen to finish goes through Window Links' own quit: requestRelaunch() asks about an
    // unsaved draft first, and its exit relaunches the app. The kit's exit callback runs there too.
    quit: (atExit) => {
      reopening.armed = true;
      reopening.atExit = () => {
        atExit();

        return true;
      };

      session.requestRelaunch();
    },
    ranBefore: () => Promise.resolve(ranBefore),
    relaunch: () => {
      // The session's exit already calls app.relaunch(); a second call would start two copies.
    },
    setTimer,
    store: appState.onboarding,
    tagline: LINKS_TAGLINE,
    tile: appTile.view,
    warn: (message) => console.warn(message),
    window: onboardingWindow,
  });

  /**
   * Whether this opening of the setup still owes the opt-in: the first time it sees Accessibility
   * on, it turns on Remember pages and files. Once only, so turning that off in Settings stands.
   */
  const rememberOptIn = { owed: true };

  /**
   * One poll for Accessibility while the setup is open: every 3 s, every 500 ms while Allow access
   * waits for it. Turning it on there also turns on Remember pages and files, once.
   */
  const permissionPoll = createPoller({
    check: () => {
      onboarding.observe();

      if (rememberOptIn.owed && mac && canReadOrigins()) {
        rememberOptIn.owed = false;

        if (!settings.current().rememberPages) {
          void settings.update({ rememberPages: true });
        }
      }

      const open = onboarding.isOpen();

      // The setup's next opening opts in again.
      rememberOptIn.owed ||= !open;

      return open;
    },
    setTimer,
  });

  permissionSpeed.set = (on) => {
    permissionPoll.setFast(on);

    return on;
  };

  onboardingWindow.onClose(() => onboarding.close());
  // Reopen to finish quits like any quit: closing the window then is neither Done nor Not now.
  session.onExit(() => {
    onboardingWindow.quitting();

    if (reopening.armed) {
      reopening.atExit();
    }
  });
  // The quit prompt Reopen to finish went through was cancelled, or its save failed.
  session.onChange(() => {
    if (reopening.armed && session.exitUnderWay() !== "relaunch") {
      reopening.armed = false;
      onboarding.quitCancelled();
    }
  });

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
      // The notice's Set Up…: the panel steps aside, keeping its draft, so it doesn't cover System Settings.
      openSetup: () => {
        popover.stepAside();
        onboarding.open("screen");
      },
      getTutorial: () => tutorial.view(PANEL_PAGE),
      tutorial: (action) => tutorial.act(PANEL_PAGE, action),
    },
    trustedSender(() => popover.webContents, popover.page)
  );
  registerLibraryChannels(
    store,
    {
      addWindows,
      answerLeave: (answer) => library.answerLeave(answer),
      menuOpen: (open) => {
        const contents = library.contents();

        if (contents !== null) {
          menus.set(contents, open);
        }
      },
      reportUnsaved: (count) => library.reportUnsaved(count),
      newCapture: showDraft,
      openSettings,
      getTutorial: () => tutorial.view(HOME_PAGE),
      reopened: () => tutorial.complete(LINKS_TASK_IDS.reopen),
      stepChecked: () => tutorial.complete(LINKS_TASK_IDS.checkStep),
      tutorial: (action) => tutorial.act(HOME_PAGE, action),
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

  /** A menu key for a page, to the window pageCommandTarget picks; none during the walkthrough. */
  const toPage = (command: PageCommand) => {
    const target = pageCommandTarget(command, {
      libraryFocused: library.isFocused(),
      libraryOpen: library.window() !== null,
      panelFocused: popover.isFocused(),
      walking: tutorial.walking(),
    });

    if (target === "panel") {
      popover.command(command);
    } else if (target === "draft") {
      showDraft();
      popover.command(command);
    } else if (target === "library") {
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
    // Getting Started and Show Me Around live in Recent Captures.
    gettingStarted: () => {
      tutorial.showChecklist();
      // The page may show a search, another list, a folded sidebar or a picture: back to the list.
      library.command("showTutorial");
    },
    showMeAround: () => {
      library.open();
      tutorial.showMeAround();
    },
    openPermissions: mac ? () => onboarding.open() : null,
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
    // Find opens Recent Captures from anywhere, but not behind the walkthrough.
    find: () => {
      if (!tutorial.walking()) {
        library.find();
      }
    },
    newCapture: showDraft,
    gettingStarted: actions.gettingStarted,
    openPermissions: () => onboarding.open(),
    showMeAround: actions.showMeAround,
    openRecent,
    openSettings,
    restartToUpdate,
    // The panel saves what it shows and locks its fields at once, so no key typed after ⌘S is lost.
    saveCapture: () => {
      if (popover.isFocused()) {
        popover.command("saveCapture");
      } else {
        session.saveDraft();
      }
    },
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
    tips: tutorial.tips(),
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
      // Turn on: the setup at Accessibility. Settings floats, so it closes rather than cover System Settings.
      allowOrigins: () => {
        if (mac) {
          settingsWindow.close();
          onboarding.open("accessibility");
        }

        return Promise.resolve();
      },
      fitHeight: (height) => settingsWindow.fitHeight(height),
      getView: () => Promise.resolve(settingsView()),
      menuOpen: (open) => {
        const contents = settingsWindow.window()?.webContents;

        if (contents !== undefined) {
          menus.set(contents, open);
        }
      },
      resetTutorial: () => {
        tutorial.reset();
        pushSettings();
      },
      setOpenAtLogin: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        pushSettings();

        return Promise.resolve();
      },
      setTips: (on) => {
        tutorial.setTips(on);
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

  registerOnboardingChannels(
    {
      allow: (id) => onboarding.allow(id),
      back: () => onboarding.back(),
      finish: (how) => onboarding.finish(how),
      fitHeight: (height) => onboardingWindow.fitHeight(height),
      getView: () => Promise.resolve(onboarding.view()),
      next: () => onboarding.next(),
      reopen: () => {
        void onboarding.reopen();
      },
      skip: () => onboarding.skip(),
      startDrag: () => appTile.drag(),
    },
    trustedSender(
      () => onboardingWindow.window()?.webContents ?? null,
      onboardingWindow.page
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
  /** Set once the last writes are written, or the user chose to quit without them. */
  let writesSettled = false;
  let settlingWrites = false;

  const quitOnceWritten = async () => {
    await settleWrites({
      ask: async () => {
        const { choices, ...shown } = writesDialog(app.getName());

        const { response } = await dialog.showMessageBox({
          ...shown,
          noLink: true,
          type: "warning",
        });

        return choices[response] ?? "wait";
      },
      writes: store,
    });
    writesSettled = true;
    app.quit();
  };

  app.on("will-quit", (event) => {
    // The library's last save arrives as its window closes; quitting waits for it to be written,
    // and after a few seconds asks rather than wait for good.
    if (store.busy && !writesSettled) {
      event.preventDefault();

      if (!settlingWrites) {
        settlingWrites = true;
        void quitOnceWritten();
      }

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

  // macOS's first run opens the setup window; an install whose first run came before it (welcomed)
  // never sees it by itself. The tile needs its icon read before it can show.
  await appTile.load();

  if (welcomeAllowed) {
    const setupShown = await onboarding.launch();

    // Without the setup (Windows, or an install that ran before it), a first run opens Recent
    // Captures, where Getting started and the example capture are.
    if (!setupShown && freshInstall) {
      library.open();
    }

    if (!appState.current().welcomed) {
      await appState.update({ welcomed: true });
    }
  }

  if (e2e) {
    Object.assign(globalThis, {
      __insetE2E: {
        ...actions,
        diagnostics: () => capturer.diagnostics,
        onboardingView: () => onboarding.view(),
        onboardingVisible: () => onboardingWindow.isVisible(),
        tutorialView: () => tutorial.view(HOME_PAGE),
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
