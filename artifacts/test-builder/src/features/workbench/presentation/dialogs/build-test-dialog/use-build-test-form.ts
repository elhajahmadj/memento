import { useState } from "react";
import {
  ApiTestBuildSpecBuildInto,
  ApiTestBuildSpecHttpMethod,
  type ApiTestBuildSpecBuildInto as BuildIntoT,
  type ApiTestBuildSpecHttpMethod as HttpMethodT,
} from "@workspace/api-client-react";
import type {
  HeaderRow,
  MultipartRow,
  ParamRow,
  TestClassMode,
} from "@/features/workbench/domain/build-test/types";

export function useBuildTestForm() {
  const [step, setStep] = useState<1 | 2>(1);

  const [baseUrl, setBaseUrl] = useState("https://api.example.com");
  const [urlName, setUrlName] = useState("Default");
  const [endpointName, setEndpointName] = useState("GetUsers");
  const [endpointSection, setEndpointSection] = useState("");
  const [endpointPath, setEndpointPath] = useState("");
  const [selectedExistingUrl, setSelectedExistingUrl] = useState<string>("");
  const [httpMethod, setHttpMethod] = useState<HttpMethodT>(
    ApiTestBuildSpecHttpMethod.GET,
  );

  const [helperMethodName, setHelperMethodName] = useState("GetUsersAsync");
  const [parameters, setParameters] = useState<ParamRow[]>([]);
  const [useAccessToken, setUseAccessToken] = useState(true);
  const [multipartFields, setMultipartFields] = useState<MultipartRow[]>([]);
  const [defaultHeaders, setDefaultHeaders] = useState<HeaderRow[]>([
    { name: "accept", value: "text/plain" },
  ]);
  const [testMethodName, setTestMethodName] = useState("GetUsers_Returns200");
  const [buildInto, setBuildInto] = useState<BuildIntoT>(
    ApiTestBuildSpecBuildInto.testMethod,
  );
  const [testClassMode, setTestClassMode] = useState<TestClassMode>("new");
  const [newClassName, setNewClassName] = useState("UsersTests");
  const [existingClassPath, setExistingClassPath] = useState("");

  function reset() {
    setStep(1);
    setBaseUrl("https://api.example.com");
    setUrlName("Default");
    setEndpointName("GetUsers");
    setEndpointSection("");
    setEndpointPath("");
    setSelectedExistingUrl("");
    setHttpMethod(ApiTestBuildSpecHttpMethod.GET);
    setHelperMethodName("GetUsersAsync");
    setParameters([]);
    setUseAccessToken(true);
    setMultipartFields([]);
    setDefaultHeaders([{ name: "accept", value: "text/plain" }]);
    setTestMethodName("GetUsers_Returns200");
    setBuildInto(ApiTestBuildSpecBuildInto.testMethod);
    setTestClassMode("new");
    setNewClassName("UsersTests");
    setExistingClassPath("");
  }

  return {
    step,
    setStep,
    baseUrl,
    setBaseUrl,
    urlName,
    setUrlName,
    endpointName,
    setEndpointName,
    endpointSection,
    setEndpointSection,
    endpointPath,
    setEndpointPath,
    selectedExistingUrl,
    setSelectedExistingUrl,
    httpMethod,
    setHttpMethod,
    helperMethodName,
    setHelperMethodName,
    parameters,
    setParameters,
    useAccessToken,
    setUseAccessToken,
    multipartFields,
    setMultipartFields,
    defaultHeaders,
    setDefaultHeaders,
    testMethodName,
    setTestMethodName,
    buildInto,
    setBuildInto,
    testClassMode,
    setTestClassMode,
    newClassName,
    setNewClassName,
    existingClassPath,
    setExistingClassPath,
    reset,
  };
}

export type BuildTestForm = ReturnType<typeof useBuildTestForm>;
