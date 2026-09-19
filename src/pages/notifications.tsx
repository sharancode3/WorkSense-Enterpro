import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CheckCheck, Inbox, Moon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { NotificationPrefsDialog } from "@/components/notification-prefs-dialog";
import { useAuth } from "@/contexts/auth-context";
import { fetchNotificationList, notificationDismiss, notificationMarkAllRead, notificationMarkRead, notificationSnooze, type NotificationRow } from "@/lib/api";

type Tab = "all" | "action" | "updates";

const GROUP_LABEL: Record<string, string> = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };

export default function Notifications() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("all");

  const q = useQuery({
    queryKey: ["notifications", user?.id ?? "anon", "center"],
    queryFn: () => fetchNotificationList(100),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const markRead = async (n: NotificationRow) => {
    if (!n.read_at) {
      try {
        await notificationMarkRead(n.id);
      } catch {
        /* ignore */
      }
    }
    if (n.deep_link) {
      window.location.href = n.deep_link;
    } else {
      void q.refetch();
    }
  };

  const snooze = async (n: NotificationRow) => {
    try {
      await notificationSnooze(n.id, new Date(Date.now() + 24 * 3600 * 1000).toISOString());
      toast.success("Snoozed until tomorrow.");
      void q.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not snooze");
    }
  };

  const dismiss = async (n: NotificationRow) => {
    try {
      await notificationDismiss(n.id);
      toast.success("Dismissed.");
      void q.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : err instanceof Object ? String((err as { message?: string }).message ?? "") : "Could not dismiss");
    }
  };

  const visible = useMemo(() => {
    const rows = q.data?.items ?? [];
    if (tab === "action") return rows.filter((r) => r.action_required && !r.resolved_at);
    if (tab === "updates") return rows.filter((r) => !r.action_required);
    return rows;
  }, [q.data, tab]);

  const grouped = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const y = new Date(Date.now() - 86400000);
    const yesterdayKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    const by: Record<string, NotificationRow[]> = { today: [], yesterday: [], earlier: [] };
    for (const r of visible) {
      const k = r.created_at.slice(0, 10);
      if (k === todayKey) by.today.push(r);
      else if (k === yesterdayKey) by.yesterday.push(r);
      else by.earlier.push(r);
    }
    return by;
  }, [visible]);

  const markAllRead = async () => {
    try {
      await notificationMarkAllRead();
      toast.success("All visible notifications marked as read.");
      void q.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark as read");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Bell className="h-3.5 w-3.5" /> Notifications
          </span>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Notification center</h1>
              <p className="mt-1 text-muted-foreground">Events from your workflows — every actionable item deep-links to its record.</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationPrefsDialog />
              <Button variant="outline" size="sm" onClick={() => void markAllRead()} disabled={(q.data?.unread_total ?? 0) === 0}>
                <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-1" role="tablist" aria-label="Filter notifications">
          {([
            { key: "all", label: "All" },
            { key: "action", label: "Action required" },
            { key: "updates", label: "Updates" },
          ] as const).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold ${tab === t.key ? "bg-primary text-white" : "bg-white text-muted-foreground shadow-card hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {q.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading notifications…</p>}
          {q.isError && (
            <div className="rounded-lg bg-white p-8 text-center shadow-card">
              <p className="text-sm font-semibold text-destructive">Could not load notifications.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Retry</Button>
            </div>
          )}
          {q.data && visible.length === 0 && (
            <div className="rounded-lg bg-white p-12 text-center shadow-card">
              <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-bold text-foreground">No notifications here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Events that need your attention will appear as they happen.</p>
            </div>
          )}
          {q.data &&
            visible.length > 0 &&
            (["today", "yesterday", "earlier"] as const).map((g) =>
              grouped[g].length > 0 ? (
                <section key={g} aria-label={GROUP_LABEL[g]} className="rounded-lg bg-white p-4 shadow-card">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[g]}</p>
                  <ul className="mt-2 divide-y divide-border">
                    {grouped[g].map((n) => (
                      <li key={n.id} className="flex items-start gap-3 py-3">
                        <button
                          type="button"
                          onClick={() => void markRead(n)}
                          className="min-w-0 flex-1 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-bold ${n.read_at || n.resolved_at ? "text-muted-foreground" : "text-foreground"}`}>{n.title}</p>
                            {n.severity === "critical" && n.action_required && !n.resolved_at && (
                              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">Urgent</span>
                            )}
                            {n.action_required && !n.resolved_at && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Action</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {n.source_module.replace(/_/g, " ")} · {new Date(n.created_at).toLocaleString()}
                            {n.deadline ? ` · due ${new Date(n.deadline).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                          </p>
                        </button>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void snooze(n)}>
                            <Moon className="mr-1 h-3 w-3" /> Snooze
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void dismiss(n)}>
                            Dismiss
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            )}
        </div>
      </div>
    </AppShell>
  );
}
