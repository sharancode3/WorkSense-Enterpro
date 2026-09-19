import type { MyDayItem } from "@/lib/api";

/** Local human time from an ISO instant. */
export function fmtLocal(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...opts }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/** Short weekday+day label for a YYYY-MM-DD key. */
export function dayKeyLabel(dateKey: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${dateKey}T12:00:00.000Z`));
  } catch {
    return dateKey;
  }
}

export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Human due label relative to the caller's today. */
export function dueLabel(item: MyDayItem, todayKey: string): string {
  if (item.status === "done") return "Done";
  if (!item.due_key) return "No due date";
  if (item.overdue_days > 0) return `Overdue by ${item.overdue_days}d`;
  if (item.due_key === todayKey) return "Due today";
  if (item.due_key === addDaysKey(todayKey, 1)) return "Due tomorrow";
  return `Due ${fmtLocal(item.due_at, { weekday: "short" })}`;
}

/** Priority chip styling — semantic, color implies state only. */
export function priorityChip(band: MyDayItem["priority"]["band"]): string {
  switch (band) {
    case "Critical":
      return "bg-destructive/10 text-destructive";
    case "Due soon":
      return "bg-accent/15 text-foreground";
    case "Waiting":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/** Origin chip styling. */
export function originLabel(item: MyDayItem): string {
  switch (item.origin) {
    case "personal":
      return "Personal";
    case "recurring_routine":
      return item.recurrence?.freq === "weekly" ? "Weekly routine" : "Daily routine";
    case "approval":
      return "Approval";
    case "review":
      return "Review";
    case "assessment":
      return "Assessment";
    case "requisition":
      return "Requisition";
    case "data_quality":
      return "Data quality";
    default:
      return "Workflow";
  }
}

export const GROUP_LABEL: Record<string, string> = {
  attention: "Needs attention",
  today: "Due today",
  in_progress: "In progress",
  waiting: "Waiting on others",
  later: "Later this week",
  completed: "Completed today",
};

export const GROUP_HINT: Record<string, string> = {
  attention: "Overdue, blocked, or awaiting your decision",
  today: "Ready for you to act on today",
  in_progress: "Work you have started",
  waiting: "Held by someone else — tracked, not counted against you",
  later: "Scheduled for the rest of the week",
  completed: "Checked off earlier today",
};
