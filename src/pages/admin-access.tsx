import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  History,
  Loader2,
  Lock,
  MailPlus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { can } from "@/lib/rbac";
import {
  ADMIN_ASSIGNABLE_ROLES,
  adminAccessInvite,
  adminAccessReactivate,
  adminAccessSuspend,
  adminAccessUpdateRole,
  type AdminActionRow,
} from "@/lib/api";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  department: string | null;
  job_title: string | null;
  auth_user_id: string | null;
}

const ROLE_CHIP: Record<string, string> = {
  hr_executive: "bg-primary text-white",
  hr_partner: "bg-primary text-white",
  manager: "bg-secondary text-white",
  recruiter: "bg-accent text-foreground",
  employee: "bg-accent text-foreground",
  it_security: "bg-secondary text-white",
  candidate: "bg-muted text-foreground",
};

const ACTION_LABEL: Record<string, string> = {
  invite: "Invited",
  update_role: "Role changed",
  suspend: "Suspended",
  reactivate: "Reactivated",
};

export default function AdminAccess() {
  const { role, twin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // dialogs
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<string>("employee");
  const [busyInvite, setBusyInvite] = useState(false);

  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null);
  const [roleValue, setRoleValue] = useState("employee");
  const [roleReason, setRoleReason] = useState("");
  const [busyRole, setBusyRole] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<MemberRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [busySuspend, setBusySuspend] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["admin-members", twin?.id ?? "anon"],
    queryFn: async () => {
      const { data } = await supabase
        .from("digital_twins")
        .select("id, name, email, role, status, department, job_title, auth_user_id")
        .order("name");
      return (data ?? []) as MemberRow[];
    },
  });

  // Merged security audit feed: access-management actions + candidate
  // conversions + policy waivers, sorted newest first.
  const audit = useQuery({
    queryKey: ["admin-audit", twin?.id ?? "anon"],
    queryFn: async () => {
      const [adm, conv, wv] = await Promise.all([
        supabase
          .from("admin_actions")
          .select("id, action, actor_twin_id, target_twin_id, target_email, before_data, after_data, reason, created_at")
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("application_stage_events")
          .select("id, new_stage, reason, at")
          .in("new_stage", ["selected", "rejected"])
          .order("at", { ascending: false })
          .limit(30),
        supabase
          .from("onboarding_tasks")
          .select("id, task_code, waiver, updated_at")
          .not("waiver", "is", null)
          .order("updated_at", { ascending: false })
          .limit(30),
      ]);
      const events: { id: string; kind: string; label: string; detail: string; reason: string | null; at: string }[] = [];
      for (const a of (adm.data ?? []) as AdminActionRow[]) {
        events.push({ id: `adm:${a.id}`, kind: a.action, label: (ACTION_LABEL[a.action] ?? a.action).toUpperCase(), detail: a.target_email ?? "member", reason: a.reason, at: a.created_at });
      }
      for (const c of (conv.data ?? []) as { id: string; new_stage: string; reason: string | null; at: string }[]) {
        events.push({ id: `conv:${c.id}`, kind: "convert", label: c.new_stage === "selected" ? "CANDIDATE_CONVERTED" : "CANDIDATE_DECISION", detail: c.reason ?? "application decision", reason: null, at: c.at });
      }
      for (const w of (wv.data ?? []) as { id: string; task_code: string; waiver?: { by_name?: string; reason?: string; policy_basis?: { doc_code?: string } }; updated_at: string }[]) {
        events.push({ id: `wv:${w.id}`, kind: "waive", label: "POLICY_WAIVED", detail: `${w.task_code} · ${w.waiver?.by_name ?? "manager"}${w.waiver?.policy_basis?.doc_code ? ` · ${w.waiver.policy_basis.doc_code}` : ""}`, reason: w.waiver?.reason ?? null, at: w.updated_at });
      }
      return events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members.data ?? []).filter((m) => {
      if (m.role === "candidate" && roleFilter !== "candidate") return false; // candidates shown only when explicitly filtered
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (statusFilter === "suspended" && m.status !== "suspended") return false;
      if (statusFilter === "active" && m.status === "suspended") return false;
      if (q && !`${m.name} ${m.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members.data, search, roleFilter, statusFilter]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-members", twin?.id ?? "anon"] });
    void qc.invalidateQueries({ queryKey: ["admin-audit", twin?.id ?? "anon"] });
  };

  const doInvite = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invEmail.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusyInvite(true);
    try {
      const res = await adminAccessInvite(invEmail.trim(), invRole, invName.trim() || invEmail.trim().split("@")[0]);
      // Demo invitation token — fictional artifact for the walkthrough.
      const token = `WS-INV-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      setInviteToken(token);
      setInvitedEmail(res.email);
      setInvEmail("");
      setInvName("");
      toast.success(`${res.email} invited as ${res.role}.`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusyInvite(false);
    }
  };

  const doRole = async () => {
    if (!roleTarget) return;
    if (roleReason.trim().length < 5) {
      toast.error("A rationale of at least 5 characters is required.");
      return;
    }
    setBusyRole(true);
    try {
      await adminAccessUpdateRole(roleTarget.id, roleValue, roleReason.trim());
      toast.success(`${roleTarget.name}: role set to ${roleValue.replace(/_/g, " ")}.`);
      setRoleTarget(null);
      setRoleReason("");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role change failed");
    } finally {
      setBusyRole(false);
    }
  };

  const doSuspend = async (reactivate: boolean) => {
    if (!suspendTarget) return;
    if (suspendReason.trim().length < 5) {
      toast.error("A rationale of at least 5 characters is required.");
      return;
    }
    setBusySuspend(true);
    try {
      if (reactivate) {
        await adminAccessReactivate(suspendTarget.id, suspendReason.trim());
        toast.success(`${suspendTarget.name} reactivated.`);
      } else {
        await adminAccessSuspend(suspendTarget.id, suspendReason.trim());
        toast.success(`${suspendTarget.name} suspended — they will be signed out on next check.`);
      }
      setSuspendTarget(null);
      setSuspendReason("");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusySuspend(false);
    }
  };

  if (role && !can(role, "manage_users")) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Lock className="h-8 w-8" />
          </span>
          <h1 className="text-2xl font-extrabold text-foreground">Administrator access only</h1>
          <p className="text-muted-foreground">User access administration is restricted to Administrators.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Platform administration</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">Platform Access & Governance Console</h1>
            <p className="max-w-2xl text-muted-foreground">
              Member directory, invitations, role changes and account suspension — every action is
              written to the append-only security audit log. All demo data is fictional.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAuditOpen(true)}>
              <History className="h-4 w-4" /> Audit log
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <MailPlus className="h-4 w-4" /> Invite member
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="h-8 w-56 border-0 bg-transparent shadow-none focus-visible:ring-0"
              aria-label="Search members by name or email"
            />
          </label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
            className="h-10 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">All roles</option>
            {ADMIN_ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
            <option value="hr_partner">hr partner</option>
            <option value="it_security">it security</option>
            <option value="candidate">candidate</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="h-10 rounded-md border border-border bg-white px-3 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <span className="ml-auto text-xs text-muted-foreground">{visible.length} members</span>
        </div>

        {/* Directory table */}
        {members.isLoading ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-muted p-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading member directory…
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg bg-white">
            <table className="w-full min-w-[760px] border-separate border-spacing-0">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Member</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Department</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${ROLE_CHIP[m.role] ?? "bg-muted text-foreground"}`}>
                        {m.role.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                        m.status === "suspended" ? "bg-destructive/10 text-destructive" : "bg-secondary/10 text-secondary"
                      }`}>
                        {m.status === "suspended" ? <Ban className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{m.department ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="secondary" disabled={m.role === "candidate"}>
                              <UserCog className="h-4 w-4" /> {m.role === "candidate" ? "Pipeline only" : "Manage"}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>{m.name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => {
                                setRoleTarget(m);
                                setRoleValue(m.role);
                                setRoleReason("");
                              }}
                            >
                              <UserCog className="mr-2 h-4 w-4" /> Update role
                            </DropdownMenuItem>
                            {m.status === "suspended" ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setSuspendTarget(m);
                                  setSuspendReason("");
                                }}
                              >
                                <RotateCcw className="mr-2 h-4 w-4 text-secondary" /> Reactivate account
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={m.id === twin?.id}
                                onSelect={() => {
                                  setSuspendTarget(m);
                                  setSuspendReason("");
                                }}
                              >
                                <Ban className="mr-2 h-4 w-4 text-destructive" />
                                {m.id === twin?.id ? "Can't suspend yourself" : "Suspend account"}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">No members match the current filters.</p>
            )}
          </div>
        )}

        <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted p-4 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Role and suspension changes apply immediately and are enforced server-side. Candidates are managed through
          the recruitment pipeline, not this roster. All data is fictional demo data.
        </p>
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => !o && setInviteOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MailPlus className="h-5 w-5 text-primary" /> Invite a member
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-email">Work email</Label>
              <Input id="inv-email" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="name@organization.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-name">Display name (optional)</Label>
              <Input id="inv-name" value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="e.g. Jamie Rivera" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-role">Initial role</Label>
              <select
                id="inv-role"
                value={invRole}
                onChange={(e) => setInvRole(e.target.value)}
                className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
              >
                {ADMIN_ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Invited members sign in with the demo password and can change their role later. Fictional demo account.
            </p>
            {inviteToken && invitedEmail && (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Invitation issued · {invitedEmail}</p>
                <p className="mt-1 select-all font-mono text-sm font-bold text-primary">{inviteToken}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Demo invitation token — share it with the invitee. The account is already created with the demo password.
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void doInvite()} disabled={busyInvite}>
                {busyInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                Issue invitation
              </Button>
              {inviteToken && (
                <Button variant="outline" onClick={() => { setInviteOpen(false); setInviteToken(null); setInvitedEmail(null); }}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Update role dialog */}
      <Dialog open={!!roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-primary" /> Update role · {roleTarget?.name}
            </DialogTitle>
          </DialogHeader>
          {roleTarget && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="role-value">New role</Label>
                <select
                  id="role-value"
                  value={roleValue}
                  onChange={(e) => setRoleValue(e.target.value)}
                  className="h-11 rounded-md bg-muted px-3 text-sm font-medium text-foreground focus:border-2 focus:border-primary focus:outline-none"
                >
                  {ADMIN_ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="role-reason">Rationale (required for the audit log)</Label>
                <Textarea id="role-reason" rows={3} value={roleReason} onChange={(e) => setRoleReason(e.target.value)} placeholder="Why is this role changing?" />
              </div>
              <Button onClick={() => void doRole()} disabled={busyRole || roleReason.trim().length < 5}>
                {busyRole ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
                Apply role change
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suspend / reactivate dialog */}
      <Dialog open={!!suspendTarget} onOpenChange={(o) => !o && setSuspendTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {suspendTarget?.status === "suspended" ? (
                <RotateCcw className="h-5 w-5 text-secondary" />
              ) : (
                <Ban className="h-5 w-5 text-destructive" />
              )}
              {suspendTarget?.status === "suspended" ? `Reactivate ${suspendTarget?.name}` : `Suspend ${suspendTarget?.name}`}
            </DialogTitle>
          </DialogHeader>
          {suspendTarget && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {suspendTarget.status === "suspended"
                  ? "Reactivation restores access immediately. Recorded in the audit log."
                  : "Suspended members are signed out on their next check and cannot use the platform until reactivated."}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="suspend-reason">Rationale (required for the audit log)</Label>
                <Textarea id="suspend-reason" rows={3} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Why is this account being suspended or restored?" />
              </div>
              <Button
                variant={suspendTarget.status === "suspended" ? "default" : "destructive"}
                onClick={() => void doSuspend(suspendTarget.status === "suspended")}
                disabled={busySuspend || suspendReason.trim().length < 5}
              >
                {busySuspend ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {suspendTarget.status === "suspended" ? "Reactivate account" : "Suspend account"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Audit drawer */}
      <Drawer open={auditOpen} onOpenChange={(o) => !o && setAuditOpen(false)}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Security audit log
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-6 pb-6">
            <p className="text-xs text-muted-foreground">
              Security events across the organization — access management, candidate conversions and policy waivers — newest first.
            </p>
            {audit.isLoading && (
              <div className="flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {audit.data && audit.data.length === 0 && (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No security events recorded yet.</p>
            )}
            {(audit.data ?? []).map((ev) => (
              <div key={ev.id} className="rounded-lg bg-muted p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    {ev.kind}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(ev.at).toLocaleString()}</span>
                </div>
                <p className="mt-1.5 text-sm font-bold text-foreground">{ev.label}</p>
                <p className="text-xs text-muted-foreground">{ev.detail}</p>
                {ev.reason && <p className="mt-1 text-xs text-foreground">{ev.reason}</p>}
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </AppShell>
  );
}
