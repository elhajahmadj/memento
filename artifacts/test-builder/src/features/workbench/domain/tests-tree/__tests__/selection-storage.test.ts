/**
 * Unit tests for the (user, project)-scoped selection-storage helpers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readPersistedSelection,
  selectionStorageKey,
  writePersistedSelection,
} from "../selection-storage";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("selectionStorageKey", () => {
  it("returns null when either id is missing", () => {
    expect(selectionStorageKey(null, "p")).toBeNull();
    expect(selectionStorageKey("u", null)).toBeNull();
    expect(selectionStorageKey(undefined, "p")).toBeNull();
  });

  it("scopes the key by user + project", () => {
    expect(selectionStorageKey("u1", "p1")).toBe(
      "tests-tree:selected:v1:u1:p1",
    );
    expect(selectionStorageKey("u1", "p1")).not.toBe(
      selectionStorageKey("u2", "p1"),
    );
    expect(selectionStorageKey("u1", "p1")).not.toBe(
      selectionStorageKey("u1", "p2"),
    );
  });
});

describe("read/writePersistedSelection", () => {
  it("round-trips a selection set", () => {
    const key = selectionStorageKey("u", "p")!;
    writePersistedSelection(key, new Set(["a", "b"]));
    expect(Array.from(readPersistedSelection(key)).sort()).toEqual(["a", "b"]);
  });

  it("clears the entry when the selection is empty", () => {
    const key = selectionStorageKey("u", "p")!;
    writePersistedSelection(key, new Set(["a"]));
    writePersistedSelection(key, new Set());
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("returns an empty set when the key is null or missing", () => {
    expect(readPersistedSelection(null).size).toBe(0);
    expect(readPersistedSelection("missing-key").size).toBe(0);
  });

  it("recovers gracefully from corrupted JSON", () => {
    const key = selectionStorageKey("u", "p")!;
    window.localStorage.setItem(key, "not-json");
    expect(readPersistedSelection(key).size).toBe(0);
  });

  it("ignores non-array payloads", () => {
    const key = selectionStorageKey("u", "p")!;
    window.localStorage.setItem(key, JSON.stringify({ foo: "bar" }));
    expect(readPersistedSelection(key).size).toBe(0);
  });

  it("ignores non-string array entries", () => {
    const key = selectionStorageKey("u", "p")!;
    window.localStorage.setItem(key, JSON.stringify(["a", 1, null, "b"]));
    expect(Array.from(readPersistedSelection(key)).sort()).toEqual(["a", "b"]);
  });
});
