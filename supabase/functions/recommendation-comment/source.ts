// Batch C (C2): recommendation comments with permissions.
// add — an authorized approver (or the responsible manager) attaches a note.
//       Persisted with a visibility ('all' | 'approvers').
// list — returns the org-scoped thread for a recommendation, honouring the
//        viewer's role: 'approvers' comments are only returned to approver
//        roles (hr_executive / hr_partner / manager).
// Writes happen here (service role) so authorship is always the caller twin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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
    .select("id, role, org_id, email")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (!caller) return json({ error: "UNAUTHENTICATED" }, 401);

  let body: { action?: string; rec_id?: string; comment?: string; visibility?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const action = (body.action ?? "").trim();
  const recId = (body.rec_id ?? "").trim();
  if (!recId) return json({ error: "VALIDATION_ERROR", message: "rec_id is required." }, 400);

  const { data: rec, error: recErr } = await supabase
    .from("recommendations")
    .select("id, org_id, twin_id, required_signoff_role")
    .eq("id", recId)
    .maybeSingle();
  if (recErr || !rec) return json({ error: "NOT_FOUND" }, 404);
  if (rec.org_id !== caller.org_id) return json({ error: "FORBIDDEN" }, 403);

  // Comment authors are the same population that acts on the hub: HR, or the
  // manager responsible for the subject twin (team member / self).
  const mayComment = async (): Promise<boolean> => {
    if (caller.role === "hr_executive" || caller.role === "hr_partner") return true;
    if (caller.role === "manager") {
      return !rec.twin_id || rec.twin_id === caller.id || (await isTeamMember(supabase, caller.id, rec.twin_id));
    }
    return false;
  };

  if (action === "add") {
    if (!(await mayComment())) {
      return json({ error: "FORBIDDEN", message: "Only HR or the responsible manager can comment on this recommendation." }, 403);
    }
    const comment = String(body.comment ?? "").trim().slice(0, 2000);
    if (comment.length === 0) {
      return json({ error: "VALIDATION_ERROR", message: "A comment is required (1–2000 characters)." }, 400);
    }
    const visibility = body.visibility === "approvers" ? "approvers" : "all";
    const { data: row, error: insErr } = await supabase
      .from("recommendation_comments")
      .insert({
        org_id: caller.org_id,
        recommendation_id: recId,
        actor_twin_id: caller.id,
        actor_role: caller.role,
        body: comment,
        visibility,
      })
      .select("id, recommendation_id, actor_twin_id, actor_role, body, visibility, created_at")
      .single();
    if (insErr) return json({ error: "INTERNAL", message: insErr.message }, 500);
    return json({ ok: true, comment: row });
  }

  if (action === "list") {
    const isApprover = ["hr_executive", "hr_partner", "manager"].includes(caller.role);
    const { data, error } = await supabase
      .from("recommendation_comments")
      .select("id, recommendation_id, actor_twin_id, actor_role, body, visibility, created_at")
      .eq("org_id", caller.org_id)
      .eq("recommendation_id", recId)
      .order("created_at", { ascending: true });
    if (error) return json({ error: "INTERNAL", message: error.message }, 500);
    const comments = (data ?? []).filter((c) => c.visibility === "all" || isApprover);
    return json({ ok: true, comments });
  }

  return json({ error: "VALIDATION_ERROR", message: "Unknown action. Use 'add' or 'list'." }, 400);
});
