import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { notificationPrefsGet, notificationPrefsRestore, notificationPrefsUpdate, type NotificationPrefs } from "@/lib/api";

const GROUPED: { label: string; hint: string; keys: { key: keyof NotificationPrefs; label: string }[] }[] = [
  {
    label: "Action required",
    hint: "Work you own, approvals and reviews.",
    keys: [
      { key: "assignments", label: "Assignments & reviews" },
      { key: "overdue", label: "Overdue reminders" },
      { key: "due_soon", label: "Due-soon reminders" },
    ],
  },
  {
    label: "Deadlines",
    hint: "Task and assessment due dates.",
    keys: [{ key: "due_soon", label: "Due-soon reminders" }],
  },
  {
    label: "Assignments",
    hint: "New work assigned to you.",
    keys: [{ key: "assignments", label: "Assignment notifications" }],
  },
  {
    label: "Status updates",
    hint: "Outcomes and state changes.",
    keys: [{ key: "status_updates", label: "Status updates" }],
  },
  {
    label: "Personal reminders",
    hint: "Your own tasks and routines.",
    keys: [{ key: "personal_reminders", label: "Personal reminders" }],
  },
  {
    label: "Digests",
    hint: "Compact summaries in My Day.",
    keys: [
      { key: "daily_digest", label: "Daily digest" },
      { key: "weekly_digest", label: "Weekly digest" },
    ],
  },
];

export function NotificationPrefsDialog() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await notificationPrefsGet();
      setPrefs(res.prefs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load preferences");
    }
  };

  const toggle = async (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    if (typeof prefs[key] !== "boolean") return;
    const next = { ...prefs, [key]: !prefs[key] } as NotificationPrefs;
    setPrefs(next);
    try {
      await notificationPrefsUpdate({ [key]: next[key] });
      toast.success("Preference saved.");
    } catch (err) {
      setPrefs(prefs);
      toast.error(err instanceof Error ? err.message : "Could not save preference");
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const res = await notificationPrefsRestore();
      setPrefs(res.prefs);
      toast.success("Defaults restored.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore defaults");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPrefs(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
          <Bell className="mr-1.5 h-3.5 w-3.5" /> Preferences
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notification preferences</DialogTitle>
          <DialogDescription>
            Where you want alerts and reminders. Changes save to the server and follow you across devices.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {!prefs ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading preferences…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {GROUPED.map((g) => (
                <div key={g.label}>
                  <p className="text-xs font-extrabold uppercase tracking-wider text-foreground">{g.label}</p>
                  <p className="text-[11px] text-muted-foreground">{g.hint}</p>
                  <div className="mt-1.5 flex flex-col gap-2">
                    {g.keys.map((k) => (
                      <div key={k.key} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-foreground">{k.label}</span>
                        <Switch checked={Boolean(prefs[k.key])} onCheckedChange={() => void toggle(k.key)} aria-label={k.label} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider text-foreground">Quiet hours</p>
                <p className="text-[11px] text-muted-foreground">Non-urgent notifications pause between these local times.</p>
                <div className="mt-2 flex items-center gap-2">
                  <Switch checked={prefs.quiet_hours_enabled} onCheckedChange={(v) => void toggle("quiet_hours_enabled")} aria-label="Quiet hours" />
                  <span className="text-sm text-muted-foreground">Enabled</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="time" className="h-8 w-28" value={prefs.quiet_hours_start} onChange={(e) => void notificationPrefsUpdate({ quiet_hours_start: e.target.value }).then(() => setPrefs({ ...prefs, quiet_hours_start: e.target.value })).catch(() => undefined)} />
                  <Label className="text-xs text-muted-foreground">to</Label>
                  <Input type="time" className="h-8 w-28" value={prefs.quiet_hours_end} onChange={(e) => void notificationPrefsUpdate({ quiet_hours_end: e.target.value }).then(() => setPrefs({ ...prefs, quiet_hours_end: e.target.value })).catch(() => undefined)} />
                </div>
              </div>

              <div className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1.5 font-bold text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Mandatory alerts
                </p>
                <p className="mt-0.5">
                  Compliance, security and owned-workflow actions cannot be disabled in-app. You may mark them read, but the action stays in My Day until resolved. Authorized critical incidents may bypass quiet hours.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void restore()} disabled={busy}>
            Restore defaults
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
