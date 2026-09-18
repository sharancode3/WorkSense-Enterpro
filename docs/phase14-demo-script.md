# Phase 14 — WorkSense Demo Script (~6 minutes)

**Mode**: live Enter Cloud deployment · AI gateway `qwen3:4b` (local) · all data fictional.
**Before starting**: sign in once to warm the model, open `/health` (footer chip must read "AI gateway: ready"). Reset Demo Data from the account menu if the previous run mutated anything.
**Fallback rule**: if Qwen is slow/flaky, show the pre-generated files in `public/demo-artifacts/` and say exactly: **"Previously generated demo artifact — not live inference."** Never imply otherwise.

| # | Beat | What you show | Live timing (observed) | Fallback |
|---|---|---|---|---|
| 1 | Business problem | Dana (Administrator) opens the dashboard. "A backend project needs a ready team in six weeks — and we're measuring everything from live records." | dashboard ~120 ms | — |
| 2 | Actual demand | Open **Staffing planner** (Workforce → Staffing planner). "One open Senior Backend Engineer role, 42-day deadline, these required bars. Not a guess — a requisition." | staffing ~100 ms | `staffing-comparison.json` |
| 3 | Resume upload → evidence | Upload `public/demo-fixtures/fixture-a-priya-nair.pdf` (recruitment → Resume). Show: source text, the clickable evidence quote, and **claim vs verified** (extracted = low rigor claims; verified = high/medium evidence). Try live extraction; if the model refuses malformed output, show that refusal as the validation layer working, then open `extraction-fixture-a.json`. | extraction 10–120 s (flaky) | `extraction-fixture-a.json` (labeled) |
| 4 | Work sample | Priya's submitted **Payments service design** work sample: submit (instant), then **evaluate** (~15 s). Inspect rubric evidence quotes; the human reviewer confirms/overrides in the Assessment panel. Unanswered questions show `NOT_ASSESSED` — no silent scores. | submit 44 ms · evaluate 14 s | `work-sample-evaluation.json` (labeled) |
| 5 | Evidence changes fit | Run **Fit card** (deterministic Skill Intelligence Graph): Priya 0.655 vs keyword-heavy Dev 0.248. "Same keywords, different evidence — the engine never treats keywords as capability." | fit ~110 ms | — |
| 6 | Hire / Move / Upskill / Hybrid | Same Staffing planner: 66% hire (56 d — **risks the window**), 54% move (21 d), 98% upskill projection (claims until verified), 99% hybrid. Read the constraint lines. | (already loaded) | `staffing-comparison.json` |
| 7 | Policy | Ask: "How many paid sick days?" → grounded answer with `POL-SICK#s1` quotation. Then ask the mobility-on-PIP question → **abstains honestly** (no invented policy). | policy ~4–15 s | `policy-grounded.json` / `policy-abstain.json` |
| 8 | Recommendation review | Open **Recommendation hub**: show evidence, alternatives, approval requirements, and the exact downstream tasks that dispatch creates. Approve with a typed rationale (idempotent, optimistic-lock, audited). | scan 40–120 s · approve <1 s | seeded feed (deterministic) |
| 9 | Adaptive onboarding | Alex's journey: show the dependency block, have IT/manager resolve it with evidence, and the next task unlocks. "Authorized resolution, not a shortcut." | <5 s per action | — |
| 10 | Readiness/outcome | Return to the dashboard: journeys/readiness and recommendation outcomes moved. Close: "Every number is live, every action is approved by a human, everything is audited." | dashboard ~120 ms | — |

## What to explain (30-second thread)
- **Qwen** handles *constrained language tasks*: extraction, rubrics, policy answers, narrative. It never decides.
- **Deterministic engines** do math, constraints, scheduling, workflow transitions, staffing coverage.
- **Evidence** has provenance (quote + source) and verification states (claimed/extracted → assessment/review → verified).
- **Decisions** combine multiple HR data sources (skills, performance, attendance, policy, demand).
- **Humans control consequential actions** — every transition needs a typed rationale; RPCs are revoked from clients.
- **Outcomes feed back** into readiness and review (dashboard + hub).

## What NOT to claim
- Guaranteed hiring quality · real-world attrition accuracy from synthetic data · causal retention improvement · complete legal/regulatory compliance · enterprise production readiness without evidence · "fully verified skills" from resume keywords.
- Never present pre-generated artifacts as live inference (always the label above).

## Observed limitations (recorded this session)
- Resume extraction is the least reliable layer on the 4B model (schema-validation refusals are surfaced, never silent; retry usually helps; artifact fallback exists).
- Interview evaluation (5-competency kit) exceeds the model's 8K context budget → `INPUT_TOO_LARGE`; the demo uses the **work-sample assessment** path instead, which fits.
- AI generations take ~5–30 s each on the local model — keep the model warm and avoid >2 live AI calls in a 6-minute pass.
