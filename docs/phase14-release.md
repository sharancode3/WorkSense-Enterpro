# Phase 14 — Release: architecture, feature mapping, and verified checklist

## Architecture (what the demo runs on)

```
Browser (Vite + React + Tailwind)
  -> backend functions (Enter Cloud edge functions, service-role client inside)
       -> deterministic engines (_shared): skill-match (computeFit), onboarding
          scheduler, policy retrieval + citation validator, Workforce Review
          Index, recommendation engine, workflow state machine
       -> Qwen (local 4B via gateway) ONLY for constrained language: resume
          extraction, rubrics, interview/assessment judgment, policy answers,
          performance narrative
  -> Enter Cloud database: RLS org/team-scoped reads, writes only via functions
     or revoked RPCs (workflow transitions are security-definer, optimistic-lock,
     idempotent, append-only audited)
```

Division of labor (the story of the demo):
- **Qwen does language**: extract claims, write rubrics, judge work samples, answer policy with citations, write explanations.
- **Engines do decisions**: skill fit math, onboarding scheduling + waivers, staffing coverage, review index, transition legality, task creation.
- **Evidence is first-class**: `evidence_items` (source, quote, provenance) → `skill_assertions` (claim states) → `digital_twins.verified_skills` (confirmed).
- **Humans gate**: recommendations move `suggested → needs_review → approved → dispatched → completed` only via typed-rationale transitions; client RPCs are revoked (Phase 13 hardening).

## Feature → problem-statement mapping

| Problem statement | Feature | Where |
|---|---|---|
| "Need a ready team in six weeks" | Demand + deadline + planning assumptions | Staffing planner (`/staffing`) |
| "Resume keywords ≠ capability" | Source extraction, evidence quotes, claim-vs-verified states | Resume intake + candidate evidence |
| "One strong work sample beats a keyword list" | Work-sample assessment, rubric evidence, human review | Assessment flow |
| "Evidence should change the answer" | Deterministic fit + fit cards before/after claims | Skill-match + recruitment |
| "Compare the options honestly" | Hire/Move/Upskill/Hybrid with constraints | Staffing planner |
| "Policy answers must be grounded" | Citation-validated answers or abstain | Policy studio |
| "No action without human sign-off" | Typed-rationale lifecycle, idempotent, audited | Recommendation hub |
| "A dependency shouldn't be bypassed" | Dependency-enforced onboarding, authorized resolution | Onboarding |
| "Readiness must be visible" | Live dashboard, journeys, outcomes, freshness labels | Executive dashboard |

## Demo support checklist (verified this session)

- [x] Compact, reproducible dataset: `reset-demo` restores pristine (89 twins incl. 2 managers, 5 open reqs, 4 recs, 0 workflow events) — verified post-run.
- [x] Two synthetic resume fixtures as PDF + sidecar text (A strong, B keyword-heavy, C adjacent, D missing dates, E contradictions, F prompt-injection) — `public/demo-fixtures/`.
- [x] Pre-generated validated artifacts with provenance labels — `public/demo-artifacts/` (regenerate with `node scripts/generate-demo-artifacts.mjs` while Qwen is healthy).
- [x] Live Qwen health check visible in the app (header chip + footer) and `/health`.
- [x] Visible build ID + demo-mode indicator (top strip: "Demo mode · all data fictional · build <commit> · schema <v> · AI gateway: ready").
- [x] Mode indicator + "Previously generated demo artifact" labeling rule in the script.
- [x] Model-warming step in the script; demo path avoids many sequential generations (2 live AI calls max).
- [x] Final-gate rehearsal run recorded (dashboard 120 ms, staffing 100 ms, work sample submit 44 ms + evaluate 14 s, policy 4–6 s grounded + abstain, fit 110 ms, open-reqs consistent at 5, no count/date contradictions).

## Verified release checklist (final gate)

1. Permissions: 21 security-matrix checks green (cross-org, cross-team, candidate fields, RPC revocation, self/stale approval, persona switch) — Phase 13 + retested.
2. Deployment consistency: `pnpm check` 220/220 · `pnpm build` green · functions bundled + deployed (dashboard, staffing-comparison, extract-resume, reset-demo, + all prior).
3. Contracts: schema/contract suite green (RLS on every table, hardened write policies, idempotency UNIQUE).
4. Visible Qwen results: health chip live; extraction/policy/work-sample artifacts validated.
5. Workflow: double-submit idempotent, one-winner concurrency, stale approval rejected, dispatch atomicity — green.
6. Known limitations documented (extraction recall/flakiness, interview 8K context budget, AI latency) — no publication approval for those AI layers as guaranteed.

## Consequential-action isolation

Only fictional demo records are used for hiring/rejection/onboarding actions; every rehearsal ends with `reset-demo` restoring the pristine seed (`workflow_events=0` verified).
