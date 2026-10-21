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

const PermissionNotice = ({ stillDenied }: { stillDenied: boolean }) => (
  <Alert data-testid="permission-notice">
    <AlertTitle>Screen Recording is off for Inset Window Links</AlertTitle>
    <AlertDescription>
      Allow it in System Settings to capture windows.
      {stillDenied
        ? " It is still off. After you allow it, macOS may ask you to quit and reopen the app."
        : ""}
    </AlertDescription>
    <div className="col-span-full mt-2 flex gap-1.5">
      <Button onClick={openSettings} size="sm" variant="outline">
        Open Screen Recording settings
      </Button>
      <Button onClick={recheck} size="sm" variant="ghost">
        Retry
      </Button>
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
