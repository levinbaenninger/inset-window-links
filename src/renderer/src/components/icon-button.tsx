import type { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The one icon-only button: ghost, small, named by its tooltip, which also shows its key if it
 * has one. The rest of the props reach the Button, so a Radix trigger such as AlertDialogTrigger
 * can wrap it with asChild.
 */
export const IconButton = ({
  label,
  icon,
  keys,
  side = "bottom",
  ...props
}: {
  label: string;
  icon: typeof Add01Icon;
  keys?: string;
  side?: ComponentProps<typeof TooltipContent>["side"];
} & ComponentProps<typeof Button>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side={side}>
      {label}
      {keys === undefined ? null : <Kbd>{keys}</Kbd>}
    </TooltipContent>
  </Tooltip>
);
