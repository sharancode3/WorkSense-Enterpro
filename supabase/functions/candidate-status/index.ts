import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fields a candidate may NEVER receive directly — requesting them yields an
// explicit 403, not a silent omission.
const PROTECTED_FIELDS = ["score", "rubric", "notes", "computed_fits", "interview_rubrics", "match_score", "audit_events"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { application_code?: string; include?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }

  const code = (body.application_code ?? "").trim();
  if (!code) {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message: "application_code is required." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Find the requisition whose applicants[] holds this code.
  const { data: reqs, error: reqErr } = await supabase
    .from("job_requisitions")
    .select("id, title, department, applicants");
  if (reqErr) {
    console.error("candidate-status: req lookup failed", reqErr);
    return new Response(JSON.stringify({ error: "INTERNAL" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let applicant: { twin_id: string; stage: string; application_code: string } | null = null;
  let requisition: { id: string; title: string; department: string } | null = null;
  for (const r of reqs ?? []) {
    const match = (r.applicants ?? []).find((a: { application_code?: string }) => a.application_code === code);
    if (match) {
      applicant = match;
      requisition = { id: r.id, title: r.title, department: r.department };
      break;
    }
  }

  if (!applicant || !requisition) {
    return new Response(JSON.stringify({ error: "NOT_FOUND", message: "No application matches this code." }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requested = body.include ?? [];
  const forbidden = requested.filter((f) => PROTECTED_FIELDS.includes(f));
  if (forbidden.length > 0) {
    return new Response(
      JSON.stringify({
        error: "FORBIDDEN_FIELD",
        message: "Scores, rubrics, notes and internal evaluation fields are not available to candidates.",
        fields: forbidden,
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Public, candidate-safe payload: status, stage, and their own skill summary.
  const { data: twin, error: twinErr } = await supabase
    .from("digital_twins")
    .select("id, name, verified_skills")
    .eq("id", applicant.twin_id)
    .maybeSingle();
  if (twinErr || !twin) {
    return new Response(JSON.stringify({ error: "NOT_FOUND", message: "Applicant record not found." }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      application_status: applicant.stage,
      requisition: { title: requisition.title, department: requisition.department },
      applicant: {
        name: twin.name,
        verified_skills: (twin.verified_skills ?? []).map((s: { name: string; proficiency: number }) => ({
          name: s.name,
          proficiency: s.proficiency,
        })),
      },
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
