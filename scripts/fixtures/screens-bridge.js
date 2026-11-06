// Stands in for the preload inside the page: each role's API, answered from the scene's data.
// scripts/screens.ts first sets `globalThis.__screens = { data, page, platform }`, then loads this file
// with `page.addInitScript({ path })`, so it runs as a plain script before the renderer starts.
const { data, page, platform } = globalThis.__screens;

const captureShortcutLabel = platform === "macos" ? "⌥⌘W" : "Ctrl+Alt+W";

const fitted = (height) => {
  globalThis.__fitted = height;
};

const nothing = () => Promise.resolve();

// A real function that does nothing: what the renderer gets back to unsubscribe.
const unsubscribe = Function.prototype;

const none = () => unsubscribe;
const resolved = (value) => () => Promise.resolve(value);

const subscribe = (name, listener) => {
  const receive = (event) => listener(event.detail);

  window.addEventListener(`fixture:${name}`, receive);

  return () => window.removeEventListener(`fixture:${name}`, receive);
};

const emit = (name, detail) =>
  window.dispatchEvent(new CustomEvent(`fixture:${name}`, { detail }));

globalThis.__calls = [];

const record = (method, ...args) => globalThis.__calls.push({ method, args });

/** What ⌘C copies of a stored capture, as main writes it: title, then description. */
const entryText = (capture) =>
  [capture.relationship.trim(), capture.description.trim()]
    .filter((part) => part !== "")
    .join("\n\n");

const COPY_CALLS = { entry: "copyEntry", image: "copyImage", note: "copyNote" };

/** What main puts on the clipboard for each copy, plainly enough for a scene to tell them apart. */
const clipText = (capture, request) => {
  switch (request.kind) {
    case "entry": {
      return entryText(capture);
    }

    case "note": {
      const due = capture.due === null ? "" : `\n\nDue: ${capture.due}`;

      return `${entryText(capture)}${due}\n\n(Copy as text)`;
    }

    default: {
      return `(image ${request.viewId})`;
    }
  }
};

/** Answers every method the renderer calls that the scene does not name itself. */
const withFallback = (api, fallback) =>
  new Proxy(api, { get: (target, key) => target[key] ?? fallback });

if (page === "popover") {
  const snapshot = {
    ...data.draft,
    platform,
    shortcut: {
      ...data.draft.shortcut,
      label: captureShortcutLabel,
    },
  };

  globalThis.inset = withFallback(
    {
      getDraft: resolved(snapshot),
      onCommand: (listener) => subscribe("command", listener),
      onDraft: (listener) => {
        setTimeout(() => listener(snapshot), 0);

        return unsubscribe;
      },
      onShown: none,
      platform,
      reportHeight: fitted,
      setText: (text) => {
        snapshot.text = text;
        record("setText", text);
      },
      save: (text) => {
        record("save", text);

        return nothing();
      },
      chooseQuit: (choice) => {
        record("chooseQuit", choice);

        return nothing();
      },
      dismiss: () => record("dismiss"),
    },
    nothing
  );
}

