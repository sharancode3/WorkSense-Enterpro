import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Download,
  FileText,
  FlaskConical,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listDemoResumes,
  resumeDownload,
  resumeImport,
  resumeReview,
  type DemoResumeFixture,
  type ResumeImportResult,
  type ResumeReviewPayload,
  type ResumeReviewSaveResult,
} from "@/lib/api";
import { toast } from "sonner";

const TIERS = ["FOUNDATIONAL", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;

const ASSOC_META: Record<string, { label: string; chip: string }> = {
  explicit: { label: "Explicit claim", chip: "bg-primary text-white" },
  inferred: { label: "Inferred", chip: "bg-muted text-foreground" },
  unsupported: { label: "Unsupported", chip: "bg-destructive/10 text-destructive" },
};

function HighlightedSource({ text, query }: { text: string; query: string | null }) {
  const parts = useMemo(() => {
    if (!query) return [text];
    const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
    if (idx === -1) return [text];
    return [text.slice(0, idx), text.slice(idx, idx + query.trim().length), text.slice(idx + query.trim().length)];
  }, [text, query]);
  if (parts.length === 1) return <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">{text}</p>;
  return (
    <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
      {parts[0]}
      <mark className="rounded bg-primary/20 px-0.5 text-primary">{parts[1]}</mark>
      {parts[2]}
    </p>
  );
}

interface Props {
  twin: { id: string; name: string };
  reqId?: string;
  onSaved?: (res: ResumeReviewSaveResult) => void;
  onManualImport: () => void;
}

export function ResumeReviewFlow({ twin, reqId, onSaved, onManualImport }: Props) {
  const [stage, setStage] = useState<"upload" | "importing" | "review" | "lowtext" | "saved" | "error">("upload");
  const [result, setResult] = useState<ResumeImportResult | null>(null);
  const [review, setReview] = useState<ResumeReviewPayload | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [demos, setDemos] = useState<DemoResumeFixture[]>([]);
  const [saveRes, setSaveRes] = useState<ResumeReviewSaveResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    void listDemoResumes().then(setDemos).catch(() => setDemos([]));
  }, []);

  // Phase 15: zero-crash intake — if the backend is unreachable (401/503/non-2xx),
  // preset resumes fall back to the static offline fixture in public/resume-fixtures
  // and populate the review state instantly. Custom uploads show an inline alert.
  const loadOffline = async (demo: DemoResumeFixture): Promise<boolean> => {
    try {
      const jsonPath = demo.file.replace(/\.(pdf|docx)$/i, ".json");
      const res = await fetch(`${import.meta.env.BASE_URL ?? "/"}resume-fixtures/${jsonPath}`);
      if (!res.ok) throw new Error(`Offline fixture missing: ${jsonPath}`);
      const fixture = (await res.json()) as {
        low_text?: boolean;
        extracted_text?: string;
        warnings?: { conflicts?: string[]; overlaps?: string[] };
        review?: ResumeReviewPayload | null;
      };
      const base: ResumeImportResult = {
        ok: true,
        document_id: `offline:${demo.file}`,
        file_name: demo.file,
        status: fixture.low_text ? "low_text" : "review",
        low_text: fixture.low_text === true,
        ocr_available: false,
        page_count: null,
        extracted_text: fixture.extracted_text ?? "",
        warnings: fixture.warnings,
      };
      setResult(base);
      if (base.low_text) {
        setStage("lowtext");
      } else {
        setReview(structuredClone(fixture.review ?? { full_name: twin.name, roles: [], education: [], certifications: [], projects: [], skill_claims: [], ambiguities: [], conflicts: [] }));
        setStage("review");
      }
      toast.success(`Loaded ${demo.label} in offline demo mode.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Offline fallback failed");
      return false;
    }
  };

  const runUpload = async (file: File, demo?: DemoResumeFixture) => {
    if (file.size === 0) {
      toast.error("The file is empty.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error(`File is ${(file.size / 1048576).toFixed(1)} MiB — the limit is 4 MiB.`);
      return;
    }
    setStage("importing");
    setError(null);
    setDismissed(new Set());
    try {
      const res = await resumeImport(twin.id, reqId, file);
      setResult(res);
      if (res.low_text) {
        setStage("lowtext");
        return;
      }
      if (res.duplicate) {
        setStage("review");
        setReview(null);
        return;
      }
      setReview(structuredClone(res.review ?? { full_name: twin.name, roles: [], education: [], certifications: [], projects: [], skill_claims: [], ambiguities: [], conflicts: [] }));
      setStage("review");
      if (res.job_id) toast.success(`Extraction done (job ${res.job_id.slice(0, 8)}).`);
    } catch (err) {
      // Preset resume + unreachable AI engine -> offline fixture, never a crash.
      if (demo) {
        const ok = await loadOffline(demo);
        if (!ok) setStage("error");
        return;
      }
      setStage("error");
      setError("AI Engine unreachable. Use a preset resume or paste text manually below.");
    }
  };

  const runDemo = async (demo: DemoResumeFixture) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL ?? "/"}resume-fixtures/${demo.file}`);
      if (!res.ok) throw new Error("Could not load the demo resume.");
      const blob = await res.blob();
      await runUpload(new File([blob], demo.file, { type: demo.file.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), demo);
    } catch (err) {
      // The preset file itself could not be fetched — fall back to the offline fixture.
      setStage("importing");
      const ok = await loadOffline(demo);
      if (!ok) setStage("error");
    }
  };

  const patch = (updater: (r: ResumeReviewPayload) => void) => {
    setReview((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      updater(next);
      return next;
    });
  };

  const save = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resumeReview(result!.document_id, twin.id, reqId, review);
      setSaveRes(res);
      setStage("saved");
      onSaved?.(res);
      toast.success(`Version ${res.version} saved — ${res.claims_saved} claims recorded as extracted (not verified).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const fetchDownload = async () => {
    if (!result || downloadUrl) return;
    const res = await resumeDownload(result.document_id);
    setDownloadUrl(res.url);
  };

  const conflicts = result?.warnings?.conflicts ?? review?.conflicts ?? [];
  const overlaps = review?.computed?.overlap_warnings ?? result?.warnings?.overlaps ?? [];
  const unsupported = review?.computed?.claims_unsupported ?? review?.skill_claims?.filter((c) => c.association === "unsupported").length ?? 0;
  const visibleWarnings = [...conflicts, ...overlaps].filter((w) => !dismissed.has(w));

  if (stage === "importing") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Uploading, parsing and extracting evidence…</p>
      </div>
    );
  }

  if (stage === "lowtext") {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="rounded-lg border-2 border-dashed border-foreground/20 bg-muted/40 p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-bold text-foreground">Very little extractable text was found</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            This looks like a scanned or image-only document. OCR is not available in this deployment — no automatic
            extraction is claimed for scanned files. You can paste the resume text below instead.
          </p>
        </div>
        <Button variant="secondary" onClick={onManualImport}>
          <FileText className="h-4 w-4" /> Paste text instead (manual import)
        </Button>
        {demos.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Or try another demo resume</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {demos.map((d) => (
                <Button key={d.file} size="sm" variant="outline" onClick={() => void runDemo(d)}>
                  {d.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (stage === "saved" && saveRes) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="rounded-lg bg-muted p-6">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-6 w-6 text-secondary" />
            <p className="text-lg font-extrabold text-foreground">Evidence review saved · version {saveRes.version}</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {saveRes.claims_saved} skill claims recorded as <b className="text-foreground">extracted</b> (low rigor) with{" "}
            {saveRes.evidence_saved} evidence items. Claims stay claims until independently supported — uploading never
            verifies skills.
          </p>
          {saveRes.fit && (
            <p className="mt-3 text-sm">
              Refreshed deterministic fit: <b className="text-primary">{Math.round(saveRes.fit.score * 100)}/100</b>
            </p>
          )}
          {saveRes.conflicts_resolved.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Conflicts surfaced for review: {saveRes.conflicts_resolved.length}.</p>
          )}
        </div>
        <Button variant="secondary" onClick={() => setStage("upload")}>
          <RotateCcw className="h-4 w-4" /> Upload another resume
        </Button>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-destructive/40 bg-destructive/5 p-6 text-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
          <p className="max-w-md text-sm font-semibold text-foreground">
            AI Engine unreachable. Use a preset resume or paste text manually below.
          </p>
          <p className="max-w-md text-xs text-muted-foreground">{error ?? "Import failed."}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={onManualImport}>
            <FileText className="h-4 w-4" /> Paste text manually
          </Button>
          <Button variant="outline" onClick={() => setStage("upload")}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "review" && result && !review) {
    // duplicate upload — show the existing record instead of a second extraction
    return (
      <div className="flex flex-col gap-4 py-4">
        <div className="rounded-lg bg-muted p-6">
          <p className="text-lg font-extrabold text-foreground">Duplicate upload detected</p>
          <p className="mt-1 text-sm text-muted-foreground">
            “{result.file_name}” was already uploaded for this candidate (content checksum identical). No duplicate
            candidate or evidence was created.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Status: {result.status} · {result.page_count ?? "?"} page(s) · uploaded{" "}
            {result.versions?.[0] ? new Date(result.versions[0].created_at).toLocaleDateString() : "earlier"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setStage("upload")}>
            <RotateCcw className="h-4 w-4" /> Upload a different file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* upload pane */}
      {stage === "upload" && (
        <>
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-foreground/20 bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/60 hover:bg-muted/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void runUpload(f);
            }}
          >
            <UploadCloud className="h-8 w-8 text-primary" />
            <span className="text-sm font-bold text-foreground">Drop a PDF or DOCX resume here</span>
            <span className="text-xs text-muted-foreground">or click to browse · max 4 MiB · private storage, never public</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runUpload(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {demos.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fictional demo resumes</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {demos.map((d) => (
                  <Button key={d.file} size="sm" variant="outline" onClick={() => void runDemo(d)} title={d.label}>
                    <FileText className="h-3.5 w-3.5" /> {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button type="button" onClick={onManualImport} className="text-xs font-semibold text-primary">
              Prefer pasting text? Use manual import
            </button>
            <span className="text-[11px] text-muted-foreground">All demo data is fictional (example.com only).</span>
          </div>
        </>
      )}

      {/* review pane */}
      {stage === "review" && review && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={review.full_name}
                onChange={(e) => patch((r) => void (r.full_name = e.target.value))}
                className="w-52 font-bold"
                aria-label="Candidate full name"
              />
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {result!.file_name} · {result!.page_count ?? "?"} page(s)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void fetchDownload()}>
                <Download className="h-4 w-4" />
                {downloadUrl ? "Original" : "Original file"}
              </Button>
              {downloadUrl && (
                <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary">
                  open (60s link)
                </a>
              )}
            </div>
          </div>

          {visibleWarnings.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Ambiguity & conflict warnings ({visibleWarnings.length})
              </p>
              {visibleWarnings.map((w) => (
                <div key={w} className="flex items-start justify-between gap-2 text-xs text-foreground/80">
                  <span>{w}</span>
                  <button type="button" onClick={() => setDismissed((s) => new Set(s).add(w))} className="shrink-0 font-semibold text-muted-foreground hover:text-foreground">
                    dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
          {unsupported > 0 && (
            <p className="text-xs text-muted-foreground">
              {unsupported} claim(s) marked <b className="text-destructive">unsupported</b> (quote not found in source). Fix or remove them before saving — fabricated quotes are rejected.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* source pane */}
            <div className="flex max-h-[60vh] flex-col overflow-hidden rounded-lg border-2 border-border">
              <div className="flex items-center justify-between border-b-2 border-border bg-muted/50 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source text (evidence)</p>
                {selected !== null && (
                  <span className="text-[11px] text-primary">highlighting claim quote</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <HighlightedSource
                  text={result!.extracted_text}
                  query={selected !== null ? (review.skill_claims?.[selected]?.quote ?? null) : null}
                />
              </div>
            </div>

            {/* structured pane */}
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
              <Section title="Skill claims" hint="normalized against the taxonomy · claims never verified here">
                {(review.skill_claims ?? []).map((c, i) => {
                  const meta = ASSOC_META[c.association] ?? ASSOC_META.inferred;
                  return (
                    <div
                      key={`${c.skill}-${i}`}
                      className={`flex cursor-pointer flex-col gap-2 rounded-lg border-2 p-3 transition-colors ${selected === i ? "border-primary bg-primary/5" : "border-border bg-white"}`}
                      onClick={() => setSelected(selected === i ? null : i)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Input value={c.skill} onChange={(e) => patch((r) => void (r.skill_claims![i].skill = e.target.value))} className="h-8 w-40 font-bold" onClick={(e) => e.stopPropagation()} />
                        <select
                          value={c.proficiency_tier}
                          onChange={(e) => patch((r) => void (r.skill_claims![i].proficiency_tier = e.target.value))}
                          onClick={(e) => e.stopPropagation()}
                          className="h-8 rounded-md bg-muted px-2 text-xs font-medium text-foreground"
                        >
                          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Input type="number" min={0} max={50} value={c.years ?? 0} onChange={(e) => patch((r) => void (r.skill_claims![i].years = Number(e.target.value)))} onClick={(e) => e.stopPropagation()} className="h-8 w-20 text-xs" aria-label="claimed years" />
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.chip}`}>{meta.label}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); patch((r) => void r.skill_claims!.splice(i, 1)); }} className="ml-auto text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <Textarea rows={2} value={c.quote} onChange={(e) => patch((r) => void (r.skill_claims![i].quote = e.target.value))} onClick={(e) => e.stopPropagation()} className="font-mono text-xs" aria-label="evidence quote" />
                    </div>
                  );
                })}
                <Button size="sm" variant="ghost" onClick={() => patch((r) => void r.skill_claims!.push({ skill: "", proficiency_tier: "FOUNDATIONAL", quote: "", association: "claimed" as never }))}>
                  <Plus className="h-4 w-4" /> Add claim
                </Button>
              </Section>

              <Section title="Employment (overlaps never double-counted)">
                {(review.roles ?? []).map((r, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border-2 border-border bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={r.title} onChange={(e) => patch((x) => void (x.roles![i].title = e.target.value))} className="h-8 w-44 font-bold" />
                      <Input value={r.company} onChange={(e) => patch((x) => void (x.roles![i].company = e.target.value))} className="h-8 w-40 text-xs" />
                      <button type="button" onClick={() => patch((x) => void x.roles!.splice(i, 1))} className="ml-auto text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={r.start ?? "unknown"} onChange={(e) => patch((x) => void (x.roles![i].start = e.target.value))} className="h-8 w-32 text-xs" aria-label="start" />
                      <span className="text-xs text-muted-foreground">→</span>
                      <Input value={r.end ?? "unknown"} onChange={(e) => patch((x) => void (x.roles![i].end = e.target.value))} className="h-8 w-32 text-xs" aria-label="end" />
                    </div>
                    <Textarea rows={1} value={r.quote} onChange={(e) => patch((x) => void (x.roles![i].quote = e.target.value))} className="font-mono text-xs" aria-label="role quote" />
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => patch((x) => void x.roles!.push({ title: "", company: "", start: "unknown", end: "unknown", quote: "" }))}>
                  <Plus className="h-4 w-4" /> Add role
                </Button>
              </Section>

              <Section title="Projects">
                {(review.projects ?? []).map((p, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border-2 border-border bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input value={p.name} onChange={(e) => patch((x) => void (x.projects![i].name = e.target.value))} className="h-8 w-44 font-bold" />
                      <Input value={p.role} onChange={(e) => patch((x) => void (x.projects![i].role = e.target.value))} className="h-8 w-36 text-xs" />
                      <button type="button" onClick={() => patch((x) => void x.projects!.splice(i, 1))} className="ml-auto text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <Input value={p.impact_metric} onChange={(e) => patch((x) => void (x.projects![i].impact_metric = e.target.value))} className="h-8 text-xs" placeholder="impact metric (optional)" />
                    <Textarea rows={1} value={p.quote} onChange={(e) => patch((x) => void (x.projects![i].quote = e.target.value))} className="font-mono text-xs" aria-label="project quote" />
                  </div>
                ))}
              </Section>

              {review.ambiguities && review.ambiguities.length > 0 && (
                <Section title="Ambiguities flagged by extraction">
                  {(review.ambiguities ?? []).map((a, i) => (
                    <div key={i} className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground/80">{a}</div>
                  ))}
                </Section>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5" /> Saving records claims as <b>extracted</b> (low rigor) — never auto-verifies skills.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStage("upload")}>Cancel</Button>
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save evidence review
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}
