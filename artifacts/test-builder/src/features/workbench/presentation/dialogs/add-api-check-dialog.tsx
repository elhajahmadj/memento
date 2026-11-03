import { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Dialog for appending an `apiAssertion` action to the in-progress
 * recording. The recorder forwards the result to the api-server via the
 * `add-api-assertion` websocket message; the codegen layer then emits a
 * `request.fetch(...)` call (per language) into the generated test.
 */
export function AddApiCheckDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [method, setMethod] = useState<ApiMethod>("GET");
  const [url, setUrl] = useState("");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [requestBody, setRequestBody] = useState("");
  const [expectedResponseJson, setExpectedResponseJson] = useState("");

  useEffect(() => {
    if (!open) {
      setMethod("GET");
      setUrl("");
      setExpectedStatus("200");
      setRequestBody("");
      setExpectedResponseJson("");
    }
  }, [open]);

  const statusNum = Number(expectedStatus);
  const statusValid =
    Number.isInteger(statusNum) && statusNum >= 100 && statusNum <= 599;

  const isValidJson = (raw: string): boolean => {
    if (!raw.trim()) return true;
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  };
  const bodyValid = isValidJson(requestBody);
  const expectedJsonValid = isValidJson(expectedResponseJson);

  const canSubmit =
    url.trim().length > 0 && statusValid && bodyValid && expectedJsonValid;

  const submit = () => {
    if (!canSubmit) return;
    window.dispatchEvent(
      new CustomEvent("recorder:request-add-api-assertion", {
        detail: {
          apiMethod: method,
          apiUrl: url.trim(),
          apiExpectedStatus: statusNum,
          apiRequestBody: requestBody.trim() || null,
          apiExpectedJson: expectedResponseJson.trim() || null,
        },
      }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-api-check">
        <DialogHeader>
          <DialogTitle>Add API check</DialogTitle>
          <DialogDescription>
            Issue an HTTP request during replay using Playwright's
            `request.fetch()` and assert the response status. The check is
            saved alongside the recorded UI actions and emitted by the
            codegenerator in your project's language.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as ApiMethod)}
            >
              <SelectTrigger data-testid="select-api-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-url" className="text-xs">
              URL
            </Label>
            <Input
              id="api-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/users/me"
              className="font-mono"
              data-testid="input-api-url"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-status" className="text-xs">
              Expected status code
            </Label>
            <Input
              id="api-status"
              type="number"
              min="100"
              max="599"
              value={expectedStatus}
              onChange={(e) => setExpectedStatus(e.target.value)}
              data-testid="input-api-status"
            />
            {!statusValid && (
              <p className="text-xs text-red-600">
                Enter an integer between 100 and 599.
              </p>
            )}
          </div>
          {method !== "GET" && method !== "DELETE" && (
            <div className="space-y-1">
              <Label htmlFor="api-body" className="text-xs">
                Request body (JSON, optional)
              </Label>
              <Textarea
                id="api-body"
                rows={4}
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                placeholder='{"name":"alice"}'
                className="font-mono text-xs"
                data-testid="input-api-body"
              />
              {!bodyValid && (
                <p className="text-xs text-red-600">Body must be valid JSON.</p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="api-expected-json" className="text-xs">
              Expected response body subset (JSON, optional)
            </Label>
            <Textarea
              id="api-expected-json"
              rows={4}
              value={expectedResponseJson}
              onChange={(e) => setExpectedResponseJson(e.target.value)}
              placeholder='{"id":"u1"}'
              className="font-mono text-xs"
              data-testid="input-api-expected-json"
            />
            {!expectedJsonValid && (
              <p className="text-xs text-red-600">
                Expected JSON must be valid JSON.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-api-check-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="button-api-check-add"
          >
            Add API check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
