import { cn } from "cn";

import { Kbd } from "@/components/ui/kbd";

import type { KeyPlatform } from "../../../shared/shortcuts";
import { SHEET, sheetKeyLabels } from "../../../shared/shortcuts";

/**
 * The sheet button's icon on both platforms: the ⌘ glyph. Hugeicons' keyboard reads as a face at
 * any size the header has room for, and the three Inset apps agreed on ⌘ for that case.
 */
export { CommandIcon as SHORTCUTS_ICON } from "@hugeicons/core-free-icons";

/**
 * Every key the app answers, grouped by where it works, for the platform it runs on. The keys
 * come from the same table as the menus, so the sheet can't list a key the app doesn't have.
 */
export const ShortcutList = ({
  platform,
  globalLabel,
  columns = 2,
}: {
  platform: KeyPlatform;
  /** The capture shortcut, or null while another app holds it. */
  globalLabel: string | null;
  columns?: 1 | 2;
}) => (
  <div
    className={cn(
      "grid gap-x-8 gap-y-5",
      columns === 2 ? "grid-cols-2" : "grid-cols-1"
    )}
    data-testid="shortcut-list"
  >
    {SHEET.map((group) => (
      <section
        aria-label={group.title}
        className="flex flex-col"
        key={group.title}
      >
        <h3 className="text-xs font-semibold">{group.title}</h3>
        <p className="text-muted-foreground mb-1.5 text-xs">{group.where}</p>
        <ul className="flex flex-col">
          {group.rows.map((row) => {
            const labels = sheetKeyLabels(row, platform, globalLabel);

            return (
              <li
                className="border-foreground/5 flex min-h-7 items-center justify-between gap-3 border-b py-0.5 text-sm last:border-b-0"
                key={row.label}
              >
                <span className="min-w-0">{row.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {labels.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      Taken by another app
                    </span>
                  ) : (
                    labels.map((label) => <Kbd key={label}>{label}</Kbd>)
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </div>
);
