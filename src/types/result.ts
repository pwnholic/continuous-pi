/**
 * Result<T, E> — A simple discriminated union for explicit error handling.
 *
 * Modeled after Rust's Result type. Every fallible operation returns a `Result`
 * instead of throwing, so the caller *must* handle the error branch.
 *
 * @example
 * ```ts
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err("division by zero");
 *   return ok(a / b);
 * }
 *
 * const result = divide(10, 2);
 * if (result.ok) {
 *   console.log(result.value); // 5
 * } else {
 *   console.error(result.error); // never reached here
 * }
 * ```
 */

export type Result<T, E = string> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E };

/**
 * Create a successful `Result`.
 */
export function ok<T, E = never>(value: T): Result<T, E> {
    return { ok: true as const, value };
}

/**
 * Create a failure `Result`.
 */
export function err<T = never, E = string>(error: E): Result<T, E> {
    return { ok: false as const, error };
}

// ──────────────────────────────────────────────
//  Branded types — nominal typing at the type level
// ──────────────────────────────────────────────

/**
 * Brand<T, B> — Attaches a phantom brand to a type for nominal typing.
 *
 * Use this to prevent accidental mixing of values that share the same
 * underlying representation (e.g. two different `string` subtypes).
 *
 * @example
 * ```ts
 * type ApiKey = Brand<string, "ApiKey">;
 * type Url    = Brand<string, "Url">;
 *
 * declare function fetchUrl(url: Url): void;
 *
 * const key = "sk-…" as ApiKey;
 * const url = "https://…" as Url;
 *
 * fetchUrl(url);  // ✅ OK
 * fetchUrl(key);  // ❌ TypeScript error
 * ```
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ──────────────────────────────────────────────
//  Utility type helpers
// ──────────────────────────────────────────────

/**
 * Extract the success type from a `Result`.
 */
export type OkType<R extends Result<unknown, unknown>> = R extends {
    readonly ok: true;
    readonly value: infer T;
}
    ? T
    : never;

/**
 * Extract the error type from a `Result`.
 */
export type ErrType<R extends Result<unknown, unknown>> = R extends {
    readonly ok: false;
    readonly error: infer E;
}
    ? E
    : never;

/**
 * Unwraps a Result, returning the value or a fallback.
 *
 * @example
 * ```ts
 * const val = unwrapOr(riskyOperation(), "default");
 * ```
 */
export function unwrapOr<T>(result: Result<T, unknown>, fallback: T): T {
    return result.ok ? result.value : fallback;
}

/**
 * Unwraps a Result, throwing the error if it's a failure.
 *
 * Use sparingly — prefer pattern-matching with `.ok` / `.error`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
    if (!result.ok) {
        throw result.error;
    }
    return result.value;
}
