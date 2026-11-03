/**
 * `Result<T, E>` is the single discriminated-union type used at every
 * application use-case boundary in this monorepo. It replaces ad-hoc
 * `throw`/`return null`/`{ok, error}` patterns with one uniform shape so
 * callers must explicitly handle both branches.
 *
 * Discipline:
 * - Domain rules and use cases return `Result`.
 * - Infrastructure adapters map transport / DB exceptions into typed
 *   `Result` errors before crossing the boundary.
 * - Presentation (Express handlers, React hooks) inspects the `kind`
 *   discriminant rather than catching exceptions.
 */
export type Result<T, E> = OkResult<T> | ErrResult<E>;

export interface OkResult<T> {
  readonly kind: "ok";
  readonly value: T;
}

export interface ErrResult<E> {
  readonly kind: "err";
  readonly error: E;
}

export const ok = <T>(value: T): OkResult<T> => ({ kind: "ok", value });

export const err = <E>(error: E): ErrResult<E> => ({ kind: "err", error });

export const isOk = <T, E>(r: Result<T, E>): r is OkResult<T> =>
  r.kind === "ok";

export const isErr = <T, E>(r: Result<T, E>): r is ErrResult<E> =>
  r.kind === "err";

/** Map the success branch; pass through errors unchanged. */
export const map = <T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> =>
  r.kind === "ok" ? ok(f(r.value)) : r;

/** Map the error branch; pass through successes unchanged. */
export const mapErr = <T, E, F>(
  r: Result<T, E>,
  f: (e: E) => F,
): Result<T, F> => (r.kind === "err" ? err(f(r.error)) : r);

/** Monadic bind / `flatMap` for chaining fallible steps. */
export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (v: T) => Result<U, E>,
): Result<U, E> => (r.kind === "ok" ? f(r.value) : r);

/**
 * Unwrap the success value or throw. Reserved for tests and trusted
 * boot-time code paths — never use inside a use case or route handler.
 */
export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.kind === "ok") return r.value;
  throw new Error(
    `unwrap() called on err Result: ${
      r.error instanceof Error ? r.error.message : JSON.stringify(r.error)
    }`,
  );
};

/** Unwrap with an explicit fallback value. */
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.kind === "ok" ? r.value : fallback;

/**
 * Lift a fallible synchronous function into a `Result`. The thrown value
 * is mapped through `mapError` so the caller controls the error shape.
 */
export const fromThrowable = <T, E>(
  fn: () => T,
  mapError: (e: unknown) => E,
): Result<T, E> => {
  try {
    return ok(fn());
  } catch (e) {
    return err(mapError(e));
  }
};

/** Async variant of `fromThrowable`. */
export const fromPromise = async <T, E>(
  p: Promise<T>,
  mapError: (e: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await p);
  } catch (e) {
    return err(mapError(e));
  }
};
