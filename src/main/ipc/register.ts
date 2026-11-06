import { readFile } from "node:fs/promises";

import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { app, clipboard, ClipboardItem, ipcMain, nativeImage } from "electron";
import { z } from "zod";

import type { SettingsApi } from "../../shared/api";
import type {
  WindowRole,
  libraryChannels,
  popoverChannels,
  settingsChannels,
} from "../../shared/channels";
import { channelName } from "../../shared/channels";
import type { CaptureDetail, CaptureListItem } from "../../shared/dto";
import { DueDateSchema } from "../../shared/due";
import {
  CandidateIdSchema,
  DraftIdSchema,
  ViewIdSchema,
} from "../../shared/ids";
import { SettingsChangeSchema } from "../../shared/settings";
import { StatusRequestSchema, statusFor } from "../../shared/status";
import {
  DraftTextSchema,
  MAX_RELATIONSHIP,
  TodoIdSchema,
} from "../../shared/text";
import { openScreenSettings } from "../capture/capturer";
import { reopenOrigin } from "../reopen";
import type { SessionController } from "../session/controller";
import { originSummary, summarizeViews } from "../session/snapshot";
import { formatEntry, formatNote } from "../store/note";
import type { CaptureStore, StoreEntry } from "../store/store";
import type { RendererPage } from "../windows/renderer-page";
import { shortcutStatus } from "../windows/shortcut";
import { imageUrl } from "./image-url";

type TrustCheck = (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;

interface Registration<K extends "invoke" | "send"> {
  kind: K;
  attach: (channel: string, trusted: TrustCheck) => void;
}

/** The sender must be the role's own top frame, showing exactly that role's page. */
export const trustedSender =
  (
    webContents: () => Electron.WebContents | null,
    page: RendererPage
  ): TrustCheck =>
  (event) => {
    const frame = event.senderFrame;

    return (
      event.sender === webContents() &&
      frame !== null &&
      frame === event.sender.mainFrame &&
      page.matches(frame.url)
    );
  };

const invoke = <S extends z.ZodTuple, R>(
  schema: S,
  run: (...args: z.output<S>) => R
): Registration<"invoke"> => ({
  attach: (channel, trusted) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) {
        throw new Error(`Rejected ${channel} from an untrusted sender`);
      }

      const parsed = schema.safeParse(args);

      if (!parsed.success) {
        throw new Error(`Rejected invalid input for ${channel}`);
      }

      return run(...parsed.data);
    });
  },
  kind: "invoke",
});

const send = <S extends z.ZodTuple>(
  schema: S,
  run: (...args: z.output<S>) => void
): Registration<"send"> => ({
  attach: (channel, trusted) => {
    ipcMain.on(channel, (event, ...args) => {
      const parsed = schema.safeParse(args);

      if (trusted(event) && parsed.success) {
        run(...parsed.data);
      }
    });
  },
  kind: "send",
});

type Table<C> = {
  [K in keyof C]: Registration<C[K] extends "send" ? "send" : "invoke">;
};

const attachAll = <C>(
  role: WindowRole,
  table: Table<C>,
  trusted: TrustCheck
) => {
  for (const [method, registration] of Object.entries<
    Registration<"invoke" | "send">
  >(table)) {
    registration.attach(channelName(role, method), trusted);
  }
};

export interface PopoverActions {
  onHeight: (height: number) => void;
  onDismiss: () => void;
}

