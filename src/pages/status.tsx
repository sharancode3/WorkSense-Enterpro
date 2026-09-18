import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { fetchHealth } from "@/lib/api";
import { can } from "@/lib/rbac";
import { BUILD_INFO } from "@/generated/build-info";
import { Activity, CheckCircle2, Clock, Loader2, Lock, RefreshCw, Server, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SystemStatus() {
  const { role } = useAuth();
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const health = useQuery({
    queryKey: ["health-status", startedAt],
    queryFn: async () => {
      const t0 = performance.now();
      const res = await fetchHealth();
      return { ...res, latency_ms: performance.now() - t0 };
    },
    refetchInterval: 30_000,
  });

  const latency = useMemo(() => health.data?.latency_ms, [health.data]);

  if (role && !can(role, "manage_users") && !can(role, "view_all_workforce")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">System status access only</h1>
          <p className="text-muted-foreground">Model telemetry is restricted to workforce administrators.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Platform operations</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">System & model health</h1>
            <p className="max-w-2xl text-muted-foreground">
              Live telemetry for the AI gateway and the application backend. Background generation jobs are surfaced
              per task in the recruitment and recommendation flows — this page reports infrastructure health only.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setStartedAt(Date.now())} disabled={health.isFetching}>
            {health.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        </div>

        {health.isLoading && (
          <div className="mt-8 flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Probing the gateway…
          </div>
        )}
        {health.error && (
          <div className="mt-8 rounded-lg bg-destructive/10 p-6 text-sm text-destructive">
            Telemetry unavailable: {health.error instanceof Error ? health.error.message : "unknown error"}
          </div>
        )}

        {health.data && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white p-5">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Server className="h-3.5 w-3.5" /> App backend
              </p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-extrabold text-foreground">
                <CheckCircle2 className="h-5 w-5 text-secondary" /> {health.data.app_backend}
              </p>
            </div>
            <div className="rounded-lg bg-white p-5">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3.5 w-3.5" /> AI gateway
              </p>
              <p className={`mt-2 text-2xl font-extrabold ${health.data.gateway === "reachable" ? "text-secondary" : "text-destructive"}`}>
                {health.data.gateway === "reachable" ? "Reachable" : "Unreachable"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                model ready: <b className="text-foreground">{health.data.model_ready ? "yes" : "no"}</b>
                {typeof health.data.gateway_authenticated === "boolean" && ` · tunnel auth: ${health.data.gateway_authenticated ? "ok" : "off"}`}
              </p>
            </div>
            <div className="rounded-lg bg-white p-5">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Zap className="h-3.5 w-3.5" /> Latency
              </p>
              <p className="mt-2 text-2xl font-extrabold text-foreground">{latency !== undefined ? `${latency.toFixed(0)} ms` : "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">time for the /health probe (p50 ~150 ms typical)</p>
            </div>
            <div className="rounded-lg bg-white p-5">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Versions
              </p>
              <p className="mt-2 font-mono text-sm font-bold text-foreground">{health.data.model}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                build {BUILD_INFO.commit.slice(0, 7)} · schema {BUILD_INFO.schemaVersion} · {new Date(BUILD_INFO.builtAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        <p className="mt-6 flex items-start gap-2 rounded-lg bg-muted p-4 text-xs text-muted-foreground">
          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Generation jobs (resume extraction, rubrics, assessments) are durable records surfaced at their point of use
          with recovery links — they are not listed here to avoid exposing per-task activity outside the workflows.
        </p>
      </div>
    </AppShell>
  );
}
