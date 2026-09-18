// Batch 5 (5.2): hiring-level work queue for the recruitment workspace.
// Renders the six interviewer/recruiter queues returned by the assessment-queue
// backend function, with explicit query states (5.3) and rows that deep-link
// to the candidate workspace focused on the relevant session.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { assessmentQueue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { classifyQuery } from "@/lib/query-state";
import type {
  AwaitingReviewItem as AwaitingReviewRow,
  FailedJobItem as FailedJobRow,
  QueueSessionItem as QueueSessionRow,
} from "@/lib/contracts";

const SESSION_TYPE_LABEL: Record<string, string> = {
  work_sample: "Work sample",
  interview: "Interview",
  knowledge_assessment: "Knowledge assessment",
};

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted",
  expired: "Expired",
  cancelled: "Cancelled",
};

interface Props {
  /** Currently selected requisition ("" = none selected yet). */
  requisitionId: string;
  requisitionTitle: string;
  onOpenSession: (candidateTwinId: string, applicationId: string, sessionId: string, requisitionId: string) => void;
}

type Row = QueueSessionRow | AwaitingReviewRow | FailedJobRow;

function roleChip({ role }: { role: { title: string; application_code: string } }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate font-semibold text-foreground/80">{role.title}</span>
      <span className="shrink-0 font-mono text-[10px]">{role.application_code}</span>
    </span>
  );
}

