# Phase 0 — WorkSense Foundation: Design System, Demo Auth, RBAC, Landing, Schema, Seed

## Context

WorkSense is the Track 1 HR hackathon build: an AI-driven workforce management platform
where one shared Skill Intelligence Graph + Recommendation Hub reason over HR data and move
decisions through human-approved workflows. The build spec (v3) is frozen.

Phase 0 delivers only the foundation the later phases stand on: the flat design system,
demo-optimized auth, role-based access control enforced at the data layer, the judge-facing
landing page, the 6-entity data model, and pre-computed seed data. **No AI calling logic is
built in this phase** — Qwen integration is Phase 1+.

The current repo is the stock template (shadcn/ui light+dark tokens, i18n, react-router).
Enter Cloud is **not enabled yet**, so step 1 of implementation is enabling it — everything
in this phase (DB, auth, backend functions, RLS) depends on it.

## Key decisions (within frozen spec, chosen for review)

- **Demo login = real auth, zero typing.** Three seeded auth accounts with fixed
  credentials (`hr@worksense.demo`, `manager@worksense.demo`, `employee@worksense.demo`,
  shared fixed password, auto-confirmed). The landing "Enter as …" buttons call
  `signInWithPassword` with those embedded credentials → instant login, but the session is a
  real JWT so RLS + backend-function role checks are the genuine demo path. No anonymous
  sign-ins.
- **Candidate = no auth account.** Candidates are `digital_twins` rows with
  `auth_user_id = null`. The candidate view is token-driven: a demo application code on the
  landing card → backend function `candidate-status` returns public fields only and returns
  **HTTP 403** when protected fields (score/rubric/notes) are requested — enforced in the
  function, demonstrated in the demo.
- **Policies live on the Organization record** as a `policies` JSONB sub-field (the 6-entity
  invariant is absolute; a 7th table is prohibited). Policy Studio (Phase 2) reads them
  deterministically. Keeps exactly 6 tables.
- **Light mode only** (spec: "Single Palette: Light Mode"). Tokens updated; dark class left
  inert, never toggled.
- **Minimal email login + signup** exists for completeness (signup trigger creates an
  `employee` digital_twin) but is off the demo path.
- **Vitest added** for unit tests on RBAC + protected-field logic (spec lists Vitest).

## Design system (shared tokens — never copy-pasted)

Files: `index.html`, `src/index.css`, `tailwind.config.ts`, `src/components/ui/button.tsx`,
`src/components/ui/card.tsx`.

