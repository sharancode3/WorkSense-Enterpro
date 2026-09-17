import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getJob } from "../_shared/jobs.ts";

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
  if (!uid) return json({ error: "UNAUTHENTICATED" }, 401);

  const url = new URL(req.url);
  let jobId = url.searchParams.get("job_id") ?? "";
  if (!jobId) {
    try {
      const body = await req.json();
      jobId = String(body?.job_id ?? "").trim();
    } catch {
      /* query-only */
    }
  }
  if (!jobId) return json({ error: "VALIDATION_ERROR", message: "job_id is required." }, 400);

  const job = await getJob(supabase, jobId);
  if (!job) return json({ error: "NOT_FOUND", message: "Job not found." }, 404);
  // Job records are actor-scoped: only the creator may read the status.
  if (job.actor_id !== uid) return json({ error: "FORBIDDEN" }, 403);

  return json({
    ok: true,
    job: {
      id: job.id,
      task: job.task,
      status: job.status,
      model: job.model,
      latency_ms: job.latency_ms,
      tokens_in: job.tokens_in,
      tokens_out: job.tokens_out,
      error_code: job.error_code,
      error_message: job.error_message,
      output: job.output,
      created_at: job.created_at,
      finished_at: job.finished_at,
    },
  });
});
