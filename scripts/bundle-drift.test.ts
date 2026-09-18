import { describe, expect, it } from "vitest";
import { normalizeEol, sameBundle, driftReason } from "./bundle-eol.mjs";

describe("bundle drift checker (Phase 15: CRLF safety)", () => {
  it("LF and CRLF versions of identical content compare equal", () => {
    const lf = "line1\nline2\nDeno.serve(";
    const crlf = "line1\r\nline2\r\nDeno.serve(";
    expect(normalizeEol(crlf)).toBe(lf);
    expect(sameBundle(lf, crlf)).toBe(true);
    expect(driftReason(lf, crlf)).toBeNull();
  });

  it("a meaningful code change still fails", () => {
    const a = "const x = 1; Deno.serve(";
    const b = "const x = 2; Deno.serve(";
    expect(sameBundle(a, b)).toBe(false);
    expect(driftReason(a, b)).toMatch(/mismatch/);
  });
});
