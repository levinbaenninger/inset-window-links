import { describe, expect, it } from "vitest";

import type { DraftId } from "../../shared/ids";
import {
  CandidateIdSchema,
  DraftIdSchema,
  ViewIdSchema,
} from "../../shared/ids";
import type { DraftText } from "../../shared/text";
import type { IdSource } from "./reduce";
import { initialSession, reduce } from "./reduce";
import type {
  CapturedView,
  SessionEffect,
  SessionEvent,
  SessionState,
} from "./state";

const D1 = DraftIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const D2 = DraftIdSchema.parse("d0000000-0000-4000-8000-000000000002");
const D3 = DraftIdSchema.parse("d0000000-0000-4000-8000-000000000003");

const CANDIDATE = CandidateIdSchema.parse(
  "c0000000-0000-4000-8000-000000000001"
);

const ids = (): IdSource => {
  let tokens = 0;
  const drafts: DraftId[] = [D2, D3];

  return {
    draftId: () => drafts.shift() ?? D3,
    token: () => {
      tokens += 1;

      return `t${tokens}`;
    },
  };
};

const view = (n: number, windowKey: string): CapturedView => ({
  acquisition: { kind: "direct", windowKeyAtCapture: windowKey },
  appName: "TextEdit",
  boundsDip: { height: 505, width: 603, x: 100, y: 100 },
  capturedAt: new Date(`2026-10-21T12:00:0${n}.000Z`),
  height: 1010,
  id: ViewIdSchema.parse(`a0000000-0000-4000-8000-00000000000${n}`),
  png: new Uint8Array([n]),
  sampledAt: new Date(`2026-10-21T12:00:0${n}.000Z`),
  title: `Untitled ${n}`,
  width: 1206,
});

const text = (relationship: string, nextStep = ""): DraftText => ({
  nextStep,
  relationship,
});

interface Run {
  state: SessionState;
  effects: readonly SessionEffect[];
}

const run = (
  source: IdSource,
  events: readonly SessionEvent[],
  from = initialSession(D1)
): Run => {
  let current: Run = { effects: [], state: from };

  for (const event of events) {
    const [state, effects] = reduce(current.state, event, source);

    current = { effects, state };
  }

  return current;
};

const captured = (token: string, v: CapturedView): SessionEvent => ({
  outcome: { kind: "captured", view: v },
  token,
  type: "captureFinished",
});

const foreignPress: SessionEvent = {
  insetFocused: false,
  type: "shortcutPressed",
};

