// A separate process that owns plain test windows, so the Windows harness never touches the user's apps.
// The harness drives it through Playwright's Electron evaluate: globalThis.fixture.open(...) and friends.
import { app, BrowserWindow, screen } from "electron";

const page = (title, body, color) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>${title}</title>
<body style="margin:0;height:100vh;background:${color};font:28px Segoe UI, sans-serif;color:#111">
<p style="margin:24px">${body}</p></body>`)}`;

const windows = new Map();

globalThis.fixture = {
  bounds: (name) => windows.get(name)?.getBounds() ?? null,
  close: () => {
    for (const win of windows.values()) {
      win.destroy();
    }
  },
  /** Physical pixels for a point in DIP, for SetCursorPos. */
  physical: (point) => screen.dipToScreenPoint(point),
  open: async (name, { title, body, color, bounds }) => {
    const win = new BrowserWindow({ ...bounds, autoHideMenuBar: true, title });

    win.on("page-title-updated", (event) => event.preventDefault());
    windows.set(name, win);
    await win.loadURL(page(title, body, color));
  },
  /** Raises a test window above the user's windows without leaving it always on top. */
  raise: (title) => {
    for (const win of windows.values()) {
      if (win.getTitle() === title) {
        win.setAlwaysOnTop(true);
        win.moveTop();
        win.setAlwaysOnTop(false);
      }
    }
  },
  setBounds: (name, bounds) => windows.get(name)?.setBounds(bounds),
};

app.on("window-all-closed", () => {
  // Kept alive until the harness closes the app.
});
