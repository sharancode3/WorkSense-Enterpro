import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { DEMO_ACCOUNTS, DEMO_CANDIDATE_CODE } from "@/lib/demo-accounts";
import { RoleCard, type CardTone } from "@/components/role-card";

const ROLE_TONE: Record<string, CardTone> = {
  hr_executive: "primary",
  manager: "secondary",
  employee: "accent",
};

export function DemoAccessPanel() {
  const { signInDemo } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const enterAs = async (role: "hr_executive" | "manager" | "employee") => {
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {DEMO_ACCOUNTS.map((account) => (
        <RoleCard
          key={account.role}
          tone={ROLE_TONE[account.role]}
          eyebrow={`Enter as ${account.role.replace("_", " ")}`}
          title={account.name.split(" ")[0] + "'s view"}
          description={account.blurb}
          cta="Enter demo"
          loading={busy === account.role}
          onClick={() => void enterAs(account.role)}
        />
      ))}

      <RoleCard
        tone="muted"
        eyebrow="No login needed"
        title="Candidate view"
        description="Check your application status and see your extracted skill summary."
        cta="View status"
        onClick={() => navigate(`/candidate-status?code=${DEMO_CANDIDATE_CODE}`)}
      />

      <div className="flex flex-col items-start justify-center gap-2 rounded-lg bg-background p-6 md:col-span-2 lg:col-span-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Why instant?</span>
        <p className="text-sm leading-relaxed text-foreground">
          One click logs into a pre-seeded demo persona with real credentials — zero typing, real
          role-based access.
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          <ExternalLink className="h-3 w-3" /> live demo path
        </span>
      </div>
    </div>
  );
}
