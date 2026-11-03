import {
  AlarmClockIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Delete02Icon,
  RepeatIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import type { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { libraryApi } from "@/lib/bridge";
import { formatClock, plural } from "@/lib/format";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId, ViewId } from "../../../shared/ids";
import type {
  CaptureStatus,
  SnoozePreset,
  StatusRequest,
} from "../../../shared/status";
import { ACTIVE, snoozePresets } from "../../../shared/status";

const FEEDBACK_MS = 2000;

type Icon = typeof Add01Icon;

interface MenuItem {
  kind: "item";
  label: string;
  /** Left out inside a submenu, whose trigger carries the icon. */
  icon?: Icon;
  /** Shown at the right of the item, such as when a snooze ends. */
  hint?: string;
  destructive?: boolean;
  run: () => Promise<void> | void;
}

export type MenuEntry =
  | MenuItem
  | { kind: "submenu"; label: string; icon: Icon; items: readonly MenuItem[] }
  | { kind: "separator"; id: string };

export interface CaptureTarget {
  id: CaptureId;
  status: CaptureStatus;
  /** The windows Reopen can bring back. */
  reopenable: readonly ViewId[];
}

/** "Opened 3 windows", or how many could not be. */
export const reopenedMessage = (asked: number, failed: number): string => {
  if (failed === 0) {
    return `Opened ${plural(asked, "window")}`;
  }

  return failed === asked
    ? "Nothing could be opened"
    : `Opened ${asked - failed}, ${failed} could not be`;
};

const outcomeMessage = (outcome: MutationOutcome): string | null => {
  switch (outcome.kind) {
    case "ok": {
      return null;
    }

    case "missing": {
      return "This capture was deleted.";
    }

    case "readOnly": {
      return "This capture can't be changed.";
    }

    default: {
      return outcome.message;
    }
  }
};

/** The time a preset ends at, with its weekday when the label does not already say the day. */
const presetHint = (preset: SnoozePreset): string => {
  const clock = formatClock(preset.until.toISOString());

  return preset.id === "nextWeek"
    ? `${preset.until.toLocaleDateString([], { weekday: "short" })} ${clock}`
    : clock;
};

/**
 * Everything that can be done to one capture, once: the right-click menu in the sidebar and the
 * capture's own header both draw these entries. Delete asks first, in the dialog this returns.
 */
export const useCaptureCommands = (target: CaptureTarget) => {
  const navigate = useNavigate();
  const router = useRouter();
  const { captureId: openId } = useParams({ strict: false });
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** When the snooze times were worked out; a menu asks again each time it opens. */
  const [now, setNow] = useState(() => new Date());

  const say = (message: string | null) => {
    setFeedback(message);

    if (message !== null) {
      setTimeout(() => setFeedback(null), FEEDBACK_MS);
    }
  };

  const setStatus = async (status: StatusRequest) => {
    say(outcomeMessage(await libraryApi().setStatus(target.id, status)));
  };

  const remove = async () => {
    const outcome = await libraryApi().remove(target.id);

    if (outcome.kind !== "ok" && outcome.kind !== "missing") {
      say(outcomeMessage(outcome));

      return;
    }

    if (openId === target.id) {
      // "/" opens the newest capture, so the list must no longer hold this one.
      await router.invalidate({ sync: true });
      await navigate({ to: "/" });
    }
  };

  const { status } = target;

  const snooze: MenuEntry = {
    icon: AlarmClockIcon,
    items: snoozePresets(now).map((preset) => ({
      hint: presetHint(preset),
      kind: "item",
      label: preset.label,
      run: () =>
        setStatus({ kind: "snoozed", until: preset.until.toISOString() }),
    })),
    kind: "submenu",
    label: status.kind === "snoozed" ? "Snooze again" : "Snooze",
  };

  const done: MenuItem = {
    icon: CheckmarkCircle02Icon,
    kind: "item",
    label: "Mark as done",
    run: () => setStatus({ kind: "done" }),
  };

  const backToList: MenuItem = {
    icon: Undo02Icon,
    kind: "item",
    label: status.kind === "done" ? "Not done" : "Unsnooze",
    run: () => setStatus(ACTIVE),
  };

  const byStatus: Record<CaptureStatus["kind"], readonly MenuEntry[]> = {
    active: [snooze, done],
    done: [backToList],
    snoozed: [backToList, snooze, done],
  };

  const entries: readonly MenuEntry[] = [
    ...(target.reopenable.length > 0
      ? [
          {
            icon: RepeatIcon,
            kind: "item" as const,
            label:
              target.reopenable.length === 1 ? "Reopen window" : "Reopen all",
            run: async () => {
              const { failed } = await libraryApi().reopen(
                target.id,
                target.reopenable
              );

              say(reopenedMessage(target.reopenable.length, failed));
            },
          },
        ]
      : []),
    {
      icon: Copy01Icon,
      kind: "item",
      label: "Copy as text",
      run: async () => {
        await libraryApi().copyNote(target.id);
        say("Copied");
      },
    },
    { id: "status", kind: "separator" },
    ...byStatus[status.kind],
    { id: "delete", kind: "separator" },
    {
      destructive: true,
      icon: Delete02Icon,
      kind: "item",
      label: "Delete…",
      run: () => setConfirming(true),
    },
  ];

  const dialog = (
    <AlertDialog onOpenChange={setConfirming} open={confirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
          <AlertDialogDescription>
            Its windows and text are removed from this computer. To keep it out
            of the list instead, mark it as done.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={remove} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    backToList,
    dialog,
    done,
    entries,
    feedback,
    onMenuOpen: () => setNow(new Date()),
  };
};

const PARTS = {
  context: {
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
    Sub: ContextMenuSub,
    SubContent: ContextMenuSubContent,
    SubTrigger: ContextMenuSubTrigger,
  },
  dropdown: {
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
    Sub: DropdownMenuSub,
    SubContent: DropdownMenuSubContent,
    SubTrigger: DropdownMenuSubTrigger,
  },
} as const;

type Parts = (typeof PARTS)[keyof typeof PARTS];

const renderItem = ({ Item, Shortcut }: Parts, entry: MenuItem) => (
  <Item
    key={entry.label}
    onSelect={() => {
      void entry.run();
    }}
    variant={entry.destructive === true ? "destructive" : "default"}
  >
    {entry.icon === undefined ? null : <HugeiconsIcon icon={entry.icon} />}
    {entry.label}
    {entry.hint === undefined ? null : <Shortcut>{entry.hint}</Shortcut>}
  </Item>
);

/** The entries as items of a right-click menu or of a dropdown; the two take the same shape. */
export const MenuEntries = ({
  entries,
  kind,
}: {
  entries: readonly MenuEntry[];
  kind: keyof typeof PARTS;
}) => {
  const parts = PARTS[kind];
  const { Separator, Sub, SubContent, SubTrigger } = parts;

  return entries.map((entry) => {
    switch (entry.kind) {
      case "separator": {
        return <Separator key={entry.id} />;
      }

      case "submenu": {
        return (
          <Sub key={entry.label}>
            <SubTrigger>
              <HugeiconsIcon icon={entry.icon} />
              {entry.label}
            </SubTrigger>
            <SubContent>
              {entry.items.map((item) => renderItem(parts, item))}
            </SubContent>
          </Sub>
        );
      }

      default: {
        return renderItem(parts, entry);
      }
    }
  });
};
