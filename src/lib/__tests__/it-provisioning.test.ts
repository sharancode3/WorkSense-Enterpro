import { describe, expect, it } from "vitest";
import { deriveItQueueCounts, filterItProvisioning, upcomingStarts } from "@/lib/it-provisioning";

const now = "2026-09-18T09:00:00Z";

function ref(over: Record<string, unknown> = {}) {
  return {
    task_code: "t",
    title: "Task",
    task_type: "provisioning",
    owner_role: "it_security",
    state: "ready",
    due_date: null,
    topological_level: 1,
    plan_id: "p1",
    twin_id: "t1",
    ...over,
  };
}

describe("deriveItQueueCounts", () => {
  it("counts each operational state and flags overdue actionable tasks", () => {
    const counts = deriveItQueueCounts(
      [
        ref({ state: "ready", due_date: "2026-09-10T09:00:00Z" }), // overdue ready
        ref({ state: "ready", due_date: "2026-09-20T09:00:00Z" }),
        ref({ state: "in_progress", due_date: "2026-09-25T09:00:00Z" }),
        ref({ state: "blocked" }),
        ref({ state: "done" }),
        ref({ state: "blocked" }),
      ],
      now
    );
    expect(counts).toEqual({ ready: 2, in_progress: 1, blocked: 2, done: 1, overdue: 1, total: 6 });
  });

  it("handles empty and non-actionable overdue states", () => {
    expect(deriveItQueueCounts([], now)).toEqual({ ready: 0, in_progress: 0, blocked: 0, done: 0, overdue: 0, total: 0 });
    const counts = deriveItQueueCounts([ref({ state: "blocked", due_date: "2026-09-01T09:00:00Z" })], now);
    expect(counts.overdue).toBe(0); // blocked is not actionable
  });
});

describe("upcomingStarts", () => {
  const people = [
    { twin_id: "a", name: "Alex", start_date: "2026-09-20T09:00:00Z", manager_name: "Jordan" },
    { twin_id: "b", name: "Priya", start_date: "2026-09-25T09:00:00Z", manager_name: null },
    { twin_id: "c", name: "No-Start", start_date: null, manager_name: null },
    { twin_id: "d", name: "Far", start_date: "2026-11-01T09:00:00Z", manager_name: null },
    { twin_id: "e", name: "Started", start_date: "2026-09-01T09:00:00Z", manager_name: null },
  ];

  it("returns starts within the window, oldest first, ignoring past/far/null dates", () => {
    const starts = upcomingStarts(people, now, 14);
    expect(starts.map((s) => s.twin_id)).toEqual(["a", "b"]);
    expect(starts[0].manager_name).toBe("Jordan");
  });
});

describe("filterItProvisioning (Batch 4.1)", () => {
  const names = new Map([
    ["t1", "Alex Chen"],
    ["t2", "Priya Shah"],
  ]);
  const items = [
    ref({ task_code: "it_provisioning", twin_id: "t1", state: "ready", due_date: "2026-09-10T09:00:00Z", title: "IT & Laptop Provisioning" }),
    ref({ task_code: "access_sso", twin_id: "t2", state: "blocked", title: "System Access & SSO Enrollment" }),
    ref({ task_code: "it_provisioning", twin_id: "t2", state: "done", title: "IT & Laptop Provisioning" }),
    ref({ task_code: "badge", twin_id: "t1", state: "in_progress", due_date: "2026-09-25T09:00:00Z", title: "Security Badge" }),
  ];

  it("filters by state", () => {
    expect(filterItProvisioning(items, names, "ready", "", now).map((t) => t.task_code)).toEqual(["it_provisioning"]);
    expect(filterItProvisioning(items, names, "blocked", "", now).map((t) => t.task_code)).toEqual(["access_sso"]);
    expect(filterItProvisioning(items, names, "done", "", now).map((t) => t.task_code)).toEqual(["it_provisioning"]);
  });

  it("flags actionable tasks past due as overdue", () => {
    const overdue = filterItProvisioning(items, names, "overdue", "", now);
    expect(overdue.map((t) => t.task_code)).toEqual(["it_provisioning"]); // ready + past due
    const later = filterItProvisioning(items, names, "overdue", "", "2026-09-05T09:00:00Z");
    expect(later).toEqual([]);
  });

  it("searches by employee name or task title", () => {
    expect(filterItProvisioning(items, names, "all", "alex", now).map((t) => t.task_code)).toEqual(["it_provisioning", "badge"]);
    expect(filterItProvisioning(items, names, "all", "sso", now).map((t) => t.task_code)).toEqual(["access_sso"]);
    expect(filterItProvisioning(items, names, "all", "nobody", now)).toEqual([]);
  });

  it("combines filter and search", () => {
    expect(filterItProvisioning(items, names, "blocked", "priya", now).map((t) => t.task_code)).toEqual(["access_sso"]);
    expect(filterItProvisioning(items, names, "blocked", "alex", now)).toEqual([]);
  });
});
