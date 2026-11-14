import "../index.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { markPlatform, onboardingApi } from "@/lib/bridge";
import { followSystemTheme } from "@/lib/theme";

import type { OnboardingView } from "../../../shared/onboarding";
import { OnboardingFlow } from "./onboarding-flow";
import type { OnboardingActions } from "./onboarding-flow";

followSystemTheme();

markPlatform();

const api = onboardingApi();

/** Window Links' channels as the flow's plain actions. */
const actions: OnboardingActions = {
  allow: (id) => {
    api.allow(id);
  },
  back: () => {
    api.back();
  },
  finish: (how) => {
    api.finish(how);
  },
  fitHeight: (height) => {
    api.fitHeight(height);
  },
  next: () => {
    api.next();
  },
  reopen: () => {
    api.reopen();
  },
  skip: () => {
    api.skip();
  },
  startDrag: () => {
    api.startDrag();
  },
};

const App = () => {
  const [view, setView] = useState<OnboardingView | null>(null);

  useEffect(() => {
    const unsubscribe = api.onView(setView);

    const load = async () => {
      const first = await api.getView();

      setView((pushed) => pushed ?? first);
    };

    void load();

    return unsubscribe;
  }, []);

  return view === null ? null : (
    <OnboardingFlow
      actions={actions}
      title="Inset Window Links Setup"
      view={view}
    />
  );
};

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
