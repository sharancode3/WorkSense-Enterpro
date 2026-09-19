import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  ArrowUpRight,
  Check,
  CircleDashed,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MyDayItem } from "@/lib/api";
import { dueLabel, fmtLocal, originLabel, priorityChip } from "./format";
import { ItemActionDialog, type ItemActionMode } from "./item-action-dialog";

export function DayItem({
  item,
  todayKey,
  busy,
  hidden = false,
  onAction,
}: {
  item: MyDayItem;
  todayKey: string;
  busy?: boolean;
  /** Rendered in the "recently hidden" strip — only restore is offered. */
  hidden?: boolean;
  onAction: (to: MyDayItem["status"], opts?: { note?: string; snooze_until?: string }) => void;
}) {
  const [dialog, setDialog] = useState<ItemActionMode | null>(null);
  const inline = item.inline_completable;
  const done = item.status === "done";
  const isHidden = hidden || item.status === "dismissed" || item.status === "snoozed";

  const primaryAction = () => {
    if (busy) return;
    if (inline) {
      onAction(done ? "todo" : "done");
    } else if (item.deep_link) {
      window.location.href = item.deep_link;
    }
  };

  return (
    <li className="group flex items-start gap-3 py-2.5">
      {/* Leading control: inline check-off for personal/routine, deep-link for workflow. */}
      <button
        type="button"
        onClick={primaryAction}
        disabled={busy}
        aria-label={
          inline
            ? done
              ? `Reopen ${item.title}`
              : `Mark ${item.title} done`
            : item.deep_link
              ? `Open ${item.title} in its center`
              : item.title
        }
        title={
          inline
            ? done
              ? "Reopen"
              : "Mark done"
            : item.deep_link
              ? "Open the canonical record (completes there)"
              : undefined
        }
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          inline
            ? done
              ? "border-secondary bg-secondary text-white"
              : "border-border bg-white text-transparent hover:border-primary hover:text-primary/40"
            : "border-primary bg-primary/5 text-primary hover:bg-primary/10"
        }`}
      >
        {inline ? (
          done ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : busy ? (
            <CircleDashed className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          )
        ) : (
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        )}
      </button>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-bold ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.title}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${priorityChip(item.priority.band)}`}>
            {item.priority.band}
          </span>
          {item.origin === "personal" || item.origin === "recurring_routine" ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {originLabel(item)}
            </span>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {item.source.module.replace(/_/g, " ")}
            </span>
          )}
          {item.carried_from && (
            <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
              <RefreshCcw className="h-2.5 w-2.5" /> Carried from {fmtLocal(item.carried_from.original_due_at, { month: "short", day: "numeric" })}
            </span>
          )}
        </div>

        {item.subject !== "You" && (
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            {item.subject}
            {item.owner_label !== item.subject && ` · ${item.owner_label.toLowerCase()}`}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={item.overdue_days > 0 && !done ? "font-bold text-destructive" : "font-semibold"}>{dueLabel(item, todayKey)}</span>
          {item.recurrence && <span>{item.recurrence.freq === "daily" ? "Daily" : "Weekly"}</span>}
          {item.blocker && (
            <span className="inline-flex items-center gap-1 font-semibold text-destructive" title={`${item.blocker.reason} · owned by ${item.blocker.owner_label ?? "unknown"}`}>
              <ShieldAlert className="h-3 w-3" />
              Blocked{item.blocker.owner_label ? ` · ${item.blocker.owner_label}` : ""}
            </span>
          )}
          {item.evidence && item.evidence.text && (
            <span className="inline-flex items-center gap-1" title="Evidence / note recorded at completion">
              <Check className="h-3 w-3 text-secondary" /> {item.evidence.text}
            </span>
          )}
        </div>

        {item.blocker && !hidden && (
          <p className="mt-1 text-xs text-muted-foreground">
            {item.blocker.reason}. {item.blocker.next_action}.{item.blocker.downstream_impact ? ` Impact: ${item.blocker.downstream_impact}.` : ""}
          </p>
        )}
      </div>

      {/* Overflow actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 rounded-full p-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Actions for ${item.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{originLabel(item)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {inline && (
            <>
              {!done && (
                <DropdownMenuItem onClick={() => onAction("done")}>
                  <Check className="mr-2 h-4 w-4" /> Mark done
                </DropdownMenuItem>
              )}
              {done && (
                <DropdownMenuItem onClick={() => onAction("todo")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Reopen
                </DropdownMenuItem>
              )}
              {!done && item.status !== "in_progress" && (
                <DropdownMenuItem onClick={() => onAction("in_progress")}>
                  <Play className="mr-2 h-4 w-4" /> Mark in progress
                </DropdownMenuItem>
              )}
              {item.status === "in_progress" && (
                <DropdownMenuItem onClick={() => onAction("todo")}>
                  <Pause className="mr-2 h-4 w-4" /> Back to to-do
                </DropdownMenuItem>
              )}
              {!done && (
                <DropdownMenuItem onClick={() => setDialog("block")}>
                  <ShieldAlert className="mr-2 h-4 w-4" /> Block…
                </DropdownMenuItem>
              )}
              {!done && (
                <DropdownMenuItem onClick={() => setDialog("wait")}>
                  <AlarmClock className="mr-2 h-4 w-4" /> Waiting on someone…
                </DropdownMenuItem>
              )}
              {!done && (
                <DropdownMenuItem onClick={() => setDialog("snooze")}>
                  <RefreshCcw className="mr-2 h-4 w-4" /> Snooze…
                </DropdownMenuItem>
              )}
              {!done && (
                <DropdownMenuItem onClick={() => onAction("dismissed")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Dismiss
                </DropdownMenuItem>
              )}
            </>
          )}
          {!inline && (
            <>
              {item.deep_link && (
                <DropdownMenuItem onClick={() => (window.location.href = item.deep_link!)}>
                  <ArrowUpRight className="mr-2 h-4 w-4" /> Open in {item.source.module.replace(/_/g, " ")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDialog("snooze")}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Snooze…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("dismissed")}>
                <Undo2 className="mr-2 h-4 w-4" /> Dismiss from My Day
              </DropdownMenuItem>
            </>
          )}
          {isHidden && (
            <DropdownMenuItem onClick={() => onAction("todo")}>
              <Undo2 className="mr-2 h-4 w-4" /> Restore
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ItemActionDialog
        open={dialog !== null}
        mode={dialog}
        onClose={() => setDialog(null)}
        onSubmit={(payload) => {
          if (dialog === "block") onAction("blocked", payload);
          else if (dialog === "wait") onAction("waiting", payload);
          else if (dialog === "snooze") onAction("snoozed", payload);
          else onAction("done", payload);
          setDialog(null);
        }}
      />
    </li>
  );
}
