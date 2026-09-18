import { describe, expect, it } from "vitest";
import {
  fullMonthsBetween,
  LEAVE_POLICY,
  leaveDaysConsumed,
  leaveSummary,
  monthsInLeaveYear,
} from "./leave-calc.ts";

describe("fullMonthsBetween", () => {
  it("counts whole calendar months", () => {
    expect(fullMonthsBetween("2026-01-01", "2026-03-15")).toBe(2);
    expect(fullMonthsBetween("2026-01-15", "2026-03-14")).toBe(1);
    expect(fullMonthsBetween("2026-01-15", "2026-03-15")).toBe(2);
  });

  it("is zero when the end precedes the start", () => {
    expect(fullMonthsBetween("2026-06-01", "2026-01-01")).toBe(0);
  });
});

describe("leaveSummary", () => {
  it("computes accrual, unused and capped carryover deterministically", () => {
    const res = leaveSummary({ join_date: "2026-01-01", taken_days: 5, as_of: "2026-09-15" });
    expect(res.accrued_days).toBe(16); // 8 months x 2
    expect(res.taken_days).toBe(5);
    expect(res.unused_days).toBe(11);
    expect(res.carryover_days).toBe(LEAVE_POLICY.carryover_cap_days); // capped at 3
    expect(res.monthly_credit).toBe(2);
  });

  it("caps carryover at the policy limit", () => {
    const res = leaveSummary({ join_date: "2024-01-01", taken_days: 1, as_of: "2026-09-15" });
    expect(res.unused_days).toBeGreaterThan(LEAVE_POLICY.carryover_cap_days);
    expect(res.carryover_days).toBe(3);
  });

  it("never goes negative on taken days", () => {
    const res = leaveSummary({ join_date: "2026-08-01", taken_days: 10, as_of: "2026-09-15" });
    expect(res.unused_days).toBe(0);
  });
});

describe("monthsInLeaveYear (mid-year join)", () => {
  it("accrues only months employed in the current leave year", () => {
    expect(monthsInLeaveYear("2026-03-10", "2026-09-15")).toBe(6);
    expect(monthsInLeaveYear("2025-06-01", "2026-09-15")).toBe(8); // Jan 1 start
  });
});

describe("leaveDaysConsumed spanning holidays", () => {
  it("excludes public holidays from the leave consumed", () => {
    const res = leaveDaysConsumed({
      from: "2026-12-24",
      to: "2026-12-31",
      public_holidays: ["2026-12-25"],
    });
    expect(res.calendar_days).toBe(8);
    expect(res.holiday_days).toBe(1);
    expect(res.leave_days_consumed).toBe(7);
  });

  it("handles inverted ranges safely", () => {
    const res = leaveDaysConsumed({ from: "2026-12-31", to: "2026-12-24", public_holidays: [] });
    expect(res.leave_days_consumed).toBe(0);
  });
});
