import { useEffect, useRef, useState } from "react";

import { popoverApi } from "@/lib/bridge";

import type { DraftSnapshot } from "../../../shared/dto";
import type { DraftText } from "../../../shared/text";
import { blankText } from "../../../shared/text";

export interface DraftState {
  snapshot: DraftSnapshot | null;
  text: DraftText;
  setText: (text: DraftText) => void;
}

/**
 * The renderer is the only writer of the text. It adopts main's copy only when a new
 * draft starts, so a pushed snapshot never overwrites what is being typed.
 */
export const useDraft = (): DraftState => {
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [text, setText] = useState<DraftText>(blankText);
  const draftId = useRef<string | null>(null);

  useEffect(() => {
    const api = popoverApi();

    const adopt = (next: DraftSnapshot) => {
      setSnapshot(next);

      if (next.draftId !== draftId.current) {
        draftId.current = next.draftId;
        setText(next.text);
      }
    };

    const unsubscribe = api.onDraft(adopt);

    const load = async () => {
      adopt(await api.getDraft());
    };

    void load();

    return unsubscribe;
  }, []);

  const updateText = (next: DraftText) => {
    setText(next);
    popoverApi().setText(next);
  };

  return { setText: updateText, snapshot, text };
};
