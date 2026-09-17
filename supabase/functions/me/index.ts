import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resolves the authenticated user's DigitalTwin + role for the auth provider.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: twin } = await supabase
    .from("digital_twins")
    .select("*")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (!twin) {
    return new Response(JSON.stringify({ error: "NO_TWIN", message: "No workforce record for this account." }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, user: { id: userData.user.id, email: userData.user.email }, twin }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