if (page === "library") {
  const { captures } = data;
  const items = data.items ?? [];

  /** Text saves a scene holds back until it calls __releaseSaves, as a slow disk would. */
  const heldSaves = [];

  /** What each copy began with, by ticket, as main takes it: the capture as it stood then. */
  const begun = new Map();

  globalThis.__releaseSaves = () => {
    for (const run of heldSaves.splice(0)) {
      run();
    }
  };

  /** What main does with a text save: write it, or fail as a full disk would. */
  const saveText = (captureId, text) => {
    if (data.failSaves === true) {
      return { kind: "failed", message: "The disk is full." };
    }

    const capture = captures.find((item) => item.id === captureId);

    if (capture !== undefined) {
      capture.relationship = text.relationship;
      capture.description = text.description;
      capture.todos = text.todos;

      for (const view of capture.views) {
        view.description = text.viewDescriptions[view.id] ?? view.description;
      }

      const item = items.find((listed) => listed.id === captureId);

      if (item !== undefined) {
        item.relationship = capture.relationship;
        item.description = capture.description;
        item.todos = capture.todos;

        for (const view of item.views) {
          view.description = text.viewDescriptions[view.id] ?? view.description;
        }
      }
    }

    emit("changed");

    return { kind: "ok" };
  };

  globalThis.inset = withFallback(
    {
      answerLeave: (answer) => record("answerLeave", answer),
      beginCopy: (ticket, captureId) => {
        const capture = captures.find((item) => item.id === captureId);

        begun.set(ticket, {
          capture: capture === undefined ? undefined : structuredClone(capture),
          captureId,
        });
        record("beginCopy", captureId);
      },
      // Main writes the clipboard once the page's edits are saved: the capture as it stood when the
      // copy began, with the words the page sent when there are any. The call is recorded after
      // it, under the name of what was copied, so a scene can tell ⌘C, Copy as text and an image
      // apart.
      copy: async (ticket, captureId, request, text) => {
        const start = begun.get(ticket);

        begun.delete(ticket);

        if (start === undefined || start.captureId !== captureId) {
          return { kind: "failed", message: "Couldn't copy. Try again." };
        }

        // Main's capture as the copy began was not on disk: a write before it failed or ran late.
        const notSaved = data.copyNotSaved?.shift();

        if (notSaved !== undefined) {
          record("copyRefused", captureId);

          return { kind: "notSaved", message: notSaved };
        }

        if (start.capture === undefined) {
          return { kind: "missing" };
        }

        const words =
          text === null || text === undefined
            ? start.capture
            : {
                ...start.capture,
                description: text.description,
                relationship: text.relationship,
              };

        await navigator.clipboard.writeText(clipText(words, request));
        record(COPY_CALLS[request.kind], captureId, request, text ?? null);

        return { kind: "ok" };
      },
      remove: (captureId) => {
        for (const list of [captures, items]) {
          const at = list.findIndex((item) => item.id === captureId);

          if (at !== -1) {
            list.splice(at, 1);
          }
        }

        record("remove", captureId);
        emit("changed");

        return Promise.resolve({ kind: "ok" });
      },
      reopen: (captureId, viewIds) => {
        record("reopen", captureId, viewIds);

        return Promise.resolve({ failed: 0 });
      },
      // A copy, as IPC hands the page: a capture saved meanwhile reads as a new stored copy.
      get: (id) =>
        Promise.resolve(
          structuredClone(captures.find((capture) => capture.id === id) ?? null)
        ),
      list: () => Promise.resolve(items),
      menuOpen: (open) => record("menuOpen", open),
      onChanged: (listener) => subscribe("changed", listener),
      onCommand: (listener) => subscribe("command", listener),
      onLeave: (listener) => subscribe("leave", listener),
      onNavigate: none,
      platform,
      reportUnsaved: (count) => record("reportUnsaved", count),
      setDue: (captureId, due) => {
        const found = captures.find((capture) => capture.id === captureId);

        if (found !== undefined) {
          found.due = due;
          const listed = items.find((item) => item.id === captureId);

          if (listed !== undefined) {
            listed.due = due;
          }
        }

        record("setDue", captureId, due);
        emit("changed");

        return Promise.resolve({ kind: "ok" });
      },
      updateText: (captureId, text) => {
        record("updateText", captureId, text);

        if (data.holdSaves === true) {
          const { promise, resolve } = Promise.withResolvers();

          heldSaves.push(() => resolve(saveText(captureId, text)));

          return promise;
        }

        return Promise.resolve(saveText(captureId, text));
      },
      setStatus: (captureId, status) => {
        for (const listed of [...captures, ...items]) {
          if (listed.id === captureId) {
            listed.status = status;
          }
        }

        record("setStatus", captureId, status);
        emit("changed");

        return Promise.resolve({ kind: "ok" });
      },
      setTodoDone: (captureId, todoId, done) => {
        const found = captures
          .find((capture) => capture.id === captureId)
          ?.todos.find((item) => item.id === todoId);

        if (found !== undefined) {
          found.done = done;
        }

        return Promise.resolve({ kind: "ok" });
      },
      shortcut: resolved({
        kind: "registered",
        label: captureShortcutLabel,
      }),
    },
    () => Promise.resolve({ failed: 0, kind: "ok" })
  );
}

if (page === "settings") {
  const settingsView = {
    ...data.view,
    platform,
    shortcut: { ...data.view.shortcut, label: captureShortcutLabel },
  };

  globalThis.inset = withFallback(
    {
      fitHeight: fitted,
      getView: resolved(settingsView),
      menuOpen: (open) => record("menuOpen", open),
      onView: none,
      platform,
    },
    nothing
  );
}