function sessionRow(row: QueueSessionRow, onOpenSession: Props["onOpenSession"]) {
  const deadline =
    row.status === "submitted" && row.submitted_at
      ? `Submitted ${new Date(row.submitted_at).toLocaleString()}`
      : row.status === "expired"
        ? `Expired ${new Date(row.expires_at).toLocaleDateString()}`
        : `Open until ${new Date(row.expires_at).toLocaleDateString()}`;
  return (
    <button
      type="button"
      onClick={() => onOpenSession(row.candidate.id, row.role.application_id, row.session_id, row.role.requisition_id)}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 text-left transition-colors hover:bg-muted/60"
    >
      <div className="min-w-0">
        <p className="font-bold text-foreground">{row.candidate.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {SESSION_TYPE_LABEL[row.session_type] ?? row.session_type.replace(/_/g, " ")} · {row.blueprint_title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{deadline}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {roleChip(row)}
        <span
          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            row.status === "submitted"
              ? "bg-secondary text-white"
              : row.status === "in_progress"
                ? "bg-primary text-white"
                : "bg-accent text-foreground"
          }`}
        >
          {STATUS_LABEL[row.status] ?? row.status.replace(/_/g, " ")}
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </button>
  );
}

function awaitingReviewRow(row: AwaitingReviewRow, onOpenSession: Props["onOpenSession"]) {
  return (
    <button
      type="button"
      disabled={!row.session_id}
      onClick={() => row.session_id && onOpenSession(row.candidate.id, row.role.application_id, row.session_id, row.role.requisition_id)}
      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
      title={row.session_id ? "Open this evaluation for human confirmation" : "This evaluation has no linked session record"}
    >
      <div className="min-w-0">
        <p className="font-bold text-foreground">{row.candidate.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.blueprint_title} · evaluated {new Date(row.evaluated_at).toLocaleString()} · {row.model}
        </p>
        {row.review_required && (
          <p className="mt-0.5 text-[11px] font-semibold text-amber-600">
            Needs human confirmation before it supports evidence.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {roleChip(row)}
        <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Awaiting review
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </button>
  );
}

function failedJobRow(row: FailedJobRow, onOpenSession: Props["onOpenSession"]) {
  const label = row.error_code ? `${row.error_code}${row.error_message ? ` — ${row.error_message.slice(0, 120)}` : ""}` : row.error_message ?? "Unknown error";
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3">
      <div className="min-w-0">
        <p className="font-bold text-foreground">
          {row.session ? row.session.candidate.name : "Evaluation job"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.finished_at ? `Failed ${new Date(row.finished_at).toLocaleString()}` : "Failed"} · {label}
        </p>
        {row.session && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.session.blueprint_title} · {row.session.candidate.name}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.session ? roleChip(row.session) : <span className="text-xs text-muted-foreground">No session link recorded</span>}
        <span className="rounded-md bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Failed · retryable
        </span>
        {row.session && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenSession(row.session!.candidate.id, row.session!.role.application_id, row.session!.session_id, row.session!.role.requisition_id)}
          >
            <ExternalLink className="h-3.5 w-3.5" /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export function AssessmentWorkQueue({ requisitionId, requisitionTitle, onOpenSession }: Props) {
  const queue = useQuery({
    queryKey: ["assessment-queue"],
    queryFn: () => assessmentQueue(),
  });

  const state = classifyQuery({
    isPending: queue.isPending,
    isError: queue.isError,
    data: queue.data,
    error: queue.error,
    list: false,
  });

  const filter = (requisition_id: string) => (requisitionId ? requisition_id === requisitionId : true);

  const q = state.kind === "ready" || state.kind === "empty" ? state.data : null;
  const upcoming = q?.queues.upcoming_interviews.filter((s) => filter(s.role.requisition_id)) ?? [];
  const awaiting = q?.queues.invitations_awaiting_response.filter((s) => filter(s.role.requisition_id)) ?? [];
  const incomplete = q?.queues.incomplete_scorecards.filter((s) => filter(s.role.requisition_id)) ?? [];
  const submitted = q?.queues.submitted_assessments.filter((s) => filter(s.role.requisition_id)) ?? [];
  const awaitingReview = q?.queues.awaiting_reviewer_confirmation.filter((a) => (requisitionId ? a.role.requisition_id === requisitionId : true)) ?? [];
  const failed = q?.queues.failed_evaluation_jobs.filter((j) => (requisitionId ? (j.session?.role.requisition_id ?? "") === requisitionId : true)) ?? [];

  const total = upcoming.length + awaiting.length + incomplete.length + awaitingReview.length + failed.length;

  const Section = ({
    title,
    icon,
    count,
    tone,
    children,
  }: {
    title: string;
    icon: ReactNode;
    count: number;
    tone: string;
    children: ReactNode;
  }) => (
    <div className="rounded-lg bg-muted/60 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
        <span className={`ml-auto rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${count > 0 ? tone : "bg-white/60 text-muted-foreground"}`}>
          {count}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {count === 0 ? (
          <p className="rounded-md bg-white/60 p-2.5 text-xs text-muted-foreground">Nothing waiting here.</p>
        ) : (
          children
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-foreground">Hiring work queue</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Real session and evaluation rows, linked to candidate / application / role.{" "}
              {requisitionId ? (
                <>Showing <b className="text-foreground">{requisitionTitle}</b>. </>) : (
                <>Showing all roles. </>
              )}
              Nothing here is estimated.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {q?.generated_at && (
              <span className="text-xs text-muted-foreground">Updated {new Date(q.generated_at).toLocaleTimeString()}</span>
            )}
            <Button size="sm" variant="outline" onClick={() => void queue.refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
        {total > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            <b className="text-foreground">{total}</b> item(s) need attention.
          </p>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the hiring work queue…
        </p>
      )}
      {state.kind === "unavailable" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          <p>Could not reach the backend — the work queue is unavailable right now.</p>
          <Button size="sm" variant="outline" onClick={() => void queue.refetch()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}
      {state.kind === "forbidden" && (
        <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {state.message} The hiring work queue is available to Recruiters and HR roles only.
        </p>
      )}
      {state.kind === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          <p>{state.message}</p>
          <Button size="sm" variant="outline" onClick={() => void queue.refetch()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}
      {(state.kind === "ready" || state.kind === "empty") && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Section title="Upcoming interviews" icon={<CalendarClock className="h-4 w-4 text-primary" />} count={upcoming.length} tone="bg-primary text-white">
            {upcoming.map((s) => sessionRow(s, onOpenSession))}
          </Section>
          <Section title="Invitations awaiting response" icon={<Send className="h-4 w-4 text-primary" />} count={awaiting.length} tone="bg-accent text-foreground">
            {awaiting.map((s) => sessionRow(s, onOpenSession))}
          </Section>
          <Section title="Incomplete scorecards" icon={<FileText className="h-4 w-4 text-amber-500" />} count={incomplete.length} tone="bg-amber-500 text-white">
            {incomplete.map((s) => sessionRow(s, onOpenSession))}
          </Section>
          <Section title="Submitted assessments" icon={<ClipboardCheck className="h-4 w-4 text-secondary" />} count={submitted.length} tone="bg-secondary text-white">
            {submitted.map((s) => sessionRow(s, onOpenSession))}
          </Section>
          <Section title="Evaluations awaiting review" icon={<Cpu className="h-4 w-4 text-amber-500" />} count={awaitingReview.length} tone="bg-amber-500 text-white">
            {awaitingReview.map((a) => awaitingReviewRow(a, onOpenSession))}
          </Section>
          <Section title="Failed evaluation jobs" icon={<TriangleAlert className="h-4 w-4 text-destructive" />} count={failed.length} tone="bg-destructive text-white">
            {failed.map((j) => failedJobRow(j, onOpenSession))}
          </Section>
        </div>
      )}
    </div>
  );
}
