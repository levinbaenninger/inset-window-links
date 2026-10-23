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
    <AlertTitle>Allow Screen Recording to capture windows</AlertTitle>
    <AlertDescription>
      {stillDenied ? (
        <p>
          macOS still blocks capture. If Inset Window Links is already switched
          on, this copy of the app is new to macOS: select it, remove it with −,
          add it again, then quit and reopen.
        </p>
      ) : (
        <p>
          Turn on Inset Window Links under Privacy &amp; Security, Screen
          Recording. macOS then asks you to quit and reopen the app.
        </p>
      )}
    </AlertDescription>
    <div className="col-span-full mt-2 flex flex-wrap gap-1.5">
      <Button onClick={openSettings} size="sm" variant="outline">
        Open Screen Recording settings
      </Button>
      {stillDenied ? (
        <Button onClick={relaunch} size="sm" variant="ghost">
          Quit and reopen
        </Button>
      ) : (
        <Button onClick={recheck} size="sm" variant="ghost">
          Check again
        </Button>
      )}
    </div>
  </Alert>
);

const messages = {
  captureFailed: "Capturing that window failed. Nothing was added.",
  needsRelationship: "Write what connects these views before saving.",
  needsView: "Add at least one view before saving.",
  sourceVanished:
    "That window closed before it could be captured. Nothing was added.",
} satisfies { [K in Exclude<Notice["kind"], "permissionDenied">]: string };

export const NoticeBanner = ({ notice }: { notice: Notice }) =>
  notice.kind === "permissionDenied" ? (
    <PermissionNotice stillDenied={notice.stillDenied} />
  ) : (
    <Alert data-testid="notice">
      <AlertDescription>{messages[notice.kind]}</AlertDescription>
    </Alert>
  );