- `index.html`: add Outfit font (Google Fonts, weights 400–800).
- `src/index.css`: replace `:root` tokens with flat palette — background `0 0% 100%`
  (#FFFFFF), foreground `220 39% 11%` (#111827), primary `217 91% 60%` (#3B82F6),
  secondary `160 84% 39%` (#10B981), accent `38 92% 50%` (#F59E0B), muted `220 14% 96%`
  (#F3F4F6), border `220 13% 91%` (#E5E7EB), radius `0.5rem`. Add base-layer rule
  `* { box-shadow: none !important; }` (zero shadow invariant) + high-contrast focus ring
  utility. Strip the `.dark` block.
- `tailwind.config.ts`: `fontFamily.sans: Outfit`, keep hsl(var()) indirection so all shadcn
  components inherit the flat palette.
- `button.tsx`: default variant → solid primary (`bg-primary text-primary-foreground
  hover:bg-primary/90`), secondary → muted bg, outline → `border-4` + fill-on-hover, all
  `rounded-md`, scale-on-hover (`hover:scale-105`), `transition-all duration-200`, shadow-none.
- `card.tsx`: remove shadow/border; `bg-card rounded-lg p-6` color-block style.

## Data model — 6 tables (all RLS-enabled in the creating migration)

Short stable names; no existing tables in this project.

| Table | Key columns (all with `created_at`) |
|---|---|
| `organizations` | name; `policies[]` JSONB (seeded policy docs) |
| `digital_twins` | org_id; auth_user_id (nullable); role enum `hr_executive\|manager\|employee\|candidate`; status (`candidate\|active\|offboarding`); name, email; department; job_title; manager_id (self-ref); tenure_months; `verified_skills[]` (name, proficiency, evidence_source, verification_rigor); `interview_rubrics[]`; `performance_history[]`; `signals[]` (attendance/engagement); `computed_fits[]` (target_type, target_id, direct/adjacent/transferable/gaps, score, computed_at); `audit_events[]` (actor, action, before/after, ts) |
| `job_requisitions` | org_id; title; department; `required_skills[]` (skill, target_proficiency); `future_skills[]`; `applicants[]` (twin_id, stage, application_code for candidate lookup); `audit_events[]` |
| `skill_graph` | org_id; skill (name, category); `outgoing_edges[]` (target_skill, type `PREREQUISITE_OF\|ADJACENT_TO\|TRANSFERABLE_TO`, weight 0–1) — no direct equivalence edges |
| `onboarding_journeys` | org_id; twin_id; `tasks[]` (id, title, depends_on[], status, waived, approvals[]); `audit_events[]` |
| `recommendations` | org_id; twin_id; category; urgency; `evidence_ledger[]`; proposed_action; status `needs_review\|approved\|rejected\|dispatched\|completed`; required_signoff_role; reviewer_rationale; `audit_events[]` |

- Migration also adds: `updated_at` triggers; **signup trigger** (auth.users insert →
  `employee` digital_twin); security-definer helper `is_team_member(twin_id)` used by manager
  RLS policies (scoped to own reports' subtree).
- RLS policies per table: hr_executive = all rows in org; manager = own row + reports subtree;
  employee = own row; candidate = own row. No `public.profiles` reuse.
- Audit Trail (Phase 3) will be a read-only aggregation over `audit_events[]` — a view, not a table.

## Backend functions (Enter Cloud, one per concern; no raw SQL)

- `reset-demo` — POST only; verifies role `hr_executive` server-side (403 otherwise); truncates
  + re-inserts the seed payload (org, twins, requisitions, skill graph, journeys,
  recommendations). Powers the "Reset Demo Data" button.
- `candidate-status` — takes `application_code` + optional `include[]`; returns public fields
  (status, stage, own skill summary); **403** if `include` requests score/rubric/notes.
- `me` — resolves `auth_user_id` → digital_twin + role + org for the frontend auth provider.

## Seed data (static pre-computed JSON via Enter Cloud insert — no live generation)

- 1 organization ("WorkSense Demo Org") + 5–8 short policy documents in `policies[]`.
- Personas (all skills/risk/rubrics pre-computed): (1) **recent hire mid-onboarding**
  (employee, active onboarding_journey, tasks partially complete); (2) **tenured at-risk
  employee** with strong performance + flagged `signals[]` + high Workforce Review Signal
  baked into a seeded recommendation; (3) **HR Executive** (the demo admin); (4) **Manager**
  owning personas 1–2; (5) 1–2 **candidates** in different pipeline stages on open reqs.
- 2 open `job_requisitions` with `required_skills[]`/`future_skills[]`/`applicants[]`.
- `skill_graph` seed rows (e.g., Docker→Containerization, SQL→Data Modeling) with typed edges.
- 2–3 `recommendations` in `needs_review` with `evidence_ledger[]`.
- Demo auth users (fixed password, auto-confirmed) linked to their digital twins.

## Frontend

- `src/lib/rbac.ts` — role constants, `ROLE_LANDING` map (route per role), `can(role, action)`.
- `src/lib/demo-accounts.ts` — fixed demo credentials + application codes (demo path only).
- `src/contexts/auth-context.tsx` — `onAuthStateChange` listener registered **before** initial
  session check (per Enter Cloud auth rules), non-async callback, deferred supabase calls via
  `setTimeout`; resolves role via `me` function; exposes `{ user, twin, role, signOut, loginDemo }`.
- `src/components/protected-route.tsx` — redirects unauthenticated users; route-level role guard.
- `src/components/app-shell.tsx` — topbar: app name, role badge, sign out; **settings corner**
  with "Reset Demo Data" (admin-only, calls `reset-demo`, confirms then reloads).
- `src/pages/landing.tsx` (replaces template Index) — hero (one-liner + Evidence→Reasoning→
  Recommendation→Approval→Action flat flow-diagram `src/components/flow-diagram.tsx`), 3 role
  cards (`src/components/role-card.tsx` = one-liner + "Enter as [Role]" one-click login),
  "Not a chatbot" differentiator section, demo access panel, minimal login/signup, candidate
  status entry (pre-filled demo code).
- `src/pages/login.tsx` — minimal email/password login + signup (auto-confirm).
- `src/pages/candidate-status.tsx` — token-based status view; "request full evaluation" button
  surfaces the **403** (visible demo of field-level protection).
- `src/pages/role-home.tsx` — one shell component keyed by role (Executive / Manager / Employee
  views land here as stubs; real dashboards land in Phase 1+).
- `src/router.tsx` — routes: `/`, `/login`, `/candidate-status`, `/app` (protected, role-aware).
- `src/lib/api.ts` — typed `functions.invoke` wrappers (`resetDemo`, `candidateStatus`, `me`).

## Tests (Vitest)

- Add `vitest` dev dependency + `"test": "vitest run"` script.
- `src/lib/__tests__/rbac.test.ts` — role→landing map, `can()` matrix (manager cannot access
  other-team actions, candidate cannot request protected fields).
- `src/lib/__tests__/protected-fields.test.ts` — candidate-status include[] sanitizer:
  public-only default, 403 on score/rubric/notes.

## Implementation checklist

- [x] Enable Enter Cloud (`supabase_enable`), then load references before writing schema/auth/function code.
- [x] Add Outfit font link to `index.html`.
- [x] Replace `src/index.css` tokens with flat palette; remove `.dark`; add zero-shadow base rule + focus-ring utility.
- [x] Update `tailwind.config.ts` (Outfit fontFamily; palette via existing hsl indirection).
- [x] Update `button.tsx` and `card.tsx` to flat variants (no shadow, scale hover, border-4 outline).
- [x] Run migration creating the 6 tables with RLS policies, signup trigger, `updated_at` trigger, `is_team_member` helper; verify via schema read + confirm RLS/policies exist.
- [x] Seed: organization + policies, 5 personas (incl. candidates), 2 requisitions, skill_graph rows, onboarding journey, 2–3 recommendations; create demo auth users + link twins; all via the `reset-demo` function (single seed source; static JSON, no live generation).
- [x] Write + deploy `reset-demo` (admin-only, re-inserts seed; one-time bootstrap allowed on uninitialized DB), `candidate-status` (403 on protected includes), `me` (role resolver).
- [x] Build `rbac.ts`, `demo-accounts.ts`, `auth-context.tsx`, `protected-route.tsx`, `app-shell.tsx` (settings corner + reset).
- [x] Build landing page (hero, flow diagram, role cards, differentiator, demo panel, login/signup, candidate entry).
- [x] Build `login.tsx`, `candidate-status.tsx`, `role-home.tsx` shells; wire `router.tsx` with protected `/app`.
- [x] Add Vitest + RBAC/protected-field unit tests; run `pnpm lint`, `tsc --noEmit`, `vitest run`, `pnpm build`.

## Verification checklist

- [x] `pnpm build` and `pnpm lint` + `tsc --noEmit` pass on the committed snapshot.
- [x] Landing renders with zero box-shadows anywhere (inspect + screenshot `desktop_1280` and `mobile_390`); flow diagram shows the 5-step flat blocks.
- [x] One-click "Enter as HR Executive / Manager / Employee" logs in without typing and lands on the correct role shell (verified via API tokens for all 3 demo accounts).
- [x] Manager session cannot fetch another team's digital_twin via direct request (RLS verified: manager sees only self + 2 reports; employee sees only self; HR sees all 7).
- [x] Candidate view with application code shows status + skill summary; requesting score/rubric/notes returns explicit 403 (`FORBIDDEN_FIELD`, HTTP 403).
- [x] HR Executive sees "Reset Demo Data" in settings corner; Manager/Employee do not; reset restores seed state (reset-demo returns 403 for employee, ok + full reseed for HR).
- [x] Minimal signup creates an `employee` digital_twin and allows login (off demo path; auth configured: signup enabled, email auto-confirm).
- [x] `vitest run` passes RBAC + protected-field tests (10 tests, 2 files).
