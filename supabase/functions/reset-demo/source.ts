import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { buildTwins, DEMO_ACCOUNTS, DEMO_ORG_ID, POLICIES, RECOMMENDATIONS, REQUISITIONS, SEED_JOURNEY, SKILLS } from "../_shared/seed-data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

async function ensureDemoAuthUsers(supabase) {
  const created: string[] = [];
  const idByEmail: Record<string, string> = {};
  const { data: allUsers, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`Failed to list auth users: ${listErr.message}`);
  const usersByEmail = new Map((allUsers?.users ?? []).map((u) => [u.email, u.id]));

  for (const account of DEMO_ACCOUNTS) {
    const existingId = usersByEmail.get(account.email);
    if (existingId) {
      idByEmail[account.email] = existingId;
      continue;
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { name: account.name, is_demo: true },
    });
    if (error) throw new Error(`Failed to create demo user ${account.email}: ${error.message}`);
    created.push(account.email);
    idByEmail[account.email] = data.user.id;
  }
  return { created, idByEmail };
}

async function reseed(supabase, authIds: Record<string, string>) {
  // Scoped teardown of the demo org's rows (children before parents),
  // plus any trigger-created twins for the demo auth accounts.
  await supabase.from("recommendations").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("onboarding_journeys").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("job_requisitions").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("skill_graph").delete().eq("org_id", DEMO_ORG_ID);
  const demoIds = Object.values(authIds);
  if (demoIds.length > 0) {
    await supabase.from("digital_twins").delete().in("auth_user_id", demoIds);
  }
  await supabase.from("digital_twins").delete().eq("org_id", DEMO_ORG_ID);
  await supabase.from("organizations").delete().eq("id", DEMO_ORG_ID);

  // Re-insert the frozen seed payload.
  const { error: orgErr } = await supabase.from("organizations").insert({
    id: DEMO_ORG_ID,
    name: "WorkSense Demo Org",
    policies: POLICIES,
  });
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);

  const { error: twinsErr } = await supabase.from("digital_twins").insert(buildTwins(authIds));
  if (twinsErr) throw new Error(`twins insert: ${twinsErr.message}`);

  const { error: skillsErr } = await supabase.from("skill_graph").insert(
    SKILLS.map((s) => ({ ...s, org_id: DEMO_ORG_ID }))
  );
  if (skillsErr) throw new Error(`skills insert: ${skillsErr.message}`);

  const { error: reqsErr } = await supabase.from("job_requisitions").insert(
    REQUISITIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID }))
  );
  if (reqsErr) throw new Error(`reqs insert: ${reqsErr.message}`);

  const { error: journeyErr } = await supabase.from("onboarding_journeys").insert(SEED_JOURNEY);
  if (journeyErr) throw new Error(`journey insert: ${journeyErr.message}`);

  const { error: recsErr } = await supabase.from("recommendations").insert(
    RECOMMENDATIONS.map((r) => ({ ...r, org_id: DEMO_ORG_ID }))
  );
  if (recsErr) throw new Error(`recs insert: ${recsErr.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Authorize: the database is considered initialized once a linked HR
  // Executive twin exists. Until then (fresh Cloud), bootstrap is allowed.
  const { count: hrCount, error: hrErr } = await supabase
    .from("digital_twins")
    .select("id", { count: "exact", head: true })
    .eq("role", "hr_executive")
    .not("auth_user_id", "is", null);
  if (hrErr) throw hrErr;
  const isInitialized = (hrCount ?? 0) > 0;

  if (isInitialized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = userData?.user?.id;
    if (!uid) return jsonResponse({ error: "UNAUTHORIZED" }, 401);

    const { data: twin } = await supabase
      .from("digital_twins")
      .select("role")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (twin?.role !== "hr_executive") {
      return jsonResponse({ error: "FORBIDDEN", message: "Only HR Executives may reset demo data." }, 403);
    }
  }

  try {
    const { created, idByEmail } = await ensureDemoAuthUsers(supabase);
    await reseed(supabase, idByEmail);
    return jsonResponse({
      ok: true,
      created_users: created,
      seeded: {
        organizations: 1,
        digital_twins: buildTwins({}).length,
        skill_graph: SKILLS.length,
        job_requisitions: REQUISITIONS.length,
        onboarding_journeys: 1,
        recommendations: RECOMMENDATIONS.length,
      },
    });
  } catch (err) {
    console.error("reset-demo failed:", err);
    return jsonResponse({ error: "INTERNAL", message: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