describe("session lifecycle", () => {
  it("adds a view on a foreign press and shows the popover beside it", () => {
    const source = ids();
    const pressed = run(source, [foreignPress]);

    expect(pressed.effects).toStrictEqual([
      { token: "t1", type: "captureForeground" },
    ]);

    const done = run(
      source,
      [captured("t1", view(1, "macos:1176"))],
      pressed.state
    );

    expect(done.state.draft.views.map((v) => v.title)).toStrictEqual([
      "Untitled 1",
    ]);
    expect(done.effects).toStrictEqual([
      {
        anchor: {
          bounds: { height: 505, width: 603, x: 100, y: 100 },
          kind: "window",
        },
        type: "showPopover",
      },
    ]);
  });

  it("keeps sources and text when the popover is hidden and shown again", () => {
    const source = ids();

    const { state } = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { type: "showDraftRequested" },
    ]);

    const shown = reduce(state, { type: "showDraftRequested" }, source);

    expect(shown[1]).toStrictEqual([
      { anchor: { kind: "keep" }, type: "showPopover" },
    ]);
    expect(shown[0].draft.id).toBe(D1);
    expect(shown[0].draft.text).toStrictEqual(text("A limits B"));
    expect(shown[0].draft.views).toHaveLength(1);
  });

  it("clears everything on explicit discard and hides", () => {
    const { state, effects } = run(ids(), [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { type: "discardRequested" },
    ]);

    expect(effects).toStrictEqual([{ type: "hidePopover" }]);
    expect(state).toStrictEqual(initialSession(D2));
  });

  it("toggles instead of capturing when Inset itself is focused", () => {
    const source = ids();

    const base = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
    ]).state;

    const [afterSelf, effects] = reduce(
      base,
      { insetFocused: true, type: "shortcutPressed" },
      source
    );

    expect(effects).toStrictEqual([{ type: "togglePopover" }]);
    expect(afterSelf).toBe(base);

    const probedSelf = run(
      source,
      [
        foreignPress,
        { outcome: { kind: "self" }, token: "t2", type: "captureFinished" },
      ],
      base
    );

    expect(probedSelf.effects).toStrictEqual([{ type: "togglePopover" }]);
    expect(probedSelf.state.draft.views).toHaveLength(1);
  });

  it("keeps a changed view of the same live window as a new view", () => {
    const { state } = run(ids(), [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      foreignPress,
      captured("t2", view(2, "macos:1176")),
    ]);

    expect(state.draft.views.map((v) => [v.id, v.acquisition])).toStrictEqual([
      [
        "a0000000-0000-4000-8000-000000000001",
        { kind: "direct", windowKeyAtCapture: "macos:1176" },
      ],
      [
        "a0000000-0000-4000-8000-000000000002",
        { kind: "direct", windowKeyAtCapture: "macos:1176" },
      ],
    ]);
  });

  it("removes one view and keeps the others and the text", () => {
    const { state } = run(ids(), [
      foreignPress,
      captured("t1", view(1, "macos:1175")),
      foreignPress,
      captured("t2", view(2, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { type: "viewRemoved", viewId: view(1, "macos:1175").id },
    ]);

    expect([
      state.draft.views.map((v) => v.title),
      state.draft.text,
    ]).toStrictEqual([["Untitled 2"], text("A limits B")]);
  });

  it("drops a stale capture result", () => {
    const { state } = run(ids(), [
      foreignPress,
      captured("t9", view(1, "macos:1176")),
    ]);

    expect(state.draft.views).toStrictEqual([]);
    expect(state.activity).toStrictEqual({
      kind: "capturing",
      pending: null,
      token: "t1",
      via: "direct",
    });
  });

  it("previews the popover beside an identified window without focusing it, then activates on capture", () => {
    const source = ids();
    const near = { height: 763, width: 1440, x: 184, y: 107 };

    const identified = run(source, [
      foreignPress,
      {
        near,
        source: { appName: "Notepad.exe", title: "Budget notes.txt" },
        token: "t1",
        type: "captureIdentified",
      },
    ]);

    expect(identified.state.activity).toStrictEqual({
      kind: "capturing",
      pending: { appName: "Notepad.exe", title: "Budget notes.txt" },
      token: "t1",
      via: "direct",
    });
    expect(identified.effects).toStrictEqual([
      { anchor: { bounds: near, kind: "window" }, type: "previewPopover" },
    ]);

    const done = run(
      source,
      [captured("t1", view(1, "windows:69110"))],
      identified.state
    );

    expect(done.state.activity).toStrictEqual({ kind: "idle" });
    expect(done.effects.map((effect) => effect.type)).toStrictEqual([
      "showPopover",
    ]);
  });

  it("ignores an identification from a stale capture", () => {
    const { state, effects } = run(ids(), [
      foreignPress,
      {
        near: { height: 1, width: 1, x: 0, y: 0 },
        source: { appName: null, title: null },
        token: "t9",
        type: "captureIdentified",
      },
    ]);

    expect(effects).toStrictEqual([]);
    expect(state.activity).toStrictEqual({
      kind: "capturing",
      pending: null,
      token: "t1",
      via: "direct",
    });
  });

  it("keeps the draft and offers the labelled chooser when direct capture fails", () => {
    const source = ids();

    const failed = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      foreignPress,
      {
        outcome: { kind: "needsChoice", near: null, reason: "noMatch" },
        token: "t2",
        type: "captureFinished",
      },
    ]);

    expect(failed.effects).toStrictEqual([
      { token: "t2", type: "loadCandidates" },
      { anchor: { kind: "keep" }, type: "showPopover" },
    ]);
    expect(failed.state.activity).toStrictEqual({
      candidates: "loading",
      kind: "choosing",
      reason: "noMatch",
      token: "t2",
    });
    expect([
      failed.state.draft.views.length,
      failed.state.draft.text,
    ]).toStrictEqual([1, text("A limits B")]);

    const candidate = {
      id: CANDIDATE,
      sourceId: "window:42:0",
      thumb: new Uint8Array([1]),
      title: "Notes",
    };

    const chosen = run(
      source,
      [
        { candidates: [candidate], token: "t2", type: "candidatesReady" },
        { candidateId: CANDIDATE, type: "sourceChosen" },
      ],
      failed.state
    );

    expect(chosen.effects).toStrictEqual([
      { candidate, reason: "noMatch", token: "t3", type: "captureChosen" },
    ]);

    const vanished = run(
      source,
      [
        {
          outcome: { kind: "needsChoice", near: null, reason: "vanished" },
          token: "t3",
          type: "captureFinished",
        },
      ],
      chosen.state
    );

    expect([
      vanished.state.notice,
      vanished.state.draft.views.length,
    ]).toStrictEqual([{ kind: "sourceVanished" }, 1]);
  });

  it("keeps the draft on a failed write and retries with the same id", () => {
    const source = ids();

    const saving = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "saveRequested" },
    ]);

    expect(saving.effects).toStrictEqual([
      { draft: saving.state.draft, type: "publish" },
    ]);

    const failed = run(
      source,
      [
        {
          draftId: D1,
          result: { kind: "failed", message: "disk full" },
          type: "saveFinished",
        },
      ],
      saving.state
    );

    expect([
      failed.state.activity,
      failed.state.draft.views.length,
      failed.state.draft.text,
    ]).toStrictEqual([
      { kind: "saveFailed", message: "disk full" },
      1,
      text("A limits B"),
    ]);

    const retry = run(
      source,
      [{ text: text("A limits B"), type: "saveRequested" }],
      failed.state
    );

    expect(retry.effects).toStrictEqual([
      { draft: failed.state.draft, type: "publish" },
    ]);
    expect(failed.state.draft.id).toBe(D1);

    const saved = run(
      source,
      [{ draftId: D1, result: { kind: "published" }, type: "saveFinished" }],
      retry.state
    );

    expect([saved.effects, saved.state]).toStrictEqual([
      [{ type: "hidePopover" }],
      initialSession(D2),
    ]);
  });

  it("refuses to save without a view or a relationship", () => {
    const noView = run(ids(), [
      { text: text("A limits B"), type: "saveRequested" },
    ]);

    expect(noView.effects).toStrictEqual([]);
    expect(noView.state.notice).toStrictEqual({ kind: "needsView" });

    const blank = run(ids(), [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("  ", "Call"), type: "saveRequested" },
    ]);

    expect(blank.effects).toStrictEqual([]);
    expect(blank.state.notice).toStrictEqual({ kind: "needsRelationship" });
  });

  it("drops the relationship notice once the relationship is written", () => {
    const source = ids();

    const blank = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text(""), type: "saveRequested" },
      { text: text("  "), type: "textChanged" },
    ]);

    expect(blank.state.notice).toStrictEqual({ kind: "needsRelationship" });

    const written = run(
      source,
      [{ text: text("A limits B"), type: "textChanged" }],
      blank.state
    );

    expect(written.state.notice).toBeNull();
  });

  it("drops a stale notice when the draft is shown again, but not the permission one", () => {
    const source = ids();

    const vanished: SessionState = {
      ...initialSession(D1),
      notice: { kind: "sourceVanished" },
    };

    expect(
      run(source, [{ type: "showDraftRequested" }], vanished).state.notice
    ).toBeNull();
    expect(
      run(source, [{ type: "chooserRequested" }], vanished).state.notice
    ).toBeNull();

    const denied: SessionState = {
      ...initialSession(D1),
      notice: { kind: "permissionDenied", stillDenied: true },
    };

    expect(
      run(source, [{ type: "showDraftRequested" }], denied).state.notice
    ).toStrictEqual({ kind: "permissionDenied", stillDenied: true });
  });

  it("quits at once with an empty draft", () => {
    expect(run(ids(), [{ type: "quitRequested" }]).effects).toStrictEqual([
      { type: "exitApp" },
    ]);
  });

  it("asks Save, Discard, or Cancel before quitting with a meaningful draft", () => {
    const source = ids();

    const asked = run(source, [
      { text: text("A limits B"), type: "textChanged" },
      { type: "quitRequested" },
    ]);

    expect(asked.effects).toStrictEqual([{ type: "askQuit" }]);

    const cancelled = run(
      source,
      [{ choice: "cancel", type: "quitChosen" }],
      asked.state
    );

    expect([
      cancelled.effects,
      cancelled.state.activity,
      cancelled.state.draft.text,
    ]).toStrictEqual([[], { kind: "idle" }, text("A limits B")]);

    const blocked = run(
      source,
      [{ type: "quitRequested" }, { choice: "save", type: "quitChosen" }],
      cancelled.state
    );

    expect(blocked.effects).toStrictEqual([
      { anchor: { kind: "keep" }, type: "showPopover" },
    ]);
    expect(blocked.state.notice).toStrictEqual({ kind: "needsView" });

    expect(
      run(
        source,
        [{ type: "quitRequested" }, { choice: "discard", type: "quitChosen" }],
        cancelled.state
      ).effects
    ).toStrictEqual([{ type: "exitApp" }]);
  });

  it("saves and then exits when Save is chosen at quit", () => {
    const source = ids();

    const saving = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { type: "quitRequested" },
      { choice: "save", type: "quitChosen" },
    ]);

    expect(saving.state.activity).toStrictEqual({
      kind: "saving",
      after: "quit",
    });

    const done = run(
      source,
      [
        {
          draftId: D1,
          result: { kind: "alreadyPublished" },
          type: "saveFinished",
        },
      ],
      saving.state
    );

    expect(done.effects).toStrictEqual([{ type: "exitApp" }]);
  });

  it("relaunches after Quit and reopen, saving first when asked", () => {
    expect(
      run(ids(), [{ relaunch: true, type: "quitRequested" }]).effects
    ).toStrictEqual([{ relaunch: true, type: "exitApp" }]);

    const source = ids();

    const saving = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { relaunch: true, type: "quitRequested" },
      { choice: "save", type: "quitChosen" },
    ]);

    expect(saving.state.activity).toStrictEqual({
      after: "relaunch",
      kind: "saving",
    });

    const done = run(
      source,
      [{ draftId: D1, result: { kind: "published" }, type: "saveFinished" }],
      saving.state
    );

    expect(done.effects).toStrictEqual([{ relaunch: true, type: "exitApp" }]);
  });

  it("forgets Quit and reopen when its save is blocked or fails", () => {
    const source = ids();

    const blocked = run(source, [
      { text: text("A limits B"), type: "textChanged" },
      { relaunch: true, type: "quitRequested" },
      { choice: "save", type: "quitChosen" },
    ]);

    expect(blocked.state.notice).toStrictEqual({ kind: "needsView" });
    expect(
      run(
        source,
        [{ type: "quitRequested" }, { choice: "discard", type: "quitChosen" }],
        blocked.state
      ).effects
    ).toStrictEqual([{ type: "exitApp" }]);

    const failed = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "textChanged" },
      { relaunch: true, type: "quitRequested" },
      { choice: "save", type: "quitChosen" },
      {
        draftId: D1,
        result: { kind: "failed", message: "disk full" },
        type: "saveFinished",
      },
    ]);

    expect(failed.state.activity.kind).toBe("saveFailed");
    expect(
      run(
        source,
        [{ type: "quitRequested" }, { choice: "discard", type: "quitChosen" }],
        failed.state
      ).effects
    ).toStrictEqual([{ type: "exitApp" }]);
  });

  it("keeps Retry after a cancelled quit following a failed save", () => {
    const source = ids();

    const { state } = run(source, [
      foreignPress,
      captured("t1", view(1, "macos:1176")),
      { text: text("A limits B"), type: "saveRequested" },
      {
        draftId: D1,
        result: { kind: "failed", message: "disk full" },
        type: "saveFinished",
      },
      { type: "quitRequested" },
      { choice: "cancel", type: "quitChosen" },
    ]);

    expect(state.activity).toStrictEqual({
      kind: "saveFailed",
      message: "disk full",
    });
  });
});
