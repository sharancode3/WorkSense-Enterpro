// ---------------------------------------------------------------------------
// Phase 15 — LLM response cache (API credit conservation).
// Deterministic key = (org, task, input_hash, model). Functions check the
// cache before calling the model and store validated outputs after a
// successful generation. Staleness trade-off: cached policy answers assume
// the policy corpus is unchanged — acceptable for the demo corpus, documented.
// ---------------------------------------------------------------------------

/** djb2-style deterministic hash (unique name to avoid flat-bundle collisions). */
export function cacheKeyHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export async function cacheGet(supabase, orgId: string, task: string, inputHash: string, model: string): Promise<unknown | null> {
  const { data } = await supabase
    .from("llm_cache")
    .select("output")
    .eq("org_id", orgId)
    .eq("task", task)
    .eq("input_hash", inputHash)
    .eq("model", model)
    .maybeSingle();
  return (data?.output as unknown) ?? null;
}

export async function cacheSet(supabase, orgId: string, task: string, inputHash: string, model: string, output: unknown): Promise<void> {
  await supabase
    .from("llm_cache")
    .upsert({ org_id: orgId, task, input_hash: inputHash, model, output }, { onConflict: "org_id,task,input_hash" });
}
