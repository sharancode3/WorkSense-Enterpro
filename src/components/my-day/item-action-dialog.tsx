import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ItemActionMode = "complete" | "block" | "wait" | "snooze";

const MODE_COPY: Record<ItemActionMode, { title: string; description: string; confirm: string; placeholder: string }> = {
  complete: {
    title: "Mark as done",
    description: "Optional note / evidence reference for this completion.",
    confirm: "Mark done",
    placeholder: "e.g. emailed the evidence ref DOC-1042",
  },
  block: {
    title: "Mark as blocked",
    description: "Say what is blocking you — the item stays visible and is never counted against you.",
    confirm: "Mark blocked",
    placeholder: "What is blocking this?",
  },
  wait: {
    title: "Mark as waiting",
    description: "Say what you are waiting on and from whom — tracked separately from your workload.",
    confirm: "Mark waiting",
    placeholder: "Waiting on…",
  },
  snooze: {
    title: "Snooze until",
    description: "Hide this item until the date below. It returns automatically.",
    confirm: "Snooze",
    placeholder: "",
  },
};

export function ItemActionDialog({
  open,
  mode,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: ItemActionMode | null;
  onClose: () => void;
  onSubmit: (payload: { note?: string; snooze_until?: string }) => void;
}) {
  const [note, setNote] = useState("");
  const [until, setUntil] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);

  const isSnooze = mode === "snooze";
  const copy = mode ? MODE_COPY[mode] : null;

  const handleSubmit = () => {
    if (!mode) return;
    setBusy(true);
    try {
      if (isSnooze) {
        if (!until) return;
        const iso = new Date(until).toISOString();
        onSubmit({ snooze_until: iso });
      } else if (mode === "block" || mode === "wait") {
        if (!note.trim()) return;
        onSubmit({ note: note.trim() });
      } else {
        onSubmit({ note: note.trim() || undefined });
      }
      setNote("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setNote("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-1">
              {isSnooze ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="snooze-until">Show again on</Label>
                  <Input id="snooze-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="action-note">{mode === "complete" ? "Evidence / note (optional)" : "Reason"}</Label>
                  <Textarea id="action-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={copy.placeholder} />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { onClose(); setNote(""); }}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={busy}>
                {copy.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
