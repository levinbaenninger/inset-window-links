import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { viewTitle } from "@/lib/format";

import type { CandidateSummary, FallbackReason } from "../../../shared/dto";

const reasons = {
  ambiguous:
    "Inset Window Links found more than one capture source for the active window.",
  captureFailed: "Capturing the active window failed.",
  invalidId:
    "The active window reported an identity Inset Window Links can't use.",
  menu: "You opened the window list from the menu.",
  noMatch:
    "Inset Window Links couldn't match the active window to a capture source.",
  probeUnavailable: "Inset Window Links couldn't read the active window.",
  vanished: "The active window closed before it could be captured.",
} satisfies { [K in FallbackReason]: string };

export const SourceChooser = ({
  reason,
  candidates,
  onChoose,
  onCancel,
}: {
  reason: FallbackReason;
  candidates: readonly CandidateSummary[] | "loading";
  onChoose: (candidate: CandidateSummary) => void;
  onCancel: () => void;
}) => (
  <section
    aria-label="Choose a window"
    className="flex flex-col gap-2"
    data-testid="source-chooser"
  >
    <Alert>
      <AlertTitle>Fallback: choose the window to add</AlertTitle>
      <AlertDescription>
        {reasons[reason]} Views added here are marked as chosen from the list.
      </AlertDescription>
    </Alert>
    {candidates === "loading" ? (
      <p className="text-muted-foreground text-xs">Loading windows…</p>
    ) : (
      <ul className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              className="hover:bg-muted focus-visible:ring-ring flex w-full flex-col gap-1 rounded-lg border p-1.5 text-left outline-none focus-visible:ring-2"
              onClick={() => onChoose(candidate)}
              type="button"
            >
              <img
                alt=""
                className="bg-muted aspect-video w-full rounded object-contain"
                src={candidate.imageUrl}
              />
              <span className="truncate text-xs">
                {viewTitle(candidate.title)}
              </span>
            </button>
          </li>
        ))}
        {candidates.length === 0 && (
          <li className="text-muted-foreground col-span-2 text-xs">
            No windows are available to capture.
          </li>
        )}
      </ul>
    )}
    <Button className="self-start" onClick={onCancel} size="sm" variant="ghost">
      Cancel
    </Button>
  </section>
);
