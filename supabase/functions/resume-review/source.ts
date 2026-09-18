import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveSkillId } from "../_shared/evidence.ts";
import { computeFit } from "../_shared/skill-graph-engine.ts";
import { normalizeSkillName, quoteMatchesSource } from "../_shared/resume.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TIER_PROFICIENCY: Record<string, number> = { FOUNDATIONAL: 1, INTERMEDIATE: 3, ADVANCED: 4, EXPERT: 5 };
const sourceTypeFor = () => "resume_document";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id, name")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller || !["hr_executive", "hr_partner", "recruiter"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Recruitment access required." }, 403);
  }

  let body: { document_id?: string; twin_id?: string; req_id?: string; version_id?: string; review?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const documentId = (body.document_id ?? "").trim();
  const twinId = (body.twin_id ?? "").trim();
  if (!documentId || !twinId || !body.review) {
    return json({ error: "VALIDATION_ERROR", message: "document_id, twin_id and the reviewed extraction are required." }, 400);
  }

  const { data: doc } = await supabase
    .from("resume_documents")
    .select("id, org_id, twin_id, extracted_text, checksum, status")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return json({ error: "NOT_FOUND", message: "Resume document not found." }, 404);
  if (doc.org_id !== caller.org_id || doc.twin_id !== twinId) return json({ error: "FORBIDDEN" }, 403);
  if (doc.status === "failed" || doc.status === "low_text") {
    return json({ error: "CONFLICT", message: "This document has no extractable text to review." }, 409);
  }
  const sourceText = doc.extracted_text ?? "";

  const review = body.review as {
    full_name?: string;
    contact?: Record<string, string>;
    roles?: { title: string; company: string; start?: string; end?: string; years_claimed?: number; quote: string }[];
    education?: { institution: string; degree: string; year: string; quote: string }[];
    certifications?: { name: string; issuer: string; year: string; quote: string }[];
    projects?: { name: string; role: string; tech_stack: string[]; impact_metric: string; quote: string }[];
    skill_claims?: { skill: string; years?: number; proficiency_tier: string; quote: string; association: string }[];
    ambiguities?: string[];
    conflicts?: string[];
  };

  // ---- Evidence validation: every quote must exist in the stored source text.
  const quoteViolations: string[] = [];
  const checkQuote = (quote: string, label: string) => {
    if (!quoteMatchesSource(quote, sourceText)) {
      quoteViolations.push(`${label}: quote not found in source — "${quote.slice(0, 100)}${quote.length > 100 ? "…" : ""}"`);
    }
  };
  for (const [i, r] of (review.roles ?? []).entries()) checkQuote(r.quote, `role[${i}]`);
  for (const [i, e] of (review.education ?? []).entries()) checkQuote(e.quote, `education[${i}]`);
  for (const [i, c] of (review.certifications ?? []).entries()) checkQuote(c.quote, `certification[${i}]`);
  for (const [i, p] of (review.projects ?? []).entries()) checkQuote(p.quote, `project[${i}]`);
  for (const [i, s] of (review.skill_claims ?? []).entries()) checkQuote(s.quote, `skill[${s.skill ?? i}]`);
  if (quoteViolations.length > 0) {
    return json({ error: "VALIDATION_ERROR", message: "Fabricated quotes cannot be saved.", details: quoteViolations }, 422);
  }

  // ---- Alias normalization (defense in depth — never create duplicates).
  const { data: graphRows } = await supabase.from("skill_graph").select("skill, aliases").eq("org_id", caller.org_id);
  const graph = (graphRows ?? []) as { skill: string; aliases?: string[] }[];
  const claims = (review.skill_claims ?? []).map((c) => ({
    ...c,
    skill: normalizeSkillName(graph, c.skill),
    proficiency_tier: (c.proficiency_tier ?? "FOUNDATIONAL").toUpperCase(),
  }));

  // Conflict resolution: keep reviewer_confirmed/assessment_supported untouched;
  // replace this twin's prior resume-extracted ('extracted') assertions only.
  const { data: prior } = await supabase
    .from("skill_assertions")
    .select("id, evidence_ids")
    .eq("twin_id", twinId)
    .eq("review_state", "extracted");
  const priorEv = (prior ?? []).flatMap((r) => r.evidence_ids ?? []);
  if (priorEv.length > 0) await supabase.from("evidence_items").delete().in("id", priorEv);
  if ((prior ?? []).length > 0) await supabase.from("skill_assertions").delete().in("id", (prior ?? []).map((r) => r.id));

  // Latest version number (reprocessing creates a new version, history preserved).
  const { data: verMax } = await supabase
    .from("resume_versions")
    .select("version")
    .eq("document_id", documentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (verMax?.version ?? 0) + 1;
  const now = new Date().toISOString();

  // Evidence per skill claim (+ project evidence for lineage).
  const evidenceRows: { org_id: string; twin_id: string; source_type: string; source_id: string; captured_at: string; quote: string; review_state: string; metadata: Record<string, unknown> }[] = [];
  const seenSkills = new Set<string>();
  const dedupedClaims: typeof claims = [];
  for (const c of claims) {
    const key = c.skill.toLowerCase();
    if (seenSkills.has(key)) continue; // repeated claim for one skill -> one assertion
    seenSkills.add(key);
    dedupedClaims.push(c);
    evidenceRows.push({
      org_id: caller.org_id, twin_id: twinId, source_type: sourceTypeFor(),
      source_id: `doc:${documentId}:v${version}`, captured_at: now,
      quote: c.quote, review_state: "extracted",
      metadata: { skill: c.skill, years: c.years ?? 0, association: c.association ?? "explicit", version },
    });
  }
  for (const [i, p] of (review.projects ?? []).entries()) {
    evidenceRows.push({
      org_id: caller.org_id, twin_id: twinId, source_type: sourceTypeFor(),
      source_id: `doc:${documentId}:v${version}`, captured_at: now,
      quote: p.quote, review_state: "extracted",
      metadata: { project: p.name, project_index: i, version },
    });
  }

  const { data: evRows, error: evErr } = await supabase.from("evidence_items").insert(evidenceRows).select("id");
  if (evErr) throw evErr;
  const evIds = (evRows ?? []).map((r) => r.id);

  // Assertions: claims remain claims ('extracted', low rigor) — uploading and
  // extraction never upgrade skills to verified.
  const assertionRows = [];
  for (let i = 0; i < dedupedClaims.length; i++) {
    assertionRows.push({
      org_id: caller.org_id, twin_id: twinId,
      skill_id: await resolveSkillId(supabase, caller.org_id, dedupedClaims[i].skill),
      claimed_proficiency: TIER_PROFICIENCY[dedupedClaims[i].proficiency_tier] ?? 2,
      proficiency_tier: dedupedClaims[i].proficiency_tier,
      review_state: "extracted",
      evidence_ids: [evIds[i]],
    });
  }
  const { error: assertErr } = await supabase.from("skill_assertions").insert(assertionRows);
  if (assertErr) throw assertErr;

  // Mark version reviewed + document reviewed.
  const { error: verErr2 } = await supabase.from("resume_versions").insert({
    org_id: caller.org_id, document_id: documentId, twin_id: twinId, version,
    source_hash: doc.checksum, payload: { ...review, skill_claims: dedupedClaims },
    review_state: "reviewed", reviewed_by: caller.id, reviewed_at: now,
  });
  if (verErr2) throw verErr2;
  const { error: docErr } = await supabase.from("resume_documents").update({ status: "reviewed", updated_at: now }).eq("id", documentId);
  if (docErr) throw docErr;

  const audit = [{ actor: caller.email ?? uid, action: "resume_reviewed", note: `Reviewed resume version ${version} (${dedupedClaims.length} claims, ${evidenceRows.length} evidence). Claims recorded as extracted — not verified.`, timestamp: now }];
  const { data: twinRow } = await supabase.from("digital_twins").select("audit_events, computed_fits, verified_skills, seniority_level").eq("id", twinId).maybeSingle();
  if (twinRow) {
    await supabase.from("digital_twins").update({ audit_events: [...(twinRow.audit_events ?? []), ...audit] }).eq("id", twinId);
  }

  // Refreshed fit (engine, assertions now include extracted claims at low rigor).
  let fit = null;
  if (body.req_id) {
    const reqId = body.req_id.trim();
    const { data: reqRow } = await supabase.from("job_requisitions").select("id, title, required_skills, seniority_level").eq("id", reqId).maybeSingle();
    if (reqRow) {
      const { data: assertions } = await supabase
        .from("skill_assertions")
        .select("skill_id, claimed_proficiency, proficiency_tier, review_state, evidence_ids, twin_id")
        .eq("twin_id", twinId);
      const { data: skills } = await supabase.from("skill_graph").select("id, skill").eq("org_id", caller.org_id);
      const nameById = new Map((skills ?? []).map((s) => [s.id, s.skill]));
      const claims2 = (assertions ?? [])
        .filter((a) => ["reviewer_confirmed", "assessment_supported", "extracted", "claimed"].includes(a.review_state))
        .map((a) => ({
          name: nameById.get(a.skill_id) ?? "",
          proficiency: a.claimed_proficiency,
          evidence_source: a.review_state === "extracted" ? "resume_extraction" : a.review_state === "reviewer_confirmed" ? "evidence_review" : "assessment",
          verification_rigor: a.review_state === "reviewer_confirmed" ? ("high" as const) : a.review_state === "assessment_supported" ? ("medium" as const) : ("low" as const),
        }))
        .filter((c) => c.name);
      const { data: graphAll } = await supabase.from("skill_graph").select("skill, category, outgoing_edges").eq("org_id", caller.org_id);
      fit = computeFit({
        candidateSkills: claims2,
        candidateLevel: twinRow?.seniority_level ?? 3,
        requiredSkills: reqRow.required_skills ?? [],
        roleLevel: reqRow.seniority_level ?? 3,
        skillGraph: graphAll ?? [],
        target: { type: "requisition", id: reqRow.id, title: reqRow.title },
        scenario: "current",
        computedAt: now,
      });
    }
  }

  return json({
    ok: true,
    document_id: documentId,
    version,
    claims_saved: dedupedClaims.length,
    evidence_saved: evidenceRows.length,
    conflicts_resolved: review.conflicts ?? [],
    fit,
    provenance: {
      artifact_ref: `doc:${documentId}:v${version}`,
      file_name: doc.file_name,
      checksum_short: doc.checksum.slice(0, 12),
      source_type: "resume_document",
    },
  });
});
