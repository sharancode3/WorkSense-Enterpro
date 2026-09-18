# Import WorkSense from GitHub + wire Enter Cloud backend

## Context

The user built **WorkSense** — an AI-driven Intelligent Workforce Management Platform (HR hackathon, "Track 1") — in another Enter workspace. That project's full source is backed up to GitHub (`sharancode3/WorkSense-Enterpro`, branch `enter-main`, public). The current workspace is a fresh, empty Enter template.

Goal: make this workspace the new home for WorkSense so development can continue here. Per user decision, this is a **full setup**: pull the repo code in, wire the Enter Cloud backend (auth + DB + backend functions + seed), verify everything builds/tests, then **analyze the app and report** to the user.

What the repo contains (verified via GitHub API):
- Frontend: Vite + React 19 + TS + Tailwind + shadcn/ui — 16 pages, `src/router.tsx` with 16 routes (landing, login, candidate-status, candidate/session, app, graph, recruitment, onboarding, policy, hub, workforce, staffing, admin/access, status, workforce/data-quality, 404), `ProtectedRoute` wrapper, 6-role RBAC (ADMIN/HR/MANAGER/RECRUITER/EMPLOYEE/CANDIDATE).
- Backend: `supabase/` with `config.toml`, `migrations/` (6 tables + RLS), and ~20 backend functions (`me`, `reset-demo`, `candidate-status`, `requisition`, `skill-match`, `extract-resume`, `rubric`, `interview-kit`, `evaluate-interview`, `recruiter-decision`, `onboarding-plan/approve/task`, `policy-qa`, `escalate`, `workforce-signal`, `performance-synthesis`, `recommendation-scan/decision`, `dashboard`, `admin-access`, `action-task-update`, `assessment-*`, `application-stage`, `health`, ...).
- 5 deterministic engines (skill-graph, onboarding/Kahn, policy BM25, workforce-signal, recommendation triggers) + 5 on-demand Qwen LLM moments (resume extract, rubric/kit, policy answer, performance narrative, recommendation rationale).
- 62 vitest unit tests; scripts `prebuild` (write-build-info.mjs), `check` (lint + tsc + tsc -p tsconfig.functions.json + vitest).
- Docs: REPORT.md, PROGRESS.md, DEMO_SCRIPT.md, README.md, CodeGuideline.md, docs/, artifacts/, public/demo-fixtures/.

## Approach

### Phase A — Pull code into workspace
1. Download the repo archive: `curl -L https://codeload.github.com/sharancode3/WorkSense-Enterpro/tar.gz/enter-main` → extract to a temp dir.
2. Replace this workspace's app files with the repo's versions: `package.json`, `pnpm-lock.yaml`, `index.html`, `components.json`, `eslint.config.js`, `i18n.config.json`, `postcss.config.js`, `tailwind.config.ts`, `tsconfig*.json`, `vite.config.ts`, `scripts/`, `tests/`, `src/` (full replace), `public/` (full replace), `supabase/` (full replace).
3. **Exclude** the repo's `.git/` and `.enter/` (old workspace plans/skills) — keep this workspace's `.enter/plans/`. Keep the repo's docs (PROGRESS.md, REPORT.md, DEMO_SCRIPT.md, docs/, artifacts/) as reference material.
4. Delete template files that the repo replaces (template `src/pages/Index.tsx`, `src/App.css`, `src/i18n`, `src/analytics.ts`, `src/components/language-switcher.tsx`, `src/hooks`, etc. — superseded by the full `src/` replace).
5. `pnpm install` using the repo lockfile (adds `vitest`).

### Phase B — Enter Cloud backend
1. Enable Enter Cloud for this workspace (interactive approval) → load the `enter_cloud` skill before writing SQL/auth/function code.
2. Apply `supabase/migrations/*` to this workspace's Enter Cloud project (6 tables + RLS policies).
3. Deploy the backend functions from `supabase/functions/*`.
4. **Repoint the frontend supabase client**: inspect `src/integrations/supabase/client.ts` and `src/generated/*` — they hard-code the old project's URL/anon key; replace with this workspace's Enter Cloud URL + anon key.
5. Seed the demo state (6 role personas + golden data) via the `reset-demo` function / seed path so login works end-to-end.
6. **Known gap (documented, not fixed this pass):** the 5 LLM moments originally called an Ollama Qwen model through an ngrok tunnel, which cannot be reproduced here. Those features will return errors/no-op; every deterministic feature keeps working. Rewiring to Enter AI All is a separate follow-up.

### Phase C — Verify
- `pnpm check` (lint + `tsc --noEmit` + `tsc -p tsconfig.functions.json` + vitest suite).
- `pnpm build`.
- Live-preview checks on key routes (landing `/`, login `/login`, one protected route).

### Phase D — Analyze & report
- Deliver a concise analysis: what WorkSense is, architecture (frontend / backend functions / engines / AI usage), screens & roles, what is now working here, and what remains (LLM features, analytics token, GitHub sync link is to the old workspace).

## Critical files

- `package.json` — replace with repo's (adds vitest, prebuild script)
- `src/router.tsx` — repo version (16 routes, ProtectedRoute)
- `src/integrations/supabase/client.ts` — repoint to this workspace's Enter Cloud instance
- `src/generated/*` — repoint project URL/anon key if present
- `supabase/migrations/*` — apply to Enter Cloud (tables + RLS)
- `supabase/functions/*` — deploy all backend functions

## Implementation checklist

- [ ] Download `enter-main` tarball from codeload.github.com and extract to temp
- [ ] Replace workspace root files with repo files (exclude `.git`, `.enter`; keep docs)
- [ ] Remove template-only leftovers (`src/pages/Index.tsx` and anything not in the repo after full `src/` replace)
- [ ] `pnpm install` succeeds against the repo lockfile (vitest present)
- [ ] Enter Cloud enabled for this workspace; `enter_cloud` skill loaded
- [ ] `supabase/migrations/*` applied (6 tables + RLS) without conflicts
- [ ] All backend functions deployed from `supabase/functions/`
- [ ] `src/integrations/supabase/client.ts` (and `src/generated/*` if it holds the URL) pointed at this workspace's Enter Cloud URL + anon key
- [ ] Demo seed applied so the 6 role personas can log in
- [ ] `pnpm check` green (lint, tsc app, tsc functions, vitest)
- [ ] `pnpm build` produces a dist without errors
- [ ] App analyzed and reported to user (what it is, architecture, status, known gaps)

## Verification checklist

- [ ] `pnpm lint` → 0 errors; `pnpm exec tsc --noEmit` clean; `pnpm exec tsc -p tsconfig.functions.json` clean; `pnpm test` (vitest) → expected suite (repo claims 62 tests) passes
- [ ] `pnpm build` exits 0 and emits `dist/`
- [ ] `/` renders the WorkSense landing page in preview; `/login` shows the persona quick-access
- [ ] `/app` unauthicated redirects to `/login` (ProtectedRoute default/negative path)
- [ ] Signing in as at least one persona (e.g., ADMIN) loads dashboard data from Enter Cloud (positive path)
- [ ] LLM-dependent actions (e.g., resume extraction) fail gracefully with an error rather than crashing the UI (known gap)
- [ ] No build errors reported by the framework's final snapshot build
