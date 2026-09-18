# Phase 0 — Baseline & Verification Report (WorkSense)

Committed against local HEAD `615f1af` on branch `enter-main2`. This is a
read-only audit + verification phase: **no feature behavior was changed**; the
work was repairing the verification toolchain, the type contracts, and the
build manifest so later feature phases start from a trustworthy baseline.

---

## 1. Route inventory

Source of truth: `src/router.tsx` (15 routes + catch-all). No route was
removed or added; `ProtectedRoute` wrappers are unchanged.

| Route | Page | Access |
| --- | --- | --- |
| `/` | Landing (demo-persona entry) | public |
| `/login` | Sign in + demo quick-access | public |
| `/candidate-status` | Candidate application status | public (application code) |
| `/candidate/session` | Candidate work-sample / interview session | public (invitation token) |
| `/app` | Role home (role-scoped overview) | authenticated |
| `/graph` | Skill graph explorer | authenticated (role-gated) |
| `/recruitment` | Recruitment & interview studio | recruiter, hr_executive |
| `/onboarding` | Adaptive onboarding plans | authenticated (role-gated) |
| `/policy` | Policy studio | authorized employees |
| `/hub` | Recommendation hub | manager, hr_partner, hr_executive |
| `/workforce` | Workforce review cases | hr, manager, employee(self) |
| `/staffing` | Staffing planner | hr, manager |
| `/admin/access` | Access & audit console | hr_executive |
| `/status` | System & model health | hr_executive |
| `/workforce/data-quality` | Data quality engine | hr_executive |
| `*` | 404 with recovery link | public |

## 2. Role-capability matrix

Sources: `src/lib/rbac.ts` (actions), `src/components/app-shell.tsx` (nav),
and backend function authorization (verified against `source.ts` entry points).

| Capability | Administrator | HR partner | Manager | Recruiter | Employee | IT Security | Candidate |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Org-wide workforce view | ✅ | ✅ | — | — | — | — | — |
| Team view (own scope) | ✅ | ✅ | ✅ | — | — | — | — |
| Own review case / self-service | ✅ | ✅ | ✅ | — | ✅ | — | — |
| Recruitment studio | ✅ | — | — | ✅ | — | — | — |
| Candidate sessions (invitation) | — | — | — | — | — | — | ✅ |
| Onboarding plan view | ✅ | ✅ | ✅ | — | ✅(self) | ✅(self) | — |
| Onboarding approve/adapt | ✅ | ✅ | ✅(own) | — | — | — | — |
| Recommendation review/approve | ✅ | ✅ | ✅ | — | — | — | — |
| Own action tasks (execution) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Policy studio | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Skill graph explorer | ✅ | — | — | ✅ | ✅ | — | — |
| Staffing planner | ✅ | ✅ | ✅ | — | — | — | — |
| Access administration | ✅ | — | — | — | — | — | — |
| System health / data quality | ✅ | — | — | — | — | — | — |
| Reset demo | ✅ | — | — | — | — | — | — |

Server-enforced scopes verified in backend functions:
- Identity: `me` resolves the twin strictly from the JWT's `auth_user_id`
  (self scope). Suspended twins are refused at the app boundary.
- Recruitment: `interview-kit`, `application-stage`, `assessment-*`,
  `recruiter-decision`, `requisition` require recruiter/executive role server-side.
- Onboarding: `onboarding-plan/-task/-approve` bind plan/twin + org and check
  owner roles for each action.
- Admin: `admin-access`, `health`, `dashboard` data-quality surfaces require
  `hr_executive` (via `manage_users`) or the documented HR scope.
- Candidate: `candidate-status` (code), `assessment-session` (invitation token).

Known scope gaps (NOT fixed in this phase, carried to their feature phases):
- `staffing-comparison` queries org-wide; a manager-specific scope restriction is
  not applied server-side (audit item C).
- Workforce-review risk-bucket labels on the page vs the engine differ (audit E).

## 3. Build manifest (deterministic)

`scripts/write-build-info.mjs` now emits `src/generated/build-info.ts` with:

```
commit        615f1af            (git rev-parse --short HEAD)
commitFull    615f1af1161cc...   (git rev-parse HEAD)
builtAt       2026-09-18T13:06:43+00:00   (HEAD committer time — deterministic per revision)
schemaVersion v1
contracts     skillFit v1 · staffing v1 · reviewIndex v1 · onboardingV2 v1 ·
              recommendation v1 · assessment v1 · policyRetrieval v1
```

- The manifest is generated from the actual git revision — no hand-entered
  string can be mistaken for the deployed commit.
- `builtAt` is the commit timestamp, so rebuilding the same revision produces
  the identical file (no generated noise between commits).
- Surfaced in the app chrome: `build {commit} · schema {version}` and in the
  footer with the full builtAt timestamp.
- Prod/dev separation: `build` (preview, development mode) and
  `build:prod` (production mode, writes the manifest first). Production
  deployment uses production configuration.

