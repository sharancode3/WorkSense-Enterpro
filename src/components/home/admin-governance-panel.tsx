// Phase 26/27: Administrators land on the Platform Operations & Security
// Governance panel instead of the (removed) duplicate module shortcuts.
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Database, History, ShieldAlert, UserCog } from "lucide-react";

export function AdminGovernancePanel() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground">
          <ShieldAlert className="h-5 w-5 text-primary" strokeWidth={2.5} />
          Platform Operations & Security Governance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enterprise access control, audit logging, model health telemetry, and data quality.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/admin/access"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UserCog className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">ACCESS</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Access & Governance</h3>
            <p className="mt-1 text-xs text-muted-foreground">Directory, role elevation, member invitations & account suspension.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Open Console <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/admin/access?tab=audit"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary/10 text-secondary">
              <History className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-secondary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-secondary">AUDIT</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Security Audit Logs</h3>
            <p className="mt-1 text-xs text-muted-foreground">Access changes, candidate conversions & policy waivers.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-secondary">
            View Audit Trail <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/status"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/30 text-foreground">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-foreground">HEALTH</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">System & Model Health</h3>
            <p className="mt-1 text-xs text-muted-foreground">Qwen gateway state, latency & deployment versions.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-foreground">
            Check Telemetry <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>

        <Link
          to="/workforce/data-quality"
          className="group flex flex-col justify-between gap-3 rounded-lg border-2 border-border bg-white p-5 transition-all duration-200 hover:scale-[1.02] hover:border-primary"
        >
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Database className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">QUALITY</span>
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground">Data Quality Engine</h3>
            <p className="mt-1 text-xs text-muted-foreground">Orphaned claims, missing twin data & assertion rigor distribution.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary">
            Inspect Quality <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>
    </div>
  );
}
