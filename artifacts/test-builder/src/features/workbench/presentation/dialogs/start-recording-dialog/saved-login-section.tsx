import { Label } from "@/shared/ui/label";
import type { SavedLoginInfo } from "./types";

export function SavedLoginSection({
  savedLoginInfo,
  useSavedLogin,
  setUseSavedLogin,
}: {
  savedLoginInfo: SavedLoginInfo;
  useSavedLogin: boolean;
  setUseSavedLogin: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
      <input
        id="use-saved-login"
        type="checkbox"
        className="mt-0.5"
        checked={useSavedLogin}
        onChange={(e) => setUseSavedLogin(e.target.checked)}
        data-testid="checkbox-use-saved-login"
      />
      <div className="space-y-0.5">
        <Label
          htmlFor="use-saved-login"
          className="font-normal cursor-pointer"
        >
          Use saved login
          {savedLoginInfo.label ? ` ("${savedLoginInfo.label}")` : ""}
        </Label>
        <p className="text-xs text-muted-foreground">
          Hydrate the recorder browser with your saved storageState
          (cookies + localStorage) so the session starts already
          signed in.
        </p>
      </div>
    </div>
  );
}
