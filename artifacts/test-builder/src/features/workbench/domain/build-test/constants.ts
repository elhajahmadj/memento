import {
  ApiTestBuildSpecHttpMethod,
  type ApiTestBuildSpecHttpMethod as HttpMethodT,
} from "@workspace/api-client-react";

export const PARAM_TYPES = [
  "string",
  "int",
  "long",
  "Guid",
  "bool",
  "double",
  "decimal",
  "DateTime",
  "object",
] as const;

export const MAX_PARAMETERS = 10;

export const HTTP_METHODS: HttpMethodT[] = [
  ApiTestBuildSpecHttpMethod.GET,
  ApiTestBuildSpecHttpMethod.POST,
  ApiTestBuildSpecHttpMethod.PUT,
  ApiTestBuildSpecHttpMethod.PATCH,
  ApiTestBuildSpecHttpMethod.DELETE,
  ApiTestBuildSpecHttpMethod.HEAD,
  ApiTestBuildSpecHttpMethod.OPTIONS,
];
