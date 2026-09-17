# WorkSense — Progress Ledger

Governing contract: **Prompt 0 (Permanent working contract)** — applied 2026-09-17.
Execution loop: inspect → reuse/gap → plan this phase → one vertical slice → migrations/contracts/authz/tests/UI together → `tsc`/lint/tests/build → browser verify (success, invalid, empty, denied, refresh, failure) → fix → complete only when verified.
Bounded repair loop: max 3 attempts per external blocker, then stop + report evidence.

---

## 1. Phase registry

| Phase | Requirement | Status | Completion gate |
|---|---|---|---|
| P0–P8 (original build) | Design system, RBAC, Skill Graph, Recruitment, Onboarding, Policy, Signal/Perf, Hub, Dashboard, Section-11 prompts | ✅ Baseline (pre-contract, live-verified) | 62 tests, lint, tsc, build, API matrix |
| AUDIT-FIX | Recruiter fit 403; RLS org-scoping; RPC lockdown; onboarding completion gate; seed consistency; 403 UX; escalation state | ✅ Verified live | curl checks + build |
| PHASE-1 | Foundation: build/deploy provenance, authorization, session safety, error contract | ✅ Gate passed (below) | See §9 |
| P2+ | *(awaiting user prompts, one at a time)* | ⏳ Not started | — |

## 9. Phase 1 — Foundation (completion gate)

**Build & deploy**
- pnpm pinned to `10.34.5` (`packageManager`), removed the bogus `pnpm: 8.6.12` devDependency; lockfile regenerated; `pnpm install --frozen-lockfile` ✅.
- `pnpm check` now runs: ESLint + app `tsc --noEmit` + **functions/shared `tsc -p tsconfig.functions.json`** + tests → exit 0 (62 tests / 10 files).
- `tsconfig.functions.json` type-checks the deterministic shared engines; it surfaced + fixed a real contract gap (`recommendation-engine` fed partial skills into `computeFit` — now explicit domain mapping, no casts).
- Build identifier: `scripts/write-build-info.mjs` → `src/generated/build-info.ts` (commit, builtAt, schema v1); `prebuild` hook regenerates it; footer shows it; verified the marker ships in the dist bundle.

**Authorization**
- RLS audited → final set is **11 SELECT-only, org-scoped policies**; all client write paths removed (approvals, dispatch, scores, verification, audit, conversion, journeys, requisitions, skills). Mutations only via backend functions (service role).
- `convert_candidate_to_employee` RPC: revoked from public/anon/authenticated, granted service_role only (anon → 403).
- SECURITY DEFINER functions reviewed: `search_path = public` fixed; conversion gated by the calling edge function's actor/state checks.

**Session safety**
- React-query keys scoped by actor id (`user.id`) across all data pages; `queryClient.clear()` on sign-out; stale-`fetchMe` guard (uid ref); `ProtectedRoute` waits for resolved identity **and** permissions (`resolving`).

**Error contract**
- Canonical codes applied across all functions: `UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / VALIDATION_ERROR / CONFLICT / INTERNAL`; `QwenError` → `MODEL_UNAVAILABLE` / `MODEL_OUTPUT_INVALID` surfaced in responses.

**Gate checks (live)**
- ✅ Frozen install; ✅ `pnpm check` (lint/tsc app/tsc functions/tests); ✅ build.
- ✅ Recruiter fit works (66/100) for permitted candidates; ✅ recruiter sees only candidates (no employee records).
- ✅ Two-org isolation: org-A admin reading org-B twin → empty; ✅ employee direct journey write blocked; ✅ manager direct recommendation write blocked (0 rows).
- ✅ Unauthorized candidate conversion (REST) → 403.
- ✅ Canonical codes: candidate protected → `FORBIDDEN`, onboarding-on-pending → `CONFLICT`.
- ⏳ Persona-switch cache + live build-id drift: code-level guarantees verified; browser click-through pending a logged-in session / post-commit preview rebuild.

## 6. Unresolved defects / open requirements (queued for P2+)

