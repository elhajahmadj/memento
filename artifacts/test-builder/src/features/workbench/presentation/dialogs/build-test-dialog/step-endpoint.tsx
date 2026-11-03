import {
  type ApiTestBuildSpecHttpMethod as HttpMethodT,
} from "@workspace/api-client-react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { HTTP_METHODS } from "@/features/workbench/domain/build-test/constants";
import type { BuildTestForm } from "./use-build-test-form";

export interface ApiBaseUrlOption {
  name: string;
  baseUrl: string;
}

export interface StepEndpointProps {
  form: BuildTestForm;
  existingUrls: ApiBaseUrlOption[];
}

export function StepEndpoint({ form: f, existingUrls }: StepEndpointProps) {
  function onSelectExistingUrl(name: string, baseUrl: string) {
    f.setSelectedExistingUrl(name);
    f.setUrlName(name);
    f.setBaseUrl(baseUrl);
  }
  function onAddNewUrl() {
    f.setSelectedExistingUrl("");
    f.setUrlName("");
    f.setBaseUrl("");
  }

  return (
    <div className="space-y-4 py-2">
      {existingUrls.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="existingApiBaseUrl">API base URL</Label>
          <Select
            value={
              f.selectedExistingUrl === "" ? "__new__" : f.selectedExistingUrl
            }
            onValueChange={(v) => {
              if (v === "__new__") {
                onAddNewUrl();
              } else {
                const match = existingUrls.find((u) => u.name === v);
                if (match) onSelectExistingUrl(match.name, match.baseUrl);
              }
            }}
          >
            <SelectTrigger
              id="existingApiBaseUrl"
              data-testid="select-existing-api-base-url"
            >
              <SelectValue placeholder="Choose an existing API base URL" />
            </SelectTrigger>
            <SelectContent>
              {existingUrls.map((u) => (
                <SelectItem key={u.name} value={u.name}>
                  {u.name} — {u.baseUrl}
                </SelectItem>
              ))}
              <SelectItem value="__new__">Add new…</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {(existingUrls.length === 0 || f.selectedExistingUrl === "") && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="urlName">URL name</Label>
            <Input
              id="urlName"
              value={f.urlName}
              onChange={(e) => f.setUrlName(e.target.value)}
              data-testid="input-url-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="baseUrl">API base URL</Label>
            <Input
              id="baseUrl"
              value={f.baseUrl}
              onChange={(e) => f.setBaseUrl(e.target.value)}
              data-testid="input-base-url"
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="endpointName">Endpoint constant name</Label>
          <Input
            id="endpointName"
            value={f.endpointName}
            onChange={(e) => f.setEndpointName(e.target.value)}
            data-testid="input-endpoint-name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endpointSection">Section (optional)</Label>
          <Input
            id="endpointSection"
            value={f.endpointSection}
            onChange={(e) => f.setEndpointSection(e.target.value)}
            placeholder="e.g. Users"
            data-testid="input-endpoint-section"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="endpointPath">Endpoint path</Label>
        <Input
          id="endpointPath"
          value={f.endpointPath}
          onChange={(e) => f.setEndpointPath(e.target.value)}
          placeholder="/users/{0}"
          data-testid="input-endpoint-path"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="httpMethod">HTTP method</Label>
        <Select
          value={f.httpMethod}
          onValueChange={(v) => f.setHttpMethod(v as HttpMethodT)}
        >
          <SelectTrigger id="httpMethod" data-testid="select-http-method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
