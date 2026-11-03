/**
 * Registry of all built-in architectures (per-language Playwright
 * defaults + per-language API marker architectures). Pure data + tiny
 * lookup helpers — no I/O.
 */
import type { Architecture } from "../types";
import { DEFAULT_ARCHITECTURE } from "./csharp";
import { PYTHON_DEFAULT_ARCHITECTURE } from "./python";
import { NODEJS_DEFAULT_ARCHITECTURE } from "./nodejs";
import { JAVA_DEFAULT_ARCHITECTURE } from "./java";
import {
  API_DEFAULT_CSHARP_ARCHITECTURE,
  API_DEFAULT_PYTHON_ARCHITECTURE,
  API_DEFAULT_NODEJS_ARCHITECTURE,
  API_DEFAULT_JAVA_ARCHITECTURE,
} from "./api";

export * from "./csharp";
export * from "./python";
export * from "./nodejs";
export * from "./java";
export * from "./api";

export const BUILTIN_ARCHITECTURES: readonly Architecture[] = [
  DEFAULT_ARCHITECTURE,
  PYTHON_DEFAULT_ARCHITECTURE,
  NODEJS_DEFAULT_ARCHITECTURE,
  JAVA_DEFAULT_ARCHITECTURE,
  API_DEFAULT_CSHARP_ARCHITECTURE,
  API_DEFAULT_PYTHON_ARCHITECTURE,
  API_DEFAULT_NODEJS_ARCHITECTURE,
  API_DEFAULT_JAVA_ARCHITECTURE,
];

export function isBuiltInId(id: string): boolean {
  return BUILTIN_ARCHITECTURES.some((a) => a.id === id);
}

export function findBuiltInById(id: string): Architecture | undefined {
  return BUILTIN_ARCHITECTURES.find((a) => a.id === id);
}

export function getDefaultArchitecture(): Architecture {
  return DEFAULT_ARCHITECTURE;
}

export function getPythonDefaultArchitecture(): Architecture {
  return PYTHON_DEFAULT_ARCHITECTURE;
}

export function getNodejsDefaultArchitecture(): Architecture {
  return NODEJS_DEFAULT_ARCHITECTURE;
}

export function getJavaDefaultArchitecture(): Architecture {
  return JAVA_DEFAULT_ARCHITECTURE;
}
