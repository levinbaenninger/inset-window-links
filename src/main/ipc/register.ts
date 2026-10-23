import { readFile } from "node:fs/promises";

import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { app, clipboard, ClipboardItem, ipcMain, nativeImage } from "electron";
import { z } from "zod";

import type {
  WindowRole,
  libraryChannels,
  popoverChannels,
} from "../../shared/channels";
import { channelName } from "../../shared/channels";
import type { CaptureDetail, CaptureListItem } from "../../shared/dto";
import {
  CandidateIdSchema,
  DraftIdSchema,
  ViewIdSchema,
} from "../../shared/ids";
import { DraftTextSchema } from "../../shared/text";
import { openScreenSettings } from "../capture/capturer";
import type { SessionController } from "../session/controller";
import { summarizeViews } from "../session/snapshot";
import { formatNote } from "../store/note";
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

export const registerPopoverChannels = (
  session: SessionController,
  onHeight: (height: number) => void,
  onDismiss: () => void,
  trusted: TrustCheck
): void => {
  const table: Table<typeof popoverChannels> = {
    cancelChoice: invoke(z.tuple([]), () =>
      session.dispatch({ type: "choiceCancelled" })
    ),
    chooseQuit: invoke(
      z.tuple([z.enum(["save", "discard", "cancel"])]),
      (choice) => session.chooseQuit(choice)
    ),
    chooseSource: invoke(z.tuple([CandidateIdSchema]), (candidateId) =>
      session.dispatch({ candidateId, type: "sourceChosen" })
    ),
    discard: invoke(z.tuple([]), () =>
      session.dispatch({ type: "discardRequested" })
    ),
    dismiss: send(z.tuple([]), onDismiss),
    getDraft: invoke(z.tuple([]), () => session.snapshot()),
    openScreenSettings: invoke(z.tuple([]), () => openScreenSettings()),
    recheckPermission: invoke(z.tuple([]), () => session.recheckPermission()),
    relaunch: invoke(z.tuple([]), () => session.requestRelaunch()),
    removeView: invoke(z.tuple([ViewIdSchema]), (viewId) =>
      session.dispatch({ type: "viewRemoved", viewId })
    ),
    reportHeight: send(z.tuple([z.number().int().min(40).max(4000)]), onHeight),
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
    id: record.id,
    kind: "current",
    nextStep: record.nextStep,
    relationship: record.relationship,
    views: record.views.map((view) => ({
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
    id: record.id,
    nextStep: record.nextStep,
    relationship: record.relationship,
    updatedAt: record.updatedAt,
    views: summarizeViews(record.views, (view) =>
      imageUrl({ captureId: record.id, kind: "saved", viewId: view.id })
    ),
  };
};

const EditedTextSchema = DraftTextSchema.extend({
  relationship: z.string().trim().min(1).max(10_000),
});

export const registerLibraryChannels = (
  store: CaptureStore,
  startDrag: (file: string, icon: Electron.NativeImage) => void,
  trusted: TrustCheck
): void => {
  const table: Table<typeof libraryChannels> = {
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
    copyNote: invoke(z.tuple([DraftIdSchema]), (captureId) => {
      const entry = store.get(captureId);

      if (entry?.kind === "current") {
        clipboard.writeText(
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
          startDrag(
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
    remove: invoke(z.tuple([DraftIdSchema]), (captureId) =>
      store.remove(captureId)
    ),
    shortcut: invoke(z.tuple([]), () => shortcutStatus()),
    updateText: invoke(
      z.tuple([DraftIdSchema, EditedTextSchema]),
      (captureId, text) => store.updateText(captureId, text, new Date())
    ),
  };

  attachAll("library", table, trusted);
};
