import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { popoverApi } from "@/lib/bridge";

import type { Notice } from "../../../shared/dto";

/** The permission onboarding, at Screen Recording; the panel steps aside, keeping the draft. */
const setUp = async () => {
  await popoverApi().openSetup();
};

const recheck = async () => {
  await popoverApi().recheckPermission();
};

const relaunch = async () => {
  await popoverApi().relaunch();
};

/** macOS keys the grant to this exact build, so a rebuilt or updated copy can show On and still be refused. */
const PermissionNotice = ({ stillDenied }: { stillDenied: boolean }) => (
  <Alert data-testid="permission-notice">
    <AlertTitle>Allow Screen Recording</AlertTitle>
    <AlertDescription>
      {stillDenied
        ? "macOS still blocks capture. If Inset Window Links is on in the list, reopen the app. If it isn’t listed, Set Up… adds it."
        : "Inset Window Links needs it to take the picture of a window."}
    </AlertDescription>
    <div className="col-span-full mt-2 flex flex-wrap gap-1.5">
      <Button onClick={setUp} size="sm" variant="outline">
        Set Up…
      </Button>
      {stillDenied ? (
        <Button onClick={relaunch} size="sm" variant="ghost">
          Reopen app
        </Button>
      ) : (
        <Button onClick={recheck} size="sm" variant="ghost">
          Check again
        </Button>
      )}
    </div>
  </Alert>
);

export const blockedReasons = {
  needsRelationship: "Add a title to save.",
  needsView: "Add a window to save.",
} as const;

const messages = {
  ...blockedReasons,
  sourceVanished: "That window closed before it was added.",
} satisfies { [K in Exclude<Notice["kind"], "permissionDenied">]: string };

export const NoticeBanner = ({ notice }: { notice: Notice }) =>
  notice.kind === "permissionDenied" ? (
    <PermissionNotice stillDenied={notice.stillDenied} />
  ) : (
    <output
      className="bg-muted block rounded-lg px-3 py-2 text-xs"
      data-testid="notice"
    >
      {messages[notice.kind]}
    </output>
  );
