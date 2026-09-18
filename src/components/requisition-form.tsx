import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { requisitionCreate, type RequisitionCriterionInput } from "@/lib/api";

interface CriteriaRow extends RequisitionCriterionInput {
  key: number;
}

const emptyRow = (key: number, requirement: "required" | "preferred"): CriteriaRow => ({
  key,
  skill: "",
  target_proficiency: 3,
  requirement,
  weight: requirement === "required" ? 1 : 0.4,
  evidence_expectation: "",
});

export function RequisitionForm({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [level, setLevel] = useState(3);
  const [rows, setRows] = useState<CriteriaRow[]>([emptyRow(1, "required"), emptyRow(2, "preferred")]);
  const [busy, setBusy] = useState(false);
  const nextKey = Math.max(0, ...rows.map((r) => r.key)) + 1;

  const patch = (key: number, updater: (r: CriteriaRow) => void) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r };
        updater(next);
        return next;
      })
    );

  const submit = async () => {
    if (!title.trim() || !dept.trim()) {
      toast.error("Title and department are required.");
      return;
    }
    const criteria = rows
      .map((r) => ({ ...r }))
      .filter((r) => r.skill.trim().length > 0)
      .map((r) => ({
        skill: r.skill.trim(),
        target_proficiency: Math.min(5, Math.max(1, Math.round(Number(r.target_proficiency) || 3))),
        requirement: r.requirement,
        weight: Math.min(1, Math.max(0, Number(r.weight) || 0)),
        evidence_expectation: r.evidence_expectation.trim() || `Source artifact proving ${r.skill.trim()} — prior-role output, work sample, or verified reference.`,
      }));
    if (criteria.length === 0) {
      toast.error("Add at least one criterion with a skill name.");
      return;
    }
    if (!criteria.some((c) => c.requirement === "required")) {
      toast.error("At least one criterion must be Required.");
      return;
    }
    setBusy(true);
    try {
      await requisitionCreate({
        title: title.trim(),
        department: dept.trim(),
        seniority_level: level,
        required_skills: [],
        future_skills: [],
        criteria,
      });
      toast.success("Requisition created — criteria drive the Compare workspace.");
      setTitle("");
      setDept("");
      setRows([emptyRow(1, "required"), emptyRow(2, "preferred")]);
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>New requisition</DrawerTitle>
          <DrawerDescription>
            Weighted selection criteria replace flat skill lists: required vs preferred, weight, and the evidence each
            criterion expects. Criteria power the Compare workspace.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-2 md:px-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="req-title">Title</Label>
              <Input id="req-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. DevOps Engineer" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="req-dept">Department</Label>
              <Input id="req-dept" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. Platform" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="req-level">Seniority level</Label>
            <select
              id="req-level"
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="h-10 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
            >
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold text-foreground">Selection criteria</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRows((prev) => [...prev, emptyRow(nextKey, "required")])}
              >
                <Plus className="h-4 w-4" /> Add criterion
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Every criterion names a skill, a proficiency target, a requirement class, a weight (0–1) and the evidence
              that satisfies it.
            </p>
            <div className="flex flex-col gap-2">
              {rows.map((r) => (
                <div key={r.key} className="flex flex-col gap-2 rounded-lg border-2 border-border bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={r.skill}
                      onChange={(e) => patch(r.key, (x) => void (x.skill = e.target.value))}
                      placeholder="Skill, e.g. Kubernetes"
                      className="h-9 w-48 font-semibold"
                    />
                    <select
                      value={r.target_proficiency}
                      onChange={(e) => patch(r.key, (x) => void (x.target_proficiency = Number(e.target.value)))}
                      className="h-9 rounded-md bg-muted px-2 text-xs font-medium text-foreground"
                      title="Target proficiency"
                    >
                      {[1, 2, 3, 4, 5].map((p) => (
                        <option key={p} value={p}>
                          proficiency {p}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => patch(r.key, (x) => void (x.requirement = r.requirement === "required" ? "preferred" : "required"))}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                        r.requirement === "required" ? "bg-primary text-white" : "bg-muted text-foreground"
                      }`}
                    >
                      {r.requirement}
                    </button>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={r.weight}
                      onChange={(e) => patch(r.key, (x) => void (x.weight = Number(e.target.value)))}
                      className="h-9 w-20 text-xs"
                      aria-label="weight"
                    />
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      aria-label="Remove criterion"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <Input
                    value={r.evidence_expectation}
                    onChange={(e) => patch(r.key, (x) => void (x.evidence_expectation = e.target.value))}
                    placeholder="Evidence that satisfies this criterion (required)"
                    className="h-9 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DrawerFooter>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Required criteria become the skill graph match target.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create requisition
              </Button>
            </div>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
