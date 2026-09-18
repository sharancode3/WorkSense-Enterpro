# WorkSense — Full Build Report

**Project:** AI-driven Intelligent Workforce Management Platform (Track 1 HR hackathon)
**Status:** All phases (0–8) + Section 11 Qwen specs built, QA'd, and live-verified. Demo-ready.

---

## 1. Architecture

```
EnterPro Frontend (Vite + React + TS + Tailwind)  — 8 screens, role-aware
        │  supabase-js (RLS-scoped reads) + backend function calls
Enter Cloud Backend (Postgres + Auth + 20 backend functions)
        │
        ├── 5 deterministic engines  (zero LLM — matching, scheduling, waivers,
        │                             risk signal, policy retrieval, triggers, dashboards)
        └── 5 Qwen calls             (extract, rubric/kit, policy answer, performance
                                     narrative, recommendation rationale — language only)
```

**Core principle:** deterministic where it can be, AI only where it must be. The LLM never computes a score, never sets urgency, never decides sign-off, never invents policy.

## 2. Design System (Flat)

- Single source of truth in `src/index.css` + `tailwind.config.ts`: `#FFFFFF / #111827 / #3B82F6 / #10B981 / #F59E0B / #F3F4F6 / #E5E7EB`, Outfit font, `rounded-md/lg`.
- **Zero box-shadows** (audited and stripped from dialogs/dropdowns/toasts), hover = scale + color shift only, light mode only.
- Verified identical across every screen — no color/radius/shadow drift.

## 3. Auth & RBAC — 6 roles

One-click personas (zero typing) on the Sign-In page; real JWTs + RLS per role.

| Role | Badge | Persona | Sees |
|---|---|---|---|
| Administrator | ADMIN | Dana Whitmore | Everything + Reset Demo + Skill Graph + Hub |
| HR Business Partner | HR | Riley Morgan | Org-wide read + Hub approvals (hr-signoff) |
| People Manager | MANAGER | Jordan Reyes | Own team only (server-enforced) + Hub (manager-signoff) |
| Technical Recruiter | RECRUITER | Chris Okafor | Candidates + requisitions + Recruitment Studio |
| Employee | EMPLOYEE | Alex Chen | Self-service (own twin, journey, signal, policy) |
| Candidate | CANDIDATE | Priya Nair | Status + own skill summary only (403 on scores/rubrics/notes) |

RBAC is enforced at the **data layer** (RLS policies on all 6 tables + role checks inside every backend function), never by hiding UI. Verified: manager→candidate 403, employee→coworker 403, employee→requisition-create 403, employee→dashboard 403.

## 4. Data Model — 6 entities (no 7th table)

`organizations` (policies[] chunked) · `digital_twins` (person: skills, signals, computed_fits[], audit_events[], performance_synthesis) · `job_requisitions` (required/future skills, applicants[], rubrics[], audit) · `skill_graph` (typed edges) · `onboarding_journeys` (tasks[], status, plan, audit) · `recommendations` (evidence_ledger, status machine, audit).

Computed fits and audit trails live as sub-fields — the "Audit Trail" is a read-only aggregation, not a table.

## 5. Deterministic Engines (shared modules, unit-tested)

| Engine | What it does | Proven by |
|---|---|---|
| `skill-graph-engine` | Exact match formula `0.50·direct + 0.25·adjacent + 0.15·evidence + 0.10·seniority`; Direct/Adjacent/Transferable/Gap classification with edge display | Live: Priya 0.655, Maya 0.83, Alex 0.39/0.17 |
| `onboarding-engine` | Bloom-style waivers, non-waivable guard, Kahn's topological scheduler (cycle → error), date assignment, blocker-aware recompute | 11 tests; live dual-approval + blocker flows |
| `policy-retrieval` | BM25 retrieval, calibrated abstention threshold (covered ≥2.4, uncovered 0.0), verbatim citation validator | 8 tests; live grounded + abstention |
| `workforce-signal-engine` | `min(1, 0.28·tenure + 0.20·attendance + 0.22·delivery + 0.12·growth)`, own-baseline attendance, reserved 0.18 | 6 tests; live Samira = **72/100** |
| `recommendation-engine` | Cross-source triggers: retention (>65), mobility (>65 + strong perf + ≥70% soft fit ≥2 paths), onboarding replan (blocker) | 5 tests; live dedup + replan |

