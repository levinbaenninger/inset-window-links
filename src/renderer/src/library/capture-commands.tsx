import {
  AlarmClockIcon,
  Calendar03Icon,
  CalendarRemove01Icon,
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

import { DueOptions } from "@/components/due";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { libraryApi } from "@/lib/bridge";
import { formatClock, formatPickHint, plural } from "@/lib/format";

import type { MutationOutcome } from "../../../shared/dto";
import type { DueDate } from "../../../shared/due";
import { dueDay, duePresets } from "../../../shared/due";
import type { CaptureId, ViewId } from "../../../shared/ids";
import type { MenuKeyId } from "../../../shared/shortcuts";
import { menuKeyLabel } from "../../../shared/shortcuts";
import type {
  CaptureStatus,
  SnoozePreset,
  StatusRequest,
} from "../../../shared/status";
import { ACTIVE, snoozePresets } from "../../../shared/status";
import { savePending } from "./inline-saver";

const FEEDBACK_MS = 2000;

type Icon = typeof Add01Icon;

interface MenuItem {
  kind: "item";
  label: string;
  /** Left out inside a submenu, whose trigger carries the icon. */
  icon?: Icon;
  /** Shown at the right of the item, such as when a snooze ends. */
  hint?: string | undefined;
  destructive?: boolean;
  run: () => Promise<void> | void;
}

interface Separator {
  kind: "separator";
  id: string;
}

export type MenuEntry =
  | MenuItem
  | {
      kind: "submenu";
      label: string;
      icon: Icon;
      items: readonly (MenuItem | Separator)[];
    }
  | Separator;

export interface CaptureTarget {
  id: CaptureId;
  status: CaptureStatus;
  due: DueDate | null;
  /** The windows Reopen can bring back. */
  reopenable: readonly ViewId[];
  /**
   * Where the menu opens: on a row of the list, or on the open capture's own page. The menu keys
   * act on the open capture only, and Space on the row in focus, so a hint shows only where its
   * key does what the item does.
   */
  from: "row" | "openRow" | "page";
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
    ? `${preset.until.toLocaleDateString(undefined, { weekday: "short" })} ${clock}`
    : clock;
};

/** The menu key that does the same to the open capture. */
const keys = (id: MenuKeyId) => menuKeyLabel(id, libraryApi().platform);

/**
 * Everything that can be done to one capture, once: the right-click menu in the sidebar and the
 * capture's own header both draw these entries. Delete asks first, in the dialog this returns.
 */
export const useCaptureCommands = (target: CaptureTarget) => {
  const navigate = useNavigate();
  const router = useRouter();
  const { captureId: openId } = useParams({ strict: false });
  const [confirming, setConfirming] = useState(false);
  const [pickingDue, setPickingDue] = useState(false);
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

  const setDue = async (due: DueDate | null) => {
    say(outcomeMessage(await libraryApi().setDue(target.id, due)));
  };

  /** The page's keys act on the open capture, so its menu, and its row's, show them. */
  const onOpen = target.from !== "row";

  const hint = (id: MenuKeyId) => (onOpen ? keys(id) : undefined);

  // The same layout as the Due picker: quick days with their dates, then Pick a date… and Clear.
  const dueMenu: MenuEntry = {
    icon: Calendar03Icon,
    items: [
      ...duePresets(now).map((preset) => ({
        hint: formatPickHint(dueDay(preset.due), now),
        kind: "item" as const,
        label: preset.label,
        run: () => setDue(preset.due),
      })),
      { id: "pick", kind: "separator" },
      {
        icon: Calendar03Icon,
        kind: "item",
        label: "Pick a date…",
        run: () => setPickingDue(true),
      },
      ...(target.due === null
        ? []
        : [
            {
              destructive: true,
              icon: CalendarRemove01Icon,
              kind: "item" as const,
              label: "Clear",
              run: () => setDue(null),
            },
          ]),
    ],
    kind: "submenu",
    label: "Due",
  };

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

  // Space on a row marks it done, or takes a done one back; a snoozed one it marks done.
  const space = target.from === "page" ? undefined : "Space";

  const done: MenuItem = {
    hint: status.kind === "done" ? undefined : space,
    icon: CheckmarkCircle02Icon,
    kind: "item",
    label: "Mark as done",
    run: () => setStatus({ kind: "done" }),
  };

  const backToList: MenuItem = {
    hint: status.kind === "done" ? space : undefined,
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

  const copy: MenuItem = {
    hint: hint("copyNote"),
    icon: Copy01Icon,
    kind: "item",
    label: "Copy as text",
    run: async () => {
      // What is still being typed goes first, so the copy matches the screen.
      await savePending(target.id);
      await libraryApi().copyNote(target.id);
      say("Copied");
    },
  };

  const entries: readonly MenuEntry[] = [
    ...(target.reopenable.length > 0
      ? [
          {
            hint: hint("reopen"),
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
    copy,
    { id: "status", kind: "separator" },
    dueMenu,
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
    <>
      <Dialog open={pickingDue} onOpenChange={setPickingDue}>
        <DialogContent className="w-72">
          <div className="p-1.5">
            <DialogTitle className="sr-only">Due</DialogTitle>
            <DialogDescription className="sr-only">
              When should this capture be done by?
            </DialogDescription>
            <DueOptions
              due={target.due}
              keys={keys("setDue")}
              now={now}
              onClose={() => setPickingDue(false)}
              onPick={(due) => {
                setPickingDue(false);
                void setDue(due);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
            <AlertDialogDescription>
              Its windows and text are removed from this computer. To keep it
              out of the list instead, mark it as done.
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
    </>
  );

  return {
    backToList,
    copy,
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
              {entry.items.map((item) =>
                item.kind === "separator" ? (
                  <Separator key={item.id} />
                ) : (
                  renderItem(parts, item)
                )
              )}
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
