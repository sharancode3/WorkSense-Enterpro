# WorkSense — Golden Demo Script (3 Acts)

**One-liner (open with this, close with this):**
> "WorkSense turns fragmented HR data into evidence-backed workforce decisions and moves those decisions through human-approved workflows — deterministic where it can be, AI only where it must be."

**Demo accounts (one-click on the Sign-In page under "Demo Environment Quick Access"):**

| Role | Badge | Persona |
|---|---|---|
| Administrator | ADMIN | Dana Whitmore |
| HR Business Partner | HR | Riley Morgan |
| People Manager | MANAGER | Jordan Reyes |
| Technical Recruiter | RECRUITER | Chris Okafor |
| Employee | EMPLOYEE | Alex Chen |
| Candidate | CANDIDATE | Priya Nair (status view, no login) |

**Reset button:** account menu (top-right) → **Reset Demo Data** (Admin only). Use it before Act I if anything has been touched.

---

## ACT I — Recruitment → Onboarding (≈3 min)

**Persona: Technical Recruiter (Chris)**

1. Click **Enter as Technical Recruiter**.
2. Nav → **Recruitment**. Open the **Senior Backend Engineer** requisition (3 applicants).
3. Priya Nair is in *Decision Pending*. Click **Fit card** → the **Skill Intelligence Graph** fit appears: score, and the **Direct / Adjacent / Transferable / Gap** breakdown, each item with its edge (e.g. *REST APIs ← Go · ADJACENT_TO*). Say: *"Every number here is computed deterministically — the model never scores."*
4. Click **Resume** on Priya → paste any resume text (it's treated as untrusted input — instruction-like phrases are neutralized before any model call) → **Extract skills** → structured skills appear with the deterministic match score. *(Only AI moment #1.)*
5. Click **Interview kit** → the kit appears, with candidate-specific probes **biased to Priya's gaps from her Fit card** (*"the Skill Graph output is reused as interview-question input"*). *(AI moments #2 — rubric generation, cached per role.)*
6. Click **Evaluate** → paste interview notes → get a structured 5-tier evaluation + recommendation.
7. Click **Select — convert to employee** → toast confirms the **atomic conversion**. Say: *"Same DigitalTwin, flipped from candidate to employee — skills, rubric, fits, and audit trail preserved, in one transaction."*
8. (Optional follow-through) As **People Manager** → **Onboarding** → Alex's journey shows the **wave-by-wave DAG**: some tasks **auto-waived** (verified skills prove them), Security/Payroll **never waivable**, dates flowing on the dependency timeline. Say: *"Kahn's topological scheduler built this — a cycle is impossible, it errors before it ever reaches the UI."*

## ACT II — Grounded Policy Q&A (≈90 sec)

**Persona: Employee (Alex)**

1. Click **Enter as Employee** → **Policy Studio**.
2. Ask a **covered** question: *"How many days of annual leave do I get and how much can I carry over?"* → **green "Grounded answer"** with `POL-LVE` citations (section + verbatim quote).
3. Ask an **uncovered** question: *"What is the policy on sabbaticals and pet insurance?"* → **red "Insufficient evidence — abstained before any model call"** (best retrieval score 0.0).
4. Say the line: **"It doesn't hallucinate, it escalates."**
5. Click **Escalate to HR** → a `policy` recommendation is created for HR follow-up (the employee can see it in their own view).

## ACT III — The Core Reasoning Moment (≈3 min)

**Persona: People Manager (Jordan)** — same dashboard shape, team-scoped (server-side).

1. Land on the **Executive Decision Dashboard**.
2. Point at **Samira Patel**: strong performance (**Exceeds Expectations, 4 straight cycles**) **alongside** a **Workforce Review Signal: 72/100**.
3. Say exactly: *"Multiple workforce indicators warrant HR review — not a prediction that she's leaving. That framing is enforced everywhere."*
4. Nav → **Recommendation Hub** → open Samira's retention recommendation. Walk **top to bottom**:
   - **Evidence cards**: `WORKFORCE_REVIEW_SIGNAL 72/100` · `ENGAGEMENT_SURVEY declining` · `ATTENDANCE above own baseline` · `PERFORMANCE strong` — *each a concrete fact, no prose.*
   - **Reasoning**: the synthesized executive summary — *"the model writes the language; it didn't choose the facts or the urgency."* *(AI moment #5.)*
   - **Recommended Action**: "Manager review for retention intervention" with numbered steps.
5. Click **Approve** → type a rationale (required) → confirm. State moves to **Approved**.
6. Click **Dispatch action** → type rationale → state moves to **Dispatched** with the effect: *"retention intervention flagged on Samira Patel's DigitalTwin."*
7. Show the proof: expand the recommendation's **Audit trail** (`approved · before: needs_review → after: approved`, `dispatched`) — and open the employee's record: the new `retention_intervention` signal + the mirrored `retention_intervention_dispatched` audit entry on the DigitalTwin.
8. (Optional) Back on the dashboard, **Run intelligence scan** → *"no new recommendations — all candidates already tracked"*; or block a task in Onboarding, rescan → a new **Onboarding Replan** recommendation appears.

## Close

> "**WorkSense turns fragmented HR data into evidence-backed workforce decisions and moves those decisions through human-approved workflows — deterministic where it can be, AI only where it must be.**"
>
> Footer line to read out: *"Skill matching, onboarding scheduling, and risk scoring are deterministic — AI is used only to extract, explain, and generate language, never to decide."*

---

## Where the AI actually shows up (and nowhere else)

| Moment | Phase |
|---|---|
| Resume extraction (Recruitment) | 2 |
| Interview rubric / kit generation (Recruitment) | 2 |
| Grounded policy answer synthesis (Policy Studio) | 4 |
| Performance narrative, on demand (service) | 5 |
| Recommendation rationale write-up (Hub scan) | 6 |

Everything else — matching, scheduling, waivers, signals, dashboard numbers, state machines — is deterministic and instant.
