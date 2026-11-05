import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";

import { isBlank } from "../../../shared/text";

export const WINDOW_DESCRIPTION_PLACEHOLDER = "What matters in this window?";

/**
 * A quiet line under a window's title: its description, or "+ Description" until it has one.
 * Either opens the window's image with the description field beside it.
 */
export const DescribeButton = ({
  description,
  label,
  onClick,
  className,
}: {
  description: string;
  /** "window 2, Budget", for the accessible name. */
  label: string;
  onClick: () => void;
  className?: string;
}) => {
  const described = !isBlank(description);

  return (
    <button
      aria-label={`${described ? "Edit the" : "Add a"} description of ${label}`}
      className={cn(
        "hover:text-foreground focus-visible:ring-ring/50 flex h-6 max-w-full min-w-0 items-center gap-1 self-start rounded-sm px-0.5 text-left text-xs outline-none focus-visible:ring-3",
        described ? "text-muted-foreground" : "text-muted-foreground/80",
        className
      )}
      data-testid="describe-window"
      onClick={onClick}
      title={described ? description.trim() : "Describe this window"}
      type="button"
    >
      {described ? (
        <span className="truncate">{description.trim()}</span>
      ) : (
        <>
          <HugeiconsIcon className="shrink-0" icon={Add01Icon} size={12} />
          <span className="truncate">Description</span>
        </>
      )}
    </button>
  );
};
