// Phase 0: every query must distinguish its outcome instead of collapsing
// "forbidden", "unavailable", "error", "loading", "empty" and "ready" into a
// single data-or-nothing shape. This module classifies a react-query result
// into a discriminated union; pages render each state explicitly.
//
// Deliberately dependency-free: it classifies structurally (an error object
// with a `code` field), so it never drags the supabase client into tests or
// other entry points.

export type QueryStatusKind =
  | "loading"
  | "ready"
  | "empty"
  | "forbidden"
  | "unavailable"
  | "error";

export interface QuerySuccess<T> {
  kind: "ready" | "empty";
  data: T;
}

export interface QueryLoading {
  kind: "loading";
}

export interface QueryFailure {
  kind: "forbidden" | "unavailable" | "error";
  message: string;
  code?: string;
}

export type QueryResult<T> = QuerySuccess<T> | QueryLoading | QueryFailure;

interface ClassifyInput<T> {
  isPending: boolean;
  isError: boolean;
  data: T | undefined;
  error: unknown;
  /** True when the query is a list that can be empty. */
  list?: boolean;
}

const isEmptyValue = (data: unknown, list: boolean): boolean => {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (list && typeof data === "object") return Object.keys(data).length === 0;
  return false;
};

const asErrorLike = (e: unknown): { code?: string; message?: string } | null =>
  e && typeof e === "object" ? (e as { code?: string; message?: string }) : null;

function classifyError(error: unknown): QueryFailure {
  const err = asErrorLike(error);
  if (err?.code) {
    const code = err.code.toUpperCase();
    if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || code === "403" || code === "401") {
      return { kind: "forbidden", message: err.message ?? "Access denied", code };
    }
    return { kind: "error", message: err.message ?? "Request failed", code };
  }
  // Network-level failures are "unavailable", not app errors.
  if (error instanceof TypeError) {
    return { kind: "unavailable", message: "Network error — the backend could not be reached." };
  }
  return { kind: "error", message: err?.message ?? "Unknown error" };
}

/**
 * Classify a react-query result. Also surfaces forbidden/unavailable errors
 * that react-query normally swallows into a generic error state.
 */
export function classifyQuery<T>(input: ClassifyInput<T>): QueryResult<T> {
  if (input.isError) {
    return classifyError(input.error);
  }
  if (input.isPending || input.data === undefined) {
    return { kind: "loading" };
  }
  const empty = isEmptyValue(input.data, input.list ?? false);
  return empty ? { kind: "empty", data: input.data } : { kind: "ready", data: input.data };
}
