import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computePerformanceFacts, performanceSourceHash, validatePerformanceCitations } from "../_shared/performance-intelligence.ts";
import { callQwen, QwenError } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function isTeamMember(supabase, rootTwinId: string, checkTwinId: string): Promise<boolean> {
  const { data } = await supabase.from("digital_twins").select("id, manager_id");
  const children = new Map<string, string[]>();
  for (const t of data ?? []) {
    if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
  }
  const seen = new Set<string>();
  const stack = [rootTwinId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return seen.has(checkTwinId);
}

const NARRATIVE_SYSTEM = `You are the WorkSense Performance Summarizer — decision support, not a formal assessment.
You are given deterministic SOURCE FACTS (each tagged with a ref like S1, S2), plus contradiction, sparse-evidence and stale-evidence analysis.
Write a structured narrative under these hard rules:
1. Every strength, improvement area, development action or observation MUST cite at least one source fact by its [ref]. A claim with no [ref] is rejected.
2. NEVER invent a [ref], metric, example, achievement, or causal diagnosis (no "X causes Y", no resignation/attrition claims).
3. Treat missing facts as missing: if the facts show only one review cycle, no work artifacts, or stale records, SAY SO and do not imply current, sustained behavior.
4. Sentiment counts and goal averages are directional context only — do not turn them into a performance verdict.
5. development_actions each target a skill gap or low-proficiency skill, name the measurable evidence requirement that would demonstrate growth, and cite its basis.
6. If sparse evidence exists, list at most ONE strength and keep it tied to a concrete cited record.
7. End with one sentence: "This summary is decision support; model confidence is not calibrated reliability."
Respond with JSON only:
{"narrative":"string","strengths":["string"],"improvement_areas":["string"],"development_actions":[{"skill":"string","gap_basis":["[ref]..."],"action":"string","measurable_evidence":"string"}],"inferred_themes":[{"theme":"string","basis":["[ref]..."]}],"data_quality":"complete|partial|sparse"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {

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
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { twin_id?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const twinId = (body.twin_id ?? "").trim();
  if (!twinId) return json({ error: "VALIDATION_ERROR", message: "twin_id is required." }, 400);

  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, org_id, role, name, performance_history, verified_skills, signals, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  const [obsRes, evRes] = await Promise.all([
    supabase
      .from("workforce_observations")
      .select("metric, period_start, value, missing")
      .eq("org_id", caller.org_id)
      .eq("twin_id", twinId)
      .order("period_start", { ascending: true }),
    supabase
      .from("evidence_items")
      .select("source_type, quote, captured_at")
      .eq("org_id", caller.org_id)
      .eq("twin_id", twinId),
  ]);

  const signals = (twin.signals ?? []) as { type?: string; value?: unknown }[];
  const input = {
    performance_history: (twin.performance_history ?? []) as unknown,
    verified_skills: (twin.verified_skills ?? []) as unknown,
    observations: (obsRes.data ?? []).map((o) => ({
      metric: o.metric,
      period: String(o.period_start).slice(0, 7),
      value: typeof o.value === "number" ? o.value : null,
      missing: o.missing === true,
    })),
    evidence_items: (evRes.data ?? []).map((e) => ({ source_type: e.source_type, quote: e.quote, captured_at: e.captured_at })),
    seeking_growth: signals.some((s) => s.type === "seeks_growth" && s.value === true),
    computed_at: new Date().toISOString(),
  };
  const facts = computePerformanceFacts(input as Parameters<typeof computePerformanceFacts>[0]);
  const hash = performanceSourceHash(input as Parameters<typeof performanceSourceHash>[0]);

  const history = (twin.performance_history ?? []) as { cycle?: string }[];
  const period = history.length > 0 && history[history.length - 1]?.cycle ? history[history.length - 1].cycle : new Date().toISOString().slice(0, 7);

  // Cache: same source version -> return the stored summary without a model call.
  const { data: existingRow } = await supabase
    .from("performance_summaries")
    .select("id, source_version_hash, narrative, source_facts, inferred_themes, contradictions, sparse_evidence, model_note, reviewer_draft, reviewer_draft_at, strengths, improvement_areas, development_actions")
    .eq("org_id", caller.org_id)
    .eq("twin_id", twinId)
    .eq("period", period)
    .maybeSingle();
  if (existingRow && existingRow.source_version_hash === hash && !body.force) {
    return json({
      ok: true,
      cached: true,
      period,
      facts,
      summary: {
        narrative: existingRow.narrative,
        source_facts: existingRow.source_facts,
        inferred_themes: existingRow.inferred_themes,
        contradictions: existingRow.contradictions,
        sparse_evidence: existingRow.sparse_evidence,
        model_note: existingRow.model_note,
        strengths: existingRow.strengths ?? [],
        improvement_areas: existingRow.improvement_areas ?? [],
        development_actions: existingRow.development_actions ?? [],
        reviewer_draft: existingRow.reviewer_draft ?? {},
        reviewer_draft_at: existingRow.reviewer_draft_at ?? null,
      },
    });
  }

  // ONE Qwen call on top of the deterministic facts.
  const userPrompt = `Employee: ${twin.name}
SOURCE FACTS (cite these by [ref]):
${facts.source_facts.map((f) => `[${f.ref}] ${f.source}: ${f.fact}`).join("\n")}
CONTRADICTIONS (must stay visible in your narrative):
${facts.contradictions.length > 0 ? facts.contradictions.map((c) => `- ${c.title}: ${c.evidence.join(" ")}`).join("\n") : "(none)"}
SPARSE EVIDENCE: ${facts.sparse_evidence.flags.join("; ") || "(none)"}
STALE EVIDENCE: ${facts.stale_evidence.map((s) => `- ${s.detail}`).join("\n") || "(none)"}
EVIDENCE GAPS (target development actions here):
${facts.evidence_gaps.length > 0 ? facts.evidence_gaps.map((g) => `- ${g.skill}: ${g.gap}`).join("\n") : "(no recorded evidence gaps)"}
WORK ARTIFACTS: ${facts.work_artifacts.length > 0 ? facts.work_artifacts.map((a) => `"${a.quote}" (${a.source_type}, ${a.period ?? "no date"})`).join(" | ") : "(none)"}
Write the narrative JSON.`;
  const parsed = (await callQwen({
    json: true,
    temperature: 0.2,
    maxTokens: 1300,
    task: "performance_summary",
    system: NARRATIVE_SYSTEM,
    user: userPrompt,
  })) as {
    narrative?: string;
    strengths?: string[];
    improvement_areas?: string[];
    development_actions?: { skill?: string; gap_basis?: string[]; action?: string; measurable_evidence?: string }[];
    inferred_themes?: { theme?: string; basis?: string[] }[];
    data_quality?: string;
  };

  const narrative = typeof parsed.narrative === "string" ? parsed.narrative : "";
  if (!narrative) throw new QwenError("MODEL_OUTPUT_INVALID", "performance-summary: empty narrative");

  // Phase 7 (item 17): validate citations — reject unsupported claims.
  // Narrative/strengths/improvement areas must cite a source fact directly;
  // development actions cite through their gap_basis (the action text is a
  // suggestion, its support lives in the basis refs).
  const allRefs = facts.source_facts.map((f) => f.ref);
  const claimsToCheck = [
    narrative,
    ...(parsed.strengths ?? []),
    ...(parsed.improvement_areas ?? []),
  ];
  const unsupported = validatePerformanceCitations(claimsToCheck, allRefs);
  const devActions = parsed.development_actions ?? [];
  for (const a of devActions) {
    const basis = a?.gap_basis ?? [];
    if (basis.length === 0) {
      unsupported.push(`development action for "${a?.skill ?? "?"}" has no cited evidence basis`);
    } else {
      unsupported.push(...validatePerformanceCitations(basis, allRefs));
    }
  }
  if (unsupported.length > 0) {
    throw new QwenError("MODEL_OUTPUT_INVALID", `performance-summary: unsupported claims rejected (${unsupported.slice(0, 3).join("; ")})`);
  }

  // Phase 7 (item 12): do not infer broad strengths from a single generic
  // seeded review. If the evidence is thin, cap strengths at one.
  const thinEvidence = facts.history_state === "none" || (facts.history_state === "partial" && facts.work_artifacts.length === 0 && facts.feedback_stats.total < 2);
  let strengths = (parsed.strengths ?? []).map((s) => String(s)).filter(Boolean);
  if (thinEvidence && strengths.length > 1) strengths = strengths.slice(0, 1);

  const modelThemes = (parsed.inferred_themes ?? [])
    .filter((t) => t?.theme)
    .map((t) => ({
      theme: t.theme!,
      basis: Array.isArray(t.basis) ? t.basis : [],
      inference: true,
      confidence_note: "Inferred from the model narrative — not a verified source fact.",
    }));
  const dataQuality = ["complete", "partial", "sparse"].includes(parsed.data_quality ?? "")
    ? parsed.data_quality!
    : thinEvidence
      ? "sparse"
      : facts.sparse_evidence.flags.length >= 2
        ? "sparse"
        : facts.sparse_evidence.flags.length === 1
          ? "partial"
          : "complete";
  const developmentActions = (parsed.development_actions ?? [])
    .filter((a) => a?.skill)
    .map((a) => ({
      skill: a.skill!,
      gap_basis: Array.isArray(a.gap_basis) ? a.gap_basis : [],
      action: a.action ?? "",
      measurable_evidence: a.measurable_evidence ?? "",
    }));

  const row = {
    org_id: caller.org_id,
    twin_id: twinId,
    period,
    narrative,
    source_facts: facts.source_facts,
    inferred_themes: facts.inferred_themes.concat(modelThemes),
    contradictions: facts.contradictions,
    sparse_evidence: facts.sparse_evidence,
    goal_stats: facts.goal_stats,
    feedback_stats: facts.feedback_stats,
    evidence_summary: facts.evidence_summary,
    strengths,
    improvement_areas: (parsed.improvement_areas ?? []).map((s) => String(s)).filter(Boolean),
    development_actions: developmentActions,
    source_version_hash: hash,
    model_note: `Generated from ${facts.source_facts.length} deterministic source facts; every claim cites its [ref]. Data quality: ${dataQuality}. Decision support — model confidence is not calibrated reliability.`,
    from_cache: false,
    generated_at: new Date().toISOString(),
  };

  if (existingRow) {
    const { error: upErr } = await supabase
      .from("performance_summaries")
      .update({ ...row, generated_at: new Date().toISOString() })
      .eq("id", existingRow.id);
    if (upErr) return json({ error: "INTERNAL", message: upErr.message }, 500);
  } else {
    const { error: insErr } = await supabase.from("performance_summaries").insert(row);
    if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);
  }

  await supabase
    .from("digital_twins")
    .update({
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.id, action: "performance_summary_generated", note: `Performance summary generated for ${twin.name} (${period}).`, timestamp: new Date().toISOString() },
      ],
    })
    .eq("id", twinId);

  return json({
    ok: true,
    cached: false,
    period,
    facts,
    summary: {
      ...row,
      reviewer_draft: existingRow?.reviewer_draft ?? {},
      reviewer_draft_at: existingRow?.reviewer_draft_at ?? null,
    },
  });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});
