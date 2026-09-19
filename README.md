# WorkSense — AI-Driven Workforce Management Platform

[![Built with enter.pro](https://img.shields.io/badge/Build%20with-Enter.pro-FC5776?style=for-the-badge&labelColor=1F1F1F)](https://enter.pro)

WorkSense is a **Track-1 HR** intelligent workforce management platform. It reasons over
multiple HR data sources (digital-twin employee records, skill evidence, onboarding plans,
requisitions, candidate sessions, policy documents, performance and review signals) and
recommends **actions** — every recommendation is approved by a human before it moves.

It is a full demo: the data is **real, seeded dummy data** stored in the backend and served
through real queries and computation. Nothing shown is a hard-coded output — scores, counts,
fit percentages and statuses are computed by backend functions from the seeded rows.

---

## The eight problem-statement systems

| PS capability | Where it lives | How it works (computed, never hard-coded) |
|---|---|---|
| **AI Recruitment Intelligence Engine** | `/recruitment` (Recruiter) | Candidates ranked by `skill-match` against requisition `required_skills` using the Skill Graph (direct / adjacent / transferable / gap), evidence rigor and seniority. |
| **Adaptive Onboarding Agent** | `/onboarding` (Employee / Manager / HR / IT) | Personalized adaptive plans built from role + department + profile, scheduled as a DAG with enforced owner/evidence, versioned approvals and a role-scoped queue. |
| **HR Policy Reasoning Agent** | `/policy` (Policy Studio) | Deterministic retrieval with verbatim quotes, date-aware applicability filters; the model grounds answers in citations or honestly abstains. |
| **Employee Attrition Prediction** | `/workforce` (Workforce Review) | A Workforce Review Index (0–100) built from workforce patterns + engagement signals — decision support, honestly labeled as not a probability. |
| **AI Performance Intelligence** | `/workforce` reviewer drafts | Goals/feedback/performance history synthesized into strengths + improvement areas; drafts are human-confirmed, never auto-finalized. |
| **Workforce Skill Graph** | `/graph` (Skill Graph) | Maps verified skills vs current and **future** requirements with evidence lineage, taxonomy edges, and a computed **development trajectory** (Today → Future target → Projected with planned development). Deep-linkable: `/graph?person=<id>&demand=<id>`. |
| **Intelligent Interview Agent** | `/recruitment` (Recruitment & Interview Studio) | Role-specific question kits, rubric-based assessment, structured insights; sessions are human-reviewed end to end. |
| **HR Decision Dashboard** | `/app` home + `/workforce` | Combines onboarding, workforce review, hiring funnel, future-skill readiness heatmap and recommendations into actionable panels, server-scoped per role. |

Also on the platform: **staffing planner** (constrained scenario engine), **recommendation &
action hub** (enforced lifecycle + idempotent actions), **access & governance console**, **system
health telemetry**, **data-quality engine**, and a public **candidate portal**.

> The whole PS map is also on the app itself at `/showcase`.

---

## Personas (demo sign-in)

Sign in from the login page with any of these (password `WorkSenseDemo!2026`), or use the
quick-access cards:

| Role | Person | Scope |
|---|---|---|
| Administrator | Dana Whitmore (`dana@worksense.demo`) | Org-wide + governance |
| HR Business Partner | Riley Morgan (`riley@worksense.demo`) | Org-wide |
| People Manager | Jordan Lee (`jordan@worksense.demo`) | Own team only |
| Technical Recruiter | Chris Okafor (`chris@worksense.demo`) | Hiring pipeline |
| Employee | Alex Chen (`alex@worksense.demo`) | Self-service |
| IT Provisioning | Elena Costa (`elena@worksense.demo`) | Provisioning handoffs |
| Candidate | Priya Nair (`priya@worksense.demo`) | Candidate portal |

**Role scope is enforced server-side** (RLS policies + backend function gates). A manager can
never widen a query to the full org; a recruiter never sees employee twins. The sidebar badge
shows each role's scope, and every shared page carries a "How this page differs by role" hint.

---

## Architecture

```
src/                        Vite + React + TypeScript frontend
  pages/                    Route-level pages (role-home, onboarding, recruitment, …)
  components/               Shared UI (app-shell, fit-card, my-work-feed, …)
    home/                   Role-home panels (extracted from role-home.tsx)
  lib/                      Client logic: api.ts (backend-function clients + contracts),
                            rbac.ts, navigation.ts, skill-graph.ts, onboarding-progress.ts, …
supabase/functions/         Backend functions (Deno edge functions) — auth, DB, computation
  _shared/                  Pure engines + unit tests (skill-graph-engine, onboarding-v2,
                            my-work-engine, staffing-review, recommendation-engine, …)
  migrations/               Versioned schema + RLS migrations
scripts/                    Verification suites (verify-batch-*.mjs, check-functions.mjs)
docs/coverage-matrix.md     Batch-by-batch PS coverage ledger
PROGRESS.md                 Delivery log (§1–§54)
```

Design principles:

- **Deterministic engines, zero LLM in the loop** for anything that can be computed (fits,
  queues, readiness, review index, staffing feasibility). The LLM writes prose (policy answers,
  interview evaluation) and the facts are still deterministic.
- **Versioned results** — fits, plans and proposals carry fingerprints (engine/evidence/
  requisition/graph), so caches recompute automatically when underlying data changes.
- **Role-scoped everything** — the client can ask, but only the server grants.

---

## Local development

```bash
pnpm install
pnpm dev          # start Vite (frontend)
```

The backend is the managed Enter Cloud instance wired through `src/integrations/supabase/client.ts`.

**Quality gate** (runs lint + TypeScript for app/functions + function manifest checks + unit tests):

```bash
pnpm check
pnpm build        # production build (frontend)
```

**Live verification** (against the deployed backend, ends with a pristine demo reset):

```bash
node scripts/verify-batch-1.mjs   # …batch-2 …batch-8, batch-10, verify-53.mjs
```

The test suite (Vitest) currently covers **418 unit tests across 41 files**, including the pure
engines and the skill-graph future projection.

---

## Honesty notes

- The **AI gateway** is an external dependency; when it is unreachable, model-written prose
  features degrade gracefully (deterministic parts keep working). The status page
  (`/status`) shows live telemetry.
- Attrition is **decision support**, not a probability. The future skill score answers "today's
  profile vs tomorrow's requirements"; the development trajectory models evidence-grounded
  growth on top of it.
- All data is fictional and seeded for this preview. `Reset demo` (account menu, admin roles)
  restores the known-good state.

---

## Continue building

Keep developing this app in Enter.pro — prompt new features, refine the UI, or connect
integrations. All changes are versioned and synced automatically.
