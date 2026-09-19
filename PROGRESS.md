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
| PHASE-2 | Qwen gateway: config, capability handling, validated generation, durable jobs, UI, observability | ✅ **Gate passed** (constrained flow documented) | See §10 |
| PHASE-3 | Evidence model + demo fixtures (assertion wiring, lineage UI, fixture generator) | ✅ **Complete** (incl. compact mode, action tasks, policy-qa → policy_documents) | See §11 |
| PHASE-4 | File-based resume ingestion with traceable extraction | 🚧 In progress (full vertical + gate **verified**; OCR intentionally unavailable; authed browser click-through of the review UI pending) | See §12 |
| PHASE-6 | Structured applications, job-relevant assessments, adaptive interview sessions, reviewer-controlled evaluation | ✅ **Complete** (evidence-linked anchors, no missing-score defaults, fit provenance) | See §13 |
| PHASE-7 | Contextual policy reasoning with validated citations (date windows, supersession, applicability, escalation) | ✅ **Complete** (145 tests; live gate verified) | See §14 |
| PHASE-8 | Adaptive onboarding with ownership, dependencies, versioned approvals, genuine completion evidence | ✅ **Complete** (185 tests; live gate verified) | See §15 |

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

## 10. Phase 2 — Qwen gateway (status: machinery verified, live gate blocked)

**Built & deployed (all functions live):**
- `_shared/qwen.ts` — server-managed config (base URL, model, gateway auth header, 40s timeout, 8k input cap, token cap), strict JSON extraction (full parse → fences → balanced, never blind brace-salvage), HTML/interstitial detection → `MODEL_UNAVAILABLE`, exactly **one** repair attempt, sanitized telemetry (latency/tokens/hash, no raw prompts), `QwenError` codes incl. `INPUT_TOO_LARGE`.
- `_shared/validate.ts` — 6 per-task runtime schemas (resume, rubric, evaluation, policy, performance, recommendation) with enum/bounds/evidence/source-reference constraints; wired into all 7 Qwen functions (invalid output → `MODEL_OUTPUT_INVALID`, never persisted).
- Durable jobs: `model_jobs` table (RLS reads-only), `_shared/jobs.ts` (queued→running→succeeded/failed, actor+org+task+input-hash dedup with 5-min stale-running rule, timing/retry/model/validated output), wired into **resume extraction** and **interview kit** (the gate tasks); `model-job` GET (actor-scoped) for refresh recovery.
- Interview kit: **batched** competency generation (one call, not N sequential) + validated biased probe.
- `health` function + AppShell 4-state indicator (app ok / gateway reachable / model ready / generation failed per job).
- Recruitment UI: job id surfaced, `?job=` refresh recovery banner.

**Unit-verified (11 new tests → 73 total, all passing):** strict parser (clean/fenced/malformed/HTML→MODEL_UNAVAILABLE/noise-rejected), all 6 validators (incl. out-of-enum, out-of-bounds, missing evidence), sanitizer regression. lint / app+functions tsc / build green.

**External blocker (resolved) → constrained flow (documented):**
- The tunnel was temporarily pointing at the wrong backend (404 HTML on `/v1/models`); it is now correctly serving Ollama (`qwen3:4b-instruct-2507-q4_K_M`) — gate re-verified live.
- The edge runtime caps total execution time; generating **all** interview competencies in one invocation exceeds it with the local 4B model. Honest constrained flow (implemented + verified): rubrics are generated **one competency per call** (cached per role, each completes ~10s), then the kit runs its single candidate-biased probe. The Recruitment Studio does exactly this (pre-generate → kit).
- Two real bugs found + fixed via the live gate: bundler strips import aliases (a `hashInput as hashJobInput` alias caused a runtime ReferenceError) — functions must use plain names; and job actor must be the **auth uid**, not the twin id, for consistent scoping. Job dedup gained a stale-queued rule (stuck `queued` jobs from interrupted invocations no longer block forever).

**Gate checks (live, tunnel up):**
- ✅ health: app ok, gateway reachable, model_ready true.
- ✅ Resume extraction → visible, validated result + durable job (job `a9b35a41…` succeeded, latency ~10s); duplicate-while-in-progress → **409 CONFLICT**; job GET owner-ok / other-actor **403**.
- ✅ Interview kit → 5 validated competencies + biased probe + durable job (job `9b787152…` succeeded).
- ✅ Per-competency rubric generation completes live with validation.
- ✅ No partial/invalid model output becomes trusted data (validators gate persistence; unit-verified for HTML/malformed/out-of-enum).
- ⚠️ Tunnel-down / wrong-model live responses: code paths + unit tests cover them; not re-tested live by design (bounded loop). Gateway should be protected with basic auth (`ngrok http --basic-auth …`) + `QWEN_GATEWAY_AUTH` — currently unauthenticated (health reports `gateway_authenticated: false`).

## 11. Phase 3 — Evidence model + demo fixtures (status: foundation + assertion wiring + lineage + fixtures verified; compact mode + authed visual click-through pending)

**Evidence model (schema, applied + live)**
- Migration `155419000` (earlier in phase): `evidence_items`, `skill_assertions`, `applications`, `assessments`, `workforce_observations`, `policy_documents`, `action_tasks` + `skill_graph.aliases`; all org-owned with FK/indexes and **reads-only** RLS (`current_twin()` org check; no client writes).
- Migration `161000000` (this slice): `organizations.staffing_projects` + `organizations.learning_options` (org jsonb for the flagship HIRE/MOVE/UPSKILL workflow).

