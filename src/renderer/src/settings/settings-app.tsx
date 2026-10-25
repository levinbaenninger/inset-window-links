import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { settingsApi } from "@/lib/bridge";

import type { IconPlace, SettingsView } from "../../../shared/settings";
import { ICON_PLACES } from "../../../shared/settings";

const ICON_LABELS = {
  dock: "Dock Only",
  dockAndMenuBar: "Dock and Menu Bar",
  menuBar: "Menu Bar Only",
} satisfies { [K in IconPlace]: string };

const isIconPlace = (value: string): value is IconPlace =>
  ICON_PLACES.some((place) => place === value);

/** A settings row, as in Inset Shelf: the label on the left, its control on the right, an optional note below. */
const Row = ({
  children,
  label,
  labelFor,
  note,
}: {
  label: string;
  labelFor?: string;
  note?: string | undefined;
  children: ReactNode;
}) => (
  <div className="flex min-h-12 flex-col justify-center gap-1 px-3 py-2.5">
    <div className="flex items-center justify-between gap-4">
      {labelFor === undefined ? (
        <span className="text-sm font-medium">{label}</span>
      ) : (
        <Label htmlFor={labelFor}>{label}</Label>
      )}
      {children}
    </div>
    {note === undefined ? null : (
      <p className="text-muted-foreground pr-12 text-xs leading-snug">{note}</p>
    )}
  </div>
);

const Group = ({ children, title }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1">
    <h2 className="text-muted-foreground flex h-7 items-center px-1.5 text-xs font-medium">
      {title}
    </h2>
    <div className="bg-background/60 border-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg border">
      {children}
    </div>
  </section>
);

const SettingsForm = ({ view }: { view: SettingsView }) => {
  const loginId = useId();
  const iconId = useId();
  const floatId = useId();
  const clickAwayId = useId();
  const page = useRef<HTMLElement>(null);
  const { settings } = view;
  const mac = view.platform === "macos";

  // The window takes the page's height, so it has no empty space below the last group.
  useEffect(() => {
    const element = page.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      settingsApi().fitHeight(
        Math.ceil(element.getBoundingClientRect().height)
      );
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <main
      className="text-foreground win:bg-background flex flex-col gap-3 px-3 pb-3"
      ref={page}
    >
      {mac ? (
        // The title strip under the traffic lights, which moves the window.
        <h1 className="drag-region -mx-3 flex h-10 items-center justify-center text-sm font-semibold">
          Settings
        </h1>
      ) : (
        <>
          <div aria-hidden className="drag-region -mx-3 -mb-2 h-9" />
          <h1 className="sr-only">Settings</h1>
        </>
      )}
      <Group title="General">
        <Row label="Open at Login" labelFor={loginId}>
          <Switch
            checked={view.openAtLogin}
            id={loginId}
            onCheckedChange={(checked) => {
              void settingsApi().setOpenAtLogin(checked);
            }}
          />
        </Row>
        {/* On Windows the notification-area icon is the app's only icon, so there is no choice. */}
        {mac && (
          <Row
            label="Show app icon in"
            labelFor={iconId}
            note={
              settings.iconIn === "menuBar"
                ? "Without a Dock icon, the app has no menu bar of its own; use the menu-bar icon instead."
                : undefined
            }
          >
            <Select
              onValueChange={(value) => {
                if (isIconPlace(value)) {
                  void settingsApi().update({ iconIn: value });
                }
              }}
              value={settings.iconIn}
            >
              <SelectTrigger id={iconId} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ICON_PLACES.map((place) => (
                  <SelectItem key={place} value={place}>
                    {ICON_LABELS[place]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}
      </Group>
      <Group title="Capture panel">
        <Row
          label="Add a window"
          note={
            view.shortcut.kind === "registered"
              ? undefined
              : "Another app holds this shortcut. Use Add windows in the panel instead."
          }
        >
          <Kbd>{view.shortcut.label}</Kbd>
        </Row>
        <Row label="Keep on top of other windows" labelFor={floatId}>
          <Switch
            checked={settings.floatOnTop}
            id={floatId}
            onCheckedChange={(checked) => {
              void settingsApi().update({ floatOnTop: checked });
            }}
          />
        </Row>
        <Row
          label="Hide when I click away"
          labelFor={clickAwayId}
          note="Off keeps the panel open while you add windows; Escape hides it."
        >
          <Switch
            checked={settings.hideOnClickAway}
            id={clickAwayId}
            onCheckedChange={(checked) => {
              void settingsApi().update({ hideOnClickAway: checked });
            }}
          />
        </Row>
      </Group>
      {mac && (
        <Group title="Reopening">
          <Row
            label="Remember pages and files"
            note={
              view.originsReadable
                ? "Reopen brings back the web page or file each window showed."
                : "Needs Accessibility. Without it, Reopen brings back only the app."
            }
          >
            {view.originsReadable ? (
              <span className="text-muted-foreground text-xs">On</span>
            ) : (
              <Button
                onClick={() => {
                  void settingsApi().allowOrigins();
                }}
                size="sm"
                variant="outline"
              >
                Turn On…
              </Button>
            )}
          </Row>
        </Group>
      )}
      {/* macOS has the app menu's About panel; elsewhere it is here. */}
      {!mac && (
        <p className="text-muted-foreground px-1 text-xs">
          Inset Window Links {view.version}. A prototype for the Inset capture
          experiments.
        </p>
      )}
    </main>
  );
};

export const SettingsApp = () => {
  const [view, setView] = useState<SettingsView | null>(null);

  useEffect(() => {
    const api = settingsApi();
    const unsubscribe = api.onView(setView);

    const load = async () => {
      setView(await api.getView());
    };

    void load();

    return unsubscribe;
  }, []);

  return view === null ? null : <SettingsForm view={view} />;
};
