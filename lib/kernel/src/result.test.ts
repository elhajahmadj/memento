import { describe, expect, it } from "vitest";
import {
  andThen,
  err,
  fromPromise,
  fromThrowable,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
} from "./result";

describe("Result", () => {
  it("ok / err construct discriminated values", () => {
    const a = ok(1);
    const b = err("nope");
    expect(isOk(a)).toBe(true);
    expect(isErr(b)).toBe(true);
    if (isOk(a)) expect(a.value).toBe(1);
    if (isErr(b)) expect(b.error).toBe("nope");
  });

  it("map transforms ok and passes err through", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>("x"), (n: number) => n)).toEqual(err("x"));
  });

  it("mapErr transforms err and passes ok through", () => {
    expect(mapErr(err("x"), (e) => `${e}!`)).toEqual(err("x!"));
    expect(mapErr(ok(1), (e: string) => e)).toEqual(ok(1));
  });

  it("andThen chains fallible steps", () => {
    const half = (n: number) =>
      n % 2 === 0 ? ok(n / 2) : err<string>("odd");
    expect(andThen(ok(8), half)).toEqual(ok(4));
    expect(andThen(ok(7), half)).toEqual(err("odd"));
    expect(andThen(err<string>("upstream"), half)).toEqual(err("upstream"));
  });

  it("unwrap returns ok value or throws on err", () => {
    expect(unwrap(ok(5))).toBe(5);
    expect(() => unwrap(err("boom"))).toThrow(/boom/);
  });

  it("unwrapOr returns fallback on err", () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err("e"), 9)).toBe(9);
  });

  it("fromThrowable wraps thrown errors", () => {
    const r = fromThrowable<number, string>(
      () => {
        throw new Error("nope");
      },
      (e) => (e instanceof Error ? e.message : "?"),
    );
    expect(r).toEqual(err("nope"));
  });

  it("fromPromise wraps async rejections", async () => {
    const r = await fromPromise<number, string>(
      Promise.reject(new Error("async fail")),
      (e) => (e instanceof Error ? e.message : "?"),
    );
    expect(r).toEqual(err("async fail"));
  });
});
