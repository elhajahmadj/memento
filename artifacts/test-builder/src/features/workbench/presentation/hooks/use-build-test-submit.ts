import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBuildApiTest,
  ApiTestBuildSpecTestClassMode,
  getGetProjectTreeQueryKey,
  type ApiTestBuildSpecBuildInto as BuildIntoT,
  type ApiTestBuildSpecHttpMethod as HttpMethodT,
} from "@workspace/api-client-react";
import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";
import type {
  HeaderRow,
  MultipartRow,
  ParamRow,
  TestClassMode,
} from "@/features/workbench/domain/build-test/types";

export interface UseBuildTestSubmitArgs {
  solutionName: string;
  onSuccess: () => void;
}

export interface SubmitInput {
  baseUrl: string;
  urlName: string;
  endpointName: string;
  endpointSection: string;
  endpointPath: string;
  httpMethod: HttpMethodT;
  helperMethodName: string;
  parameters: ParamRow[];
  useAccessToken: boolean;
  multipartFields: MultipartRow[];
  defaultHeaders: HeaderRow[];
  testMethodName: string;
  buildInto: BuildIntoT;
  testClassMode: TestClassMode;
  newClassName: string;
  existingClassPath: string;
}

export function useBuildTestSubmit({
  solutionName,
  onSuccess,
}: UseBuildTestSubmitArgs) {
  const qc = useQueryClient();
  const [buildError, setBuildError] = useState<string | null>(null);

  const build = useBuildApiTest({
    mutation: {
      onSuccess: async (res) => {
        setBuildError(null);
        toast.success(`Built ${res.files.length} files`);
        await qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() });
        await invalidateDiscoveredTests(qc);
        onSuccess();
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Build failed";
        setBuildError(msg);
        toast.error(msg);
      },
    },
  });

  function submit(input: SubmitInput) {
    build.mutate({
      data: {
        solutionName,
        baseUrl: input.baseUrl,
        urlName: input.urlName,
        endpointName: input.endpointName,
        endpointSection: input.endpointSection.trim()
          ? input.endpointSection.trim()
          : null,
        endpointPath: input.endpointPath,
        buildInto: input.buildInto,
        testMethodName: input.testMethodName,
        testClass:
          input.testClassMode === "new"
            ? {
                mode: ApiTestBuildSpecTestClassMode.new,
                className: input.newClassName,
              }
            : {
                mode: ApiTestBuildSpecTestClassMode.existing,
                path: input.existingClassPath,
              },
        helperMethodName: input.helperMethodName,
        parameters: input.parameters.filter((p) => p.name && p.type),
        httpMethod: input.httpMethod,
        useAccessToken: input.useAccessToken,
        multipartFields: input.multipartFields.filter(
          (m) => m.name && m.valueExpression,
        ),
        defaultHeaders: input.defaultHeaders.filter((h) => h.name),
      },
    });
  }

  return {
    submit,
    isPending: build.isPending,
    buildError,
    clearBuildError: () => setBuildError(null),
  };
}
