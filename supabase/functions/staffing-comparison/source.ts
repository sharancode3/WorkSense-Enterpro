import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { planStaffing, DEFAULT_ASSUMPTIONS, type Candidate, type Person, type ScenarioInput } from "../_shared/staffing-planner.ts";
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
  for (const t of data ?? []) if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
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

const NL = String.fromCharCode(10);

const EXPLAIN_SYSTEM = `You are the WorkSense staffing-planning narrator. You are given ONLY the validated numbers produced by the deterministic planner (options with status, cost, ready-day, verified/conditional coverage, mandatory gaps, deadline and budget).
Your job is to explain those numbers clearly. HARD RULES:
1. NEVER invent, recalculate, or change any number — restate exactly what the planner produced.
2. Do not claim an option is role-ready unless the planner says its status is feasible/conditional AND mandatory gaps are empty.
3. Never claim the 56-day hire track is ready at a 42-day deadline; restate the planner's ready-day and deadline as given.
4. Compare options on cost, time, verified coverage and risk using ONLY the provided values.
Respond with JSON only: {"explanation":"string"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, role, email, org_id, name")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);
  if (!["hr_executive", "hr_partner", "manager"].includes(caller.role)) {
    return json({ error: "FORBIDDEN", message: "Staffing planner requires HR or Manager access." }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "plan");

  // ---- list saved scenarios ---------------------------------------------------
  if (action === "list") {
    const { data, error } = await supabase
      .from("staffing_scenarios")
      .select("id, name, input_snapshot, assumptions, result, created_by, created_at")
      .eq("org_id", caller.org_id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    const { data: props } = await supabase
      .from("staffing_proposals")
      .select("id, scenario_id, status, review_note, created_at")
      .eq("org_id", caller.org_id);
    return json({ ok: true, scenarios: data ?? [], proposals: props ?? [] });
  }

  // ---- propose a saved scenario for human review -------------------------------
  if (action === "propose") {
    const scenarioId = String(body.scenario_id ?? "").trim();
    if (!scenarioId) return json({ error: "VALIDATION_ERROR", message: "scenario_id is required." }, 400);
    const { data: scenario } = await supabase
      .from("staffing_scenarios")
      .select("id")
      .eq("org_id", caller.org_id)
      .eq("id", scenarioId)
      .maybeSingle();
    if (!scenario) return json({ error: "NOT_FOUND" }, 404);
    const { data, error } = await supabase
      .from("staffing_proposals")
      .insert({
        org_id: caller.org_id,
        scenario_id: scenarioId,
        status: "open",
        submitted_by: caller.id,
        review_note: "Submitted for human review from the staffing planner.",
      })
      .select("id, status, created_at")
      .single();
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    return json({ ok: true, proposal_id: data.id, status: data.status, message: "Proposal submitted for human review." });
  }

  // ---- explain a saved scenario (Qwen narrates ONLY the validated numbers) ------
  if (action === "explain") {
    const scenarioId = String(body.scenario_id ?? "").trim();
    if (!scenarioId) return json({ error: "VALIDATION_ERROR", message: "scenario_id is required." }, 400);
    const { data: scenario } = await supabase
      .from("staffing_scenarios")
      .select("name, result")
      .eq("org_id", caller.org_id)
      .eq("id", scenarioId)
      .maybeSingle();
    if (!scenario) return json({ error: "NOT_FOUND" }, 404);
    const result = (scenario.result ?? {}) as {
      options?: unknown[]; decision_table?: unknown[]; scenario?: { deadline_days?: number; budget_usd?: number };
    };
    const digest = {
      deadline_days: result.scenario?.deadline_days,
      budget_usd: result.scenario?.budget_usd,
      options: (result.options ?? []).map((o) => ({
        id: (o as { id?: string })?.id,
        status: (o as { status?: string })?.status,
        ready_at_days: (o as { ready_at_days?: number })?.ready_at_days,
        cost_usd: (o as { cost_usd?: number })?.cost_usd,
        verified_coverage_pct: (o as { verified_coverage_pct?: number })?.verified_coverage_pct,
        conditional_coverage_pct: (o as { conditional_coverage_pct?: number })?.conditional_coverage_pct,
        mandatory_missing: (o as { mandatory_missing?: string[] })?.mandatory_missing ?? [],
        meets_deadline: (o as { meets_deadline?: boolean })?.meets_deadline,
      })),
      decision_table: result.decision_table ?? [],
    };
    try {
      const parsed = (await callQwen({
        json: true,
        temperature: 0.2,
        maxTokens: 800,
        task: "staffing_explanation",
        system: EXPLAIN_SYSTEM,
        user: `Scenario "${scenario.name}".${NL}${NL}PLANNER OUTPUT (validated — restate exactly):${NL}${JSON.stringify(digest)}`,
      })) as { explanation?: string };
      return json({ ok: true, explanation: String(parsed.explanation ?? "") || "No explanation produced.", digest });
    } catch (err) {
      return json({ ok: true, explanation: null, digest, error: err instanceof QwenError ? err.code : "MODEL_UNAVAILABLE" });
    }
  }

  // ---- plan (default) ----------------------------------------------------------
  const scenarioInput: ScenarioInput = {
    name: String(body.name ?? `Scenario ${new Date().toLocaleDateString()}`).slice(0, 80),
    demand_title: String(body.demand_title ?? "Backend Engineer").slice(0, 120),
    department: body.department ? String(body.department).slice(0, 80) : undefined,
    required_skills: Array.isArray(body.required_skills) && body.required_skills.length > 0
      ? (body.required_skills as { skill: string; min_proficiency: number; mandatory?: boolean }[]).map((r) => ({
          skill: String(r.skill),
          min_proficiency: Math.max(1, Math.min(5, Number(r.min_proficiency) || 3)),
          mandatory: r.mandatory !== false,
        }))
      : [{ skill: "Go", min_proficiency: 3, mandatory: true }, { skill: "REST APIs", min_proficiency: 3, mandatory: true }],
    capacity_people: Math.max(1, Number(body.capacity_people) || 1),
    deadline_days: Math.max(1, Number(body.deadline_days) || 42),
    budget_usd: Math.max(0, Number(body.budget_usd) || 60000),
    geography: body.geography ? String(body.geography) : undefined,
    horizon_months: Math.max(1, Number(body.horizon_months) || 12),
    assumptions_version: String(body.assumptions_version ?? DEFAULT_ASSUMPTIONS.version),
  };

  // Authorized internal population: HR sees the org; managers see their team
  // (item 29 — a manager can never pull the wider org or candidate pipeline).
  const { data: twins } = await supabase
    .from("digital_twins")
    .select("id, name, role, department, manager_id, verified_skills, signals")
    .eq("org_id", caller.org_id)
    .eq("status", "active");
  const all = (twins ?? []) as {
    id: string; name: string; role: string; department: string | null; manager_id: string | null;
    verified_skills: { name: string; proficiency: number; verification_rigor?: string }[];
    signals?: { type?: string; value?: unknown }[];
  }[];
  let scopedPeople = all.filter((t) => ["employee", "manager"].includes(t.role));
  if (caller.role === "manager") {
    // Manager scope: the caller's reporting subtree only (item 29).
    const { data: allTwins2 } = await supabase.from("digital_twins").select("id, manager_id");
    const children = new Map<string, string[]>();
    for (const t of allTwins2 ?? []) if (t.manager_id) children.set(t.manager_id, [...(children.get(t.manager_id) ?? []), t.id]);
    const seen = new Set<string>();
    const stack = [caller.id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
    scopedPeople = scopedPeople.filter((p) => seen.has(p.id));
  }
  const population: Person[] = scopedPeople.map((t) => {
    const critical = (t.signals ?? []).find((s) => s.type === "critical_assignment");
    return {
      id: t.id,
      name: t.name,
      department: t.department,
      manager_id: t.manager_id,
      current_assignment: critical ? String(critical.value ?? "") : null,
      skills: (t.verified_skills ?? []).map((s) => ({
        name: s.name,
        proficiency: s.proficiency,
        verification_rigor: (s.verification_rigor ?? "low") as Person["skills"][number]["verification_rigor"],
      })),
    };
  });

  // Candidate pipeline: only visible to HR roles (managers stay scoped out).
  let candidates: Candidate[] = [];
  if (["hr_executive", "hr_partner"].includes(caller.role)) {
    const { data: reqs } = await supabase
      .from("job_requisitions")
      .select("id, title, applicants")
      .eq("org_id", caller.org_id)
      .eq("status", "open");
    const req = (reqs ?? []).find((r) => r.title.toLowerCase() === scenarioInput.demand_title.toLowerCase()) ?? (reqs ?? [])[0];
    const applicants = (req?.applicants ?? []) as { twin_id: string; stage: string; applied_at?: string; match_score?: number | null }[];
    const { data: candTwins } = applicants.length > 0
      ? await supabase.from("digital_twins").select("id, name, verified_skills").in("id", applicants.map((a) => a.twin_id))
      : { data: [] as never[] };
    const byId = new Map((candTwins ?? []).map((c) => [c.id, c]));
    candidates = applicants.map((a) => {
      const t = byId.get(a.twin_id) as { id: string; name: string; verified_skills: { name: string; proficiency: number; verification_rigor?: string }[] } | undefined;
      const stageStatus = a.stage === "rejected" ? "rejected" : a.stage === "selected" ? "expired" : a.stage === "final_round" || a.stage === "technical_interview" || a.stage === "screening" ? "active" : "invited";
      return {
        id: a.twin_id,
        name: t?.name ?? `Candidate ${a.twin_id.slice(0, 6)}`,
        status: stageStatus,
        applied_at: a.applied_at ?? undefined,
        match_score: a.match_score ?? null,
        skills: (t?.verified_skills ?? []).map((s) => ({
          name: s.name,
          proficiency: s.proficiency,
          verification_rigor: (s.verification_rigor ?? "low") as Person["skills"][number]["verification_rigor"],
        })),
      };
    });
  }

  const plan = planStaffing(scenarioInput, population, candidates);

  const { data: saved, error: saveErr } = await supabase
    .from("staffing_scenarios")
    .upsert(
      {
        org_id: caller.org_id,
        name: plan.scenario.name,
        input_snapshot: { ...plan.scenario, geography: plan.scenario.geography ?? null },
        assumptions: plan.assumptions,
        result: plan,
        created_by: caller.id,
      },
      { onConflict: "org_id,name" }
    )
    .select("id")
    .single();
  if (saveErr) return json({ error: "INTERNAL", message: saveErr.message }, 500);

  return json({
    ok: true,
    scenario_id: saved.id,
    scope: caller.role === "manager" ? "team" : "org",
    population_size: population.length,
    candidate_pipeline_size: caller.role === "manager" ? null : candidates.length,
    ...plan,
  });
});
