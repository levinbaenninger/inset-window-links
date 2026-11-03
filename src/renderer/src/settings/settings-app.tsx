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
  dock: "Dock only",
  dockAndMenuBar: "Dock and menu bar",
  menuBar: "Menu bar only",
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
    <h2 className="text-muted-foreground flex h-7 items-center px-1 text-xs font-medium">
      {title}
    </h2>
    <div className="bg-background mac:dark:bg-card border-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg border">
      {children}
    </div>
  </section>
);

const SettingsForm = ({ view }: { view: SettingsView }) => {
  const loginId = useId();
  const iconId = useId();
  const floatId = useId();
  const clickAwayId = useId();
  const pagesId = useId();
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
      {/* The title strip, which moves the window: centred under the traffic lights, or on the
          left with the Windows close button drawn over the right. */}
      <h1 className="drag-region mac:justify-center win:px-3.5 -mx-3 -mb-2 flex h-11 shrink-0 items-center text-sm font-semibold">
        Settings
      </h1>
      <Group title="General">
        <Row label="Open at login" labelFor={loginId}>
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
            label="Show icon in"
            labelFor={iconId}
            note={
              settings.iconIn === "menuBar"
                ? "No Dock icon means no menu bar. Use the menu bar icon."
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
          label="Shortcut"
          note={
            view.shortcut.kind === "registered"
              ? undefined
              : "Taken by another app."
          }
        >
          <Kbd>{view.shortcut.label}</Kbd>
        </Row>
        <Row label="Keep on top" labelFor={floatId}>
          <Switch
            checked={settings.floatOnTop}
            id={floatId}
            onCheckedChange={(checked) => {
              void settingsApi().update({ floatOnTop: checked });
            }}
          />
        </Row>
        <Row label="Hide on click away" labelFor={clickAwayId}>
          <Switch
            checked={settings.hideOnClickAway}
            id={clickAwayId}
            onCheckedChange={(checked) => {
              void settingsApi().update({ hideOnClickAway: checked });
            }}
          />
        </Row>
      </Group>
      {/* Windows needs no permission to read a browser's address, so it is a plain switch. */}
      {!mac && (
        <Group title="Reopen">
          <Row label="Remember web pages" labelFor={pagesId}>
            <Switch
              checked={settings.rememberPages}
              id={pagesId}
              onCheckedChange={(checked) => {
                void settingsApi().update({ rememberPages: checked });
              }}
            />
          </Row>
        </Group>
      )}
      {mac && (
        <Group title="Reopen">
          <Row
            label="Remember pages and files"
            note={view.originsReadable ? undefined : "Needs Accessibility."}
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
                Turn on…
              </Button>
            )}
          </Row>
        </Group>
      )}
      {/* macOS has the app menu's About panel; elsewhere it is here. */}
      {!mac && (
        <p className="text-muted-foreground px-1 text-xs">
          Inset Window Links {view.version}
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
