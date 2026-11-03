export type ParamRow = { name: string; type: string; [k: string]: string };

export type MultipartRow = {
  name: string;
  valueExpression: string;
  [k: string]: string;
};

export type HeaderRow = { name: string; value: string; [k: string]: string };

export type TestClassMode = "new" | "existing";
