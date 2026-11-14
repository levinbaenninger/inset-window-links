import { createContext, useContext } from "react";

import { libraryApi } from "@/lib/bridge";

import { NO_TUTORIAL } from "../../../shared/tutorial";
import type { TutorialAction, TutorialView } from "../../../shared/tutorial";

/** The in-app tutorial (src/renderer/src/tutorial/) over Recent Captures' channels. */
export const tutorialSource = {
  load: async (): Promise<TutorialView> => await libraryApi().getTutorial(),
  subscribe: (listener: (view: TutorialView) => void) =>
    libraryApi().onTutorial(listener),
};

export const actTutorial = (action: TutorialAction): void => {
  libraryApi().tutorial(action);
};

export const endWalk = (): void => {
  libraryApi().tutorial({ kind: "spotlightDone" });
};

/** The tutorial as the Shell last heard it, for the pages under it: which captures are examples. */
export const TutorialContext = createContext<TutorialView>(NO_TUTORIAL);

/** Whether a capture is the first run's example, which says so wherever it shows. */
export const useIsExample = (captureId: string): boolean =>
  useContext(TutorialContext).examples.includes(captureId);

/** The tag on the example capture, in the list and on its page. */
export const ExampleTag = () => (
  <span className="bg-foreground/8 text-muted-foreground shrink-0 rounded-sm px-1.5 py-px text-xs font-medium">
    Example
  </span>
);

/** The tag, on the example capture only. */
export const ExampleBadge = ({ captureId }: { readonly captureId: string }) =>
  useIsExample(captureId) ? <ExampleTag /> : null;
