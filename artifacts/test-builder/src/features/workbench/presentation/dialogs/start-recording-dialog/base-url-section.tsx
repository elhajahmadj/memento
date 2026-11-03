import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { NamedUrl } from "./types";

export function BaseUrlSection({
  hasNamedUrls,
  namedUrls,
  urlSelection,
  setUrlSelection,
  urlName,
  setUrlName,
  startUrl,
  setStartUrl,
}: {
  hasNamedUrls: boolean;
  namedUrls: NamedUrl[];
  urlSelection: string;
  setUrlSelection: (v: string) => void;
  urlName: string;
  setUrlName: (v: string) => void;
  startUrl: string;
  setStartUrl: (v: string) => void;
}) {
  return (
    <>
      {hasNamedUrls && (
        <div className="space-y-2" data-testid="section-base-url">
          <Label htmlFor="url-existing">Base URL</Label>
          <Select
            value={urlSelection}
            onValueChange={(v) => {
              setUrlSelection(v);
              if (v === "__add_new__") return;
              const picked = namedUrls.find((u) => u.name === v);
              if (picked) {
                setUrlName(picked.name);
                setStartUrl(picked.url);
              }
            }}
          >
            <SelectTrigger
              id="url-existing"
              data-testid="select-existing-url"
            >
              <SelectValue placeholder="Choose a saved base URL" />
            </SelectTrigger>
            <SelectContent>
              {namedUrls.map((u) => (
                <SelectItem key={u.name} value={u.name}>
                  {u.name} — {u.url}
                </SelectItem>
              ))}
              <SelectItem value="__add_new__">Add new URL…</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Saved base URLs from this project's previous setup. Pick one
            or choose <em>Add new URL…</em> to record against a different
            target.
          </p>
        </div>
      )}
      {(!hasNamedUrls || urlSelection === "__add_new__") && (
        <div
          className="space-y-2"
          data-testid={hasNamedUrls ? undefined : "section-base-url"}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="url-name">URL name</Label>
              <Input
                id="url-name"
                value={urlName}
                onChange={(e) => setUrlName(e.target.value)}
                placeholder="BaseUrl"
                data-testid="input-url-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url">Start URL</Label>
              <Input
                id="url"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                data-testid="input-start-url"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved to <code>appsettings.json</code> under{" "}
            <code>Urls:{urlName || "Name"}</code> and read at runtime.
          </p>
        </div>
      )}
    </>
  );
}