**Assertion wiring (extract-resume + scoring) — deployed + live-verified**
- New `_shared/evidence.ts`: `buildSkillClaims` (per-skill dedup by strongest review state; invalidated states excluded from scoring), `resolveSkillClaims` (assertions-first with legacy `verified_skills` fallback), `resolveLineage` (assertions + evidence), `resolveSkillId` (grow the canonical skill graph), rigor map `reviewer_confirmed→high / assessment_supported→medium / extracted+claimed→low`.
- `extract-resume` now writes one `evidence_items` row per skill (`resume_document`, quote, `resume:<job_id>` source) + one `skill_assertions` row (`extracted`, tier, evidence ref). It **replaces** prior extracted records for the twin (no duplicates) and never touches `verified_skills`. Verified live: after extraction Dev Sharma has 4 `extracted` assertions + 4 evidence rows; `verified_skills` byte-identical to seed; fit `evidence` section = 0 (unverified claims don't inflate it).
- Scoring path: `skill-match` (+ `extract-resume`'s own fit) uses `resolveSkillClaims` — confirmed assertions when present, legacy jsonb otherwise. Returns `lineage` (assertions + evidence) with the fit.
- Invalid model output stayed rejected (`MODEL_OUTPUT_INVALID`, 2×) and nothing was persisted — the Phase-2 validation contract holds.

**Evidence lineage UI — wired, browser click-through pending**
- `FitCard` gains an optional lineage panel (fit → assertion → evidence → source: state chip, level, quote, source id/type, capture date). Wired in Recruitment fit modal and Skill Graph Explorer (both current/future cards).

**Deterministic fixture generator — reproducible + validated + live-seeded**
- `scripts/generate-demo-fixtures.test.ts` → `_shared/generated-demo-fixtures.ts` (~280KB static JSON). Fixed mulberry32 seed; dates relative to demo clock `2026-09-15`. Self-validating: target counts, FK integrity (manager/skill/requisition/scenario refs), UUID well-formedness, chronology (nothing after the clock), and **computed claims recomputed by the engines** (applicant `match_score` ≡ `computeFit`; employee signals ≡ `computeWorkforceSignal`).
- Footprint: 2 orgs (demo + `9999…` isolation org w/ own admin `isabelle@worksense.demo`), 60 employees / 6 depts (9 golden personas preserved with exact ids), 24 candidates, 6 requisitions, 96 canonical skills with aliases + typed edges, 14 versioned policy docs, 720 workforce observations (12 mo), 5 onboarding journeys (not-started/in-progress/blocked/completed), 4 staffing projects + 6 learning options, 10 demo scenarios encoded, engine-consistent `match_score`s.
- `reset-demo` rewired to seed the fixture footprint (2 orgs, derived assertions/evidence/applications/observations/assessments, verified_skills derived from confirmed assertions only). Still bootstrap-or-HR-exec gated and org-scoped.
- **Live gate passed**: reset twice → identical counts (orgs 2, twins 88, skills 106, reqs 7, policies 14, journeys 5, recs 3, evidence 393, assertions 393, apps 19, observations 720). RLS isolation: dana sees 0 org-2 twins; isabelle sees only org-2 rows. Samira signal = 72 (engine-computed). Skill-match lineage regression: Priya 0.655 with 4 assertions + evidence.

**Tests**: 83 (73 baseline + 9 evidence + 1 fixture generator). `pnpm check` green (lint, tsc app, tsc functions, tests) + build green. Bundler hardened: strips **multi-line** `../_shared` imports (a real deploy-time failure was found + fixed).

**Pending for Phase-3 completion**: compact-mode generator option; authenticated browser click-through of the lineage panel; `action_tasks` seeding (dispatch workflow); policy-qa reading `policy_documents` (still uses `organizations.policies` jsonb).

**Phase-3 leftovers — completed (this slice)**
- `reset-demo` **compact mode** (`{compact:true}` → the small golden seed: 1 org, 9 personas, 18 skills, 2 reqs, 1 journey, 3 recs) — verified live.
- **Action tasks**: seeded a dispatched upskilling recommendation + 2 `action_tasks` (open / in_progress) — verified in DB.
- **policy-qa reads `policy_documents`** (latest version per doc_code, org-scoped) with `organizations.policies` jsonb fallback — deployed; verified grounded answer citing `POL-RMT s1` from the new table.

## 12. Phase 4 — File-based resume ingestion with traceable extraction (status: full vertical verified; OCR intentionally unavailable; authed click-through of review UI pending)

**Ingestion (verified live)**
- `resume-import` backend function: base64 intake (4 MiB cap), safe filenames (paths/control chars stripped), magic-byte content sniffing (extension never trusted — a renamed text file is rejected with a clear error), PDF via `unpdf` (page-text map + page count) and DOCX via `mammoth` (no page geometry), encrypted/malformed → useful errors (`DOCUMENT_ENCRYPTED` / `DOCUMENT_PARSE_FAILED`), private bucket `resumes` (created idempotently by the function; never public), expiring signed download via `resume-download` (org+role gated).
- **Scanned/low-text detection**: <160 chars → `low_text:true`, `ocr_available:false` with an honest message — OCR is not implemented in this deployment; manual text import is offered instead.
- **Original file and extracted text stored separately** (`storage_path` + `extracted_text`/`text_pages`); sanitization for the LLM never touches the stored evidence (verified: adversarial directive text survives in `extracted_text`).

**Extraction schema** — contact, roles+date ranges, education, certifications, projects, skill claims (years + tier + quoted evidence), ambiguities, conflicts. **Alias normalization** against `skill_graph.aliases` (Postgres → PostgreSQL; no duplicate concepts). Proficiency is kept as a **claim** (tier from the model, low rigor) — never auto-verified. **Overlapping employment dates** merged (9.5y deduped for the strong-go fixture), unknown dates stay unknown.

**Evidence validation** — every quote is checked against the stored source text at import (violations → `association:unsupported` + conflict warning) **and** re-checked at save (`resume-review` rejects with 422 listing the fabricated quotes — verified live).

**Review UI** — `ResumeReviewFlow` in the Recruitment resume modal (file-first, textarea fallback): dropzone + fictional demo-resume picker, two-pane review (source text with clickable claim-quote highlights + structured editable extraction), ambiguity/conflict warnings with dismiss, duplicate-upload handling, explicit **Save** that records claims as `extracted` (never verified), version history (v1 draft → v2 reviewed), and a refreshed deterministic fit after save.

**Demo resumes** — 9 fictional assets in `public/resume-fixtures/` (example.com contacts only): strong Go/PostgreSQL/Docker, Python→Go adjacent, keyword-stuffed weak, junior small-projects, SQL/BI analyst (PDF + DOCX), career-switcher, scanned/low-text, adversarial (instruction-injection) — generated by `scripts/generate-resume-fixtures.mjs` (hand-built multi-page PDFs + STORED-zip DOCX).

**Completion gate — verified live**
- Upload → extraction → evidence review → save → refreshed fit (strong-go → fit 0.748). Duplicate upload → dedup (same doc, no new evidence). Invalid file → magic-sniff rejection. Empty/scanned → low-text path. Conflicting evidence → overlap warnings surfaced. Fabricated quote → 422. Model failure → `MODEL_UNAVAILABLE` + failed doc, nothing trusted persisted. Malicious instructions → neutralized (no inflated rank; claims at FOUNDATIONAL). Isolation: org-2 admin sees 0 org-1 resume docs. Claims remain claims (verified_skills unchanged).

**Tests** — 93 (10 new: sniffing, safe filenames, alias normalization, quote matching, overlap/unknown-date totals, rich-schema validator). `pnpm check` + build green. Bundler: esm.sh parser libs verified at deploy.

**Limitations** — OCR intentionally unavailable (honest `ocr_available:false` + manual fallback); 4 MiB cap with base64 transport; extraction latency on the local 4B model can exceed 40s (gateway timeout raised to 100s; one timed-out attempt observed and correctly handled); browser click-through of the review UI pending a logged-in session (API-verified end-to-end).

## 13. Phase 6 — Structured applications, job-relevant assessments, adaptive interview sessions, reviewer-controlled evaluation (status: full vertical verified live; authed click-through of studio pending)

**Data model (migration `20260917_171500000`)** — `applications` gains optimistic-concurrency (`version`, `updated_at`); new RLS-reads-only tables: `application_stage_events` (append-only, actor/prior/new/reason/time/version/audit ref), `assessment_blueprints` (versioned artifact specs + test cases per requisition+competency), `assessment_rubrics` (observable behavior, evidence requirements, 1..5 anchors, critical mistakes, insufficient-evidence conditions, `skill_mapping` for fit provenance), `candidate_sessions` (token-scoped, expiration, autosave drafts, immutable submitted answers, `submission_hash` + duplicate guard, one bounded follow-up round).

**Backend functions (5 new, 2 changed; all bundled + deployed)**
- `assessment-blueprint` — seed/list/create versioned blueprints+rubrics. Canonical seeds (deterministic, server-owned, no LLM): Backend Engineer (payments idempotency + slow-query diagnosis + API resilience), Data Analyst (messy dataset triage + metric integrity + chart honesty), People Ops (policy scenario + missing-info handling + escalation note, hosted on a new People Operations Partner requisition).
- `assessment-session` — reviewer `create` (scoped invitation, expiry) / `fetch` (reviewer view vs. public token view — candidate view never leaks rubrics/evaluation) / `resume` (one bounded follow-up round) / candidate `draft` (autosave, refresh keeps drafts) / `submit` (lock + duplicate guard: same hash → 409 DUPLICATE_SUBMISSION, different → 409 LOCKED; expired → 410).
- `assessment-evaluate` — durable job (`assessment_evaluation`); per-competency judgment: anchor 1..5 + verbatim evidence quotes (validated against the full answer text) + anchor_ref + uncertainty + suggested follow-up; missing answers → `NOT_ASSESSED`, too-short → `INSUFFICIENT_EVIDENCE` (no fabricated scores); prompt forbids emotion/face/accent/personality scoring; answers wrapped as untrusted; **code-execution sandbox explicitly unavailable — never simulated**; one evaluation per session (replaces prior run after a follow-up round).
- `assessment-review` — human confirm/override with reasons; preserves both AI suggestion and human determination in `assessments.result`; supported anchors (3..5) write `skill_assertions` (`assessment_supported`, medium rigor) + `evidence_items` (`work_sample`/`interview`) via `skill_mapping`, then recompute current+future fit (assertions-first) — verified: Priya current/future fit rose 0.655 → 0.97 with provenance rows.
- `application-stage` — authorized transitions only (server matrix; `move_forward` along pipeline, `reject` from any open stage, `select` only from final round incl. conversion RPC + fit compute); `expected_stage`/`expected_version` mismatch → 409 `STALE_STATE`; writes `application_stage_events` + syncs legacy `applicants[]` jsonb.
- `candidate-status` — now also returns open sessions (token/type/status/expiry/title) for candidates.

**Frontend** — public `/candidate/session?token=…` page: instructions, accommodation/support options, time policy, debounced autosave indicator, explicit submit confirmation, submitted state (immutable answers), follow-up round display, honest "no scores shown to candidates". Recruitment Studio: stage now driven by the `applications` table (badge + version), authorized Move/Reject/Select via `application-stage`, transition **History** dialog, **Assessments** panel (session list, blueprint seed/new invitation, evidence-linked AI judgments, per-competency anchor + reason review with confirm/override, fit update, send follow-up round). `candidate-status` lists invites with Start/Continue links.

**Completion gate — verified live (curl + API)**
- Candidate completes the work sample (draft → submit → hash) and the interview session; duplicate submit → 409; changed-answers resubmit → 409 LOCKED; expired invitation → status expired + 410 on draft/submit.
- Reviewer evaluates: work sample → 3 anchor judgments (5/4/4) with verbatim quotes + zero code-execution claims; adversarial interview (injection attempt + missing + short answers) → judged on content (injection did not inflate score), `NOT_ASSESSED`, `INSUFFICIENT_EVIDENCE`.
- Reviewer overrides one judgment with reason and saves → both AI suggestion and human determination preserved; 3 `assessment_supported` assertions + linked evidence; fit recomputed (0.655 → 0.97) with provenance.
- Adaptive round: submit → reviewer `resume` (bounded 1 round) → candidate answers round 2 (new hash) → second resume blocked (409).
- Security: org-2 admin → 404 on org-1 session/evaluate/review/stage data; manager (no recruitment role) → 403; candidates never receive evaluation/rubric data.

**Tests** — 118 total (25 new: transition matrix, stale-state conflict, blueprint seed validity, judgment vocabulary, quote/score validation, missing/short defaults). `pnpm check` (lint + tsc app + tsc functions + tests) ✅ · `pnpm build` ✅. 25 backend functions deployed.

**Limitations** — code-execution sandbox not available (stated + never simulated); select-path conversion fit still uses `verified_skills` (legacy cache) unlike the assertions-first review path (pre-existing, documented); authed browser click-through of the Recruitment studio / review panel pending a logged-in session (all flows API-verified); local 4B model latency (~10–45s per evaluation) with job-recovery polling in the UI.

## 14. Phase 7 — Contextual policy reasoning with validated citations (status: full vertical verified live; authed click-through of studio pending)

**Data model (migration `20260917_173000000`)** — `policy_documents` gains `effective_to` (date window), `applicable_locations` / `applicable_worker_types` (applicability filters), and `supersedes_doc_id` (supersession relationships); `digital_twins` gains optional `work_location` / `worker_type` (nullable, additive) for employee context; new RLS-reads-only `policy_escalations` table — a SEPARATE authorized escalation workflow (question, selected context, relevant sources, reason, owner, status open→in_progress→resolved→closed, timestamps).

**Policy data** — fixture corpus (14 docs) extended deterministically: POL-LVE **v2** (Leave & Time Off: 2 days/month accrual, **3-day** carryover, public holidays don't reduce balance, mid-year pro-rata) that **supersedes** the fixture v1 (retired 2025-12-31, 5-day carryover — the conflict case); POL-CAT v1 **expired** (Catering Reimbursement, retired 2024-12-31); POL-RMT-EU (EU Remote-First Exception, `applicable_locations: ["EU"]` — the cross-location case). Org-scoped reads only — an actor never retrieves another org's policies.

**Retrieval** — org → date window (`filterByWindow`) → supersession/current-version resolution (`currentVersionSet`: newest version per doc_code wins, superseded docs dropped) → applicability filters (`applicabilityOk`) applied before answering; deterministic BM25 lexical baseline kept (an embedding model is NOT available in this deployment, so dense/hybrid retrieval is documented as not implemented rather than faked — no Qwen chat text is ever used as an embedding). BM25 score is treated as a ranking signal, not a probability; abstention threshold tuned on the reviewed question set. Missing applicability fields → `clarification_needed` with the field + reason (never assumed); exclusive-token disambiguation (`exclusiveQuestionTokens`) decides when a question is really about a **retired** or **applicability-excluded** document (honest notes, no invention).

**Contextual reasoning** — authorized employee context resolution (`canViewEmployee`: self / HR roles / manager→direct reports; name-mention detection; hypothetical context overrides), deterministic leave engine (`leave-calc.ts`: accrual, mid-year join pro-rata, capped carryover, holiday-spanning request math) whose numbers are injected as authoritative computed facts and echoed in the UI; answers may only restate them.

**Citations (fixed)** — strict validator: every exact_quote must be **non-empty** and exist **in the cited section of the cited document version** (source identity + claim support), not merely somewhere in the retrieved chunks; citations are enriched with doc title/version/heading/effective dates; empty/invalid/insufficient citations → **one repair attempt** (also for schema-invalid model output), then downgrade to `partially_supported` or abstain — never labeled grounded.

**Escalation** — `escalate` now creates a `policy_escalations` row (question, selected context, sources, reason, HR owner, status, timestamps); the UI confirms before including sensitive employee context and only reports "escalated" after the insert succeeds.

**Employee UX** — Policy Studio: example chips + contextual form (employee picker, work location, worker type, taken days, request span), explicit "why clarification is needed" panel, deterministic calculation cards, citation list with document version + section + quote + effective dates, expandable source inspection, and a confirmed route to HR review.

**Completion gate — verified live (curl + API)**
- **Supported**: annual leave → grounded, cites POL-LVE v2 s1/s3 with real quotes + effective dates (current version, NOT the superseded v1's 5-day carryover). Mid-year-join → grounded v2 s3. Samira's balance → computed facts (accrued 84, carryover capped at 3) + cited quotes. **Unsupported**: pet-insurance/sabbatical → abstained, empty answer, no invention. **Ambiguous**: EU exception without location → `clarification_needed` (fields + reason). **Conflicting**: "five days carryover?" → explicitly corrected to 3 days citing v2. **Expired**: catering → "retired on 2024-12-31, no current version — nothing invented". **Cross-location**: US context vs EU exception → "does not apply to location=US — nothing assumed". **Injection**: instruction-injection questions (incl. one targeting a named employee) → sanitized; no inflated numbers; answer discarded/grounded only on real quotes. **Citation mismatch**: unit-tested (quote in another section/doc/version rejected); live cross-check confirmed every returned quote is verbatim in the cited section. Context action lists only visible employees + current docs; org-2 admin sees zero org-1 policies and gets 403 for org-1 employee context.

**Tests** — 145 total (17 new: leave engine math, policy-context authorization/mention resolution, date window, supersession, applicability, strict per-section citations, exclusive-token disambiguation, expired-hit detection). `pnpm check` ✅ · `pnpm build` ✅. 3 functions changed + deployed (policy-qa rewritten as contextual reasoner, escalate → dedicated workflow, reset-demo seeds Phase 7 data). 25 functions deployed total.

**Limitations** — dense/hybrid retrieval not implemented (no embedding model/storage available; documented honestly); BM25 relevance is lexical-only, so semantically-paraphrased questions may abstain (honest); authed browser click-through of the Policy Studio pending a logged-in session (all flows API-verified); local 4B model occasionally needs the one repair attempt for citation/schema errors (then downgrades or abstains as specified).

## 15. Phase 8 — Adaptive onboarding with ownership, dependencies, versioned approvals, genuine completion evidence (status: full vertical verified live)

**Data model (migration `20260917_181712000`)** — role check widened with `it_security` (IT service-owner persona, **no** broad HR powers). New RLS-reads-only, org-scoped tables: `onboarding_plans` (versioned plan bound to `plan_hash`, dual approvals `manager_approval`/`hr_approval` stored ON the row, status draft→pending_approval→approved→completed→superseded, readiness estimate, carryover mapping), `onboarding_tasks` (task DEFINITION columns — type learning|verification|provisioning|policy|access|onboarding_admin, `owner_role` employee|manager|hr|it_security, deps, duration, `why_evidence` reason+source, `evidence_requirements` — separated from EXECUTION columns — state, blockers[], waiver, completion_record, adaptation), and `onboarding_task_events` (execution audit log deduped by `(plan, task_code, action, attempt_hash)`).

**Deterministic engine (`_shared/onboarding-v2.ts`, 39 unit tests)** — plan hash (canonical defs), DAG validation (cycle/missing-dep), Kahn topological schedule + cascade dates, blocked set with **multiple simultaneous blockers** (resolving one keeps others), critical path, honest readiness estimate ("estimated readiness… not a guarantee"), strict owner authorization matrix (`canActOnTask` — employee owns own tasks, manager owns direct-reports' manager tasks, HR owns hr tasks, **HR has no access to service-owner tasks, employee cannot claim IT provisioning**), pure `validateCompletion` gate (plan approved, actor authorized, not done/waived/failed/blocked, prerequisites satisfied, evidence per requirements), waiver rules (non-waivable → HR Exec + policy basis citation only), adaptation (learning→verification replacement; failed verification reopens gap + revises plan, reason+source preserved), carryover on regeneration (completed work preserved with explicit mapping only when the definition is unchanged).

**Planning** — built from the **approved role relationship**: the employee's `applications` row with stage `selected` → requisition → role skills (never a title substring); confirmed skill gaps from verified skills; mandatory policy tasks (POL-SEC etc.) + provisioning/access/payroll; learning task per required-skill gap + one verification task on the first gap + future-skill upskilling + survey.

**Functions** — `onboarding-plan` (build/regenerate with version+hash; regeneration supersedes the old row so approvals never carry — no retained approved state), `onboarding-approve` (authorization checked first — employee can never approve own journey, manager only direct reports, HR Exec org-wide — then **hash binding**; both approvals → approved), `onboarding-task` (complete/block/resolve/waive/adapt/fail with all server-side checks, evidence, attempt-hash dedup for double submission, full task-state sync after every recompute). All 4 (incl. reset-demo) deployed.

**Demo seed** — Alex Chen: approved application (WS-ALEX-2026 → Senior Backend Engineer), plan v1 approved by Jordan+Dana with `security_training` done (evidence), **access_sso blocked by an IT-reported blocker**, it_provisioning/payroll ready, downstream cascaded. Live flow verified: IT reports a second blocker (multiple) → IT completes it_provisioning with evidence → resolves blocker #1 (blocker #2 stays) → resolves #2 → access_sso ready → IT completes access_sso with MFA evidence → manager completes team_intro → Alex completes learn_go with PR evidence → verify_go with assessment evidence → readiness 8.3%→25%→33.3%→41.7%→50%, blockers 9→0. All negative gates curl-verified (unauthorized completion, unmet prerequisite, blocked, double submission, self-approval FORBIDDEN, HR-partner approval FORBIDDEN, hash mismatch, invalid waiver, non-waivable waiver policy basis required, missing evidence). Adapt → verify_postgresql (plan v3 pending, approvals invalidated); fail verify_go → learn_go_reopen (plan v4 pending).

**Tests** — 185 total (39 onboarding-v2 + regression: blocked task with empty derived reasons rejected; rbac it_security matrix). `pnpm check` ✅ · `pnpm build` ✅. 4 functions deployed.

**Limitations** — authed browser click-through pending a logged-in session (all flows API-verified); dashboard journey counts still read the legacy `onboarding_journeys` table (compat; Phase 8 drives its own UI); 8-bit hash is binding-in-practice but not cryptographic.

## 17. Phase 9 — Longitudinal workforce review + performance intelligence (status: full vertical verified live)

**Heuristic baseline rigor (migration `20260917_182500000` + engine `_shared/workforce-review-index.ts`, 11 unit tests)** — the legacy `workforce-signal-engine` (weights summing to 0.82, zero-baseline attendance jumping to a full factor, missing observations indistinguishable from "fine", `seeks_growth` adding risk, displayed as a risk score) was **replaced** by an interpretable **Workforce Review Index** (0–100, weights sum to exactly 1.0: career 0.30 / attendance 0.30 / delivery 0.30 / engagement 0.10). Every factor carries a documented definition, source period and caveat. Zero-baseline absence scores a fixed moderate 0.5 step (never an extreme ratio). Missing observation periods reduce `data_completeness` and are listed explicitly — they never count as poor performance and the top "review" tier requires ≥75% completeness (otherwise capped at "high" with the gate reason stored). `seeks_growth` is reported **separately and never contributes to the index**. Trend is computed over the last 6 present periods per metric. Sensitivity flags (`individual_absence`, `individual_engagement`) gate individual signals to HR/manager/self. Limitations always state: decision support, NOT a probability of leaving. New org-scoped RLS-reads-only tables: `workforce_review_cases` (per-twin period rows: index, priority, factors, trend, completeness, missing_data, fact_finding, sensitivity, limitations, `source_version_hash`) and `performance_summaries` (versioned narratives + `source_facts` + `inferred_themes` + `contradictions` + `sparse_evidence` + `source_version_hash` for cache invalidation).

**Performance intelligence (`_shared/performance-intelligence.ts`, 8 unit tests)** — deterministic facts aggregation with refs `[S1…]`; goal averages and sentiment counts explicitly labeled "directional context, not a performance verdict / not a score"; contradictions detected (concerns vs positive rating, declining goal attainment, engagement decline + concerns — always with a correlation-not-diagnosis caveat); sparse-evidence flags; rule-based inferred themes labeled INFERENCE. `performance-summary` writes a Qwen narrative strictly on top of these facts (one repair; every claim must cite a ref; no causal diagnoses; "model confidence is not calibrated reliability" note); the same `source_version_hash` returns the cached summary until source rows change, then regenerates (live-verified: adding a 2026-H2 evidence row invalidated the cache and produced a hedged narrative).

**Functions** — `workforce-review-index` (compute + upsert case + twin signal `workforce_review_index`), `performance-summary`, `workforce-signal` (now delegates to the new engine), `dashboard` (org/team-scoped review cards + `review_cases` list; card renamed to "Review priority cases", threshold 60), `recommendation-scan` (index + completeness + growth-aware triggers; DEVELOPMENT_SUPPORT for healthy growth interest). Old engine + its tests deleted. Fixtures regenerated deterministically with the new engine; a healthy-growth persona (Fatima, index 5/low + `seeks_growth`) proves development interest ≠ risk.

**Live gates (curl)** — Samira: index 77 / review priority / 94.4% completeness / missing engagement periods listed / seeking-growth reported but excluded / label "decision support, not a probability". Fatima: index 5, low priority, sole fact-finding = growth conversation. Performance summary: 24 cited facts, 3 contradictions, inferred themes labeled, cache hit on replay, cache invalidation + hedged narrative after new evidence. RBAC negatives: employee reading another twin → FORBIDDEN; org-2 admin reading org-1 → FORBIDDEN. `pnpm check` ✅ (198 tests / 20 files) · `pnpm build` ✅. Functions deployed.

**Limitations** — trained attrition model intentionally NOT built (no labeled departure history, no Python runtime) — the interpretable index is retained per contract; browser click-through of the Workforce Review page pending a logged-in session.

## 18. Phase 11 — Transactional recommendation review, action execution, outcome tracking (status: full vertical verified live)

**Recommendation lifecycle (migration `20260917_200000000` + RPCs)** — `recommendations.status` widened to the full lifecycle: `suggested → needs_review → approved/rejected → execution_pending → in_progress → completed/failed/cancelled` plus `stale` (re-review via `re_review`). New columns: `version` (optimistic concurrency), `source_hash` (staleness/dedupe), `resource_ref`, `alternatives`, `required_approvers`, `expires_at`, `stale`/`stale_reason`/`superseded_by`, `intended_outcome`, `approved_at`, `last_reviewed_at`, `outcomes`. Transitions are **allowed-transition maps, not arbitrary status assignment** — enforced by security-definer RPCs `workflow_recommendation_transition` / `workflow_action_task_transition` (atomic `UPDATE … WHERE status = <expected>` optimistic guard + append-only audit in the same transaction; revoked from anon/authenticated). **Idempotency**: `workflow_events` has `UNIQUE(resource_type, resource_id, request_id)` checked BEFORE the transition — a replayed request_id returns `idempotent: true` with no re-application; double clicks with different request_ids hit the optimistic guard (CONFLICT, no duplicate effects).

**Action tasks** — `action_tasks` gains `task_code` (+ `UNIQUE(recommendation_id, task_code)`), `owner_role`, `resource_link`, `instructions`, `required_evidence`, `depends_on`, `outcome_measure`, `version`, `started_at`/`completed_at`, `verification`, `last_error`, `retry_count`, status lifecycle `open → in_progress → blocked → completed/failed/cancelled` with `retry` recovery. Dispatch creates the reviewed tasks **in the same transaction** as the state change (`execution_pending` only after the rows exist; duplicate task_codes are no-ops). Task completions roll up: all done → rec `completed` with `time_to_ready_days` + `task_summary`; failures stay visible (last_error, retry_count) and recoverable.

**Audit** — append-only `workflow_events` (org, resource_type/id, actor_twin_id, actor_role, resource, prior/new status, reason, source_version, request_id, timestamp), RLS reads-only.

**Triggers (`_shared/recommendation-engine.ts`)** — mobility now requires **meaningful target coverage** (≥60% of the target role's required skills covered, ≥70% soft-share, ≥2 paths) and evaluates ALL requisitions, selecting the best by coverage with ranked `alternatives`; recruitment recommendations require an **actual application record** + unverified claims (`recruitment_review`, tasks owned by the recruiter); healthy development opportunities remain (DEVELOPMENT_SUPPORT); missing data/growth never inflate risk.

**Staleness + dedupe (`recommendation-scan`)** — every candidate gets a `source_hash`; same (twin, category, hash) → skipped ("unchanged"); a changed hash marks the older open recommendation `stale` (`superseded_by` → fresh rec, workflow event recorded, re-review required); identical recommendations are never re-created (live: scan#1 created 8 + stale'd the legacy seeded rec; scan#2 → unchanged 13, created 0).

**UI** — Hub shows the full lifecycle with per-state actions (submit/approve/reject/re-review/dispatch/start/complete/fail/cancel/retry), stale banners, alternatives, intended outcome, outcomes (time-to-ready, task summary), per-task panels (owner, due, instructions, required evidence, verification, failure + retry), and the workflow audit trail; task owners (employees/recruiters) act on their tasks from a new "My action tasks" panel on their home screen. Legacy `recommendation-decision` superseded (removed from the bundler map).

**Live gates (curl)** — approve→dispatch→2 tasks (same-transaction) ✓; re-dispatch same request → IDEMPOTENT, different request → CONFLICT, task count stays 2 ✓; start→task1 complete→in_progress→task2 complete→rec `completed` (time_to_ready 0, task_summary 2/2) ✓; rec-level complete on completed → CONFLICT ✓; reject → no execution (dispatch → CONFLICT) ✓; fail task → visible (last_error), retry → recoverable ✓; approve replay same request → IDEMPOTENT ✓; scan dedupe + staleness ✓; recruitment flow: suggested → submit → needs_review → approve → dispatch (2 recruiter-owned tasks) → complete → rec completed ✓. `pnpm check` ✅ (207 tests / 21 files incl. `workflow-engine.test.ts` 6 + updated trigger tests) · `pnpm build` ✅. 4 new functions deployed (recommendation-review, recommendation-execute, action-task-update, recommendation-scan updated).

**Limitations** — external email/calendar/HRIS integrations not implemented (in-app tasks first per contract; any future integration must be real, authorized, and visibly distinguish draft from sent); seeded recommendations predate `source_hash` so the first scan marks them stale by design (honest re-review); `workflow_events` audit is functional but no dedicated admin audit-navigation UI yet (Hub shows per-rec trail).

## 16. Unresolved defects / open requirements (queued)

1. Fit-score calibration semantics (adjacency when nothing missing; evidence influence; future-role floor).
2. ~~Dispatch → assigned work with owners, deadlines, completion evidence, outcomes (partially adjacent to Phase 8; action_tasks table exists)~~ ✅ Phase 11 (transactional lifecycle + action tasks + outcomes).
3. Signal reframing documentation (heuristic ≠ probability) + UI wording audit — addressed by Phase 9.
4. Remove remaining `as any` casts (seed/generator boundaries); reconcile any residual lockfile notes.
5. Flagship workflow: HIRE / MOVE / UPSKILL / COMBINE comparison → evidence-backed recommendation → human approval → tasks → readiness/outcome tracking.
6. `me` edge case: unauthenticated invoke without an apikey header returns a gateway-level response (not the function's `UNAUTHENTICATED`) — low risk, document only.

## 6. Unresolved defects / open requirements (queued for P3+)

1. Fit-score calibration semantics (adjacency when nothing missing; evidence influence; future-role floor).
2. ~~Resume claims → verified assessment pipeline~~ ✅ Phase 6 (assessment_supported evidence + reviewer confirm/override).
3. ~~Interview evaluation maturity: work-sample lifecycle, no missing-score defaults~~ ✅ Phase 6 (evidence-linked anchors, NOT_ASSESSED/INSUFFICIENT_EVIDENCE defaults).
4. Dispatch → assigned work with owners, deadlines, completion evidence, outcomes.
5. Signal reframing documentation (heuristic ≠ probability) + UI wording audit.
6. Remove remaining `as any` casts (seed/generator boundaries); reconcile any residual lockfile notes.
7. Flagship workflow: HIRE / MOVE / UPSKILL / COMBINE comparison across demand, time, cost, capacity, skill evidence, policy constraints → evidence-backed recommendation → human approval → tasks → readiness/outcome tracking.
8. ~~Policy citation robustness (tie quotes to the specific doc+section, not any chunk)~~ ✅ Phase 7 (strict per-section/version citation validation + repair-or-abstain).
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
- Workflows: resume→fit→kit→evaluate→atomic convert; onboarding dual-approval→blocker→replan; policy grounded/abstain→escalate; Hub lifecycle suggested→needs_review→approved|rejected→execution_pending→in_progress→completed|failed|cancelled (+stale→re-review) with idempotent, optimistic-concurrency transitions, per-category action tasks, outcomes and append-only workflow audit; Executive Dashboard (org/team scoped) + future-skill heatmap + rec feed; Workforce Review Index (longitudinal) + evidence-bound performance summaries.

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
2. ~~Resume claims → verified assessment pipeline~~ ✅ Phase 6 (assessment_supported evidence + reviewer confirm/override).
3. ~~Interview evaluation maturity: work-sample lifecycle, no missing-score defaults~~ ✅ Phase 6 (evidence-linked anchors, NOT_ASSESSED/INSUFFICIENT_EVIDENCE defaults).
4. Dispatch → assigned work with owners, deadlines, completion evidence, outcomes.
5. Signal reframing documentation (heuristic ≠ probability) + UI wording audit.
6. Remove `as any` casts; reconcile pnpm lockfile drift.
7. Flagship workflow: HIRE / MOVE / UPSKILL / COMBINE comparison across demand, time, cost, capacity, skill evidence, policy constraints → evidence-backed recommendation → human approval → tasks → readiness/outcome tracking.
8. ~~Policy citation robustness (tie quotes to the specific doc+section, not any chunk)~~ ✅ Phase 7 (strict per-section/version citation validation + repair-or-abstain).

## 7. Deployment / build identifier

- Repo: `sharancode3/WorkSense-Enterpro`, branch `enter-main`.
- Latest commit at contract start: `3694577402e667cb6c37fdabdef7ebedc867e4e7` (turn_31).
- 20 backend functions deployed (me, reset-demo, candidate-status, skill-match, extract-resume, rubric, interview-kit, evaluate-interview, recruiter-decision, requisition, onboarding-plan, onboarding-approve, onboarding-task, policy-qa, escalate, workforce-signal, performance-synthesis, recommendation-scan, recommendation-decision, dashboard).
- Demo data: clean golden state (9 twins, 3 recommendations, generated 12-task journey).

## 8. Next unfinished requirement

**Awaiting Prompt 1.** Suggested first priority per audit: the flagship **HIRE / MOVE / UPSKILL / COMBINE** decision workflow, or the fit-calibration / evidence-verification remediation — as directed by the user.

## 19. Phase 12 — Role-focused IA, trustworthy dashboards, copy + state audit (status: verified live)

**Requisition status (migration `20260917_203000000`)** — `job_requisitions.status` (`open/on_hold/filled/closed`, default `open`, indexed). Seeds updated: `seed-data.ts` (2 open), `assessment.ts` (People Ops → on_hold), fixture generator (`status` propagated to `generated-demo-fixtures.ts`, Product Designer → on_hold). **Open requisitions everywhere now count `status = 'open'`, never row count** (dashboard card, recruiter stats/pipeline, status chips on the recruitment page).

**Dashboard rework (`dashboard`, live-verified org + team)** — explicit metric **definitions travel with the payload** (`definitions.headcount/open_requisitions/active_candidates/heatmap`): headcount = active employee/manager twins only (candidates excluded — they have status 'candidate'); open reqs = status-based with a full `requisition_statuses` breakdown; active candidates = non-terminal applicants on open reqs only. **Freshness** (`computed_at`) + **period** (observation bounds, default "all observations (YYYY-MM – YYYY-MM)"). **Server-side filters** (department, requisition_id, YYYY-MM period) can only narrow the role-decided scope; the client gets `filters.available` (departments + requisitions with status) and a stable `observation_range` so the month dropdown never collapses. **Heatmap buckets** per (open req, future skill), each scoped worker in exactly one bucket: `missing` (no verified path, no claims), `below_target` (verified direct match under the bar), `adjacent_support` (adjacent/transferable only), `insufficient_evidence` (claims exist but nothing verified), `ready` — color AND label, with legend. **Manager team-scope N+1 removed**: single twins load + one BFS of the reporting tree (was a per-twin full-table select each). Live gates: Dana org → open reqs 5 / on_hold 2, headcount 57, heatmap totals 57 ✓; department filter → 10; requisition filter → single req rows; period filter → label + full `observation_range` preserved; Jordan (manager) → scope team, headcount 12, heatmap totals 12, cases 12 ✓; Alex (employee) → 403 FORBIDDEN ✓. Seed now includes one honest claimed-only future-skill assertion (Data employee claims GTM Strategy, unverified) so `insufficient_evidence` shows a real 1, not a silent 0.

**Role IA + workspace pattern** — `app-shell` nav is now **role-sectioned** (Overview / Workforce / Talent / Actions / Governance), each link gated by the same server-enforced action it always was; mobile gets a hamburger menu (previously links vanished below md). `role-home` drops the misleading "Phase 1+" module stubs entirely — replaced by an **honest per-role module grid** that only lists modules the role can open; stat cards carry definition text; recruiter "Open requisitions" and employee "Active recommendations" counts fixed to status-aware / my-twin queries.

**Design quality** — dashboard toolbar (labeled selects + focus ring), semantic status tones with label AND color, freshness/filter/scope disclosure line, stat cards link to the underlying authorized record page (workforce/recruitment/onboarding/hub) where the role can open them; heatmap cells show numeric counts (never color alone) plus a legend.

**Copy audit** — login "Register as Candidate" → "Check your application status" (no application flow exists; status check is the real action); landing hero badge "AI-driven workforce management" → "Workforce decision intelligence"; candidate-status adds a "Demonstration data is fictional" note; role-home welcome adds a fictional-data chip. Grep confirms no remaining "verified/never hallucinates/fully secure/industry-ready/Register as Candidate" claims.

**State + verification** — `pnpm check` ✅ (207 tests / 21 files, fixture generator regenerated with status) · `pnpm build` ✅ · lint clean (react-refresh export warning fixed). Functions deployed: `dashboard` (v2 payload) + `reset-demo` (status seeds + claimed-future-skill case); migration applied. Browser: landing, login, candidate-status verified clean at desktop_1280 + mobile_390. **Authed-screen click-through (role-home/exec-dashboard at desktop + narrow) remains pending a logged-in preview session** — the preview redirects `/app` → `/login`; verified instead at API level (full payload matrix above) + code level (types, lint, tsc, build, 207 tests).

## 20. Phase 13 — Evidence-based evaluation & regression verification (status: security/workflow/perf green; 2 AI limitations surfaced)

**New automated layers** — `scripts/phase13-contract.test.ts` (13 tests): every `create table` ships with RLS enabled; org/team policy scoping; `convert_candidate_to_employee` + workflow transition RPCs revoked from clients; `job_requisitions.status`; `workflow_events` idempotency UNIQUE; `candidate_twin_id` regression trap; hardened write policies. `scripts/verify-phase13.mjs` (live security matrix + workflow race/recovery + performance; incremental JSON report to `artifacts/`). `scripts/verify-phase13-ai.mjs` (human-authored AI reference fixtures, two modes). Full report: `docs/phase13-verification-report.md`.

**Second sign-in-able manager (fixtures)** — Data dept lead is now **Nadia Kim** (`nadia@worksense.demo`, id `f0e2fc7c-…`, RNG-preserving generator change) so the matrix exercises two orgs and two managers: cross-team reads blocked both ways, manager dashboards team-scoped (12 vs 10 vs org 57), persona-switch re-scopes server-side.

**Security finding + fix** — a manager could PATCH a team recommendation's `status` directly via the `is_team_member` write branch of `rec_write`, bypassing the workflow state machine. Hardened in migration `20260917_203500000`: `rec_write`/`onboarding_write` → hr_executive-only (app writes these tables only through functions; zero client `.insert/update` verified by grep). Live re-test: manager direct status PATCH now affects 0 rows. Regression-guarded by 2 new contract tests.

**Results (live)** — fast suite **44/44 PASS** (21 security-matrix checks incl. cross-org/cross-team/candidate-fields/RPC revocation/self-approval/stale approval/persona-switch; 9 workflow race+recovery: double-submit idempotent, two simultaneous reviewers → exactly one wins, stale approval rejected, dispatch same-transaction + re-dispatch rejected, scan dedupe `created=0`, interrupted job surfaced; parallel fits; latency budgets: dashboard warm p50 ~104 ms org / ~90 ms team, health p50 157 ms, skill-match p50 358 ms — no sub-second promise for AI). AI fixtures: policy 3/3 (grounded w/ citation, abstain ×2 incl. adversarial), resume adversarial + ambiguous PASS, **resume well-formed = recall FAIL** (4B missed 2/6 skills, no hallucination), **interview evaluation = blocked by enforced 8000-char context budget** (`INPUT_TOO_LARGE` surfaced, not silent; rubric gen also flaky on 4B) — both documented, no publication for those AI layers. `pnpm check` ✅ (220 tests / 22 files) · `pnpm build` ✅. DB restored to pristine after every run.

**Limitations** — authed-screen visual click-through still pending a logged-in preview session (verified at API + code level); interview evaluation unusable on the current 4B model with full kits; resume extraction recall incomplete on 4B.

## 21. Phase 14 — Demo readiness, staffing planner, honest storytelling (status: delivered, rehearsal-run live)

**New surface — Staffing planner (`staffing-comparison` function + `/staffing` page, HR/manager)**: the missing demo beat "Hire / Move / Upskill / Hybrid". Deterministic coverage from verified skills via the Skill Intelligence Graph + EXPLICITLY labeled cost/time assumptions (never guarantees). Live output on the demo req (Senior Backend Engineer, 42-day window): hire 66% / 56d (flagged "risks window"), move 54% / 21d (mobility policy + backfill constraints), upskill 98% / 42d ("trained skills are claims until verified"), hybrid 99% / 42d. Constraint lines + "planning estimates, not guarantees" footnote. Bundler entry added; `req` handler-parameter shadowing bug fixed (bundle runtime error surfaced + instrumented with try/catch).

**Demo blocker fixed — resume extraction reliability**: the 4B model repeatedly failed strict schema validation (`proficiency_tier`) and 40s timeouts. Fixed in `extract-resume`: per-call timeout override (120s), human-tier normalization + coerce-unparseable-with-visible-warning (claim stays low rigor, DB enum always satisfied), `tier_warnings` surfaced in output. Live: Fixture A now extracts Go/PostgreSQL/Docker/Kubernetes as `verification_rigor: low` claims; Fixture B is refused loudly when malformed — both honest behaviors, artifact-labeled fallback.

**Demo assets**: `scripts/generate-demo-resumes.mjs` → 6 human-authored resume fixtures (A strong / B keyword-heavy / C adjacent / D missing-dates / E contradictions / F prompt-injection) as PDFs + sidecar .txt in `public/demo-fixtures/`. `scripts/generate-demo-artifacts.mjs` → pre-validated artifacts in `public/demo-artifacts/` (policy grounded POL-SICK#s1, policy abstain, extraction A, work-sample evaluation, staffing) each carrying `_provenance: "previously-generated-demo-artifact"` and the scripted label rule: never shown as live inference. App adds a top **Demo-mode strip** (fictional-data + live AI gateway state + build/schema) and the work-sample beat uses the seeded Priya session (submit 44ms, evaluate 14s, NOT_ASSESSED handling verified).

**Docs + gate**: `docs/phase14-demo-script.md` (6-minute beat table with observed timings + fallbacks + what-to-explain/what-not-to-claim) and `docs/phase14-release.md` (architecture, feature→problem mapping, release checklist, known limitations). Rehearsal run recorded: dashboard 120ms, staffing 100ms, fit 110ms, policy 4–15s, work-sample 14s; consistency verified (open_reqs=5, staffing req = "Senior Backend Engineer", Priya fit 0.655 == seeded match). Known limitations documented: extraction flakiness on the 4B (artifact fallback), interview 8K context budget (demo uses work samples), AI latency 5–30s (warm the model first). `pnpm check` 220/220 · `pnpm build` green. Functions deployed: staffing-comparison, extract-resume (fixed), reset-demo (Nadia persona). DB restored pristine (89 twins, 6 org-1 managers, 4 recs, 0 workflow events).

## 22. Phase 15 — Demo stability & governance contract (status: delivered; gateway outage exercised the fallbacks)

**Zero-crash resume intake** — `resume-review-flow.tsx` `runDemo()` now catches any non-2xx/401/503 `resume-import` failure for preset resumes and falls back to static fixtures at `public/resume-fixtures/<file>.json`, populating review state instantly with toast "Loaded [Label] in offline demo mode." Custom uploads show an inline alert card ("AI Engine unreachable. Use a preset resume or paste text manually below.") with a paste-text escape hatch. 8 human-authored offline fixtures (strong-go, python-to-go, keyword-stuffed, junior-small-projects, data-analyst-sql-bi, career-switcher, scanned-lowtext→lowtext stage, adversarial) validated against the review-payload contract.

**Access & users console** — new `admin-access` backend function (hr_executive-only; live 403 for others) + `/admin/access` page (nav "Governance → Access & users"): member directory with name/email search + role/status filters, Invite Member dialog (creates auth user + elevates the auto-created twin, org-bound), Update Role dialog (hr_executive/manager/recruiter/employee; no self-demotion), suspend/reactivate (no self-suspend), and a security audit side-drawer over the new append-only `admin_actions` table (RLS org-scoped reads). Suspension is enforced at the app boundary: `auth-context` signs out suspended accounts. Migration also widened `digital_twins.status` to allow `suspended`. Live-verified: invite→sign-in as manager→update_role→suspend (me returns suspended)→reactivate; 4 audit rows recorded.

**API credit conservation** — new `llm_cache` table (RLS org-scoped reads, UNIQUE org/task/hash) + `_shared/llm-cache.ts`; wired into `extract-resume` (cache check before any model call; cache hit re-runs only the deterministic evidence/fit writes and returns `from_cache: true`) and `policy-qa` (keyed on question+retrieval+facts; skips the model entirely on identical repeat). Rubric generation was already cached per req+competency (verified). **Proof under outage**: with the Qwen gateway down, a seeded cache row made `extract-resume` return `from_cache: true` with full low-rigor claims and zero model calls.

**Quality gate** — `pnpm check` 223/223 · `pnpm build` green · contract suite extended (admin_actions/llm_cache RLS + org-scoped read policies, status 'suspended' allowed). Functions deployed: `admin-access` (new), `extract-resume` + `policy-qa` (cache), `reset-demo` (teardown now clears `admin_actions` + `llm_cache`). DB restored to pristine golden state (89 twins, 0 audit, 0 cache, 0 workflow events). Live observation: an external interaction on the shared live preview converted a candidate (Priya→employee) mid-turn — reset-demo restored it; noted as a reason demo records must always be reset before a walkthrough.

**Known limitations** — policy cache staleness if the corpus changes (documented; acceptable for the demo corpus); invitee gets the shared demo password (no real email delivery); suspended users are refused at the app boundary but `me` still returns the twin (status flag drives the refusal).

## 23. Onboarding demo fallback & null-safety fix

`src/pages/onboarding.tsx`: guarded `(planData.carryover ?? [])`, `(task.depends_on ?? [])`, `(task.blocked_reasons ?? [])`, `(task.blockers ?? [])`, and the critical-path adjacency `for (const d of t.depends_on ?? [])` — fixing the `carryover.length` render crash. Demo fallback: managers/HR now auto-land on the default demo employee with an active plan (Alex Chen — the only plan owner, approved, 12 tasks, 9 blocked, ideal DAG) via a new `planOwners` query; if a selection resolves to no plan and the user has not explicitly picked someone (`userPickedRef`), selection falls back to that default so the dependency graph always shows on page load. Verified: manager RLS reads plan owners/employees; `pnpm check` 223/223 · `pnpm build` green.

## 24. Workforce Review narrative null-safety (+ consolidated crash sweep)

`src/pages/workforce-review.tsx`: added a `!perf.summary` empty state ("No performance summary synthesized for this employee yet. Click Regenerate..."), narrative now `perf.summary?.narrative ?? "No narrative available."`, and guarded every remaining summary/facts array access — `contradictions`, `inferred_themes`, `sparse_evidence.flags`, `source_facts`, `model_note` — so newly converted employees without a synthesized narrative no longer crash the route. Completes the crash sweep together with onboarding carryover (`?? []`), resume-intake preset offline fallback, and the `/admin/access` governance console (which now includes the Candidate role filter, a demo invitation-token display, and a merged security audit feed covering access actions + CANDIDATE_CONVERTED + POLICY_WAIVED). `pnpm check` 223/223 · `pnpm build` green.

## 25. Onboarding TDZ ordering fix

`src/pages/onboarding.tsx`: the demo-fallback `useEffect` referenced `plan.data` (dependency array + body) while `const plan = useQuery(...)` was declared later — a Temporal Dead Zone violation that crashed the route on mount in production builds (`ReferenceError: Cannot access 'w' before initialization`). Moved `const plan = useQuery(...)` above the effect (now planOwners → plan → effect → tasks). Verified with a hook-ordering sweep across onboarding, admin-access, workforce-review, and resume-review-flow: no other hook references a later-declared const. `pnpm check` 223/223 · `pnpm build` green.

## 26. Admin governance panel + redundancy cleanup

`src/pages/role-home.tsx`: the bottom "Your modules" grid (which duplicated the header nav) is replaced for `hr_executive` with the **Platform Operations & Security Governance panel** — 4 cards: Access & Governance (`/admin/access`), Security Audit Logs (`/admin/access?tab=audit`, deep-link opens the drawer), System & Model Health (`/status`), Data Quality Engine (`/workforce/data-quality`). Non-admin roles keep the honest per-role module grid. New pages: `src/pages/status.tsx` (live gateway state, model, latency probe, build/schema versions; jobs correctly remain function-mediated) and `src/pages/data-quality.tsx` (read-only ledger health: assertion rigor distribution, orphaned claims, twins with missing/thin verified skills, evidence-with-quotes). Routes registered; admin RLS reads verified live. `pnpm check` 223/223 · `pnpm build` green.

## 27. Role isolation, redundancy cleanup & visual scannability (frontend only)

- **Nav**: flattened to a single row of icon-backed tabs (no category labels) in `app-shell.tsx`; per-role tab sets — admin adds System Health (`/status`) + Data Quality (`/workforce/data-quality`); recruiter and employee now get Skill Graph (`explore_skill_graph` granted in rbac, recruiter matrix test updated); role landings wired for real via `resolveLanding` in login + demo quick-access (recruiter → `/recruitment`, admin → `/admin/access`).
- **KPI cards** (`executive-dashboard`): recruitment cards (Open Requisitions / Active Candidates) render only for recruitment managers; every rendered card is clickable with a valid `to`.
- **Redundancy**: "Your modules" grid removed for all roles; administrators keep the Platform Operations & Security Governance panel; other roles get a live "Action tasks & review feed".
- **Onboarding jargon** (`onboarding.tsx`): Wave 0/1/2 → Step 1 (IT & Pre-boarding Setup) / Step 2 (Core Orientation & Learning) / Step 3 (Role Verification & First Contribution); dependencies render as "Prerequisite: <task title> must be completed first."
- **Charts**: exec dashboard adds a skill-gap distribution bar (Ready / Support / Insufficient / Missing per future skill) and an onboarding progress bar (on track vs blocked) — hand-rolled semantic bars (no new dependency).
- **Candidate**: 4-step application stepper (Applied → Technical Interview → Final Round → Selected) on `/candidate-status`.
- **Typography**: Outfit font applied to the base layer.
- Backend untouched (no function/RPC/schema changes). `pnpm check` 223/223 · `pnpm build` green. Deferred (scope): dedicated recruiter candidate-directory page and literal Recharts dependency.

## 28. Onboarding page UX redesign (frontend only, `src/pages/onboarding.tsx`)

- **Hero "Next action" banner**: picks the first incomplete task (preferring unblocked) and shows title, step context, due/blocked note, with a "View step / View blocked step" button that smooth-scrolls to the dependency graph.
- **Milestone stepper**: horizontal stepper above the DAG — numbered dots with complete/active/pending states and human step titles (1 Setup & Provisioning, 2 System Access & SSO, 3 Team Orientation, 4 First Contribution, 5 Final Verification).
- **Readiness widget**: clean "Onboarding Readiness" card with big %, flat progress bar, "X of Y completed · Z blocked by prerequisites · Dd on critical path".
- **Task cards**: compact summary (title, status chip, owner/due, blocker tag, actions, resolve) with a "View details & evidence" toggle that hides prerequisites/completion/waiver/adaptation/WhyEvidence by default — blockers and actions stay visible for the demo.
- **Regenerate** → "Generate new plan version" with subtext "the active plan is never modified in place"; bottom governance text → collapsible "Governance & safeguards" accordion.
- No backend function/RPC/schema changes. `pnpm check` 223/223 · `pnpm build` green.

## 29. Fixed left-sidebar navigation (all AppShell pages)

`src/components/app-shell.tsx` converted from a top horizontal nav to a **fixed vertical left sidebar** that every `<AppShell>` page inherits automatically: brand + role pill up top, vertical icon+text links (role-gated), a "Governance" section for admins (Access & users, System health, Data quality), and a footer with the live AI-gateway chip, the active user email, Reset demo, and Sign out. The content panel keeps the demo-mode strip (fictional-data badge, AI state, build/schema) and the slim governance footer; on narrow screens the sidebar collapses to a hamburger menu in the top strip. No page routes or backend touched. `pnpm check` 223/223 · `pnpm build` green. (Visual click-through of the sidebar pending a logged-in preview session; prior items — AdminGovernancePanel restore, role isolation, onboarding redesign — already shipped.)

## 30. AppShell recursion bug fix (authed pages freeze / white screen)

Root cause of the blank/frozen authed pages (landing rendered fine): the sidebar rewrite had matched the wrong `return (` anchor, so `renderLink` ended up containing the entire AppShell layout — when invoked it recursively re-rendered the sidebar (`renderLink → mainLinks.map(renderLink) → …`), and `AppShell` itself returned nothing. Rewrote `src/components/app-shell.tsx` cleanly: `renderLink` returns a single `<Link>`, and `AppShell` returns the fixed left sidebar (brand + role pill + gated nav + Governance section + health/email/reset/sign-out footer) + the scrollable content panel (demo-mode strip, mobile menu, account menu, main, footer). Verified structurally (1 layout div at component level, renderLink contains a plain Link) and via `pnpm check` 223/223 · `pnpm build` green.

## 32. Module UX overhaul — part 1 (onboarding, workforce review, staffing)

- **Onboarding**: fixed the `Step 4: Step 4` label bug (unknown levels now render "Additional Step N"); "non-waivable" chip + waiver dialog → "Mandatory Security Requirement"; the step columns got a carousel with ‹ Prev / Next › scroll buttons (smooth horizontal scroll).
- **Workforce Review**: added a search bar (by name), a department dropdown, a risk-level filter (Low 0–30 / Moderate 31–70 / High 71–100), color-coded index gauges (green/yellow/red) in every case row, department labels, and a "N of M employees" count.
- **Staffing Planner**: added an infographic KPI row — External fill rate (with bar), Coverage today (move), Fastest path to ready (best option + days), and Recommended path (hybrid coverage) — all derived from the live staffing payload.
- Backend untouched. `pnpm check` 223/223 · `pnpm build` green.
- **Deferred (documented)**: Recommendation Hub category grouping + plain-English rationale cards, and Skill Graph search + current-vs-target bars — larger page refactors, next turn.

## 33. Batch C — Recommendation Hub: subject clarity, comments with permissions, canonical history, honest pagination

Execution of the reviewer's 15-section spec in small batches (A→H). Batch C status:

- **C1 — Subject clarity: COMPLETED.** The hub resolves every recommendation's subject to a real person (name · role · job title) from the org roster and the target to a requisition title/department, shown on each card and in the approve preview. No sliced resource ids remain (`resource_ref.slice(0,8)` removed).
- **C2 — Optional messages/comments with permissions: COMPLETED.** New `recommendation_comments` table (org/recommendation/actor/body/visibility `all|approvers`, RLS read org-scoped with approver-only visibility, no client write policy). New backend function `recommendation-comment` (add/list) enforces who may comment (HR or the responsible manager) and hides approvers-only notes from non-approver roles. Review/execute actions accept an optional `message`, persisted in the workflow-event payload (canonical audit) and mirrored into the comment thread; idempotent replays skip the mirror. Hub has a persisted comment thread per card plus an optional note field on every decision dialog.
- **C3 — Recommendation-specific canonical history incl. pre-execution events: COMPLETED.** The workflow_events trail is now shown for every lifecycle state (previously hidden before execution). Legacy `audit_events` is merged and deduplicated: only the scan-time creation record survives, transition-shaped legacy entries are dropped. Decision notes and outcome evidence render in the timeline. Pure helper `src/lib/decision-history.ts` (unit-tested, 7 cases).
- **C4 — Honest pagination: COMPLETED.** The hub now asks the server for an exact count under the same filters and RLS (`count=exact`) and fetches bounded range slices, instead of "latest 20 → local pagination". Out-of-range pages are clamped; the shown count is the real matched total.

**Tests run:** `pnpm check` green — 349 tests / 32 files (was 342/31; +7 decision-history, schema/contract wiring), 41 bundles, no drift. `pnpm build` green. Migration applied; `recommendation-comment` deployed (v1), `recommendation-review`/`recommendation-execute` re-deployed.

**Browser verification:** not performed (auth-gated pages cannot be screenshotted — session capture races the async persona login). Live API verification instead via `scripts/verify-batch-c.mjs` — 16/16 checks pass: exact server count + bounded page, decision message persisted in the event payload AND mirrored as an approvers comment, comment persists across calls, employee blocked from adding and from seeing approvers-only notes, cross-recommendation history differs, reset restores a pristine org (comments cascade-wiped). Demo left pristine after the final reset.

## 34. Batch D — Multi-person onboarding overview, journeys, comparison, canonical consistency

- **D1 — Administrator overview first: COMPLETED.** The journeys overview row now shows employee, role, department, manager (resolved by name), start date, owned-task completion (x/y), plan status (Pending approval / Active / Completed), blockers, overdue, stalled, sign-off needed, and actions available to the viewer. New search (name/role/department/manager) plus department and plan-status filters. Clicking a journey opens a bounded journey-summary dialog (who · plan state · progress with gates · blockers & waiting · your actions) instead of dropping the user straight into the dependency graph; "Open full plan" deep-links to the existing plan view.
- **D2 — Multiple coherent journeys: COMPLETED.** reset-demo now seeds 5 onboarding plans at distinct lifecycle stages via the deterministic engine and real approved applications: Alex Chen (Backend — approved, waiting on IT blocker), Samira Patel (Data Analyst — pending approval), Diego Mensah (Product Designer — progressing normally), Wei Fernandez (Data Analyst — nearly complete), Fatima Kowalski (Backend — completed). Done tasks carry matching demo evidence references; plans differ per role (never a clone). Demo-tenant only and idempotent (reset deletes + reseeds plans/tasks/applications).
- **D3 — Compare up to three: COMPLETED.** Each overview row has a Compare toggle (max 3); a compare dialog shows plan status, owned-task completion, the three mandatory readiness gates, blocked/overdue counts, time since start, and projected ready, with an explicit "different role plans are not directly equivalent" caveat. The queue contract now carries `department`, `completed_tasks`/`total_tasks`, and `gates`.
- **D4 — Completion vs review: PARTIAL.** The UI now labels the four distinct signals explicitly: plan approval (sign-off on the plan), owned-task completion (x/y), evidence-gated verification (verification tasks require accepted assessment evidence; waived never counts as capability), and readiness (labeled an estimate/provisional). No submission/review task state was added: the engine has no such state, so an "evidence awaiting review" journey stage is not represented (per "where supported") — no frontend-only status was invented.
- **D5 — Canonical consistency: COMPLETED.** Home, dashboard, and the onboarding center all read `onboarding_plans` + `onboarding_tasks` (verified live: dashboard `journeys_in_progress` == queue count == 5, on-track 4 / blocked 1 matching Alex's blocker).

**Tests run:** `pnpm check` green — 355 tests / 33 files (+6 onboarding-queue engine tests), 42 bundles, no drift. `pnpm build` green. Deployed: `onboarding-queue`, `reset-demo`.

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-d.mjs` — 14/14 checks pass (5 journeys at the expected stages, department/counts/gates present, distinct roles, dashboard↔queue agreement). Demo left pristine after the final reset.

## 35. Batch E — Skill Graph: honest scores, freshness, fingerprint, visual connections

- **E1 — Current/future explained correctly: COMPLETED.** A demand with no future-skills definition now renders an honest "Future requirements not defined" panel — never a fabricated 0 or 100. When future requirements exist, a "How the future target differs from today" strip shows added / raised / no-longer-required skills (pure `futureRequirementDiff` helper, unit-tested), and the copy states a lower future score can be legitimate because the target is harder/different — the future number is never inflated.
- **E2 — Claim vs verified capability: COMPLETED.** New "Profile match vs verified coverage" panel over the direct skills: direct skills in role · verified coverage (reviewer-confirmed or assessment-supported) · unverified claims (self-reported/extracted) · missing evidence. Copy states the overall match includes claims and that keywords alone never satisfy a gate (`coverageBreakdown` helper, unit-tested).
- **E3 — Complete cache fingerprint: COMPLETED.** The engine now records `graph` (hash of the whole taxonomy incl. typed edges) and `context` (seniority + independent artifact count) in `fit.versions` alongside engine/evidence/requisition. `fitIsStale` compares all five; pre-Batch-E fits are recomputed once. `skill-match` builds the full fingerprint on every call (verified live: graph + context present, cached repeat served, force recompute fresh).
- **E4 — Selection/race protection: COMPLETED.** Results are bound to the person+demand they were computed for; changing either shows a "Selection changed — recompute" banner instead of stale figures. A monotonic run-id drops late responses from superseded runs. Freshness + cache status are shown ("served from cache · last computed …"), and evidence/requisition/seniority/graph changes auto-invalidate via the fingerprint. Permission enforcement re-verified live (employee → other person = 403).
- **E5 — Focused visual connections: COMPLETED.** The section is renamed "Connections". Clicking a skill renders a bounded SVG ego-network (center + direct outgoing/incoming neighbors only — never the whole taxonomy), with a legend (Related skill / Transferable experience / Prerequisite), clickable nodes that re-center, and the outgoing/incoming relationship lists kept below as the accessible table/list alternative. "A path between skills is a relationship, never proof of mastery."

**Tests run:** `pnpm check` green — 362 tests / 34 files (+7 skill-graph metrics, +2 engine fingerprint/staleness), 42 bundles, no drift. `pnpm build` green. Deployed `skill-match`.

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-e.mjs` — 8/8 pass (full fingerprint, cache, force recompute, person identity, permission enforcement). Demo left pristine.

## 36. Batch F — Admin overview authorized search + staffing comprehension

- **F1 — Authorized overview search: COMPLETED.** New backend function `overview-search` returns People / Candidates / Roles groups bounded to 5 each, with the scope decided server-side from the caller's role — HR searches the org, managers only their own reporting subtree (same BFS as the dashboard and staffing planner), and the candidate/requisition groups are HR-only (item 29: a manager can never pull the wider org or pipeline). A `q < 2` query returns empty groups, and non-HR/managers get 403. The overview header on the dashboard hosts a new `OverviewSearch` component: debounced 250ms, grouped panel with deep links (people → `/workforce?twin=`, candidates → `/recruitment?cand=`, roles → `/recruitment?req=`, actions/modules → RBAC-driven nav links from the same navigation source as the app shell), keyboard navigation (↑/↓, Enter, Esc), an explicit clear (×) button, a result/scope footer, and distinct loading/empty/error states. Module ("actions") results stay client-side because they are static navigation, not data. The requisition filter's misleading "All open" empty option was reconciled to "All requisitions" (the dropdown lists every status; the aggregate cards still count only status open).
- **F2 — Staffing comprehension: COMPLETED.** The planner page is retitled "Plan how to staff a role or project" with an explicit **Define → Compare → Review → Approve** stepper. Comparison is now FIRST: the decision table appears immediately under the scenario bar with per-option summaries (subject or first violated constraint), and the recommendation rule is stated verbatim — *highest verified coverage among options that satisfy every mandatory skill within deadline AND budget, ties broken by lower cost then earlier ready date; no recommendation when none qualify*. The recommended row is highlighted and badged (pure, unit-tested `recommendOption` in `src/lib/staffing-recommendation.ts`). Detailed option cards remain below for evidence review. The proposal flow now binds the SELECTED option: the user picks a row, "Send selected option to human review" is gated on a selection (and on a non-outdated plan), and the backend `propose` action validates the option against the scenario result and persists `option_id`, `option_label`, a full `option_snapshot`, and `scenario_version` (assumptions version + stable input fingerprint) on `staffing_proposals`. The submitted confirmation shows the bound option and version fingerprint. A wrong/missing option is rejected with 400 and nothing is inserted.

**Tests run:** `pnpm check` green — 367 tests / 35 files (+4 staffing-recommendation, +1 overview-search contract), 42 bundles, no drift. `pnpm build` green. Migration applied (staffing_proposals option-binding columns); deployed `overview-search` (v1) and `staffing-comparison` (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-f.mjs` — 20/20 pass (HR org scope incl. populated candidate group, manager team scope with zero candidate/requisition exposure, employee 403, short-query guard, no-match emptiness, bounded deep-link rows, proposal binds option+label+version, persisted row readable at RLS scope with the option snapshot, invalid/missing option rejected). Demo left pristine.

## 37. Batch G — Persistent, private policy conversations

- **Ownership + RLS: COMPLETED.** New `policy_conversations` and `policy_messages` tables. Every conversation is owned by exactly one twin; RLS select policies are owner-only (join through `current_twin()`), there is no client write policy, and every action in the new `policy-conversation` backend function re-checks `owner_twin_id === caller.id` — listing, reading, saving into, or linking escalations to another user's conversation returns 404. Live-verified in both directions.
- **No cross-user leaks: COMPLETED.** The shared `sessionStorage` draft (`workspace:policy-studio`) that leaked between personas in one tab is gone. The page now reads the conversation list from the server on mount and renders full persisted history; dana and alex each see only their own conversations and messages (function 404 + REST RLS returning zero rows both directions).
- **Retry dedup: COMPLETED.** Saves are idempotent on a per-submit `request_id` via `unique (conversation_id, request_id)` + upsert — re-saving the same request updates in place and never duplicates the user/assistant rows (verified: retry keeps 1 conversation and 2 messages).
- **Citations/escalations preserved: COMPLETED.** The assistant message stores the full validated `PolicyAnswer` payload, so grounded status, citations with verbatim quotes, computed leave facts, employee context, and the sources-inspection list all survive a refresh and are re-rendered from history. Escalations bind to the assistant message via `link-escalation` (escalation_id column on the message, FK to `policy_escalations`), and history shows an "Escalated to HR" note. The Policy Studio UI is now a conversation browser: sidebar list with title + last-answer status + escalated marker, "New" to start a fresh conversation, composer continues the active thread, and the existing context/examples/escalation-workflow features are preserved.
- The user-facing data model did not change; only Q&A persistence was added.

**Tests run:** `pnpm check` green — 368 tests / 35 files (+1 policy-conversation contracts test), 43 bundles, no drift. `pnpm build` green. Migration applied; `policy-conversation` deployed (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-g.mjs` — 17/17 pass (persist+preview, full answer + citations after round-trip, retry dedup, escalation link visible in history, both cross-user directions blocked by the function and by RLS). Demo left pristine.

## 38. Batch H — Audit history + connected cross-module demo

- **H1 — Access/users audit: COMPLETED.** New `security-audit` backend function (admin-only, enforced server-side) merges the four canonical sources — `admin_actions` (access governance), canonical `workflow_events` (recommendation + action-task lifecycle), `application_stage_events` (candidate decisions), and onboarding waivers — into one newest-first feed. Dedup is structural + enforced: legacy `audit_events` jsonb arrays are never read (so the same fact cannot surface twice) and every emitted row carries a stable source-prefixed `key` on which the feed dedupes. Names (actor + affected subject) are resolved server-side from the org roster. Pagination is honest: exact per-source counts sum to `total` under the same filters, pages are bounded slices, out-of-range pages keep the real total, and per-source truncation is reported (`truncated_sources`). The admin drawer now has a server-side kind filter (changes the exact total), real Prev/Next page controls, resolved names, expandable reason, and authorized "View in module" deep links.
- **H2 — Fictional audit examples: COMPLETED.** reset-demo seeds an idempotent labeled audit sequence (every record carries "Synthetic demo audit record — fictional data only.") that is internally consistent with the seeded state and references the SAME real fictional resources: an access story that nets back to "active" (invite → role change → suspend → reactivate by Dana), canonical workflow events for the Samira recommendation (submit by Riley) and the upskilling recommendation + its pair_data action task (approve by Jordan, start by the analyst), a candidate conversion stage event for Alex (final_round → selected, matching his selected application row), and a labeled onboarding waiver on Samira's pending plan survey (task set to `waived` with the deterministic readiness estimate recomputed through the same engine, so task states and plan readiness never diverge). Idempotency verified: a second reset re-seeds the identical feed with no duplicates.
- **H3 — Connected demo: COMPLETED.** The same identities and records are connected across modules: Alex's stored resume/fixtures, employee evidence, workforce demand (Senior Backend Engineer requisition), staffing scenarios, the recommendation hub (subject, comments, per-recommendation history), owned action tasks, outcome evidence, skill-match fits, and individual histories all reference the same demo resources. The audit feed adds authorized handoff links per event (member → `/admin/access`, recommendation → `/hub?rec=`, candidate → `/recruitment?cand=`, waiver → `/onboarding`). No closed loop is claimed beyond what is implemented and persisted.

**Tests run:** `pnpm check` green — 369 tests / 35 files (+1 security-audit contract test), 44 bundles, no drift. `pnpm build` green. Deployed `security-audit` (v1) and `reset-demo` (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-h.mjs` — 19/19 pass (all four canonical sources merged, deduped keys, server-resolved actor names, deep links, synthetic labeled events across all kinds, exact kind-filtered totals, bounded page 2, stable total, out-of-range consistency, employee 403, idempotent re-seed). Demo left pristine.

## 39. Final combined verification (A–H)

Final status of the reviewer's 15-section refinement spec across batches A–H:

- **A** (candidate/fit dialogs scrollable + state isolation; workforce drawer; staffing dirty-input protection; recommendation outcome evidence) — **COMPLETED** (prior turns).
- **B** (resume-viewing-first; linked fictional resumes verified; hiring terminology; decision previews) — **COMPLETED** (prior turns).
- **C** (recommendations: subject clarity, optional comments with permissions, canonical per-recommendation history, honest pagination) — **COMPLETED** (prior turns).
- **D** (onboarding overview first, 5 journeys at distinct stages, compare-up-to-3, completion-vs-review signals, canonical consistency) — **COMPLETED** with **D4 PARTIAL** (four signals labeled; no submission/review task state exists in the engine, so none was invented — per "where supported").
- **E** (skill graph: future-not-defined honesty, claim-vs-verified panel, complete cache fingerprint, identity-bound results + race guard, focused SVG Connections) — **COMPLETED** (prior turns).
- **F** (authorized overview search + staffing comprehension: Define→Compare→Review→Approve, comparison-first, explicit recommendation rule, proposal binds option + scenario version) — **COMPLETED** (this session).
- **G** (persistent private policy conversations: ownership/RLS, retry dedup, no cross-user leaks, citations/escalations preserved) — **COMPLETED** (this session).
- **H** (audit history: merged canonical sources, dedup, honest pagination, name resolution; idempotent labeled synthetic audit demo; connected cross-module handoff links) — **COMPLETED** (this session).

**Verification run individually:** ESLint clean; `tsc` app clean; `tsc` functions clean; `tsc` functions-check clean; bundle checker 44/44 entry points valid, no drift; 369 tests / 35 files pass; production build green (build identity `25e7fc9`). Live API verification: batch scripts F (20/20), G (17/17), H (19/19) all pass, plus the prior A–E live checks. Demo left pristine after the final reset.

**Browser verification:** not performed — all changed pages (dashboard overview, staffing planner, policy studio, admin audit drawer) are auth-gated and cannot be screenshotted; the run's live API verification covers the backend contracts and RLS behavior instead. No claim of visual verification is made.

**No concrete blockers remain.** The only open item in the spec is D4's optional submission/review task state, which is intentionally NOT STARTED because the adaptive onboarding engine has no such state; it is labeled PARTIAL and would require an engine/migration/API change to add.

## 40. Role workspaces spec — Batch 1 (navigation item filtering + HR skill-graph authorization)

New reviewer spec ("Role workspaces, authorization and connected HR logic repair", batches 1–9). Batch 1 delivered.

- **1.1 — Navigation item filtering: COMPLETED.** `visibleSections(role)` now evaluates each item's permission individually, drops empty sections, returns new section objects (original config never mutated), and the same filtered model drives the expanded sidebar, minimized rail and mobile drawer. Fixes: IT no longer sees Recommendation hub; recruiters no longer see Workforce review via Skill graph; HR no longer sees a graph destination the page refuses; candidates no longer see any app-shell destination (Overview is staff-only).
- **1.2 — HR skill access end-to-end: COMPLETED.** `hr_partner` gained `explore_skill_graph` in `ROLE_ACTIONS` (fixes the page guard and the menu). The `skill-match` backend now authorizes `hr_partner` for same-org workforce twins (scope `org`, candidates denied). No RLS change was needed — the existing `twin_select_hr_partner` policy already granted HR org reads; a redundant policy I added this turn was reviewed and dropped. The broader candidate-inclusive HR read remains flagged for the Batch 2 RLS audit.
- **1.3 — Split employee/manager authorization: COMPLETED.** Added a pure `authorizeSkillMatch` helper in `_shared/skill-graph-engine.ts` (shared by the backend and unit tests). Explicit branches: hr_executive org; hr_partner org-workforce; recruiter candidates-only; manager self or same-org team member; employee self (same org); IT/candidate/cross-org denied. Team traversal now filters to the caller's organization; a failed membership lookup returns false (never grants).
- **1.4 — Tests: COMPLETED.** New `src/lib/__tests__/navigation.test.ts` asserts exact per-role destination lists (not just which sections exist). `rbac.test.ts` updated for the new intended HR capability (the old "HR graph denied" expectation removed). `skill-graph-engine.test.ts` gains 7 authorization cases (HR same-org allowed, HR candidate denied, employee self-only, manager team/outside-team, recruiter candidate/employee, IT denied, cross-org denied). `scripts/verify-batch-1.mjs` live-verifies the deployed function with the real personas.

**Tests run:** `pnpm check` green — 379 tests / 36 files (was 369/35), 44 bundles, no drift. `pnpm build` green. Deployed `skill-match` (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-1.mjs` — 10/10 pass (hr_partner org employee 200 scope=org; hr_partner candidate 403; employee self 200; employee other 403; manager teammate 200 scope=team; manager stranger 403; recruiter candidate 200 scope=candidates; recruiter employee 403; IT 403). Demo left pristine.

**Remaining:** Batch 2 (backend + direct-table RLS audit), Batch 3 (role-specific workspaces), Batch 4 (IT onboarding handoff), Batch 5 (interview/assessment discoverability), Batch 6 (cross-module handoffs), Batch 7 (fixtures), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof).

## 41. Role workspaces spec — Batch 2 (backend + direct-table scope audit)

- **2.1 — Onboarding queue allowlist: COMPLETED.** `onboarding-queue` now uses an explicit allowlist (`hr_executive`, `hr_partner`, `manager`, `employee`, `it_security`); recruiter/candidate/unknown roles get a server-side 403 instead of silently falling back to HR's org-wide view. Manager scope is now the RECURSIVE reporting subtree (matching the skill-match scope model), not just direct reports.
- **2.2 — Direct-table scope: COMPLETED.** Audited the live policy set (every read policy was org-wide — `exists(current_twin where org matches)`). Replaced them with role-scoped reads through a shared security-definer helper `public.can_view_twin(subject_twin_id)` encoding: self / manager-team / HR-org / recruiter-candidates. Applied to onboarding plans/tasks/events, skill_fits, evidence_items, skill_assertions, applications, application_stage_events, candidate_sessions, assessments, assessment blueprints/rubrics, resume documents/versions, action_tasks, workflow_events (scoped via the resource subject: recommendation twin / action-task owner), performance_summaries, workforce_observations, workforce_review_cases, review_case_actions, staffing scenarios/proposals, recommendation_comments, and admin_actions (hr_executive only). `digital_twins.twin_select_hr_partner` was narrowed to HR partner + org workforce (no candidates). IT keeps direct read of onboarding plans/tasks (provisioning subjects); `policy_documents`, `skill_graph`, `job_requisitions`, `organizations`, and the owner-scoped policy conversation tables were left as-is (shared-by-design or already scoped).
- **2.3 — IT minimal projection: COMPLETED.** The IT queue payload now returns `journeys: []` (no readiness/gates/approvals/waiting-on) plus `provisioning` task refs enriched with `depends_on`, `blockers`, `evidence_requirements` and a minimal `people` array (name, start date, manager name). The ProvisioningQueue UI renders from that projection (identity, start, manager, blockers, dependencies, evidence flag, due date) instead of the HR-heavy journey fields. Contract + tests updated.
- **2.4 — Suspended/invalid accounts: COMPLETED (guard) + audit reported.** The queue function rejects non-active twins server-side (403); verified live via suspend → queue 403 → reactivate. Broader audit finding: most backend functions gate on twin existence/role but not status; auth session revocation at the platform boundary remains the global control, and per-function status guards can be added incrementally.
- **2.5 — Verification: COMPLETED.** `scripts/verify-batch-2.mjs` (17/17): recruiter queue 403; employee self-only queue + self-only direct plan/skill_fit/evidence reads; manager recursive-team queue + team-only plan reads; HR org queue + org workforce twins with zero candidates; recruiter zero plan reads but candidate applications readable; suspend→403→reactivate. Earlier live suites re-run green (batch-1 10/10, f 20/20, g 17/17, h 19/19). Cross-org cases covered by unit tests (single demo org).

**Tests run:** `pnpm check` green — 381 tests / 36 files (queue +2 IT projection tests, contracts updated), 44 bundles, no drift. `pnpm build` green. Deployed `onboarding-queue` (v1); migration recorded by the tool (`twin_select_hr_partner` narrowed; 20+ read policies re-scoped via `can_view_twin`).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-2.mjs` — 17/17 pass; demo left pristine.

**Remaining:** Batch 3 (role-specific workspaces), Batch 4 (IT onboarding handoff), Batch 5 (interview/assessment discoverability), Batch 6 (cross-module handoffs), Batch 7 (fixtures), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof).

## 42. Role workspaces spec — Batch 3 (role-specific workspaces)

- **3.1 — Administrator operational home: COMPLETED.** `ROLE_LANDING.hr_executive` changed from `/admin/access` to `/app` (unit-tested). Admins now land on the operational home: the shared org-scoped dashboard (pending decisions, review cases, blocked journeys), the governance panel (access/audit/health/quality), and the new org-scope attention strip. The internal `hr_executive` → "Administrator" mapping is documented and unchanged.
- **3.2 / 3.3 — HR + manager attention surfaces: COMPLETED.** New shared `JourneyAttentionStrip` above the dashboard, fed by the same server-scoped queue function: HR partners and administrators see organization journeys, managers see their team — pending-approval / stalled / overdue counts plus a top-5 actionable list with deep links (`/onboarding?twin=`). No new modules; same engine, different scope and labels ("My team needs attention" vs "Onboarding needs attention").
- **3.4 — Recruiter discoverability: COMPLETED (home counts).** The recruiter home now shows real candidate-session rows: "Invitations awaiting response" (invited/in_progress) and "Submitted for review" (submitted) — genuine counts from the RLS-scoped `candidate_sessions` table, never "no assessments" on a failed read. Deep-dive queueing/UX lands in Batch 5.
- **3.5 — Employee home: COMPLETED (waiting-on line).** The onboarding panel now shows "Waiting on others" from the canonical queue's `waiting_on` refs (e.g., laptop/SSO owned by IT, orientation by manager) with owner labels.
- **3.6 — IT Provisioning workspace + label: COMPLETED.** Role label renamed to "IT Provisioning" (badge "IT PROV"); the generic filler card is replaced by a real workspace: ready/in-progress/blocked/overdue/completed counts, upcoming start dates (next 14 days) with manager, and the full provisioning/access task list with employee, due date, blocker, dependency and evidence-required hints — all from the Batch 2 minimal IT projection. New pure helpers `deriveItQueueCounts` + `upcomingStarts` in `src/lib/it-provisioning.ts` (tested).
- **3.7 — Candidate: unchanged** (token-scoped status/assessment flow, strict scope).
- **3.8 — Shared design: unchanged** — all panels reuse the existing StatBlock/queue/design-system tokens; differentiation is by scope, content and actions only.

**Tests run:** `pnpm check` green — 385 tests / 37 files (+4 rbac/landing + it-provisioning helpers), 44 bundles, no drift. `pnpm build` green. No backend function changed this batch (data paths reused from Batch 2).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-3.mjs` — 12/12 (Elena/IT: minimal projection with people+provisioning context, IT direct reads of plans but zero evidence/fits; recruiter session counts resolve — 6 invited, 0 submitted is a genuine count, not a read failure). Batches 1–2 re-run green (10/10, 17/17). Demo left pristine.

**Remaining:** Batch 4 (IT onboarding handoff: task completion + propagation + fixtures), Batch 5 (interview/assessment discoverability UX), Batch 6 (cross-module handoffs), Batch 7 (role-relevant fictional data), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof).

## 43. Role workspaces spec — Batch 4 (real onboarding handoff)

- **4.1 — Queue fields + filters: COMPLETED.** The IT provisioning queue (onboarding center AND home workspace) now carries employee, start date, manager, task, owner, state, due date, dependencies, blockers, evidence-required hints, and adds operational filters — All / Ready / Blocked / Overdue / Completed — plus employee/task-title search. Pure `filterItProvisioning` helper in `src/lib/it-provisioning.ts` (unit-tested), shared by both surfaces.
- **4.2 — Lifecycle + evidence: COMPLETED.** Approved plan → provisioning work (already the canonical flow). IT records accepted evidence through the existing completion dialog whose requirement labels are genuinely IT-shaped ("Hardware & asset tag", "MFA / SSO enrollment reference") — device reference / access confirmation, never passwords/tokens/credentials. Blocker resolution is server-side distinct from completion (verified), and dependencies are enforced by the engine (`validateCompletion`).
- **4.3 — Propagation: COMPLETED (verified live).** Laptop completion → canonical task done + readiness recomputed (16.7→25), SSO stays blocked by its open blocker; blocker resolved → SSO ready; SSO completed → team_intro (manager-owned) cascades to ready. IT queue drops Alex's tasks, HR journey view shows the same recomputed counts (completed 3, readiness 25). All views read the same canonical rows — no demo reset needed.
- **4.4 — Assignment: COMPLETED.** Ownership is role-based and enforced server-side (`canActOnTask`: IT acts on `it_security` tasks, org-scoped); no person-level "Elena owns this" claim — the completion records the acting IT twin. IT cannot read unrelated HR evidence (verified: evidence_items 0 rows).
- **4.5 — Fixtures: COMPLETED.** Four coherent starters on real plans: Laptop ready (Alex `it_provisioning`), SSO blocked (Alex `access_sso`, 1 open blocker), **Access ready (Diego `access_sso` derived READY — new fixture, done list re-seeded without access_sso)**, Provisioning complete (Wei both done; Fatima completed). Verified live after reset.

**Tests run:** `pnpm check` green — 393 tests / 37 files (+8 filter helper cases), 44 bundles, no drift. `pnpm build` green. Deployed `reset-demo` (v1) with the Diego fixture.

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-4.mjs` — 12/12 (Diego access ready; laptop→blocked→resolve→SSO→cascade with evidence + propagation; IT queue/HR journey reflect; IT zero evidence reads). Prior live suites re-run green (1: 10, 2: 17, 3: 12, f: 20, g: 17, h: 19). Demo left pristine.

**Remaining:** Batch 5 (interview/assessment discoverability UX + error-vs-empty), Batch 6 (cross-module handoffs), Batch 7 (role-relevant fictional data), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof).

## 44. Role workspaces spec — Batch 5 (interview/assessment discoverability)

- **5.1 — Candidate workspace tabs show real session state: COMPLETED.** The Assessments tab is no longer a static stub that auto-launches a dialog and leaves an empty tab. It now renders the application's real `candidate_sessions` rows (blueprint title, format, status, expiry/submission time) with an "Open reviewer" button per row; closing the dialog leaves the tab showing the same real rows. A session deep-link (`initialSessionId`) opens the tab and the reviewer focused on that session. The Interview tab gains a minimal "Interview record" block (5.6): real interview-session rows, explicitly labeled **manually scheduled**, with the note that no calendar invite is ever created or fabricated.
- **5.2 — Hiring-level work queues: COMPLETED.** New backend function `assessment-queue` (role-gated to hr_executive / hr_partner / recruiter, active accounts only) + pure engine `_shared/assessment-queue.ts` (7 unit tests) derive six org-scoped queues from canonical rows only: upcoming interviews, invitations awaiting response, incomplete scorecards (submitted, unevaluated), submitted assessments, evaluations awaiting reviewer confirmation (assessments.reviewed_at IS NULL), and failed evaluation jobs. Every item is linked to candidate / application / role. Failed `assessment_evaluation` jobs now record `output.session_id` (assessment-evaluate change) so they link back to the session. The Recruitment workspace gets a "Work queue" tab (reachable without a requisition too); each row deep-links into the candidate workspace on the relevant session.
- **5.3 — Query handling: COMPLETED.** `loadSessionList` no longer swallows DB errors (`?? []` → false "No sessions yet."). New `src/lib/candidate-sessions.ts` `loadCandidateSessions` throws a coded `SessionListError` (RLS `42501` mapped to FORBIDDEN); the candidate-detail tab renders loading / unavailable / forbidden / error-with-retry / empty / populated via `classifyQuery`, and the reviewer panel renders loading / error-with-retry / empty / list. A failed read is never presented as an empty queue.
- **5.4 — Distinct formats: already satisfied, preserved.** Work sample / interview / knowledge assessment keep genuinely different blueprints; the invitation dialog only offers blueprints matching the chosen format (server-validated too).
- **5.5 — Qwen assistance + deterministic rules + human confirmation: already satisfied, preserved.** Evaluate = deterministic pre-classification + Qwen + server-side `validateJudgmentItem` + `computeReviewRequired`; review confirmation still gates evidence.
- **5.6 — Minimal interview record: COMPLETED** (see 5.1) — labeled manual scheduling, no fake calendar invites.
- **5.7 — Candidate-session reliability: already satisfied, preserved and re-verified live.** Invitation token, expiry (`SESSION_EXPIRED`), already-submitted (`LOCKED`), duplicate submission (`DUPLICATE_SUBMISSION`, hash-exact), autosave (draft flush + beforeunload) — the live verify re-confirms duplicate rejection.

**Tests run:** `pnpm check` green — 396 tests / 38 files (+7 assessment-queue engine tests), 44 bundles, no drift. `pnpm build` green. Deployed `assessment-queue` (v1) and `assessment-evaluate` (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-5.mjs` — 15/15 (queue shape + six queues + org-wide counts + candidate/application/role linkage + manager 403 gate + 3 real Priya sessions + duplicate-submission rejection + incomplete-scorecard routing + evaluation → awaiting-review linkage + pristine reset). Prior live suites re-run green. Demo left pristine.

**Remaining:** Batch 6 (cross-module handoffs), Batch 7 (role-relevant fictional data), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof).

## 45. Role workspaces spec — Batch 6 (cross-module handoffs)

Contract map audited: canonical sources (person/role, application+stage, resume doc/version, skill assertions+evidence, assessment/review, skill fit, onboarding plan/task, staffing scenario/proposal, recommendation, action task, workflow event) — one canonical operational state per workflow; derived summaries read the same rows.

- **6.1 — Resume update → fit invalidation: COMPLETED.** `resume-review` recomputed a fresh fit but never persisted it (stale until a manual recompute). It now writes the recomputed fit to the canonical `skill_fits` row + legacy mirror via the new shared `_shared/fit-store.ts` (pure `mergeLegacyFits` / `appendAuditEvent` + atomic `upsertSkillFit`; 3 unit tests). Claims stay `extracted` (unverified); extraction never upgrades skills; selection is untouched.
- **6.2 — Reviewed assessment → evidence/fit/comparison: COMPLETED (canonical fit now written).** `assessment-review` wrote evidence + assertions (already present) but persisted fit only to the legacy `computed_fits` array — while `candidate-compare` reads the canonical `skill_fits` table first. It now upserts current+future fits through `upsertSkillFit`. Verified live: review raised Priya's fit 0.715 → 0.970 and the hiring comparison reflected 0.970 with **no demo reset**; 3 source-linked `assessment_supported` evidence records written.
- **6.3 — Hiring handoff: COMPLETED (verified).** `select` (final round only, stage engine) → RPC `convert_candidate_to_employee` (same twin id, role→employee, verified skills/evidence preserved — no duplicate profile) → the new employee's selected application binds an onboarding plan built from the approved role (`NO_APPROVED_ROLE` guard prevents title-guess plans). Live: disposable candidate advanced→selected→converted→plan generated with owned tasks.
- **6.4 — Onboarding changes → propagation: COMPLETED (re-verified).** Generated plan exposes `it_provisioning`/`access_sso` work owned by IT, learning owned by employee, approval owned by manager/HR; canonical state/readiness/queue recompute already live-verified in Batch 4.
- **6.5 — Development evidence: already supported** (accepted evidence → assertion/proficiency rules in `assessment-review` + onboarding verification; waived tasks never prove skill).
- **6.6 — Staffing decisions: existing.** Proposals bind the selected option + scenario version + full option snapshot; the staffing page flags proposals against the current scenario version (recalculate semantics). Evidence→proposal staleness cascade deliberately deferred to Batch 9's stale-proposal test scope (proposals carry no candidate id today).
- **6.7 — Technical reliability: COMPLETED (verified).** Version-guarded stage transitions + atomic conversion RPC; duplicate select against an old version is rejected `409 STALE_STATE` (no duplicate conversion); `skill_fits` upsert is idempotent per (twin, target, scenario).

**Tests run:** `pnpm check` green — 399 tests / 39 files (+3 fit-store), 45 bundles, no drift. `pnpm build` green. Deployed `assessment-review` and `resume-review` (v1).

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-6.mjs` — 19/19 (canonical fit after review, comparison reflects without reset, source-linked evidence, select→convert→same-twin, STALE_STATE on duplicate select, plan from approved role with IT/employee/manager/HR owners, pristine reset). Batch 5 re-run green (15/15). Demo left pristine.

**Remaining:** Batch 7 (role-relevant fictional data — check fixtures first), Batch 8 (honest coverage matrix), Batch 9 (regression + release proof, incl. stale-proposal handling test).

## 46. Role workspaces spec — Batch 7 (role-relevant fictional data)

Inspected existing fixtures first (54 employees with coherent manager reporting, 30 candidates, 6 requisitions with differentiated stages, 184 reviewer_confirmed / 124 assessment_supported / 88 claimed / 5 extracted assertions, review-case priority mix low 33 / medium 17 / high 6 / review 1, 5 onboarding plans). Enriched the designated demo org only; no destructive reset, no production backfill.

- **7.1 — Differentiated candidate-session states: COMPLETED.** Previously all 6 sessions were `invited`. New `seedCandidateSessionStates` in reset-demo gives a second candidate (Ravi Shah, real WS-SYN-RAVI-2026 application) the realistic mix: **work_sample submitted → evaluated → HUMAN-REVIEWED** (seeded canonical assessment with `reviewed_at`, determination confirm, verbatim evidence quotes), **interview in_progress** (drafts saved, awaiting candidate), **knowledge_check expired** (deadline in the past). Priya's 3 sessions and the disposable twin's 3 sessions stay pristine as the live acceptance surface.
- **7.2 — Reviewed evidence loop: COMPLETED.** The seeded review persists a source-linked `evidence_items` row (source_type work_sample, quote is a verbatim substring of the stored answer — no generic "Evidence: resume"), referenced by the assessment. The reviewer view (`assessment-session fetch`) returns the reviewed evaluation.
- **7.3 — Partial-data honesty: COMPLETED (verified).** Juno Park stays a low-text/keyword-only resume (no fabricated dates); the risk mix is not uniformly high (low 33 > high 6). The queue correctly shows Ravi's reviewed submission under "submitted" and NOT under "incomplete scorecards" (it has a scorecard).
- **7.4 — Live acceptance surfaces preserved: COMPLETED.** Priya + disposable invited sessions still 6; prior verify suites re-run green with the new fixture (upcoming interviews now 3 — Ravi's in-progress interview joins the two invited ones).

**Tests run:** `pnpm check` green — 399 tests / 39 files, no drift. `pnpm build` green. Deployed `reset-demo` (v1) with the enriched fixtures.

**Browser verification:** not performed (auth-gated pages cannot be screenshotted). Live API verification via `scripts/verify-batch-7.mjs` — 13/13 (differentiated session states, past expiry, reviewed evaluation, verbatim source quote, linked evidence, Priya/disposable untouched, queue placement, partial-data candidate, non-uniform risk mix, pristine reset). Regressions: batch-5 15/15, batch-6 19/19, batch-4 12/12, batch-3 12/12. Demo left pristine.

**Remaining:** Batch 8 (honest coverage matrix), Batch 9 (regression + release proof, incl. stale-proposal handling test).

## 47. Role workspaces spec — Batch 8 (honest coverage matrix)

Created `docs/coverage-matrix.md` — the internal truth-telling map of the 8 capability categories (recruitment intelligence, adaptive onboarding, policy reasoning, workforce risk, performance intelligence, skill graph, interview intelligence, decision dashboard). Each row states what exists, where (function/module), and its real limits. Supported: recruitment, onboarding, policy, workforce risk (explicitly NOT an attrition model), skill graph, interview intelligence, decision dashboard. Partial: performance intelligence (drafts only, human confirmation). Unsupported, explicitly named (nothing faked): trained attrition/performance prediction, code-execution sandbox, calendar invites, OCR, real-time push, payroll, and the evidence→staffing-proposal staleness cascade (scenario-version binding exists; proposal-to-candidate linkage deferred to Batch 9 test scope).

The one working cross-source journey (Demand → evidence → explainable comparison → human review → owned execution → accepted evidence → updated readiness) is proven live end-to-end in `scripts/verify-batch-8.mjs` — 8/8, no model dependency: open requisition with criteria → Ravi's reviewed work sample with verbatim quote → deterministic fit + scored comparison → human-reviewed determination → select → onboarding plan (12 tasks owned by employee/manager/IT) → numeric readiness → every assessment_supported evidence row carries a real quote. No new feature was added to fill a coverage box (per the batch instruction).

**Tests run:** `pnpm check` green (399 tests / 39 files, no drift). `pnpm build` green. Live `verify-batch-8.mjs` 8/8; prior suites unchanged (5: 15, 6: 19, 7: 13). Demo left pristine.

**Remaining:** Batch 9 (regression + release proof; add the missing tests — stale proposal handling, assessment errors vs empty, etc. — then final report).

## 48. Role workspaces spec — Batch 9 (FINAL: regression + release proof)

**Missing test added — stale-proposal handling: COMPLETED.** New pure helper `src/lib/staffing-staleness.ts` (dependency-free) with two predicates and 8 unit tests (`src/lib/__tests__/staffing-staleness.test.ts`): `isInputFingerprintOutdated(planPresent, inputFingerprint, currentFingerprint)` (dirty-input protection, replacing the inline `outdated` expression in staffing.tsx) and `isProposalStale(proposalScenarioVersion, currentScenarioVersion)` (a submitted proposal bound to an older assumptions version is flagged). staffing.tsx wires both in: the proposal-bound card now renders an amber alert whenever `proposal.scenario_version` differs from the current `plan.assumptions.version`, so a stale proposal is never mistaken for a fresh computation. The evidence→proposal staleness cascade (proposal-to-candidate id linkage) stays honestly deferred — it would require a `staffing_proposals` schema change plus engine rewrite, outside this batch's test-additive mandate (recorded in `docs/coverage-matrix.md`).

**Other reviewer test items — verified already covered, not duplicated:** assessment errors-vs-empty (classifyQuery + SessionListError: `src/lib/__tests__/query-state.test.ts` 6 tests; live batch-5), candidate/application state isolation + idempotent retry (`_shared/onboarding-v2.test.ts`, `stage-engine.test.ts`, batch-5/6 live), evidence-driven fit invalidation (`_shared/fit-store.test.ts`, batch-6 live), IT dependency propagation (`_shared/onboarding-v2.test.ts`, batch-4 live). Re-running them is the regression proof rather than new code.

**Six release checks — run separately, all green:**
1. Frontend lint — `pnpm lint`: 0 errors, 2 pre-existing warnings (role-home.tsx exhaustive-deps, benign).
2. App tsc — `tsc --noEmit -p tsconfig.app.json`: pass.
3. Backend checks — `tsc -p tsconfig.functions.json` + `tsc -p tsconfig.functions-check.json`: pass.
4. Bundle consistency — `node scripts/check-functions.mjs`: all 45 function entry points bundled & valid (28 shared modules), no drift.
5. Unit/contract tests — `pnpm test`: **407 tests / 40 files passed** (was 399/39; +8 staleness tests).
6. Production build — `pnpm build`: green (2029 modules).

**Live regression — all 8 suites re-run green (106 checks):** batch-1 10/10, batch-2 17/17, batch-3 12/12, batch-4 12/12, batch-5 15/15, batch-6 19/19, batch-7 13/13, batch-8 8/8. Each suite ends with a reset-demo teardown; final state read-only query confirms demo pristine (candidate_sessions 9, staffing_proposals 0, no leftover test rows).

**Browser verification:** not performed (all exercised pages are auth-gated and cannot be screenshotted); code/contract and live-API verification are the evidence above.

**Spec complete:** all 9 batches delivered (1 nav/RBAC, 2 RLS/scope, 3 role landings + IT, 4 IT queue + handoff, 5 assessment discoverability, 6 cross-module handoffs, 7 role-relevant fixtures, 8 coverage matrix, 9 regression + release proof). Remaining items: none implementable — only browser-persona verification remains untested (a tooling limit, not a product gap). Concrete blockers: none.

## 49. Innovation batch 10 — staffing proposal human-review loop

The reviewer spec's 6.6 said "Approval creates supported owned tasks" — but proposals could be submitted and were then never decided anywhere. This batch closes that loop end-to-end.

**Backend.** New `review_proposal` action in `staffing-comparison` (deployed v1): role-gated to HR (hr_executive/hr_partner), org-scoped, version-guarded (`open` → `approved`/`declined`; a second review is `409 ALREADY_REVIEWED`, never a silent overwrite), and persists a durable decision — status + `reviewed_by` + `reviewed_at` + `review_note`. On approval, when the selected option's subject resolves to an active org employee, exactly one employee-owned `action_tasks` row is dispatched (`task_code staffing_transition`, idempotency key `staffing-proposal:<id>`, surfaces in the subject's My work feed); declined approvals dispatch nothing. New additive migration adds `reviewed_by`/`reviewed_at` (existing `open` rows untouched). Also fixed a latent scope bug in `list`: it used the service role and returned **all org proposals to managers** — it is now server-scoped (managers see only their own/team proposals; HR sees all) and resolves submitted/reviewed twin ids to names.

**Engine + tests.** Pure `_shared/staffing-review.ts` (`isProposalDecision`, `planProposalDecision`, `buildFollowUpTaskRow`) + 7 unit tests. Frontend: new `reviewStaffingProposals` RBAC permission for both HR roles; `api.ts` exposes `reviewStaffingProposal` + the enriched list; staffing.tsx gains a "Submitted proposals — human review" section (loading / error-with-retry / honest empty / populated; per-proposal Approve/Decline with an optional note shown to the submitter; status + reviewer + timestamp + note on every card).

**Checks:** lint 0 errors, app tsc + functions tsc green, 45 bundles / 29 shared modules no drift, `pnpm test` **414 tests / 41 files** (+7), `pnpm build` green. Live `verify-batch-10.mjs` **18/18**: plan→propose→approve→durable decision→idempotent re-review 409→404→manager 403→owned task for the subject→decline dispatches nothing→hr_partner reviews→HR list all org (names resolved)→manager list team-scoped→pristine reset. All prior suites re-run green (batch-1..8 = 106 checks). Browser verification not performed (auth-gated). Demo left pristine.

**Honest boundary:** the evidence→proposal *staleness cascade* (proposal-to-candidate linkage) stays deferred in the coverage matrix; this batch adds the decision loop and version-bound follow-up task, not that cascade.

**Remaining:** none implementable. Concrete blockers: none.

## 50. Browser persona verification (completes the last unverified item)

The previously "untested" item — authenticated persona screens at 768/1440 — is now verified in a real browser. No code change was needed to enable it: the login page already exposes a deep-linkable persona (`/login?as=<role>&to=<path>`), so the preview's real JWT + RLS session could be captured directly.

**Screens captured (real authenticated sessions):**
- **1440:** Administrator (Dana) · HR skill graph (Riley) · People Manager (Jordan) · IT Provisioning (Elena) · Recruiter (Chris, /recruitment) · Employee (Alex).
- **768:** the same six, plus the public landing/login/candidate portal at 1280 and the landing at 390.
- **1280:** public landing, login, candidate-status portal.

**Result — every sidebar matched the exact per-role navigation contract** (`navigation.test.ts`): Administrator 11 items incl. Administration; HR partner 7 (no recruitment/admin); Manager 7 (no recruitment/admin); Recruiter 4 (no workforce review/staffing/admin); Employee 5 (self scope); IT 2 (`/app`, `/onboarding`). Role badges read Administrator / HR Business Partner / People Manager / Technical Recruiter / Employee / IT Provisioning. Home content was role-appropriate everywhere (admin attention queue, HR org scope, manager team scope + "waiting on others", recruiter requisition workspace, employee onboarding 1/12 + "Waiting on others", IT provisioning workspace with 5 canonical tasks). **The reviewer's original defect — HR reaching Skill graph and getting an authorization-denial screen — is fixed and confirmed in-browser at both 1440 and 768** (graph renders real skill data, no denial).

**Defect found and fixed (real, from the 768 capture):** in the IT provisioning panel and the onboarding provisioning queue, the search input shared the filter row with `min-w-0 flex-1` and was squeezed at tablet width, clipping its placeholder to "Se". Both rows are now `flex-col` on mobile and `sm:flex-row sm:flex-wrap`, with the search input `shrink-0 sm:w-56` — so pills never wrap and the search placeholder is always readable. Verified in-browser at 768 (all five pills on one line, search below, placeholder fully readable) and unchanged at 1440 (page height identical at 1842px before/after). Files: `src/pages/role-home.tsx`, `src/pages/onboarding.tsx`.

**Also confirmed:** the earlier `useAuth must be used within <AuthProvider>` + blank-preview console errors were **transient mid-edit HMR** during Batch 10 (already fixed); the current build renders clean at every captured width with no runtime errors. Live suites re-run this turn: batch-1..8 + 10 = **124 checks green**; demo pristine (9 sessions, 0 proposals). Gate: lint 0 errors, all tsc green, 45 bundles, **414 tests / 41 files**, build green.

**Remaining:** none. Concrete blockers: none.

## 51. Judge-facing brief map + resume + skill-graph upgrades

Three workstreams requested for the final presentation.

**1) Judge-facing showcase (`/showcase`, new public page).** The brief → the build, mapped point-wise with a checkmark status per requested capability: AI Recruitment Intelligence Engine, Adaptive Onboarding Agent, HR Policy Reasoning Agent, Workforce Skill Graph, Intelligent Interview Agent, HR Decision Dashboard (all "Implemented ✓"), plus Employee Attrition Prediction ("Decision support, honestly labeled") and AI Performance Intelligence ("Human-confirmed drafts"). Each card lists where it lives (screen + route), what it does, and the real data behind it; a dark "one connected cross-source journey" banner shows the Demand → evidence → options → human review → owned execution → accepted evidence → updated readiness loop; a 7-persona scope grid (incl. Candidate portal) and an honesty section round it out. Linked from the landing hero ("How this maps to the brief") and routed publicly. Browser-verified at 1440 (all 8 sections, journey banner, 7 persona cards, honesty + CTA) — no overflow.

**2) Candidate resumes — fixed and enriched.** (a) Every candidate with an application now has a realistic, multi-section resume document (16 candidates, ~500–1100 chars each: summary, experience with dates, projects, education, skills) seeded idempotently in reset-demo (prior demo docs per twin are replaced, so exactly one canonical document per candidate); Juno Park remains the honest low-text/partial-data case. Fixed a fixture name bug (Priya "Rana" → Priya "Nair"). (b) The resume tab now shows an inline "View resume text" preview (from the stored extracted text) so viewing never depends on a Word-file download; the Download action is unchanged. (c) Fixed the reported bug: the resume upload/import/extract UI is now recruiter-only — Administrator and HR see the document + download + revision history with a "view-only" note and no upload control. Root-cause find: `resume_documents.status` CHECK constraint only allows uploaded/extracted/low_text/reviewed/failed — the seeder now writes `extracted` (was silently `continue`-ing on an invalid `imported` value). Deployed reset-demo; verified 16 seeded resume rows in the live DB.

**3) Skill graph.** (a) Selecting a person (and demand) now computes the graph automatically — no scroll-up-and-press-Compute; re-selecting recomputes, already-computed selections are not re-run. (b) New "Person skill network" section after results: an SVG network of the person's mapped skills around the role, with real taxonomy edges drawn (Related/Transferable/Prerequisite + legend), nodes colored by match classification, a 5-metric summary strip (match score, verified skills, claims, gaps, artifacts) and a 3-column analysis (verified strengths, close/transferable paths, gaps to close) plus a computed future-outlook line. Future scores remain genuinely computed from each role's future requirement set — the section labels this explicitly.

**Checks:** lint 0 errors, all tsc green, 45 bundles no drift, `pnpm test` 414/41, `pnpm build` green. Live regression re-run: batch-1..5,7,8,10 all green (12+17+12+12+15+13+8+18 = 107); **batch-6 = 13/14** with the single failing check blocked by an external Qwen gateway outage (`health: gateway "unreachable", model_ready false` — all deterministic handoff checks 6.2/6.3/6.4/6.7 pass). Browser: showcase verified; skill-graph + landing/login/candidate pages verified clean at 1440. Demo left pristine after the final reset.

**Concrete external blocker (only one):** the local Qwen gateway is unreachable, so the live AI-assisted assessment-evaluation leg cannot be exercised (batch-6 model check). Everything deterministic is proven green; the model leg returns to full verification when the gateway recovers.

## 52. Role-unique interfaces: HR vs manager home + scope callouts + nav clarity

The reviewer asked for every role's interface to be unique and working, explicit "how this page differs" hints for judges, and clearer navigation. Delivered in one pass.

**1) Distinct home compositions (role-home.tsx).** `hr_executive`, `hr_partner` and `manager` previously shared the exact same home skeleton (feed → attention strip → dashboard). Now each HR-family role gets a genuinely different first screen:
- **People Manager**: a new **"My team" roster** derived from the same server-scoped onboarding queue that drives the attention strip — team members with department, start date, a readiness progress bar and a status chip (On track / Awaiting approval / Needs attention), always scoped to the recursive reporting subtree.
- **HR Business Partner / Administrator**: a new **"Organization lifecycle"** panel — org-wide stage cards (Onboarding journeys, Review cases in scope, Approvals awaiting decision, and admin-only Data quality alerts) each linking to its module, plus a "Journeys needing an HR decision" list.
- **Administrator** keeps the Platform Operations & Security Governance panel beneath everything.

**2) "How this page differs by role" callouts (new reusable `RoleScopeCallout`).** A light-blue banner rendered on the home, onboarding center, workforce review, recommendation hub and staffing planner. Each instance states the role's title, its real server-enforced scope, and a "Similar page:" contrast line (e.g. "Managers land on the same page, but every panel is filtered to their team only"). Staffing's inline scope line was upgraded to the shared callout; the existing skill-graph scope line was already in place.

**3) Navigation clarity.** Every role badge in the sidebar/drawer now carries a one-line scope descriptor (Administrator "Org-wide view + governance", HR "Org-wide view", Manager "Your team only", Recruiter "Hiring pipeline", Employee "Self-service", IT "Provisioning handoffs") — mirroring server-enforced scope. `navigation.ts` routes and `navigation.test.ts` exact lists untouched.

**4) UX fix found during verification.** The org-wide "waiting on others" feed buried the HR home (page 11,569px tall). The waiting group is informational, so `MyWorkFeed` now caps it at 8 items with an honest "+N more waiting" note; attention and ready items are always shown in full. HR home dropped to ~6,300px with the lifecycle panel immediately reachable.

**Checks:** lint 0 errors, app tsc green, 414 tests / 41 files, `pnpm build` green. Browser-verified at 1440 (manager roster + team attention, HR lifecycle + journeys needing HR decision, admin 4th card + governance panel, recruiter, hub, staffing, onboarding queue team-scoped for manager; sidebar descriptors on every role) and 390 (manager home + callout fit cleanly, no overflow). Demo left pristine.

**Remaining:** none. Concrete blockers: the pre-existing external Qwen gateway outage still blocks only the live model leg (batch-6, 13/14).

## 53. Full-app audit + skill-graph future trajectory (real computation)

Reviewed the whole product against the Track-1 HR problem statement (8 systems) and the "dummy data, not dummy output" bar. Findings and fixes:

**Audit — no dummy output anywhere.** Grepped every page/component for `Math.random` (only legit uses: invite-token generation, sidebar shimmer width), inline fake-data arrays (none), and placeholder/lorem text (none). Every feature surface is query-driven and server-computed: recruitment (7 requisitions with real applicant counts, match scores from skill-match), policy studio (LLM-grounded answers with verbatim citations + honest abstention), recommendation hub (server lifecycle + idempotent actions), onboarding center (adaptive DAG plans + role-scoped queue), workforce review (computed review index), staffing planner (constraint engine with feasible/conditional/infeasible statuses), executive dashboard (aggregates over live records), system health (live telemetry: app backend ok, latency 128ms, gateway currently unreachable — the pre-existing external outage), data quality (computed rigor distribution + orphan scan), candidate portal (real application-code lookup, WS-PRIYA-2026). Seed data is realistic (51 active employees, 7 requisitions, named personas + 16 multi-section resumes) — no lorem/Jane-Doe.

**Skill graph — "why would the future score decrease?"** Root cause: the raw future score answers "today's profile vs tomorrow's (harder) requirement set", so a harder future target legitimately scores lower. The page explained this but the user experience read as broken. Fix — a **development trajectory** that models people actually learning:
- New pure helper `projectedFutureReadiness()` in `src/lib/skill-graph-metrics.ts` (+4 unit tests, 418 total). It assumes every future requirement with a REAL foundation (a partial direct claim, an adjacent graph edge, or transferable experience) is trained to the target bar, then recomputes the SAME weighted composite (50/25/15/10). Pure gaps stay open. Because each foundation-backed skill contributes at least what it did, **projected >= raw future always** — computed, never fabricated.
- The graph page now shows a 3-step trajectory card: **Today → Future target (today's profile) → Projected with planned development**, with a position bar, the closable-skills chips, and an honest read-out explaining any dip.
- Live-verified against the backend on real rows (verify-53.mjs): e.g. **Alex Chen vs Data Analyst — today 27% → future 19% (harder target) → projected 94%**; all 12 sampled matches satisfy projected ≥ future; demo reset pristine.

**UI bugs found and fixed this pass.** (1) Skill-graph toolbar: the Recompute button clipped the card edge at 1280 — the action row now wraps with min-widths, buttons fully visible. (2) Re-verified §52 role homes, onboarding, workforce, hub, staffing, recruitment, policy studio, candidate portal, status page — no other clipping/overflow; the sidebar "missing" in later screenshot chunks is just the sticky sidebar (correct behaviour).

**Checks:** lint 0 errors, app tsc green, 418 tests / 41 files, `pnpm build` green. Live: verify-53.mjs green; existing suites unaffected (no function changes this turn — the projection lives in the frontend pure module). Browser: graph toolbar fix + all audited pages verified at 1440; trajectory verified at the data level (real backend fits) and via unit tests — the interactive select-then-compute flow itself is unchanged.

**Remaining:** none. Concrete blockers: pre-existing external Qwen gateway outage still blocks only the live model leg (batch-6, 13/14).

## 54. Codebase restructure + README + final audit confirmation

Reviewer's closing pass: "check final properly, structure the codebase properly, update README properly."

**1) Restructure — `role-home.tsx` slimmed 1,098 → 407 lines.** Seven self-contained panels
that were inlined in the page were extracted into `src/components/home/` (each with its own
imports, verified by tsc + eslint): `stat-block`, `my-action-tasks`, `admin-governance-panel`,
`journey-attention-strip`, `it-provisioning-panel`, `manager-team-panel`, `hr-lifecycle-panel`.
`role-home.tsx` now keeps only the page composition (queries + per-role render). Behaviour is
pixel-identical — browser-verified manager and HR homes render exactly as before (HR page
height 6348px unchanged; manager differs only by post-reset demo data). No function/test files
touched; 418 tests still pass.

**2) README.md rewritten** from the generic Enter template to a proper WorkSense document:
the eight PS systems mapped to routes with how each computes (not hard-codes) its output, the
persona table with server-enforced scopes, architecture + directory map, local dev + quality
gate (`pnpm check` / `pnpm build`) + live verification scripts, and honest notes (AI gateway
dependency, attrition/future-score semantics, fictional data + reset).

**3) Final audit confirmation** (re-checked this turn): no dummy output anywhere (all feature
pages query-driven), no UI breakage found beyond the already-fixed skill-graph toolbar button,
realistic seeded data throughout, and the skill-graph development trajectory verified again on
live rows (verify-53.mjs 4/4, projected ≥ future for all 12 matches, demo reset pristine).

**Checks:** lint 0 errors, all tsc green, **418 tests / 41 files**, `pnpm build` green.
Browser: manager + HR homes verified after the refactor. Demo left pristine.

**Remaining:** none. Concrete blockers: pre-existing external Qwen gateway outage (affects only
the live model-written leg, batch-6 13/14); all deterministic functionality proven green.
