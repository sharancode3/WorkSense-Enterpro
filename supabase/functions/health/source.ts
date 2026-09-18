import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { QWEN_API_KEY, QWEN_BASE_URL, QWEN_GATEWAY_AUTH, QWEN_MODEL, QWEN_TIMEOUT_MS } from "../_shared/qwen.ts";

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

  // App backend reachable (DB round-trip).
  const app = await supabase.from("organizations").select("id", { count: "exact", head: true }).limit(1);

  // Gateway reachable + model ready (short probe; never block long).
  let gateway: "reachable" | "unreachable" = "unreachable";
  let modelReady = false;
  let models: string[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(QWEN_TIMEOUT_MS, 5000));
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${QWEN_API_KEY}` };
    if (QWEN_GATEWAY_AUTH) headers["Authorization"] = QWEN_GATEWAY_AUTH;
    const res = await fetch(`${QWEN_BASE_URL}/models`, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      models = ((data?.data ?? []) as { id?: string }[]).map((m) => m.id ?? "");
      gateway = "reachable";
      modelReady = models.includes(QWEN_MODEL);
    }
  } catch {
    gateway = "unreachable";
  }

  return json({
    ok: true,
    app_backend: "ok",
    gateway,
    model_ready: gateway === "reachable" ? modelReady : false,
    gateway_authenticated: Boolean(QWEN_GATEWAY_AUTH) || QWEN_API_KEY !== "local",
    model: QWEN_MODEL,
    models: models.slice(0, 10),
  });
});
