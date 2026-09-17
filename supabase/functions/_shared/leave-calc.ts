// ---------------------------------------------------------------------------
// WorkSense deterministic leave engine (Phase 7).
// Matches POL-LVE v2 ("Leave & Time Off Policy"): 24 days/year, credited
// monthly at 2 days per full month of service; up to 3 days carryover;
// public holidays at the applicable location do not reduce the balance;
// mid-year joiners accrue only for months employed in the leave year.
// Zero LLM — every number is computed, so answers can cite the policy while
// the arithmetic stays honest and unit-tested.
// ---------------------------------------------------------------------------

export const LEAVE_POLICY = {
  days_per_year: 24,
  monthly_credit: 2,
  carryover_cap_days: 3,
  notice_days_for_long_leave: 28, // 4 weeks for requests of 10+ consecutive days
  long_leave_threshold: 10,
} as const;

export const LEAVE_YEAR_START = { month: 0, day: 1 }; // 1 January

/** Whole calendar months between two dates (join/start to as-of). A month
 *  counts when the same day-of-month has passed in the following month. */
export function fullMonthsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Full months of employment inside the current leave year. */
export function monthsInLeaveYear(joinDate: string, asOf: string): number {
  const yearStart = `${new Date(asOf).getUTCFullYear()}-01-01`;
  if (new Date(joinDate) > new Date(asOf)) return 0;
  const effectiveStart = new Date(joinDate) > new Date(yearStart) ? joinDate : yearStart;
  return fullMonthsBetween(effectiveStart, asOf);
}

export interface LeaveSummary {
  accrued_days: number;
  taken_days: number;
  unused_days: number;
  carryover_days: number;
  carryover_cap_days: number;
  monthly_credit: number;
  as_of: string;
  join_date: string;
}

/** Deterministic balance for an employee on an as-of date. */
export function leaveSummary(params: { join_date: string; taken_days: number; as_of: string }): LeaveSummary {
  const accrued = LEAVE_POLICY.monthly_credit * fullMonthsBetween(params.join_date, params.as_of);
  const unused = Math.max(0, accrued - params.taken_days);
  const carryover = Math.min(LEAVE_POLICY.carryover_cap_days, unused);
  return {
    accrued_days: accrued,
    taken_days: params.taken_days,
    unused_days: unused,
    carryover_days: carryover,
    carryover_cap_days: LEAVE_POLICY.carryover_cap_days,
    monthly_credit: LEAVE_POLICY.monthly_credit,
    as_of: params.as_of,
    join_date: params.join_date,
  };
}

/** A leave request spanning public holidays consumes only non-holiday days. */
export function leaveDaysConsumed(params: { from: string; to: string; public_holidays: string[] }): {
  calendar_days: number;
  holiday_days: number;
  leave_days_consumed: number;
} {
  const from = new Date(params.from);
  const to = new Date(params.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return { calendar_days: 0, holiday_days: 0, leave_days_consumed: 0 };
  }
  const holidays = new Set(
    (params.public_holidays ?? []).map((d) => d.slice(0, 10))
  );
  let calendarDays = 0;
  let holidayDays = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const iso = cursor.toISOString().slice(0, 10);
    if (holidays.has(iso)) holidayDays += 1;
    calendarDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    calendar_days: calendarDays,
    holiday_days: holidayDays,
    leave_days_consumed: Math.max(0, calendarDays - holidayDays),
  };
}
