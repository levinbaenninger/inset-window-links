import type {
  HandOffChoice,
  OnboardingStep,
  OnboardingView,
  PermissionId,
} from "@shared/onboarding";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";
import { WindowHeader, WindowTitle } from "@/shared/window-header";

import { PermissionRow } from "./permission-row";

/**
 * What the page can ask of the app. Plain functions, so an app with another
 * IPC pattern can pass its own.
 */
export interface OnboardingActions {
  readonly allow: (id: PermissionId) => void;
  readonly reopen: () => void;
  /** Get Started, Continue, →, or Not now on Allow access. */
  readonly next: () => void;
  /** Back, or ←. */
  readonly back: () => void;
  /** Not now on Welcome: the whole flow. */
  readonly skip: () => void;
  /** Done's two buttons. */
  readonly finish: (how: HandOffChoice) => void;
  readonly startDrag: () => void;
  /** The page's height, so the window fits it without empty space. */
  readonly fitHeight: (height: number) => void;
}

/** A step's heading and the sentences under it. */
export const OnboardingHeading = ({
  children,
  lead,
}: {
  readonly children: ReactNode;
  readonly lead?: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
    {lead === undefined ? null : (
      <div className="text-muted-foreground text-sm leading-relaxed">
        {lead}
      </div>
    )}
  </div>
);

/** The permissions still to allow. */
const missing = (view: OnboardingView) =>
  view.permissions.filter((row) => row.state !== "allowed");

const plural = (count: number): string =>
  count === 1 ? "1 permission" : `${count} permissions`;

const WelcomeStep = ({ view }: { readonly view: OnboardingView }) => {
  const count = missing(view).length;

  return (
    <OnboardingHeading
      lead={
        <div className="flex flex-col gap-2">
          <p>{view.tagline}</p>
          <p>
            {count === 0
              ? "It has everything it needs from macOS."
              : `It needs ${plural(count)} from macOS. You can skip any step.`}
          </p>
        </div>
      }
    >
      Welcome to {view.appName}
    </OnboardingHeading>
  );
};

const AccessStep = ({
  actions,
  view,
}: {
  readonly view: OnboardingView;
  readonly actions: OnboardingActions;
}) => (
  <>
    <OnboardingHeading lead="macOS asks once for each. You can change them later in System Settings › Privacy & Security.">
      Allow access
    </OnboardingHeading>
    <ul className="border-foreground/10 divide-foreground/10 bg-background/40 flex flex-col divide-y overflow-hidden rounded-lg border">
      {view.permissions.map((row) => (
        <PermissionRow
          active={row.id === view.focus}
          key={row.id}
          onAllow={() => {
            actions.allow(row.id);
          }}
          onDragTile={() => {
            actions.startDrag();
          }}
          onReopen={() => {
            actions.reopen();
          }}
          row={row}
          tile={view.tile}
        />
      ))}
    </ul>
  </>
);

const DoneStep = ({ view }: { readonly view: OnboardingView }) => {
  const skipped = missing(view).filter((row) => row.features.length > 0);

  return (
    <>
      <OnboardingHeading
        lead={skipped.length === 0 ? view.handOff.ready : view.handOff.later}
      >
        {skipped.length === 0 ? "You’re all set" : "Set up for now"}
      </OnboardingHeading>
      {skipped.length === 0 ? null : (
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          {skipped.map((row) => (
            <li key={row.id}>
              Allow {row.title} to use {row.features.join(" and ")}.
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

/** The step's way forward, for Return and the main button; null while Allow access still waits. */
const primaryAction = (
  view: OnboardingView,
  actions: OnboardingActions
): (() => void) | null => {
  const { kind } = view.step;

  if (kind === "done") {
    return () => {
      actions.finish("start");
    };
  }

  if (kind === "access") {
    return missing(view).length === 0 ? actions.next : null;
  }

  return actions.next;
};

/** The footer's buttons on the right: Not now while a step can be passed by, then the way forward. */
const Buttons = ({
  actions,
  view,
}: {
  readonly view: OnboardingView;
  readonly actions: OnboardingActions;
}) => {
  const { kind } = view.step;
  const primary = primaryAction(view, actions);

  if (kind === "done") {
    return (
      <>
        {view.handOff.showAround === null ? null : (
          <Button
            onClick={() => {
              actions.finish("showAround");
            }}
            variant="outline"
          >
            {view.handOff.showAround}
          </Button>
        )}
        <Button
          autoFocus
          onClick={() => {
            actions.finish("start");
          }}
        >
          {view.handOff.start}
        </Button>
      </>
    );
  }

  return (
    <>
      {kind === "welcome" || primary === null ? (
        <Button
          onClick={() => {
            if (kind === "welcome") {
              actions.skip();
            } else {
              actions.next();
            }
          }}
          variant="ghost"
        >
          Not now
        </Button>
      ) : null}
      {primary === null ? null : (
        <Button
          autoFocus
          onClick={() => {
            primary();
          }}
        >
          {kind === "welcome" ? "Get Started" : "Continue"}
        </Button>
      )}
    </>
  );
};

/** Elements that answer Return themselves. */
const ownsReturn = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

/**
 * → and ← move through the pages (→ is Not now on a page still waiting),
 * and Return takes the page's way forward when a button doesn't have focus.
 */
const useStepKeys = (
  view: OnboardingView,
  actions: OnboardingActions
): void => {
  const latest = useRef({ actions, view });

  useEffect(() => {
    latest.current = { actions, view };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      const { current } = latest;
      const { kind } = current.view.step;

      if (event.key === "ArrowRight" && kind !== "done") {
        event.preventDefault();
        current.actions.next();
      } else if (event.key === "ArrowLeft" && kind !== "welcome") {
        event.preventDefault();
        current.actions.back();
      } else if (event.key === "Enter" && !ownsReturn(event.target)) {
        const primary = primaryAction(current.view, current.actions);

        if (primary !== null) {
          event.preventDefault();
          primary();
        }
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
};

/** The window takes the page's height, so no page has empty space below it. */
const useFitHeight = (fitHeight: (height: number) => void) => {
  const page = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = page.current;

    const observer = new ResizeObserver(() => {
      if (element !== null) {
        fitHeight(Math.ceil(element.getBoundingClientRect().height));
      }
    });

    if (element !== null) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [fitHeight]);

  return page;
};

const stepKey = (step: OnboardingStep): string => step.kind;

/**
 * The permission onboarding: Welcome, Allow access, Done, one page each,
 * with Back after Welcome and a dot per page. Every page comes from the
 * view's plain data; the app adds the window's title.
 */
export const OnboardingFlow = ({
  actions,
  title,
  view,
}: {
  readonly view: OnboardingView;
  readonly actions: OnboardingActions;
  readonly title: string;
}) => {
  const { step } = view;
  const page = useFitHeight(actions.fitHeight);

  useStepKeys(view, actions);

  return (
    <main
      className={cn(
        "text-foreground flex flex-col",
        // On macOS the window's translucent material shows through, as in Settings.
        !isMac && "bg-background"
      )}
      ref={page}
    >
      <WindowHeader>
        <WindowTitle>{title}</WindowTitle>
      </WindowHeader>
      <section
        aria-live="polite"
        className="motion-safe:animate-in motion-safe:fade-in-0 flex flex-col gap-4 px-6 pt-5 pb-6 motion-safe:duration-300"
        key={stepKey(step)}
      >
        {step.kind === "welcome" ? <WelcomeStep view={view} /> : null}
        {step.kind === "access" ? (
          <AccessStep actions={actions} view={view} />
        ) : null}
        {step.kind === "done" ? <DoneStep view={view} /> : null}
      </section>
      <footer className="flex h-14 shrink-0 items-center gap-2 border-t px-4">
        {step.kind === "welcome" ? null : (
          <Button
            onClick={() => {
              actions.back();
            }}
            variant="ghost"
          >
            Back
          </Button>
        )}
        <ol
          aria-label={`Step ${view.steps.findIndex((each) => each.kind === step.kind) + 1} of ${view.steps.length}`}
          className="mr-auto flex items-center gap-1.5 px-1"
        >
          {view.steps.map((each) => (
            <li
              aria-current={each.kind === step.kind ? "step" : undefined}
              className={cn(
                "size-1.5 rounded-full transition-colors motion-reduce:transition-none",
                each.kind === step.kind ? "bg-foreground" : "bg-foreground/20"
              )}
              key={each.kind}
            />
          ))}
        </ol>
        <Buttons actions={actions} view={view} />
      </footer>
    </main>
  );
};
