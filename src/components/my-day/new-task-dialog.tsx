import { useMemo, useState } from "react";
import { CalendarDays, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MyDayItem } from "@/lib/api";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultDue(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function NewTaskDialog({
  linkableItems,
  onCreate,
  busy,
}: {
  /** Source-backed items the caller can associate a personal task with. */
  linkableItems: MyDayItem[];
  onCreate: (payload: {
    title: string;
    notes?: string;
    due_at?: string | null;
    recurrence?: { freq: "daily" | "weekly"; weekdays?: number[]; day_time?: string } | null;
    assoc_item_id?: string | null;
  }) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState(defaultDue());
  const [freq, setFreq] = useState<"none" | "daily" | "weekly">("none");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [dayTime, setDayTime] = useState("09:00");
  const [assocId, setAssocId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => linkableItems.slice(0, 40), [linkableItems]);

  const reset = () => {
    setTitle("");
    setNotes("");
    setDue(defaultDue());
    setFreq("none");
    setWeekdays([1, 3, 5]);
    setDayTime("09:00");
    setAssocId("");
    setError(null);
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("Give the task a short title.");
      return;
    }
    const ok = await onCreate({
      title: title.trim(),
      notes: notes.trim() || undefined,
      due_at: due ? new Date(due).toISOString() : null,
      recurrence:
        freq === "none"
          ? null
          : {
              freq,
              weekdays: freq === "weekly" ? weekdays : [],
              day_time: dayTime || "09:00",
            },
      assoc_item_id: assocId || null,
    });
    if (ok) {
      reset();
      setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> Add personal task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a personal task</DialogTitle>
          <DialogDescription>
            Private to you — with optional recurrence and an optional link to a work item you can already see.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1 pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nt-title">Title</Label>
            <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Draft the team meeting notes" maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nt-notes">Notes (optional)</Label>
            <Textarea id="nt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, links, next steps…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nt-due">Due</Label>
            <Input id="nt-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Repeat</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["none", "daily", "weekly"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFreq(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                    freq === f ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {f === "none" ? "One-off" : f}
                </button>
              ))}
            </div>
            {freq === "weekly" && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                    className={`rounded px-2 py-1 text-[11px] font-bold ${weekdays.includes(i) ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            {freq !== "none" && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">At</span>
                <Input type="time" className="w-32" value={dayTime} onChange={(e) => setDayTime(e.target.value)} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nt-link">Link to a work item (optional)</Label>
            <Select value={assocId || "none"} onValueChange={(v) => setAssocId(v === "none" ? "" : v)}>
              <SelectTrigger id="nt-link" className="w-full">
                <SelectValue placeholder="Select an item from your scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No link</SelectItem>
                {options.map((it) => (
                  <SelectItem key={it.id} value={it.id} className="max-w-full truncate">
                    {it.title} · {it.source.module.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Link2 className="h-3 w-3" /> Only records in your role scope are listed.
            </p>
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>}
        </div>
        <DialogFooter className="items-center gap-2">
          <span className="mr-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarDays className="h-3 w-3" /> Recurring tasks become daily/weekly routines.
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