export const registerPopoverChannels = (
  session: SessionController,
  actions: PopoverActions,
  trusted: TrustCheck
): void => {
  const table: Table<typeof popoverChannels> = {
    addWindows: invoke(z.tuple([]), () =>
      session.dispatch({ type: "chooserRequested" })
    ),
    cancelChoice: invoke(z.tuple([]), () =>
      session.dispatch({ type: "choiceCancelled" })
    ),
    chooseQuit: invoke(
      z.tuple([z.enum(["save", "discard", "cancel"])]),
      (choice) => session.chooseQuit(choice)
    ),
    chooseSources: invoke(
      z.tuple([z.array(CandidateIdSchema).min(1).max(100)]),
      (candidateIds) =>
        session.dispatch({ candidateIds, type: "sourcesChosen" })
    ),
    discard: invoke(z.tuple([]), () =>
      session.dispatch({ type: "discardRequested" })
    ),
    dismiss: send(z.tuple([]), actions.onDismiss),
    getDraft: invoke(z.tuple([]), () => session.snapshot()),
    openScreenSettings: invoke(z.tuple([]), () => openScreenSettings()),
    recheckPermission: invoke(z.tuple([]), () => session.recheckPermission()),
    relaunch: invoke(z.tuple([]), () => session.requestRelaunch()),
    removeView: invoke(z.tuple([ViewIdSchema]), (viewId) =>
      session.dispatch({ type: "viewRemoved", viewId })
    ),
    reportHeight: send(
      z.tuple([z.number().int().min(40).max(4000)]),
      actions.onHeight
    ),
    save: invoke(z.tuple([DraftTextSchema]), (text) =>
      session.dispatch({ text, type: "saveRequested" })
    ),
    setText: send(z.tuple([DraftTextSchema]), (text) =>
      session.dispatch({ text, type: "textChanged" })
    ),
  };

  attachAll("popover", table, trusted);
};

const listItem = (entry: StoreEntry): CaptureListItem => {
  if (entry.kind !== "current") {
    return entry;
  }

  const { record } = entry;

  return {
    createdAt: record.createdAt,
    description: record.description,
    due: record.due,
    id: record.id,
    kind: "current",
    relationship: record.relationship,
    reopenable: record.views
      .filter((view) => originSummary(view) !== null)
      .map((view) => view.id),
    status: record.status,
    todos: record.todos,
    views: record.views.map((view) => ({
      appName: view.appName,
      description: view.description,
      height: view.height,
      id: view.id,
      imageUrl: imageUrl({
        captureId: record.id,
        kind: "saved",
        viewId: view.id,
      }),
      title: view.title,
      width: view.width,
    })),
  };
};

const detail = (entry: StoreEntry | undefined): CaptureDetail | null => {
  if (entry?.kind !== "current") {
    return null;
  }

  const { record } = entry;

  return {
    createdAt: record.createdAt,
    description: record.description,
    due: record.due,
    id: record.id,
    relationship: record.relationship,
    status: record.status,
    todos: record.todos,
    updatedAt: record.updatedAt,
    views: summarizeViews(record.views, (view) =>
      imageUrl({ captureId: record.id, kind: "saved", viewId: view.id })
    ),
  };
};

const EditedTextSchema = DraftTextSchema.extend({
  relationship: z.string().trim().min(1).max(MAX_RELATIONSHIP),
});

export interface LibraryActions {
  startDrag: (file: string, icon: Electron.NativeImage) => void;
  newCapture: () => void;
  addWindows: () => void;
  openSettings: () => void;
}

