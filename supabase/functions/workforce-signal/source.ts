import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { computeWorkforceSignal } from "../_shared/workforce-signal-engine.ts";

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
    .select("id, org_id, role, tenure_months, promotion_lag_months, attendance, delivery, signals, audit_events")
    .eq("id", twinId)
    .maybeSingle();
  if (twinErr || !twin) return json({ error: "NOT_FOUND" }, 404);

  let allowed = false;
  if (["hr_executive", "hr_partner"].includes(caller.role)) allowed = twin.org_id === caller.org_id;
  else if (caller.role === "manager" || caller.role === "employee") {
    allowed = twin.id === caller.id || (caller.role === "manager" && (await isTeamMember(supabase, caller.id, twin.id)));
  }
  if (!allowed) return json({ error: "FORBIDDEN" }, 403);

  const signals = (twin.signals ?? []) as { type?: string; value?: unknown }[];
  const seeksGrowth = signals.some((s) => s.type === "seeks_growth" && s.value === true);

  const result = computeWorkforceSignal({
    promotion_lag_months: twin.promotion_lag_months ?? 0,
    attendance: twin.attendance ?? {},
    delivery: twin.delivery ?? {},
    seeks_growth: seeksGrowth,
  });

  const now = new Date().toISOString();
  const nextSignals = signals
    .filter((s) => s.type !== "workforce_review_signal")
    .concat([
      {
        type: "workforce_review_signal",
        value: result.risk_score,
        signal: result.signal,
        computed_at: now,
        factors: result.factors,
        label: "Multiple workforce indicators warrant HR review",
      },
    ]);

  await supabase
    .from("digital_twins")
    .update({
      signals: nextSignals,
      audit_events: [
        ...(twin.audit_events ?? []),
        { actor: caller.id, action: "workforce_signal_computed", note: `Workforce Review Signal recomputed to ${result.risk_score}/100.`, timestamp: now },
      ],
    })
    .eq("id", twinId);

  return json({ ok: true, risk_score: result.risk_score, factors: result.factors, label: "Multiple workforce indicators warrant HR review" });
});
