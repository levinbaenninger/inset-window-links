import { cn } from "cn";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

import {
  DescribeButton,
  WINDOW_DESCRIPTION_PLACEHOLDER,
} from "@/components/describe-button";

import { isBlank, MAX_VIEW_DESCRIPTION } from "../../../shared/text";

export interface WindowDescriptionHandle {
  /** Starts editing, with the keyboard in the field. */
  edit: () => void;
}

/**
 * A window's description as plain text, or a quiet "+ Description" until it has one. A click
 * edits it in place. It saves as it is typed; Return or leaving the field goes back to the text,
 * Shift-Return starts a new line, and Escape puts back what it said before.
 */
export const WindowDescription = ({
  value,
  name,
  onChange,
  onLeave,
  className,
  addClassName,
  ref,
}: {
  value: string;
  /** "window 2, Budget", for the accessible names. */
  name: string;
  onChange: (description: string) => void;
  /** Called when editing ends, so what was typed is saved at once. */
  onLeave?: () => void;
  /** The box the text and the field share, so nothing moves when one becomes the other. */
  className?: string;
  addClassName?: string | undefined;
  ref?: Ref<WindowDescriptionHandle>;
}) => {
  const [editing, setEditing] = useState(false);
  const before = useRef(value);
  // Return and Escape hand the keyboard back to the text; a click elsewhere keeps it where it went.
  const refocus = useRef(false);
  const shown = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const edit = () => {
    before.current = value;
    setEditing(true);
  };

  useImperativeHandle(ref, () => ({ edit }));

  useEffect(() => {
    const input = field.current;

    if (editing && input !== null) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (!editing && refocus.current) {
      refocus.current = false;
      shown.current?.focus();
    }
  }, [editing]);

  const finish = (giveBack: boolean) => {
    refocus.current = giveBack;
    setEditing(false);
    onLeave?.();
  };

  if (editing) {
    return (
      <textarea
        aria-label={`Description of ${name}`}
        className={cn(
          "placeholder:text-muted-foreground bg-foreground/4 text-foreground field-sizing-content resize-none outline-none",
          className
        )}
        data-testid="window-description"
        maxLength={MAX_VIEW_DESCRIPTION}
        onBlur={() => {
          // The window lost the keyboard, not the field: it is still being edited.
          if (field.current === document.activeElement) {
            return;
          }

          setEditing(false);
          onLeave?.();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          const plain =
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();

            if (event.currentTarget.value !== before.current) {
              onChange(before.current);
            }

            finish(true);
          } else if (event.key === "Enter" && plain) {
            event.preventDefault();
            finish(true);
          }
        }}
        placeholder={WINDOW_DESCRIPTION_PLACEHOLDER}
        ref={field}
        rows={1}
        value={value}
      />
    );
  }

  if (isBlank(value)) {
    return (
      <DescribeButton
        className={addClassName}
        description=""
        label={name}
        onClick={edit}
        ref={shown}
      />
    );
  }

  return (
    <button
      aria-label={`${value.trim()}. Edit the description of ${name}`}
      className={cn(
        // Focus tints the words as hover does; a ring would make them look like a field again.
        "text-muted-foreground hover:bg-foreground/4 focus-visible:bg-foreground/4 hover:text-foreground focus-visible:text-foreground text-left break-words whitespace-pre-wrap outline-none",
        className
      )}
      data-testid="window-description-text"
      onClick={edit}
      ref={shown}
      type="button"
    >
      {value.trim()}
    </button>
  );
};