export const registerLibraryChannels = (
  store: CaptureStore,
  actions: LibraryActions,
  trusted: TrustCheck
): void => {
  const table: Table<typeof libraryChannels> = {
    addWindows: send(z.tuple([]), actions.addWindows),
    // The page saves what is typed first, and copies nothing when that fails.
    copyEntry: invoke(z.tuple([DraftIdSchema]), async (captureId) => {
      await store.idle();

      const entry = store.get(captureId);

      if (entry?.kind === "current") {
        await clipboard.writeText(formatEntry(entry.record));
      }
    }),
    copyImage: invoke(
      z.tuple([DraftIdSchema, ViewIdSchema]),
      async (captureId, viewId) => {
        const file = store.imagePath(captureId, viewId);

        if (file !== null) {
          const png = new Blob([await readFile(file)], { type: "image/png" });

          await clipboard.write([new ClipboardItem({ "image/png": png })]);
        }
      }
    ),
    copyNote: invoke(z.tuple([DraftIdSchema]), async (captureId) => {
      // The page sends its pending edits first; a write still under way is waited for here.
      await store.idle();

      const entry = store.get(captureId);

      // Electron's clipboard writes resolve later; the page says Copied only once this has.
      if (entry?.kind === "current") {
        await clipboard.writeText(
          formatNote(
            entry.record,
            app.getLocale(),
            Intl.DateTimeFormat().resolvedOptions().timeZone
          )
        );
      }
    }),
    dragImage: send(
      z.tuple([DraftIdSchema, ViewIdSchema]),
      (captureId, viewId) => {
        const file = store.imagePath(captureId, viewId);

        if (file !== null) {
          actions.startDrag(
            file,
            nativeImage.createFromPath(file).resize({ width: 96 })
          );
        }
      }
    ),
    get: invoke(z.tuple([z.string().max(64)]), (captureId) =>
      detail(store.get(captureId))
    ),
    list: invoke(z.tuple([]), () => store.list().map(listItem)),
    newCapture: send(z.tuple([]), actions.newCapture),
    openSettings: send(z.tuple([]), actions.openSettings),
    remove: invoke(z.tuple([DraftIdSchema]), (captureId) =>
      store.remove(captureId)
    ),
    setDue: invoke(
      z.tuple([DraftIdSchema, DueDateSchema.nullable()]),
      (captureId, due) => store.setDue(captureId, due, new Date())
    ),
    setStatus: invoke(
      z.tuple([DraftIdSchema, StatusRequestSchema]),
      (captureId, request) =>
        store.setStatus(captureId, statusFor(request, new Date()))
    ),
    // Only ids cross from the page; what opens is read from the record here.
    reopen: invoke(
      z.tuple([DraftIdSchema, z.array(ViewIdSchema).min(1).max(100)]),
      async (captureId, viewIds) => {
        const entry = store.get(captureId);

        const views =
          entry?.kind === "current"
            ? entry.record.views.filter((view) => viewIds.includes(view.id))
            : [];

        // One after another, so the windows come up in capture order. Two views of one app start it once.
        const started = new Set<string>();

        const opened = await views.reduce<Promise<number>>(
          async (count, view) =>
            (await count) +
            ((await reopenOrigin(view.origin, started)) ? 1 : 0),
          Promise.resolve(0)
        );

        return { failed: viewIds.length - opened };
      }
    ),
    setTodoDone: invoke(
      z.tuple([DraftIdSchema, TodoIdSchema, z.boolean()]),
      (captureId, todoId, done) => store.setTodoDone(captureId, todoId, done)
    ),
    shortcut: invoke(z.tuple([]), () => shortcutStatus()),
    updateText: invoke(
      z.tuple([DraftIdSchema, EditedTextSchema]),
      (captureId, text) => store.updateText(captureId, text, new Date())
    ),
  };

  attachAll("library", table, trusted);
};

export interface SettingsActions extends Omit<
  SettingsApi,
  "getView" | "fitHeight"
> {
  getView: SettingsApi["getView"];
  fitHeight: (height: number) => void;
}

export const registerSettingsChannels = (
  actions: SettingsActions,
  trusted: TrustCheck
): void => {
  const table: Table<typeof settingsChannels> = {
    allowOrigins: invoke(z.tuple([]), actions.allowOrigins),
    fitHeight: send(
      z.tuple([z.number().int().min(40).max(4000)]),
      actions.fitHeight
    ),
    getView: invoke(z.tuple([]), actions.getView),
    setOpenAtLogin: invoke(z.tuple([z.boolean()]), actions.setOpenAtLogin),
    update: invoke(z.tuple([SettingsChangeSchema]), (change) =>
      actions.update(change)
    ),
  };

  attachAll("settings", table, trusted);
};
