import "../index.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import { libraryApi, markPlatform } from "@/lib/bridge";
import { listenForCommands } from "@/lib/commands";
import { announceMenus } from "@/lib/menu-keys";
import { followSystemTheme } from "@/lib/theme";

import { LeavePushSchema } from "../../../shared/leave";
import { listenForCopy } from "./copy-keys";
import { LeavePrompt } from "./leave-prompt";
import { OwedUnread } from "./owed-unread";
import { drafts, leaving, opened } from "./page-drafts";
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

// The page answers for the Discards main still owes only once it has taken them in.
libraryApi().onLeave((push) => {
  const parsed = LeavePushSchema.safeParse(push);

  if (!parsed.success) {
    return;
  }

  void (async () => {
    await opened;

    if (parsed.data === "cancel") {
      leaving.dismiss();
    } else {
      leaving.request(parsed.data);
    }
  })();
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

/**
 * The captures show only once the page knows which Discards main still owes, so a capture main
 * owes one for shows as not discarded from the first frame, and none can be copied or edited
 * before then.
 */
const Library = () => {
  const opening = useSyncExternalStore(leaving.subscribe, leaving.opening);

  if (opening === "reading") {
    return null;
  }

  if (opening === "unread") {
    return <OwedUnread />;
  }

  return (
    <SidebarProvider>
      <RouterProvider router={router} />
      <LeavePrompt />
    </SidebarProvider>
  );
};

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <Library />
    </StrictMode>
  );
}
