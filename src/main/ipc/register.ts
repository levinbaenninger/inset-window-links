import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { app, ipcMain, nativeImage } from "electron";
import { z } from "zod";

import type { SettingsApi } from "../../shared/api";
import type {
  WindowRole,
  libraryChannels,
  popoverChannels,
  settingsChannels,
} from "../../shared/channels";
import { channelName } from "../../shared/channels";
import { CopyRequestSchema, CopyTicketSchema } from "../../shared/copy";
import type { CaptureDetail, CaptureListItem } from "../../shared/dto";
import {
  CandidateIdSchema,
  DraftIdSchema,
  ViewIdSchema,
} from "../../shared/ids";
import type { LeaveAnswer } from "../../shared/leave";
import { LeaveAnswerSchema, UnsavedCountSchema } from "../../shared/leave";
import { SettingsChangeSchema } from "../../shared/settings";
import { StatusRequestSchema, statusFor } from "../../shared/status";
import {
  DraftTextSchema,
  EditedTextSchema,
  TodoIdSchema,
} from "../../shared/text";
import { openScreenSettings } from "../capture/capturer";
import { writeClip } from "../clipboard";
import { reopenOrigin } from "../reopen";
import type { SessionController } from "../session/controller";
import { originSummary, summarizeViews } from "../session/snapshot";
import { copyCapture, CopyStarts } from "../store/copy";
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

/** The page's number for one save of a capture's draft. */
const RevSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

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

export interface LibraryActions {
  startDrag: (file: string, icon: Electron.NativeImage) => void;
  menuOpen: (open: boolean) => void;
  reportUnsaved: (count: number) => void;
  answerLeave: (answer: LeaveAnswer) => void;
  newCapture: () => void;
  addWindows: () => void;
  openSettings: () => void;
}

export const registerLibraryChannels = (
  store: CaptureStore,
  actions: LibraryActions,
  trusted: TrustCheck
): void => {
  const starts = new CopyStarts(store);

  const table: Table<typeof libraryChannels> = {
    addWindows: send(z.tuple([]), actions.addWindows),
    answerLeave: send(z.tuple([LeaveAnswerSchema]), actions.answerLeave),
    beginCopy: send(z.tuple([CopyTicketSchema, DraftIdSchema]), (ticket, id) =>
      starts.begin(ticket, id)
    ),
    // The page's copy gate asks only once the words it copies are saved.
    copy: invoke(
      z.tuple([
        CopyTicketSchema,
        DraftIdSchema,
        CopyRequestSchema,
        EditedTextSchema.nullable(),
      ]),
      (ticket, captureId, request, text) =>
        copyCapture(
          store,
          starts,
          ticket,
          captureId,
          request,
          text,
          writeClip,
          {
            locale: app.getLocale(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        )
    ),
    discard: invoke(z.tuple([DraftIdSchema, RevSchema.nullable()]), (id, rev) =>
      store.discard(id, rev)
    ),
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
    menuOpen: send(z.tuple([z.boolean()]), actions.menuOpen),
    newCapture: send(z.tuple([]), actions.newCapture),
    openSettings: send(z.tuple([]), actions.openSettings),
    owedDiscards: invoke(z.tuple([]), () => store.owed()),
    reportUnsaved: send(z.tuple([UnsavedCountSchema]), actions.reportUnsaved),
    remove: invoke(z.tuple([DraftIdSchema]), (captureId) =>
      store.remove(captureId)
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
      z.tuple([DraftIdSchema, TodoIdSchema, z.boolean(), RevSchema]),
      (captureId, todoId, done, rev) =>
        store.setTodoDone(captureId, todoId, done, rev)
    ),
    shortcut: invoke(z.tuple([]), () => shortcutStatus()),
    updateText: invoke(
      z.tuple([DraftIdSchema, EditedTextSchema, RevSchema]),
      (captureId, text, rev) =>
        store.updateText(captureId, text, new Date(), rev)
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
    menuOpen: send(z.tuple([z.boolean()]), actions.menuOpen),
    setOpenAtLogin: invoke(z.tuple([z.boolean()]), actions.setOpenAtLogin),
    update: invoke(z.tuple([SettingsChangeSchema]), (change) =>
      actions.update(change)
    ),
  };

  attachAll("settings", table, trusted);
};
