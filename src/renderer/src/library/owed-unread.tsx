import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * What Recent Captures shows while main can't say which Discards it still owes: no capture, so
 * none can be copied or edited over the words a Discard puts back. The page keeps asking.
 */
export const OwedUnread = () => (
  <div className="bg-background text-foreground flex h-screen flex-col">
    <div className="drag-region h-11 shrink-0" />
    <main
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 pb-20 text-center"
      data-testid="owed-unread"
    >
      <HugeiconsIcon
        className="text-muted-foreground"
        icon={Alert02Icon}
        size={20}
      />
      <h1 className="text-sm font-semibold">Recent Captures can’t open yet</h1>
      <output className="text-muted-foreground block max-w-72 text-sm text-balance">
        Inset couldn’t check which changes it still has to discard. Trying
        again…
      </output>
    </main>
  </div>
);
