import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "UNAUTHORIZED" }, 401);

  const { data: caller } = await supabase
    .from("digital_twins")
    .select("id, org_id, name, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHORIZED" }, 401);

  let body: { question?: string; status?: string; best_score?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const question = String(body.question ?? "").trim();
  if (!question) return json({ error: "BAD_REQUEST", message: "question is required." }, 400);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("recommendations")
    .insert({
      org_id: caller.org_id,
      twin_id: caller.id,
      category: "policy",
      urgency: "medium",
      evidence_ledger: [
        { type: "policy_question", value: question, note: `Asked by ${caller.name}.` },
        { type: "retrieval_status", value: body.status ?? "insufficient_evidence", note: `Best retrieval score: ${body.best_score ?? "n/a"}.` },
      ],
      proposed_action: {
        title: "Review policy question",
        description: question,
        steps: [
          { order: 1, action: "Read the employee's question." },
          { order: 2, action: "Check the policy corpus and any retrieval context." },
          { order: 3, action: "Reply to the employee with a grounded answer or clarify." },
        ],
      },
      status: "needs_review",
      required_signoff_role: "hr_executive",
      reviewer_rationale: {},
      audit_events: [{ actor: caller.email ?? uid, action: "escalated", note: "Policy question escalated for HR follow-up.", timestamp: now }],
    })
    .select("id")
    .single();
  if (error) return json({ error: "INSERT_FAILED", message: error.message }, 500);

  return json({ ok: true, recommendation_id: data.id });
});
