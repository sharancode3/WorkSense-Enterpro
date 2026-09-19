import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Clock, RefreshCw, Search, Sun, Undo2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { DayGroup } from "@/components/my-day/day-group";
import { NewTaskDialog } from "@/components/my-day/new-task-dialog";
import { RhythmSection } from "@/components/my-day/rhythm-section";
import { DayItem } from "@/components/my-day/day-item";
import { GROUP_LABEL } from "@/components/my-day/format";
import { fetchMyDay, myDayCreateTask, myDayTransition, myDayUpdatePrefs, type MyDayItem, type MyDayResult } from "@/lib/api";
import { ROLE_BADGE_CLASS, ROLE_LABEL } from "@/lib/rbac";

type View = "today" | "week" | "all";
const VIEWS: { key: View; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All" },
];

const GROUP_KEYS: (keyof typeof GROUP_LABEL)[] = ["attention", "today", "in_progress", "waiting", "later", "completed"];

export default function MyDay() {
  const { role, twin, user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("today");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "waiting" | "done">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "workflow" | "personal" | "routine">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["my-day", user?.id ?? "anon", view],
    enabled: !!user && role !== "candidate",
    queryFn: () => fetchMyDay(view),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const result = q.data ?? null;

  const patch = (r: MyDayResult) => {
    qc.setQueryData(["my-day", user?.id ?? "anon", view], r);
    void qc.invalidateQueries({ queryKey: ["my-day-badge"] });
  };

  const markBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const runAction = async (item: MyDayItem, to: MyDayItem["status"], opts?: { note?: string; snooze_until?: string }) => {
    const key = item.id;
    const target = item.origin === "personal" ? "personal" : item.origin === "recurring_routine" ? "instance" : "source";
    markBusy(key, true);
    // Optimistic patch — reverted on failure by a refetch of server truth.
    qc.setQueryData<MyDayResult>(["my-day", user?.id ?? "anon", view], (old) =>
      old ? { ...old, items: old.items.map((i) => (i.id === key ? { ...i, status: to } : i)), dismissed_items: old.dismissed_items.filter((i) => i.id !== key) } : old
    );
    try {
      const res = await myDayTransition({ target, key, to, version: item.version, note: opts?.note, snooze_until: opts?.snooze_until });
      patch(res.result);
      if (res.already) toast.info("Already in that state.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
      await q.refetch();
    } finally {
      markBusy(key, false);
    }
  };

  const createTask = async (payload: Parameters<typeof myDayCreateTask>[0]) => {
    try {
      const res = await myDayCreateTask(payload);
      patch(res.result);
      toast.success("Personal task added.");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the task");
      return false;
    }
  };

  const toggleRollover = async () => {
    if (!result) return;
    try {
      const res = await myDayUpdatePrefs({ rollover_enabled: !result.prefs.rollover_enabled });
      patch(res.result);
      toast.success(result.prefs.rollover_enabled ? "Rollover turned off." : "Overdue personal tasks will roll over to today.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update preferences");
    }
  };

  const filtered = useMemo(() => {
    const all = result?.items ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((i) => {
      if (view === "today" && i.group === "later") return false;
      if (statusFilter === "open" && !["todo", "blocked", "in_progress"].includes(i.status)) return false;
      if (statusFilter === "waiting" && i.status !== "waiting") return false;
      if (statusFilter === "done" && i.status !== "done") return false;
      if (sourceFilter === "workflow" && (i.origin === "personal" || i.origin === "recurring_routine")) return false;
      if (sourceFilter === "personal" && i.origin !== "personal") return false;
      if (sourceFilter === "routine" && i.origin !== "recurring_routine") return false;
      if (needle && !`${i.title} ${i.subject} ${i.source.module}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [result, view, statusFilter, sourceFilter, search]);

  const linkableItems = useMemo(() => (result?.items ?? []).filter((i) => !i.inline_completable && i.deep_link), [result]);
  const hiddenItems = result?.dismissed_items ?? [];
  const tzName = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "local time";
    }
  }, []);

  if (!role || !twin) return null;

  const s = result?.summary;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <Sun className="h-3.5 w-3.5" /> My Day
            </span>
            <span className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE_CLASS[role]}`}>{ROLE_LABEL[role]}</span>
            <span className="rounded-md bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fictional demo data</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">My Day</h1>
          <p className="max-w-2xl text-muted-foreground">
            Your personal checklist plus the role work already assigned to you — every workflow item opens its canonical record.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {tzName}</span>
            {result && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> Synced {new Date(result.generated_at).toLocaleTimeString()}
              </span>
            )}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Refresh My Day">
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Focus summary strip */}
        {s && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {[
              { label: "Needs attention", value: s.attention, cls: "text-destructive" },
              { label: "Due today", value: s.due_today, cls: "text-foreground" },
              { label: "In progress", value: s.in_progress, cls: "text-foreground" },
              { label: "Waiting", value: s.waiting, cls: "text-muted-foreground" },
              { label: "Overdue", value: s.overdue_count, cls: s.overdue_count > 0 ? "text-destructive" : "text-muted-foreground" },
              { label: "Blocked", value: s.blocked_count, cls: s.blocked_count > 0 ? "text-destructive" : "text-muted-foreground" },
              { label: "Done today", value: s.completed_today, cls: "text-secondary" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg bg-white p-3 shadow-card">
                <p className={`text-2xl font-extrabold leading-none ${c.cls}`}>{c.value}</p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Time horizon">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                  view === v.key ? "bg-primary text-white" : "bg-white text-muted-foreground shadow-card hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your day…"
                className="h-9 w-44 pl-8 text-xs sm:w-56"
                aria-label="Search My Day items"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-9 w-32 text-xs" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="waiting">Waiting</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
              <SelectTrigger className="h-9 w-36 text-xs" aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="routine">Routines</SelectItem>
              </SelectContent>
            </Select>
            <NewTaskDialog linkableItems={linkableItems} onCreate={createTask} busy={false} />
          </div>
        </div>

        {/* Checklist */}
        <div className="mt-6 flex flex-col gap-4">
          {q.isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading your day…</p>}
          {q.isError && (
            <div className="rounded-lg bg-white p-6 text-center shadow-card">
              <p className="text-sm font-semibold text-destructive">Could not load My Day.</p>
              <p className="mt-1 text-xs text-muted-foreground">{q.error instanceof Error ? q.error.message : "Unknown error"}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Retry</Button>
            </div>
          )}
          {result && filtered.length === 0 && (
            <div className="rounded-lg bg-white p-10 text-center shadow-card">
              <p className="text-sm font-bold text-foreground">Nothing matches here.</p>
              <p className="mt-1 text-xs text-muted-foreground">Try a different filter or add a personal task.</p>
            </div>
          )}
          {result &&
            GROUP_KEYS.map((g) => (
              <DayGroup
                key={g}
                group={g}
                items={filtered.filter((i) => i.group === g)}
                todayKey={result.today_date}
                busyKey={busy}
                onAction={(item, to, opts) => void runAction(item, to, opts)}
              />
            ))}

          {/* Recently hidden — undo */}
          {hiddenItems.length > 0 && (
            <section aria-label="Recently hidden" className="rounded-lg border border-dashed border-border bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Hidden ({hiddenItems.length}) — dismissed or snoozed
              </p>
              <ul className="mt-2 divide-y divide-border">
                {hiddenItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-muted-foreground">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.status === "snoozed" ? "Snoozed" : "Dismissed"} · {item.source.module.replace(/_/g, " ")}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void runAction(item, "todo")} disabled={busy.has(item.id)}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Rhythm analytics */}
        {result && <RhythmSection result={result} />}

        {/* Personal rollover preference */}
        {result && (
          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-lg bg-white p-4 shadow-card">
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">Personal rollover</p>
              <p className="text-xs text-muted-foreground">
                When on, an unfinished personal task carries to today (its original date is preserved). Workflow due dates are never rewritten.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void toggleRollover()} disabled={q.isFetching}>
              {result.prefs.rollover_enabled ? "Turn off" : "Turn on"}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
