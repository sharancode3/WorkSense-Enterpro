# WorkSense — Internal Coverage Matrix (Batch 8)

Honest map of what the product supports today vs. what it explicitly does not.
This is an internal engineering truth-telling document, not marketing. Each row
says what exists, where, and what its real limits are. Nothing here claims a
trained model, production certification, or a capability that is not implemented.

Legend: **Supported** = implemented and exercised in the demo. **Partial** = a
real subset works; the missing part is named. **Not supported** = explicitly out
of scope today (no demo box is faked to fill it).

---

## 1. Recruitment intelligence — Supported

- Requirements: weighted `requisition_criteria` (required/preferred, target
  proficiency, evidence expectation) per open requisition.
- Resume/evidence: `resume-import`/`resume-review` persist documents + accepted
  claim revisions; claims are stored as `extracted` (low rigor) until a human
  promotes them. Quotes are validated against the stored source text server-side.
- Explainable comparison: `candidate-compare` buckets scored / unscored / stale.
  Fit is a deterministic distance over the skill graph — never a probability.
  Unknowns are never ranked as zero; they sit in their own unscored bucket.
- Limits: no automated selection (selection is a human `select` at final round).

## 2. Adaptive onboarding — Supported

- Role/evidence-informed journey: `onboarding-plan` builds tasks only from an
  approved (selected) application — the `NO_APPROVED_ROLE` guard rejects any
  title-guess plan. Task set derives from role requirements + verified skills.
- Owners: employee / manager / HR / IT, enforced by `canActOnTask` server-side.
- Dependencies: DAG validation, blocked→ready cascades, readiness estimate
  recomputed on every task mutation (canonical `onboarding_plans` + tasks).
- Limits: readiness is an estimate from task state and dates, not a guarantee.

## 3. Policy reasoning — Supported

- Applicable version: `policy-retrieval` respects date windows and supersession.
- Citations: quoted passages are validated; the answer states the version.
- Clarification/abstention: `policy-conversation` can abstain, clarify, or
  escalate instead of inventing an answer.
- Limits: policy scope is the seeded + authored doc corpus; no external sources.

## 4. Workforce risk — Supported, with explicit honesty

- Deterministic review index (0–100) with completeness, freshness, confidence,
  and flags; human follow-up via review cases + actions.
- **Not supported: trained attrition prediction.** No attrition model exists.
  Every surface states the index is decision support, never a probability of
  leaving. `REVIEW_MODEL_STATUS` documents what a real model would require.

## 5. Performance intelligence — Partial

- Supported: performance summaries (goal/feedback/artifact review) and synthesis
  drafts with development suggestions.
- Not supported: automated performance verdicts. Suggestions are drafts; a human
  confirms before anything is recorded as evidence.

## 6. Skill graph — Supported

- Requirements + verified/claimed distinction: `reviewer_confirmed` (high),
  `assessment_supported` (medium), `claimed`/`extracted` (low) — never blurred.
- Relationships: `outgoing_edges` drive adjacent/transferable/gap reasoning.
- Evidence freshness: fit records carry engine/evidence/requisition/graph/context
  version fingerprints; `skill-match` recomputes when they drift.
- Limits: freshness is computed on demand, not by a background scheduler.

## 7. Interview intelligence — Supported

- Criteria-mapped structured questions; three genuinely different formats
  (work sample / interview / knowledge assessment) with their own blueprints.
- Rubric drafts (cached per role), Qwen-assisted probes, follow-up rounds for
  unresolved evidence, and exact-quote excerpts.
- Human reviewer confirms/overrides before any consequential evidence is written.
- **Not supported:** code execution (work samples are read as written work only)
  and calendar invites (scheduling is manual and labeled as such).

## 8. Decision dashboard — Supported

- Cross-source action priorities: the operational home, "My work" feed, role
  attention strips, and the hiring work queue surface counts + drill-downs.
- Outcomes: stage events, audit events, readiness, evidence and fit all update
  from the same canonical rows; no demo reset is needed between steps.
- Limits: priorities are deterministic counts/signals, not an ML ranking.

---

## Unsupported / out of scope (explicit, nothing faked)

| Item | Status | Reason |
|---|---|---|
| Trained attrition / performance prediction | Not supported | No model exists; index is labeled decision support |
| Isolated code-execution sandbox for work samples | Not supported | No execution service; stated in every work sample |
| Calendar/Outlook interview invites | Not supported | Manual scheduling only, labeled |
| OCR for scanned/low-text resumes | Not supported | Low-text path + paste-text fallback instead |
| Real-time push notifications | Not supported | Poll/refetch + durable model-job records |
| Evidence→staffing-proposal staleness cascade | Partial | Scenario-version binding + stale-proposal flag exist; proposal-to-candidate linkage is not implemented. Staffing-proposal human-review decision loop IS supported (approve/decline + note + owned follow-up task) — Batch 10 |
| Payroll / salary handling | Not supported | Out of scope |

## The one working cross-source journey (demo)

Demand → candidate/employee evidence → feasible staffing options → human review
→ owned execution → accepted evidence → updated readiness/outcome.

| Leg | Implementation | Verified live |
|---|---|---|
| Demand | Open requisition with weighted criteria | verify-batch-7 |
| Candidate evidence | Resume docs + assertions; reviewed work sample with verbatim quotes | verify-batch-7 |
| Feasible staffing options | `staffing-comparison` deterministic planner (feasible/conditional/infeasible + human review) | on-demand in workspace |
| Human review | `assessment-review` confirm/override before evidence; human `select` at final round; staffing proposals decided by HR (`review_proposal` — approve/decline + note, owned follow-up task on approval) | verify-batch-6 + verify-batch-10 |
| Owned execution | Onboarding plan tasks owned by employee/manager/IT; action tasks | verify-batch-6 |
| Accepted evidence | `assessment_supported` evidence + canonical `skill_fits` refresh | verify-batch-6 |
| Updated readiness/outcome | Readiness recompute, IT queue drop, comparison reflects fit | verify-batch-4/6/7 |
