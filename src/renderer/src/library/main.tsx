import "../index.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import { libraryApi, markPlatform } from "@/lib/bridge";
import { listenForCommands } from "@/lib/commands";
import { announceMenus } from "@/lib/menu-keys";
import { followSystemTheme } from "@/lib/theme";

import { LeaveReasonSchema } from "../../../shared/leave";
import { listenForCopy } from "./copy-keys";
import { LeavePrompt } from "./leave-prompt";
import { drafts, leaving } from "./page-drafts";
import { router } from "./router";
import { SidebarProvider } from "./sidebar";

/** Main only asks for app routes such as /captures/<id>; anything else is ignored. */
const RouteSchema = z.string().regex(/^\/[\w/-]{0,120}$/u);

followSystemTheme();

markPlatform();

listenForCommands((listener) => libraryApi().onCommand(listener));

listenForCopy();

announceMenus((open) => libraryApi().menuOpen(open));

// Main holds the close while the page reports unsaved words. Words typed a moment before the close
// may not have been reported yet: this is the last chance to send them.
window.addEventListener("pagehide", () => drafts.leave());

libraryApi().onLeave((reason) => {
  const parsed = LeaveReasonSchema.safeParse(reason);

  if (parsed.success) {
    leaving.request(parsed.data);
  }
});

libraryApi().onChanged(() => {
  void router.invalidate();
});

libraryApi().onNavigate((route) => {
  const parsed = RouteSchema.safeParse(route);

  if (parsed.success) {
    router.history.push(parsed.data);
  }
});

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <SidebarProvider>
        <RouterProvider router={router} />
        <LeavePrompt />
      </SidebarProvider>
    </StrictMode>
  );
}