## 4. Verification results (all green on this workspace)

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.app.json` (explicit app check) | **PASS** — previously **18 errors** across 8 files |
| `tsc -p tsconfig.functions.json` (shared helpers) | PASS |
| `tsc -p tsconfig.functions-check.json` (bundled entry points) | **PASS** — previously dozens of errors |
| `node scripts/check-functions.mjs` (drift + `Deno.serve` entry points) | PASS — 36 functions, 23 shared modules |
| `pnpm lint` | PASS |
| `pnpm test` (vitest) | **239 passed** (was 223) — added contract + query-state suites |
| `pnpm build:prod` | PASS |

### Type/contract errors found and fixed (Phase 0 scope)

App (`tsconfig.app.json`):
1. `recruitment.tsx` — `generateRubrics` referenced but **never imported**
   (root cause of the audit's interview-kit failure) → imported.
2. `api.ts` — `MeResult` lacked `ok: true`; `AssessmentEvaluation.result`
   lacked `assessment_id`; summary `inferred_themes` lacked `confidence_note`;
   resume `warnings` fields were incorrectly required.
3. `onboarding.tsx` — `TaskCard` declared `titleFor` but its props type did not;
   redundant `state !== "done"` comparison that TS could not narrow; raw-row
   casts to `PlanView`/`PlanTaskView` removed.
4. `recruitment.tsx`/`role-home.tsx`/`recommendation-hub.tsx` — raw
   `Json` rows cast into typed contracts replaced by zod validation
   (`src/lib/contracts.ts`).
5. `workforce-review.tsx` — `useQuery` passed `fetchDashboard` as the query fn.
6. `fit-card.tsx` — `String.replaceAll` (ES2021+) replaced with
   split/join so the app stays on its ES2020 target.

Backend entry points (previously never type-checked — the deploy pipeline
bundles without checking):
1. `interview-kit` — `supabase` client was scoped inside `try` but used in
   `catch` (runtime `ReferenceError` on the error path); rubrics array typed
   too narrowly.
2. `assessment-session` — `blueprint_id` referenced but only `blueprintId`
   exists (runtime `ReferenceError` when creating a session).
3. `extract-resume` — duplicate `proficient` key in the tier-alias map;
   `finishJob(..., { cache_hit })` passed an option the contract does not have.
4. `jobs.ts` — `JobRow` missing `created_at`/`started_at`/`finished_at` that
   `model-job` reads (columns exist in the table).
5. `recommendation-engine` — inline `import("./skill-graph-engine.ts").X` type
   queries that survive the bundler; converted to real type imports.
6. `application-stage`, `assessment-evaluate`, `evaluate-interview`,
   `extract-resume`, `interview-kit`, `performance-synthesis`, `policy-qa`,
   `resume-import`, `rubric` — `!valid.ok` truthiness narrowing that fails
   under `strict:false`; converted to explicit `valid.ok === false`.
7. `onboarding-plan` — skill claims cast to a shape missing
   `evidence_source`/`verification_rigor`; `verification_rigor` narrowed to
   the real `"low"|"medium"|"high"` union.
8. `requisition` — `skillsEqual` read `target_proficiency` off a
   `{skill: string}` type.
9. `reset-demo` — `twinRow` narrowed to one literal fixture union (failed for
   candidates/org-2 twins); `SKILL_NAME` keyed by literal skill ids; auth-user
   map inferred unknown values; `journeyStatus`/evidence/assertion helpers
   rejected readonly fixture arrays; generated `ScheduledTask` import removed
   (self-contained interface) so the mega-bundle no longer collides with
   `onboarding-v2`.
10. `workforce-review-index` / `workforce-signal` — `signals` concat passed
    `priority` to a type that only allowed `type`/`value`; rebuilt as spreads.

### Safe decoding introduced (task 7)

`src/lib/contracts.ts` — strict zod contracts (validated at runtime) for:
requisition rows, candidate rows, onboarding plan/task views, recommendation
rows, and the wire payloads of `me`, `interview-kit`, `health` and
`staffing-comparison`. `decode()` rejects a mismatched payload loudly instead
of casting it into the app; the onboarding task query normalizes the one
genuinely missing column (`blocked_reasons`) explicitly rather than loosening
the contract. All row shapes were verified against the live seeded database
before enforcing the schemas.

### Query-state discrimination introduced (task 8)

`src/lib/query-state.ts` — a dependency-free classifier that distinguishes
`loading / ready / empty / forbidden / unavailable / error`, plus the first
application on the recruiter requisitions list (loading, forbidden,
unavailable, error and empty states are now rendered separately). The remaining
pages adopt the classifier as their feature phases touch their queries.

## 5. Baseline screenshots (captured on this workspace's preview)

- Landing (`/`) — renders the evidence→reason→recommend→approve→action hero
  and all seven demo-persona entry points. No errors.
- Login (`/login`) — full sign-in form + Demo Environment Quick Access for the
  six authenticated personas and the candidate entry. No errors.
- Candidate status (`/candidate-status`) — application-code lookup UI with the
  seeded code `WS-PRIYA-2026`. No errors.

Authenticated-role screenshots require interactive login; they are captured in
each subsequent phase as that role's workflow is exercised (the original audit
covered them against the old build).

## 6. Audit claims re-verified in THIS workspace

- ✅ Confirmed: interview-kit generation broken — `generateRubrics` not
  imported in `recruitment.tsx`. Fixed in this phase.
- ✅ Confirmed: explicit `tsconfig.app.json` check fails with 18 errors.
  Fixed in this phase.
- ✅ Confirmed: backend functions were never type-checked; entry-point checks
  surfaced real latent runtime bugs (interview-kit `supabase` scope,
  assessment-session `blueprint_id`). Fixed + now enforced by `pnpm check`.
- ⏳ Not yet handled (feature phases B–H): onboarding dual sources of truth,
  staffing math, IT provisioning queue, workforce-review priority/completeness,
  health/evidence overclaims, candidate-session defects, auth-refresh
  interruption, IA/navigation redesign.

## 7. Remaining limitations (honest scope)

- Query-state classifier applied to one page; the rest follow per feature phase.
- Strict contracts are enforced on the entities listed above; remaining wire
  payloads (dashboard, workforce-review-index, performance-summary,
  assessment-session, policy-qa) are still typed (not yet validated) — they
  will gain contracts when their phases repair them.
- `reset-demo` and the bundler concatenation remain naive by design; the
  self-contained journey type removed the only collision, and drift is now
  machine-checked every `pnpm check`.
