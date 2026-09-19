import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Bell, BellRing, CheckCheck, Inbox, Moon, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { NotificationPrefsDialog } from "./notification-prefs-dialog";
import { fetchNotificationList, fetchNotificationSummary, notificationDismiss, notificationMarkAllRead, notificationMarkRead, notificationSnooze, type NotificationRow } from "@/lib/api";

export function NotificationBell() {
  const { twin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "action" | "updates">("all");
  const twinId = twin?.id ?? "none";

  const key = ["notifications", twinId];
  const summaryKey = ["notifications-summary", twinId];

  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchNotificationList(60),
    enabled: !!twin,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: fetchNotificationSummary,
    enabled: !!twin,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Real-time delivery: new/changed notifications for THIS twin invalidate the
  // list + badge instantly, across tabs/sessions. Cleanup prevents duplicates.
  useEffect(() => {
    if (!twin) return;
    const channel = supabase
      .channel(`notifications-${twin.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_twin_id=eq.${twin.id}` }, () => {
        void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: summaryKey });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Reconnect fallback: bounded refetch on focus/manual refresh handles it.
          void qc.invalidateQueries({ queryKey: key });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twin?.id]);

  const unread = summary.data?.unread_total ?? 0;
  const criticalUnread = summary.data?.critical_unread ?? 0;
  const badge = unread > 99 ? "99+" : unread > 0 ? String(unread) : "";

  const markAllRead = async () => {
    try {
      await notificationMarkAllRead();
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: summaryKey })]);
      toast.success("All visible notifications marked as read.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark as read");
    }
  };

  const onRead = async (n: NotificationRow) => {
    if (!n.read_at) {
      try {
        await notificationMarkRead(n.id);
      } catch {
        /* non-fatal */
      }
    }
    if (n.deep_link) window.location.href = n.deep_link;
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: summaryKey });
    setOpen(false);
  };

  const snooze = async (n: NotificationRow) => {
    const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    try {
      await notificationSnooze(n.id, until);
      toast.success("Snoozed until tomorrow.");
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not snooze");
    }
  };

  const dismiss = async (n: NotificationRow) => {
    try {
      await notificationDismiss(n.id);
      toast.success("Dismissed.");
      void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not dismiss");
    }
  };

  const visibleItems = useMemo(() => {
    const rows = list.data?.items ?? [];
    if (tab === "action") return rows.filter((r) => r.action_required && !r.resolved_at);
    if (tab === "updates") return rows.filter((r) => !r.action_required);
    return rows;
  }, [list.data, tab]);

  const grouped = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const yKey = new Date(Date.now() - 86400000);
    const yesterdayKey = `${yKey.getFullYear()}-${String(yKey.getMonth() + 1).padStart(2, "0")}-${String(yKey.getDate()).padStart(2, "0")}`;
    const by: Record<string, NotificationRow[]> = { today: [], yesterday: [], earlier: [] };
    for (const r of visibleItems) {
      const k = r.created_at.slice(0, 10);
      if (k === todayKey) by.today.push(r);
      else if (k === yesterdayKey) by.yesterday.push(r);
      else by.earlier.push(r);
    }
    return by;
  }, [visibleItems]);

  const drawer = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-extrabold text-foreground">Notifications</p>
          {unread > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white" aria-label={`${unread} unread`}>
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <NotificationPrefsDialog />
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => void markAllRead()} disabled={unread === 0}>
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Mark visible as read
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border px-4 py-2" role="tablist" aria-label="Notification filters">
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
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${tab === t.key ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}
        {list.isError && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-semibold text-destructive">Could not load notifications.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void list.refetch()}>Retry</Button>
          </div>
        )}
        {list.data && visibleItems.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-bold text-foreground">You're all caught up</p>
            <p className="mt-0.5 text-xs text-muted-foreground">New events will appear here in real time.</p>
          </div>
        )}
        {list.data &&
          visibleItems.length > 0 &&
          (["today", "yesterday", "earlier"] as const).map((g) =>
            grouped[g].length > 0 ? (
              <div key={g} className="mt-2">
                <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {g === "today" ? "Today" : g === "yesterday" ? "Yesterday" : "Earlier"}
                </p>
                <ul className="mt-1 flex flex-col">
                  {grouped[g].map((n) => (
                    <NotificationRowItem key={n.id} n={n} onRead={onRead} onSnooze={snooze} onDismiss={dismiss} />
                  ))}
                </ul>
              </div>
            ) : null
          )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5">
        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="block rounded-md bg-muted px-3 py-2 text-center text-xs font-bold text-foreground hover:bg-muted/70"
        >
          View notification center
        </Link>
      </div>
    </div>
  );

  const trigger = (
    <Button
      variant="secondary"
      size="sm"
      className="relative"
      aria-label={`Notifications, ${unread} unread`}
      title="Notifications"
    >
      {unread > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {badge && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold leading-none text-white">
          {badge}
        </span>
      )}
      {criticalUnread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-white" aria-label={`${criticalUnread} urgent`} title="Urgent items unread" />
      )}
    </Button>
  );

  // Match the desktop breakpoint: render the popover on md+ and the full-height
  // sheet below it. Rendering BOTH (CSS-hidden) lets the Radix sheet portal open
  // on desktop too and cover the popover, which reads as an auto-close.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return isDesktop ? (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0" aria-label="Notifications">
        <div className="h-[520px]">{drawer}</div>
      </PopoverContent>
    </Popover>
  ) : (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="sr-only">Notifications</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{drawer}</div>
      </SheetContent>
    </Sheet>
  );
}

/** SSR-safe media query hook — tracks the desktop breakpoint reactively. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function NotificationRowItem({
  n,
  onRead,
  onSnooze,
  onDismiss,
}: {
  n: NotificationRow;
  onRead: (n: NotificationRow) => void;
  onSnooze: (n: NotificationRow) => void;
  onDismiss: (n: NotificationRow) => void;
}) {
  const navigate = useNavigate();
  const unread = !n.read_at && !n.resolved_at && !n.dismissed_at;
  const severityCls =
    n.severity === "critical"
      ? "border-l-destructive"
      : n.severity === "high"
        ? "border-l-accent"
        : unread
          ? "border-l-primary"
          : "border-l-border";

  return (
    <li
      role="button"
      tabIndex={0}
      aria-label={`${n.title}${unread ? ", unread" : ""}`}
      onClick={() => void onRead(n)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void onRead(n);
      }}
      className={`group relative flex cursor-pointer items-start gap-2.5 rounded-md border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${severityCls} ${unread ? "bg-white" : "bg-transparent"}`}
    >
      {unread && <span className="absolute left-1 top-3 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`text-[13px] font-bold ${n.action_required && unread ? "text-foreground" : "text-foreground"}`}>{n.title}</p>
          {n.severity === "critical" && n.action_required && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">Urgent</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {n.source_module.replace(/_/g, " ")}
          {n.deadline ? ` · ${new Date(n.deadline).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Actions for ${n.title}`}>
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => void onSnooze(n)}>
            <Moon className="mr-2 h-4 w-4" /> Snooze until tomorrow
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void onDismiss(n)}>
            <Inbox className="mr-2 h-4 w-4" /> Dismiss
          </DropdownMenuItem>
          {n.deep_link && (
            <DropdownMenuItem onClick={() => navigate(n.deep_link!)}>
              <AlarmClock className="mr-2 h-4 w-4" /> Open linked record
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