## 6. Backend Functions (20 deployed)

**Foundation:** `me` (role resolver) · `reset-demo` (bootstrap/reset seed) · `candidate-status` (public view + 403 contract)
**Recruitment:** `requisition` (create/update/apply + stale-marking on skill changes) · `skill-match` (compute + cache + persist fits) · `extract-resume` (6.1) · `rubric` (6.2, cached per role) · `interview-kit` (6.2, gap-biased probes) · `evaluate-interview` (structured 5-tier eval) · `recruiter-decision` (stages + atomic candidate→employee conversion + fit-on-conversion)
**Onboarding:** `onboarding-plan` (fit vs own role current+future → Kahn plan → pending) · `onboarding-approve` (Manager + HR dual approval → active) · `onboarding-task` (complete / block / resolve + date recompute)
**Policy:** `policy-qa` (retrieval → abstention gate → 6.3 grounded answer → validator) · `escalate` (→ HR recommendation)
**Intelligence:** `workforce-signal` (deterministic score, persisted) · `performance-synthesis` (deterministic aggregates + on-demand 6.x narrative, cached)
**Hub:** `recommendation-scan` (trigger engine + 6.4 rationale, dedup) · `recommendation-decision` (state machine: needs_review→approved|rejected→dispatched→completed; real effects + audits)
**Dashboard:** `dashboard` (org/team aggregation, heatmap, rec feed — scope decided server-side)

## 7. Screens

- `/` **Landing** — hero, Evidence→Reasoning→Recommendation→Approval→Action flow, 6 role demo cards, "Not a chatbot" section, closing one-liner footer
- `/login` — reference-style card: sign-in form + collapsible Demo Environment Quick Access
- `/candidate-status` — public status + skill summary; explicit 403 demo
- `/app` — **Executive Dashboard** (HR/Partner/Manager): 6 real-data cards, future-skill gap heatmap, urgency-sorted Recommended Actions feed → drills into Hub · **Recruiter home** (pipeline) · **Employee home** (journey + signal)
- `/graph` — Skill Graph Explorer (HR Exec): twin × requisition, current **and** future fit cards, graph browser
- `/recruitment` — create req → applicants → Fit card → resume intake → kit → evaluate → Select
- `/onboarding` — wave-by-wave DAG, waive/required/blocked states, dual-approval banner, blocker reporting
- `/policy` — grounded (green) / partially-supported (amber) / insufficient (red) + Escalate to HR
- `/hub` — evidence cards → reasoning → action → typed-rationale Approve/Reject/More-Review/Dispatch + audit trail

## 8. Where AI is used (and only here)

Resume extraction (2) · rubric/kit generation (2) · grounded policy answer (4) · performance narrative on-demand (5) · recommendation rationale (6). Everything else is deterministic and instant.

## 9. Testing & Verification

- **62 unit tests** (10 files): engines (skill-match, Kahn/waivers, BM25/abstention, signal, triggers), RBAC, candidate-403 contract, prompt-injection sanitizer.
- **Live API verification** of every function: login×6, RBAC 403 matrix, dual approval, atomic conversion (skills/fits/audit preserved), dispatch effects (twin flag + journey reopen + mirrored audits), caching, grounded answers with verbatim quotes, calibrated abstention.
- lint / `tsc --noEmit` / `pnpm build` all green.
- Two QA bugs found & fixed: `me` role resolver (blank /app after login) and seed journey shape (empty DAG view) — both re-verified.

## 10. Caveats

- The 5 LLM moments depend on the laptop **ngrok tunnel** (Ollama → `qwen3:4b-instruct-2507-q4_K_M`) — accepted deviation from the frozen spec; all deterministic features keep working if it drops.
- Demo-optimized auth (fixed persona accounts, no production hardening); light-mode only per the design system.
- Use **Reset Demo Data** (Admin menu) before presenting to restore the golden state.
