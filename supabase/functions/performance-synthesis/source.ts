import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { callQwen, QwenError } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATING_ORDER: Record<string, number> = {
  "Needs Improvement": 1,
  "On Track": 2,
  "Meets Expectations": 3,
  "Exceeds Expectations": 4,
  "Exceptional": 5,
};

const SYNTHESIS_SYSTEM = `You are a performance narrative writer.
Write strictly from the aggregated numbers provided — never invent metrics, examples, or achievements.
Respond with JSON only:
{"strengths":"2-3 sentences","growth_areas":"2-3 sentences","trend_direction":"up|flat|down","confidence":0.0-1.0}
confidence reflects how much signal the numbers carry (low when few cycles). Ground every sentence in the numbers.`;

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

interface PerfCycle {
  cycle: string;
  rating: string;
  goals_met?: number;
  feedback?: { sentiment: "positive" | "negative" | "neutral"; text: string }[];
}

function aggregate(history: PerfCycle[]) {
  const goals = history.map((h) => h.goals_met).filter((g): g is number => typeof g === "number");
  const goalsMetPct = goals.length > 0 ? goals.reduce((a, b) => a + b, 0) / goals.length : null;

  let pos = 0, neg = 0, neu = 0;
  for (const h of history) {
    for (const f of h.feedback ?? []) {
      if (f.sentiment === "positive") pos++;
      else if (f.sentiment === "negative") neg++;
      else neu++;
    }
  }

  const ratings = history.map((h) => RATING_ORDER[h.rating] ?? 3);
  let trend: "up" | "flat" | "down" = "flat";
  if (ratings.length >= 2) {
    const last = ratings[ratings.length - 1];
    const prev = ratings[ratings.length - 2];
    trend = last > prev ? "up" : last < prev ? "down" : "flat";
  }

  return { goalsMetPct, sentiment: { positive: pos, negative: neg, neutral: neu }, trend, cycles: history.length };
}

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
    .select("id, role, org_id")
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
    .select("id, org_id, role, name, performance_history, performance_synthesis, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  const history = (twin.performance_history ?? []) as PerfCycle[];
  const agg = aggregate(history);

  // On-demand only: reuse a cached synthesis unless force is requested.
  const cached = (twin.performance_synthesis ?? {}) as { generated_at?: string };
  if (cached.generated_at && !body.force) {
    return json({ ok: true, cached: true, synthesis: twin.performance_synthesis });
  }

  // ONE Qwen call per employee, on demand — grounded strictly in the numbers.
  const parsed = (await callQwen({
    json: true,
    temperature: 0.2,
    maxTokens: 400,
    task: "performance_narrative",
    system: SYNTHESIS_SYSTEM,
    user: `Employee: ${twin.name}
Aggregates (JSON): ${JSON.stringify(agg)}
Write the strengths/growth-areas narrative from these numbers only.`,
  })) as unknown;
  const valid = validatePerformanceNarrative(parsed);
  if (valid.ok === false) throw new QwenError("MODEL_OUTPUT_INVALID", `Narrative failed validation: ${valid.errors.join("; ")}`);
  const typed = parsed as { strengths?: string; growth_areas?: string; trend_direction?: string; confidence?: number };

  const synthesis = {
    goals_met_pct: agg.goalsMetPct,
    sentiment: agg.sentiment,
    trend: agg.trend,
    cycles: agg.cycles,
    narrative: {
      strengths: typed.strengths ?? "",
      growth_areas: typed.growth_areas ?? "",
      trend_direction: typed.trend_direction ?? agg.trend,
      confidence: typed.confidence ?? 0.5,
    },
    generated_at: new Date().toISOString(),
  };

  await supabase
    .from("digital_twins")
    .update({
      performance_synthesis: synthesis,
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.id, action: "performance_synthesized", note: `Performance synthesis generated for ${twin.name}.`, timestamp: new Date().toISOString() },
      ],
    })
    .eq("id", twinId);

  return json({ ok: true, cached: false, synthesis });
  } catch (err) {
    return json({ error: err instanceof QwenError ? err.code : "INTERNAL", message: err instanceof Error ? err.message : "unknown" });
  }
});