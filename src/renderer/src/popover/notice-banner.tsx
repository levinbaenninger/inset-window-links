import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { popoverApi } from "@/lib/bridge";

import type { Notice } from "../../../shared/dto";

const openSettings = async () => {
  await popoverApi().openScreenSettings();
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
        ? "macOS still blocks capture. Remove Inset Window Links from the list, add it again, then reopen."
        : "Turn on Inset Window Links in System Settings, then reopen the app."}
    </AlertDescription>
    <div className="col-span-full mt-2 flex flex-wrap gap-1.5">
      <Button onClick={openSettings} size="sm" variant="outline">
        Open System Settings
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
