// Stands in for the preload inside the page: each role's API, answered from the scene's data.
// scripts/screens.ts first sets `globalThis.__screens = { data, page, platform }`, then loads this file
// with `page.addInitScript({ path })`, so it runs as a plain script before the renderer starts.
const { data, page, platform } = globalThis.__screens;

const fitted = (height) => {
  globalThis.__fitted = height;
};

const nothing = () => Promise.resolve();

// A real function that does nothing: what the renderer gets back to unsubscribe.
const unsubscribe = Function.prototype;

const none = () => unsubscribe;
const resolved = (value) => () => Promise.resolve(value);

/** Answers every method the renderer calls that the scene does not name itself. */
const withFallback = (api, fallback) =>
  new Proxy(api, { get: (target, key) => target[key] ?? fallback });

if (page === "popover") {
  const snapshot = { ...data.draft, platform };

  globalThis.inset = withFallback(
    {
      getDraft: resolved(snapshot),
      onDraft: (listener) => {
        setTimeout(() => listener(snapshot), 0);

        return unsubscribe;
      },
      onShown: none,
      platform,
      reportHeight: fitted,
    },
    nothing
  );
}

if (page === "library") {
  const { captures } = data;
  const items = data.items ?? [];

  globalThis.inset = withFallback(
    {
      get: (id) =>
        Promise.resolve(captures.find((capture) => capture.id === id) ?? null),
      list: () => Promise.resolve(items),
      onChanged: none,
      onFind: none,
      onNavigate: none,
      platform,
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
        label: platform === "macos" ? "⌥⌘W" : "Ctrl+Alt+W",
      }),
    },
    () => Promise.resolve({ failed: 0, kind: "ok" })
  );
}

if (page === "settings") {
  const settingsView = { ...data.view, platform };

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
