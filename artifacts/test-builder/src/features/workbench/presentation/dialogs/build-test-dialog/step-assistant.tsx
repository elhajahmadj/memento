import {
  ApiTestBuildSpecBuildInto,
  type ApiTestBuildSpecBuildInto as BuildIntoT,
} from "@workspace/api-client-react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import {
  MAX_PARAMETERS,
  PARAM_TYPES,
} from "@/features/workbench/domain/build-test/constants";
import type { TestClassMode } from "@/features/workbench/domain/build-test/types";
import { ParametersEditor } from "./parameters-editor";
import type { BuildTestForm } from "./use-build-test-form";

export interface ExistingTestClass {
  className: string;
  path: string;
}

export interface StepAssistantProps {
  form: BuildTestForm;
  existingTestClasses: ExistingTestClass[];
}

export function StepAssistant({
  form: f,
  existingTestClasses,
}: StepAssistantProps) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="helperName">Helper method name</Label>
        <Input
          id="helperName"
          value={f.helperMethodName}
          onChange={(e) => f.setHelperMethodName(e.target.value)}
          data-testid="input-helper-method"
        />
      </div>

      <ParametersEditor
        rows={f.parameters}
        setRows={f.setParameters}
        label="Helper parameters"
        testid="parameters"
        maxRows={MAX_PARAMETERS}
        fields={[
          { key: "name", placeholder: "name (e.g. id)" },
          { key: "type", placeholder: "type", options: PARAM_TYPES },
        ]}
      />

      <div className="flex items-center gap-2">
        <Checkbox
          id="useAccessToken"
          checked={f.useAccessToken}
          onCheckedChange={(v) => f.setUseAccessToken(v === true)}
          data-testid="checkbox-use-access-token"
        />
        <Label htmlFor="useAccessToken" className="text-sm font-normal">
          Attach Bearer access token from configuration
        </Label>
      </div>

      <ParametersEditor
        rows={f.defaultHeaders}
        setRows={f.setDefaultHeaders}
        label="Default headers (optional)"
        testid="default-headers"
        fields={[
          { key: "name", placeholder: "header (e.g. Accept)" },
          { key: "value", placeholder: "value" },
        ]}
      />

      <ParametersEditor
        rows={f.multipartFields}
        setRows={f.setMultipartFields}
        label="Multipart fields (optional)"
        testid="multipart-fields"
        fields={[
          { key: "name", placeholder: "field name" },
          {
            key: "valueExpression",
            placeholder: 'C# expression (e.g. "value")',
          },
        ]}
      />

      <div className="space-y-2">
        <Label>Where does the call go?</Label>
        <RadioGroup
          value={f.buildInto}
          onValueChange={(v) => f.setBuildInto(v as BuildIntoT)}
          className="flex flex-col gap-1"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value={ApiTestBuildSpecBuildInto.testMethod}
              id="bi-test"
              data-testid="radio-build-into-test-method"
            />
            Inside the test method (default)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value={ApiTestBuildSpecBuildInto.oneTimeSetup}
              id="bi-ctor"
              data-testid="radio-build-into-one-time-setup"
            />
            In the test class constructor (response asserted in the test
            method; xUnit constructs once per test instance)
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor="testMethod">Test method name</Label>
        <Input
          id="testMethod"
          value={f.testMethodName}
          onChange={(e) => f.setTestMethodName(e.target.value)}
          data-testid="input-test-method-name"
        />
      </div>

      <div className="space-y-2">
        <Label>Test class</Label>
        <RadioGroup
          value={f.testClassMode}
          onValueChange={(v) => f.setTestClassMode(v as TestClassMode)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value="new"
              id="tc-new"
              data-testid="radio-test-class-new"
            />
            New class
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem
              value="existing"
              id="tc-existing"
              data-testid="radio-test-class-existing"
            />
            Add to existing class
          </label>
        </RadioGroup>
        {f.testClassMode === "new" ? (
          <Input
            value={f.newClassName}
            onChange={(e) => f.setNewClassName(e.target.value)}
            placeholder="UsersTests"
            data-testid="input-new-class-name"
          />
        ) : existingTestClasses.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-no-existing-test-classes"
          >
            No existing test classes found. Pick "New class" to create one.
          </p>
        ) : (
          <Select
            value={f.existingClassPath}
            onValueChange={(v) => f.setExistingClassPath(v)}
          >
            <SelectTrigger data-testid="select-existing-class-path">
              <SelectValue placeholder="Choose an existing test class" />
            </SelectTrigger>
            <SelectContent>
              {existingTestClasses.map((c) => (
                <SelectItem key={c.path} value={`Tests/${c.className}.cs`}>
                  {c.className}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
