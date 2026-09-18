import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, ClipboardList, Database, FileCheck2, KeyRound, ListChecks, RefreshCw, ShieldAlert, Users } from "lucide-react";
import type { WorkItem, WorkItemType, WorkGroup, MyWorkResult } from "@/lib/api";
import { Button } from "@/components/ui/button";

const TYPE_ICON: Record<WorkItemType, typeof ListChecks> = {
  onboarding_task: ListChecks,
  provisioning_request: KeyRound,
  recommendation_task: ClipboardList,
  approval_request: FileCheck2,
  review_case: Users,
  candidate_next_step: Briefcase,
  assessment_session: ClipboardList,
  requisition_attention: Briefcase,
  data_quality_alert: Database,
  policy_escalation: ShieldAlert,
};

const GROUP_LABEL: Record<WorkGroup, string> = {
  attention: "Needs your attention",
  ready: "Ready for you",
  waiting: "Waiting on others",
};

const GROUP_TONE: Record<WorkGroup, string> = {
  attention: "text-destructive",
  ready: "text-secondary",
  waiting: "text-muted-foreground",
};

const ACTION_LABEL: Record<string, string> = {
  complete: "Complete",
  resolve_blocker: "Resolve blocker",
  report_blocker: "Report blocker",
  review: "Review",
  approve: "Approve",
  reject: "Reject",
  advance: "Advance",
  send_reminder: "Remind",
  retry: "Retry",
  view_plan: "View plan",
};

function WorkItemCard({ item }: { item: WorkItem }) {
  const Icon = TYPE_ICON[item.type];
  const actionLabel = item.authorized_actions[0] ? ACTION_LABEL[item.authorized_actions[0]] ?? "Open" : "Open";
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-white p-4 shadow-card transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.subject}
              {item.due_at ? ` · due ${new Date(item.due_at).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {item.status_label}
        </span>
      </div>

      {item.blocker && (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs leading-snug text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {item.blocker}
        </p>
      )}
      {item.priority_reason && !item.blocker && (
        <p className="rounded-md bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-foreground">{item.priority_reason}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {item.owner_label}
          {item.source.version ? ` · ${item.source.workflow} v${item.source.version}` : ` · ${item.source.workflow}`}
        </span>
        <Button size="sm" variant={item.group === "attention" ? "default" : "secondary"} asChild>
          <Link to={item.deep_link}>
            {actionLabel} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function WorkGroupList({ group, items }: { group: WorkGroup; items: WorkItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${GROUP_TONE[group]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${group === "attention" ? "bg-destructive" : group === "ready" ? "bg-secondary" : "bg-muted-foreground"}`} />
        {GROUP_LABEL[group]} · {items.length}
      </h2>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <WorkItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

/**
 * Unified "My work" feed. Empty state renders ONLY after a successful query
 * returned zero items; failures show unavailable + retry, never an empty
 * message beneath real work.
 */
export function MyWorkFeed({ feed, loading, error, onRetry }: { feed: MyWorkResult | null; loading: boolean; error: Error | null; onRetry: () => void }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading assigned work">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-destructive/10 px-6 py-10 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" strokeWidth={2} />
        <p className="text-sm font-semibold text-destructive">Assigned work is unavailable right now.</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  if (!feed) return null;

  if (feed.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-12 text-center shadow-card">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CheckCircle2 className="h-6 w-6" strokeWidth={2} />
        </span>
        <p className="text-base font-extrabold text-foreground">No assigned work right now</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Nothing in scope needs your attention. Assigned items from onboarding, approvals, recommendations, and
          candidate workflows will appear here.
        </p>
      </div>
    );
  }

  const groups: WorkGroup[] = ["attention", "ready", "waiting"];
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <WorkGroupList key={g} group={g} items={feed.items.filter((i) => i.group === g)} />
      ))}
    </div>
  );
}