1. Fit-score calibration semantics (adjacency when nothing missing; evidence influence; future-role floor).
2. Resume claims → verified assessment pipeline (work samples, evidence review, contradiction handling).
3. Interview evaluation maturity: work-sample lifecycle, no missing-score defaults, benchmark.
4. Dispatch → assigned work with owners, deadlines, completion evidence, outcomes.
5. Signal reframing documentation (heuristic ≠ probability) + UI wording audit.
6. Remove remaining `as any` casts (seed/generator boundaries); reconcile any residual lockfile notes.
7. Flagship workflow: HIRE / MOVE / UPSKILL / COMBINE comparison across demand, time, cost, capacity, skill evidence, policy constraints → evidence-backed recommendation → human approval → tasks → readiness/outcome tracking.
8. Policy citation robustness (tie quotes to the specific doc+section, not any chunk).
9. `me` edge case: unauthenticated invoke without an apikey header returns a gateway-level response (not the function's `UNAUTHENTICATED`) — low risk, document only.

## 2. Contract non-negotiables — current standing

- ✅ Dashboard metrics / AI outcomes never hardcoded in UI (all from backend aggregation).
- ✅ Demo data isolated in `_shared/seed-data.ts` (+ engine-generated fixtures), restored via `reset-demo`; no erasing real records.
- ✅ Resume claims marked `verification_rigor: "low"` + `evidence_source: "resume_extraction"` — distinct from verified assessment evidence (strengthen per audit in a later phase).
- ✅ Workforce Review Signal labeled decision-support heuristic (never a probability / prediction).
- ✅ No auto-reject/hire/discipline from AI scores; every consequential action requires typed human approval (Hub state machine).
- ✅ Frontend hiding is not authz — RLS + server-side role checks; RLS now org-scoped; conversion RPC revoked from clients.
- ✅ No service-role/Qwen creds or raw evidence in the browser; model endpoint reached only from backend functions.
- ⚠️ **`as any` / unsafe casts exist in seed/generator/function code** — tracked for systematic removal (do not use to conceal contract problems).
- ⚠️ Interview evaluation is LLM-assisted and labeled, but scoring maturity (work samples, no score defaults) is an open requirement.

## 3. Implemented behavior (baseline)

- 6-role RBAC (ADMIN/HR/MANAGER/RECRUITER/EMPLOYEE/CANDIDATE) with one-click personas, RLS + server enforcement.
- Deterministic engines: skill match (exact weighted formula + Direct/Adjacent/Transferable/Gap), Kahn onboarding scheduler + Bloom waivers + non-waivable guard, BM25 policy retrieval + calibrated abstention + verbatim citation validator, Workforce Review Signal, cross-source recommendation triggers, dashboard aggregation.
- Qwen (local via ngrok, OpenAI-compatible): resume extraction, 5-tier rubrics (cached), candidate-biased interview kit, grounded policy answers, performance narrative (on-demand), recommendation rationale — all with Section-11 exact schemas.
- Workflows: resume→fit→kit→evaluate→atomic convert; onboarding dual-approval→blocker→replan; policy grounded/abstain→escalate; Hub needs_review→approved|rejected→dispatched→completed with real effects + mirrored audits; Executive Dashboard (org/team scoped) + future-skill heatmap + rec feed.

## 4. Tests executed and results

- 62 unit tests / 10 files: skill-match formula + classification, Kahn/waivers/cycle/blocker, BM25 routing + threshold + citation validator, signal formula, trigger engine, RBAC matrix, candidate-403 contract, prompt-injection sanitizer.
- `eslint .` ✅ · `tsc --noEmit` (app) ✅ · `pnpm build` ✅.
- Note: backend functions are Deno — validated by the deploy bundler (all 20 compiled), not the app tsconfig. Optional: add a functions tsconfig.

## 5. Browser verification

- Landing, login, candidate-status rendered flat/clean (desktop + mobile).
- Auth flow fixed (`me` role resolver) — all personas resolve roles.
- Authed screens (dashboard, hub, onboarding, policy, recruitment, graph) verified functionally via live API matrix; visual click-through of authed screens pending a logged-in browser session.

## 6. Unresolved defects / open requirements (queued for P1+)

1. Fit-score calibration semantics (adjacency when nothing missing; evidence influence; future-role floor).
2. Resume claims → verified assessment pipeline (work samples, evidence review, contradiction handling).
3. Interview evaluation maturity: work-sample lifecycle, no missing-score defaults, benchmark.
4. Dispatch → assigned work with owners, deadlines, completion evidence, outcomes.
5. Signal reframing documentation (heuristic ≠ probability) + UI wording audit.
6. Remove `as any` casts; reconcile pnpm lockfile drift.
7. Flagship workflow: HIRE / MOVE / UPSKILL / COMBINE comparison across demand, time, cost, capacity, skill evidence, policy constraints → evidence-backed recommendation → human approval → tasks → readiness/outcome tracking.
8. Policy citation robustness (tie quotes to the specific doc+section, not any chunk).

## 7. Deployment / build identifier

- Repo: `sharancode3/WorkSense-Enterpro`, branch `enter-main`.
- Latest commit at contract start: `3694577402e667cb6c37fdabdef7ebedc867e4e7` (turn_31).
- 20 backend functions deployed (me, reset-demo, candidate-status, skill-match, extract-resume, rubric, interview-kit, evaluate-interview, recruiter-decision, requisition, onboarding-plan, onboarding-approve, onboarding-task, policy-qa, escalate, workforce-signal, performance-synthesis, recommendation-scan, recommendation-decision, dashboard).
- Demo data: clean golden state (9 twins, 3 recommendations, generated 12-task journey).

## 8. Next unfinished requirement

**Awaiting Prompt 1.** Suggested first priority per audit: the flagship **HIRE / MOVE / UPSKILL / COMBINE** decision workflow, or the fit-calibration / evidence-verification remediation — as directed by the user.
