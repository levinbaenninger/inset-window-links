import { NO_TUTORIAL } from "@shared/tutorial";
import type { TutorialView } from "@shared/tutorial";
import { useEffect, useState } from "react";

/**
 * A page's tutorial view: loaded once, then every pushed update. Plain
 * functions, so an app with another IPC pattern passes its own. A page
 * without a tutorial (an app or harness that answers nothing) shows none.
 */
export const useTutorial = (source: {
  readonly load: () => Promise<TutorialView | undefined>;
  readonly subscribe: (listener: (view: TutorialView) => void) => () => void;
}): TutorialView => {
  const [view, setView] = useState<TutorialView>(NO_TUTORIAL);
  const { load, subscribe } = source;

  useEffect(() => {
    let pushed = false;

    const unsubscribe = subscribe((next) => {
      pushed = true;
      setView(next);
    });

    const fetchInitial = async (): Promise<void> => {
      const first = await load();

      if (!pushed && first !== undefined) {
        setView(first);
      }
    };

    void fetchInitial();

    return unsubscribe;
  }, [load, subscribe]);

  return view;
};
