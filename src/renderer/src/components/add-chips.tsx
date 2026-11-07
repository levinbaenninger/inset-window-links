import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";

import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type AddField = "description" | "steps" | "due";

export interface AddChip {
  field: AddField;
  label: string;
  keys: string;
}

/**
 * The quiet row under a capture's text: + Description, + Next steps, + Due. A field that is
 * already there has no chip, so an empty field never takes room and the row shrinks as it fills.
 */
export const AddChips = ({
  chips,
  onAdd,
  className,
}: {
  chips: readonly AddChip[];
  onAdd: (field: AddField) => void;
  className?: string;
}) =>
  chips.length === 0 ? null : (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {chips.map((chip) => (
        <Tooltip key={chip.label}>
          <TooltipTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none focus-visible:ring-3"
              data-testid={`add-${chip.field}`}
              onClick={() => onAdd(chip.field)}
              type="button"
            >
              <HugeiconsIcon icon={Add01Icon} size={12} />
              {chip.label}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Add {chip.label.toLocaleLowerCase()}
            <Kbd>{chip.keys}</Kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
