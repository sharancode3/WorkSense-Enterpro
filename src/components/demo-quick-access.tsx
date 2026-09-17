import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { DEMO_ACCOUNTS, DEMO_CANDIDATE_CODE } from "@/lib/demo-accounts";
import type { Role } from "@/lib/rbac";
import { RoleCard, type CardTone } from "@/components/role-card";

const ROLE_TONE: Record<string, CardTone> = {
  hr_executive: "dark",
  hr_partner: "primary",
  manager: "secondary",
  recruiter: "accent",
  employee: "muted",
  it_security: "secondary",
};

/**
 * The "Demo Environment Quick Access" grid — one-click personas matching the
 * reference UI: Administrator, HR Business Partner, People Manager, Technical
 * Recruiter, Employee, Candidate. Zero typing; real JWT + RLS per role.
 */
export function DemoQuickAccess() {
  const { signInDemo } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const enterAs = async (role: Exclude<Role, "candidate">) => {
    setBusy(role);
    try {
      await signInDemo(role);
      navigate("/app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demo login failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {DEMO_ACCOUNTS.map((account) => (
        <RoleCard
          key={account.role}
          tone={ROLE_TONE[account.role]}
          eyebrow={account.badge}
          title={account.name}
          description={account.blurb}
          meta={account.email}
          cta="One-click demo"
          loading={busy === account.role}
          onClick={() => void enterAs(account.role)}
        />
      ))}

      <RoleCard
        tone="muted"
        eyebrow="CANDIDATE"
        title="Candidate"
        description="Check your application status and see your extracted skill summary."
        meta="no login needed"
        cta="View status"
        onClick={() => navigate(`/candidate-status?code=${DEMO_CANDIDATE_CODE}`)}
      />

      <div className="col-span-full flex items-center gap-3 rounded-lg bg-muted px-5 py-4">
        <ExternalLink className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} />
        <p className="text-sm leading-relaxed text-foreground">
          Each card signs into a pre-seeded persona with real credentials. Role-based access is
          enforced at the data layer — not hidden UI.
        </p>
      </div>
    </div>
  );
}
