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
      return `${entryText(capture)}\n\n(Copy as text)`;
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
      dismiss: () => record("dismiss"),
    },
    nothing
  );
}

if (page === "library") {
  const { captures } = data;
  const items = data.items ?? [];

  globalThis.inset = withFallback(
    {
      // Main writes the clipboard once the page's edits are saved; the call is recorded after it,
      // under the name of what was copied, so a scene can tell ⌘C, Copy as text and an image apart.
      copy: async (captureId, request) => {
        const capture = captures.find((item) => item.id === captureId);

        if (capture === undefined) {
          return { kind: "missing" };
        }

        await navigator.clipboard.writeText(clipText(capture, request));
        record(COPY_CALLS[request.kind], captureId, request);

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
      get: (id) =>
        Promise.resolve(captures.find((capture) => capture.id === id) ?? null),
      list: () => Promise.resolve(items),
      onChanged: (listener) => subscribe("changed", listener),
      onCommand: (listener) => subscribe("command", listener),
      onNavigate: none,
      platform,
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
        if (data.failSaves === true) {
          record("updateText", captureId, text);

          return Promise.resolve({
            kind: "failed",
            message: "The disk is full.",
          });
        }

        const capture = captures.find((item) => item.id === captureId);

        if (capture !== undefined) {
          capture.relationship = text.relationship;
          capture.description = text.description;
          capture.todos = text.todos;

          for (const view of capture.views) {
            view.description =
              text.viewDescriptions[view.id] ?? view.description;
          }

          const item = items.find((listed) => listed.id === captureId);

          if (item !== undefined) {
            item.relationship = capture.relationship;
            item.description = capture.description;
            item.todos = capture.todos;

            for (const view of item.views) {
              view.description =
                text.viewDescriptions[view.id] ?? view.description;
            }
          }
        }

        record("updateText", captureId, text);
        emit("changed");

        return Promise.resolve({ kind: "ok" });
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
      onView: none,
      platform,
    },
    nothing
  );
}
