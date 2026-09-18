import { describe, expect, it } from "vitest";
import { classifyQuery } from "../query-state";

function makeQuery<T>(partial: {
  isPending?: boolean;
  isError?: boolean;
  data?: T;
  error?: unknown;
  list?: boolean;
}) {
  return {
    isPending: partial.isPending ?? false,
    isError: partial.isError ?? false,
    data: partial.data,
    error: partial.error ?? null,
    list: partial.list ?? false,
  };
}

describe("classifyQuery (loading / ready / empty / forbidden / unavailable / error)", () => {
  it("classifies loading", () => {
    const r = classifyQuery(makeQuery({ isPending: true }));
    expect(r.kind).toBe("loading");
  });

  it("classifies ready with data", () => {
    const r = classifyQuery(makeQuery({ data: [{ id: "1" }], list: true }));
    expect(r).toEqual({ kind: "ready", data: [{ id: "1" }] });
  });

  it("classifies empty lists and empty payloads", () => {
    expect(classifyQuery(makeQuery({ data: [], list: true })).kind).toBe("empty");
    expect(classifyQuery(makeQuery({ data: null })).kind).toBe("empty");
    expect(classifyQuery(makeQuery({ data: undefined })).kind).toBe("loading");
  });

  it("classifies forbidden via error code", () => {
    const r = classifyQuery(
      makeQuery({ isError: true, error: { code: "FORBIDDEN", message: "no access" } })
    );
    expect(r.kind).toBe("forbidden");
    if (r.kind === "forbidden") {
      expect(r.message).toBe("no access");
    }
  });

  it("classifies network failures as unavailable", () => {
    const r = classifyQuery(makeQuery({ isError: true, error: new TypeError("fetch failed") }));
    expect(r.kind).toBe("unavailable");
  });

  it("classifies generic errors as error", () => {
    const r = classifyQuery(makeQuery({ isError: true, error: new Error("boom") }));
    expect(r).toEqual({ kind: "error", message: "boom" });
  });
});
