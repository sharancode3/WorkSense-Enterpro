// ---------------------------------------------------------------------------
// WorkSense assessment domain — authoritative, deterministic blueprints and
// scoring rubrics (no LLM involved in authoring; anchors are server-owned).
// Phase 5: three genuinely different formats (work_sample / interview /
// knowledge_assessment), explicit question→criterion mapping, dimension scores
// (correctness / reasoning / trade_offs / communication), partial-credit
// anchored proficiency, and server-computed reviewer-confirmation routing.
//
// Shared by: reset-demo (seeding), assessment-blueprint (list/create/seed),
// assessment-evaluate (judgment prompt + validation), assessment-session
// (candidate view) and assessment-review (human confirm/override + provenance).
// ---------------------------------------------------------------------------

export type SessionType = "work_sample" | "interview" | "knowledge_assessment";

export const SESSION_TYPES: readonly SessionType[] = [
  "work_sample",
  "interview",
  "knowledge_assessment",
] as const;

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  work_sample: "Work sample",
  interview: "Structured interview",
  knowledge_assessment: "Knowledge assessment",
};

export interface BlueprintQuestion {
  key: string;
  prompt: string;
  hint?: string;
  max_chars: number;
  /** Rubric competency names this question provides evidence for (Q→criteria). */
  criteria: string[];
  /** Core questions are identical for every candidate — the comparative core.
   *  Only the reviewer-triggered follow-up round adapts per candidate. */
  is_core?: boolean;
  /** Recruiter-authored reference answer (knowledge assessments). Never shown
   *  to candidates — stripped from the candidate session view server-side. */
  answer_key?: string;
}

export interface BlueprintSeed {
  id: string;
  requisition_id: string;
  competency: string;
  version: number;
  title: string;
  kind: SessionType;
  instructions: string;
  time_policy: string;
  questions: BlueprintQuestion[];
  test_cases: { name: string; expected: string }[];
  prompt_adaptation_allowed: boolean;
  rubrics: RubricSeed[];
}

export interface RubricSeed {
  id: string;
  competency: string;
  version: number;
  observable_behavior: string;
  evidence_requirements: string[];
  anchors: Record<string, string>;
  critical_mistakes: string[];
  insufficient_evidence_conditions: string[];
  skill_mapping: { skill: string; anchor_to_proficiency: Record<string, number> };
}

/** Extra demo requisition (People Operations Partner) that hosts the People Ops
 *  blueprint — the demo org has no open HR requisition in the fixtures. */
export const PEOPLE_OPS_REQUISITION = {
  id: "33333333-3333-3333-3333-333333333303",
  title: "People Operations Partner",
  department: "People Operations",
  status: "on_hold",
  seniority_level: 3,
  required_skills: [
    { skill: "Policy Management", target_proficiency: 3 },
    { skill: "Stakeholder Management", target_proficiency: 3 },
  ],
  future_skills: [{ skill: "People Analytics", target_proficiency: 2 }],
  applicants: [],
  audit_events: [
    { actor: "dana@worksense.demo", action: "created", note: "Requisition opened (assessment demo).", timestamp: "2026-09-01T09:00:00Z" },
  ],
};

// ---------------------------------------------------------------------------
// Dimension scoring (item 5 of the Phase 5 spec: correctness / reasoning /
// trade-offs / communication are judged separately; verbosity ≠ competence).
// ---------------------------------------------------------------------------

export const DIMENSION_NAMES = ["correctness", "reasoning", "trade_offs", "communication"] as const;
export type DimensionName = (typeof DIMENSION_NAMES)[number];

export const DIMENSION_SCORES = ["1", "2", "3", "4", "5", "NA"] as const;
export type DimensionScore = (typeof DIMENSION_SCORES)[number];

export type Dimensions = Partial<Record<DimensionName, DimensionScore>>;

export function isDimensionScore(v: unknown): v is DimensionScore {
  return typeof v === "string" && (DIMENSION_SCORES as readonly string[]).includes(v);
}

/** Normalize a model dimension score ("NA" or a numeric string 1..5). */
export function normalizeDimension(v: unknown): DimensionScore {
  if (isDimensionScore(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return String(Math.round(n)) as DimensionScore;
  return "NA";
}

// ---------------------------------------------------------------------------
// Reviewer-confirmation routing (item 8). An evaluation "needs human
// confirmation" when the model is uncertain (high uncertainty) or when its own
// dimension scores contradict the synthesized anchor (correctness 5 but
// reasoning 1, etc.). Contradictory/uncertain judgments must not become
// verified evidence without a human reviewer confirming them.
// ---------------------------------------------------------------------------

export const UNCERTAINTY_REVIEW_THRESHOLD = 0.55;
export const DIMENSION_CONTRADICTION_GAP = 3;

export function computeReviewRequired(
  uncertainty: number | undefined,
  dimensions?: Dimensions | null
): boolean {
  const unc = Number.isFinite(uncertainty) ? (uncertainty as number) : 0;
  if (unc >= UNCERTAINTY_REVIEW_THRESHOLD) return true;
  const numeric: number[] = [];
  for (const name of DIMENSION_NAMES) {
    const v = dimensions?.[name];
    if (v && v !== "NA") numeric.push(Number(v));
  }
  if (numeric.length < 2) return false;
  const spread = Math.max(...numeric) - Math.min(...numeric);
  return spread >= DIMENSION_CONTRADICTION_GAP;
}

// ---------------------------------------------------------------------------
// Blueprints. The three formats for the Senior Backend Engineer requisition
// are intentionally NOT interchangeable: the work sample asks for a payments
// service DESIGN, the interview is a production-INCIDENT conversation, and the
// knowledge assessment checks objective facts (HTTP semantics, isolation
// levels, TCP states, monitoring signals). No question text is reused between
// formats (asserted in assessment.test.ts).
// ---------------------------------------------------------------------------

const BACKEND_REQ = "33333333-3333-3333-3333-333333333301"; // Senior Backend Engineer
const ANALYST_REQ = "33333333-3333-3333-3333-333333333302"; // Data Analyst
const PEOPLE_OPS_REQ = PEOPLE_OPS_REQUISITION.id;

export const ASSESSMENT_SEEDS: BlueprintSeed[] = [
  // -------------------------------------------------------------------------
  // 601 — work_sample · "Payments service design & implementation notes"
  // Genuinely different from 604/605: this is a written DESIGN artifact for a
  // payments service. No code is executed (no execution sandbox exists), and
  // candidates are told so up front.
  // -------------------------------------------------------------------------
  {
    id: "66666666-6666-6666-6666-666666666601",
    requisition_id: BACKEND_REQ,
    competency: "Backend Engineering",
    version: 1,
    title: "Payments service design & implementation notes",
    kind: "work_sample",
    instructions:
      "You are handed a small, realistic backend task for a payments service. You are NOT required to execute code in this environment — code-execution sandboxes are not available, so no tests will be run against your submission. Write clear, specific answers to each question. Show your reasoning; where you would write code, include it as a short snippet in your answer.",
    time_policy: "Plan for up to 45 minutes. Your answers are saved automatically as you type.",
    questions: [
      {
        key: "q1",
        prompt:
          "A payment webhook may deliver the same event more than once. Explain how you would make processing idempotent: what you would store, what concurrency risks exist, and how you would handle duplicates arriving in parallel.",
        hint: "Mention idempotency keys, unique constraints, and the failure window between INSERT and COMMIT.",
        max_chars: 4000,
        criteria: ["Event-driven design"],
        is_core: true,
      },
      {
        key: "q2",
        prompt:
          "A customer-facing query against the orders table is slow. Describe how you would diagnose it and the indexing, query, or schema changes you would propose — and how you would verify the fix.",
        hint: "Think EXPLAIN ANALYZE, index choice, and avoiding misleading micro-benchmarks.",
        max_chars: 4000,
        criteria: ["Database performance"],
        is_core: true,
      },
      {
        key: "q3",
        prompt:
          "Describe how you would make a third-party API call resilient to transient failures without distorting latency or correctness. Cover retry policy, timeouts, and what happens when the upstream is degraded for minutes, not seconds.",
        hint: "Consider bounded retries with backoff, circuit breaking, and fallback behavior.",
        max_chars: 4000,
        criteria: ["API resilience"],
        is_core: true,
      },
    ],
    test_cases: [
      { name: "idempotency design", expected: "Names an idempotency key, a unique constraint or equivalent, and the duplicate-in-flight race." },
      { name: "database diagnosis", expected: "Proposes EXPLAIN ANALYZE, a concrete index or query change, and a verification step." },
      { name: "resilience design", expected: "Bounded retries with backoff, timeout strategy, and degraded-upstream behavior (e.g., circuit breaker, queue)." },
    ],
    prompt_adaptation_allowed: true,
    rubrics: [
      {
        id: "66666666-6666-6666-6666-666666666661",
        competency: "Event-driven design",
        version: 1,
        observable_behavior:
          "Demonstrates how duplicate events are made safe to process (idempotency), where state is stored, and what happens under concurrent delivery.",
        evidence_requirements: [
          "Names a concrete idempotency mechanism (idempotency key, unique constraint, dedup table).",
          "Identifies at least one concurrency or failure window and how it is handled.",
          "States what is persisted and when the write is considered durable.",
        ],
        anchors: {
          "1": "No idempotency mechanism; duplicates would double-process or corrupt state; no concurrency awareness.",
          "2": "Mentions dedup in passing but no concrete mechanism or failure-window handling.",
          "3": "Names an idempotency key or unique constraint and covers the basic duplicate-in-flight race.",
          "4": "Covers idempotency key + unique constraint, the INSERT/COMMIT failure window, and retry semantics.",
          "5": "Full design: idempotency key, atomic upsert, crash/rollback recovery, and how parallel duplicates serialize.",
        },
        critical_mistakes: [
          "Claiming duplicates 'never happen' so no handling is needed.",
          "Proposing to detect duplicates only in application memory.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer discusses a different topic (e.g., frontend work) with no idempotency content.",
        ],
        skill_mapping: { skill: "Event-driven architecture", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666662",
        competency: "Database performance",
        version: 1,
        observable_behavior:
          "Diagnoses a slow query concretely, proposes a testable fix, and verifies with evidence rather than guessing.",
        evidence_requirements: [
          "Uses EXPLAIN ANALYZE or an equivalent concrete diagnostic.",
          "Proposes a specific index, query rewrite, or schema change.",
          "Describes how the fix would be verified against real or representative data.",
        ],
        anchors: {
          "1": "Guesses without a diagnostic; no concrete fix or verification.",
          "2": "Mentions 'add an index' generically with no query or verification.",
          "3": "Names EXPLAIN ANALYZE, proposes a plausible index, and sketches verification.",
          "4": "Diagnoses via plan analysis, proposes the right index/query shape for the access pattern, and verifies.",
          "5": "Plan-driven diagnosis, indexes/queries matched to workload, considers cardinality and regression testing.",
        },
        critical_mistakes: [
          "Proposing to 'just cache everything' without diagnosing the query.",
          "Claiming a fix works without any verification step.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer covers an unrelated topic with no database content.",
        ],
        skill_mapping: { skill: "PostgreSQL", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666663",
        competency: "API resilience",
        version: 1,
        observable_behavior:
          "Designs bounded retry/timeout behavior and a sane degraded-mode response for an upstream that fails or slows.",
        evidence_requirements: [
          "Bounded retries with backoff (not unbounded).",
          "A timeout strategy that protects the caller's latency budget.",
          "A defined degraded behavior when the upstream stays down.",
        ],
        anchors: {
          "1": "No retry/timeout design; would block on the upstream indefinitely.",
          "2": "Retries generically with no bounds or degraded behavior.",
          "3": "Bounded retries with backoff and a timeout; basic fallback.",
          "4": "Bounded retries, explicit latency budget, circuit breaker or queue, and degraded responses.",
          "5": "Comprehensive: retry policy, timeouts, circuit breaking, fallback, and monitoring of the failure path.",
        },
        critical_mistakes: [
          "Unbounded retries that amplify load on a degraded upstream.",
          "Ignoring the timeout entirely.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer covers unrelated networking topics with no resilience content.",
        ],
        skill_mapping: { skill: "REST APIs", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 604 — interview · "Production incident interview"
  // A structured (stable-core) conversation about incident response, pressure
  // communication, and blameless learning. Distinct scenario from 601: no
  // design work; the evaluator scores judgment, communication, ownership.
  // -------------------------------------------------------------------------
  {
    id: "66666666-6666-6666-6666-666666666604",
    requisition_id: BACKEND_REQ,
    competency: "Backend Engineering",
    version: 1,
    title: "Production incident interview",
    kind: "interview",
    instructions:
      "This is a structured interview session, not a work sample. Answer the scenario questions conversationally but specifically: state what you would do first, what you would say to whom, and how you would follow through. There is no single script — grounded, concrete answers score highest.",
    time_policy: "Plan for up to 40 minutes. Your answers are saved automatically as you type.",
    questions: [
      {
        key: "q1",
        prompt:
          "It is 2am and your pager fires: the payments service is failing for a subset of customers. Errors are rising but still below the threshold your monitoring expected. Walk through your first 30 minutes — what you check first, who you tell and what you tell them, and how you decide between rolling back and fixing forward.",
        max_chars: 4000,
        criteria: ["Incident response judgment", "Communication under pressure"],
        is_core: true,
      },
      {
        key: "q2",
        prompt:
          "The root cause turns out to be a change your teammate shipped. You lead the postmortem. How do you structure it so the team actually learns without creating a blame culture — and what makes you confident a written action item will not be the thing that is skipped?",
        max_chars: 4000,
        criteria: ["Collaboration & ownership"],
        is_core: true,
      },
      {
        key: "q3",
        prompt:
          "Tell me about a real production incident you resolved end-to-end. What was the hardest decision you made in the middle of it, and what concrete change did you make afterward so it could not recur?",
        max_chars: 4000,
        criteria: ["Incident response judgment"],
        is_core: true,
      },
    ],
    test_cases: [
      { name: "incident response", expected: "Concrete first checks, escalation to the right audience, and a rollback vs fix-forward decision with verification." },
      { name: "blameless learning", expected: "A postmortem structure that separates cause from blame and names how action items get enforced." },
      { name: "reflection", expected: "A real incident with a named hard decision and a durable prevention change." },
    ],
    prompt_adaptation_allowed: true,
    rubrics: [
      {
        id: "66666666-6666-6666-6666-666666666684",
        competency: "Incident response judgment",
        version: 1,
        observable_behavior:
          "Responds to an in-progress incident with structured triage, correct escalation, and a rollback-vs-fix-forward decision that is verified, not hoped.",
        evidence_requirements: [
          "Names concrete first checks (error rate by customer segment, deploy/release window, upstream dependency).",
          "States who is told and at what cadence.",
          "Justifies rollback vs fix-forward and how the choice is verified.",
        ],
        anchors: {
          "1": "Would panic-respond without structure; no escalation; makes a decision with no verification.",
          "2": "Generic 'alert the team and look at logs' with no triage order or decision.",
          "3": "Names 2–3 concrete checks in order, escalates, and proposes a rollback or fix-forward with a basic verification.",
          "4": "Structured triage, audience-correct escalation, and a rollback/fix-forward decision tied to blast radius and time-to-verify.",
          "5": "Exemplary incident command: triage order, explicit comms plan, decision rule, verification, and a stop-the-bleed-first posture.",
        },
        critical_mistakes: [
          "Fixing forward on a payments service without a rollback option and without explaining why.",
          "No escalation until the incident is over.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer is about general career talk with no incident-response content.",
        ],
        skill_mapping: { skill: "Incident Response", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666685",
        competency: "Communication under pressure",
        version: 1,
        observable_behavior:
          "Communicates during an incident to the right audience, with honest status and a cadence that matches severity.",
        evidence_requirements: [
          "Identifies the audience (incident channel, on-call, stakeholders, customers).",
          "Gives an example of honest, uncertainty-aware status.",
        ],
        anchors: {
          "1": "No communication plan; would go dark during the incident.",
          "2": "Communicates only to close teammates; no stakeholder or customer consideration.",
          "3": "Names the audiences and a basic status cadence.",
          "4": "Audience-correct messaging with honest uncertainty and a defined cadence.",
          "5": "A comms plan that scales with severity, owns uncertainty, and knows when customers must be told.",
        },
        critical_mistakes: [
          "Promising a fix time without evidence.",
          "Withholding information from customers past a material threshold.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer has no communication content (only monitoring talk).",
        ],
        skill_mapping: { skill: "Stakeholder Communication", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666686",
        competency: "Collaboration & ownership",
        version: 1,
        observable_behavior:
          "Runs a postmortem that separates cause from blame, and follows through on prevention as a personal owner.",
        evidence_requirements: [
          "Names a no-blame postmortem technique (blameless language, 5 whys, systems thinking).",
          "Explains how action items are enforced rather than written and forgotten.",
        ],
        anchors: {
          "1": "Blames the teammate; no learning structure.",
          "2": "Mentions 'no blame' but no concrete technique or follow-through.",
          "3": "Uses one concrete no-blame technique and names how one action item gets enforced.",
          "4": "Structures the postmortem around systems, gets team buy-in, and tracks prevention to done.",
          "5": "Makes learning the team norm: blameless framing, root-cause depth, enforced follow-ups, and a culture change.",
        },
        critical_mistakes: [
          "Using the postmortem to assign individual fault.",
          "Action items with no owner or deadline.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer is about solo debugging with no collaboration content.",
        ],
        skill_mapping: { skill: "Coaching", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 605 — knowledge_assessment · "Core backend knowledge check"
  // Objective, fact-checkable questions with recruiter-authored answer keys.
  // Scoring emphasizes correctness first, then the reasoning shown. No design
  // artifact and no incident scenario — plain, precise knowledge.
  // -------------------------------------------------------------------------
  {
    id: "66666666-6666-6666-6666-666666666605",
    requisition_id: BACKEND_REQ,
    competency: "Backend Engineering",
    version: 1,
    title: "Core backend knowledge check",
    kind: "knowledge_assessment",
    instructions:
      "Answer each question precisely and concisely. Where a question asks for a specific status code, term, state, or mechanism, state it exactly. Precision of the fact matters as much as the explanation — this is a knowledge check, not a design exercise.",
    time_policy: "Plan for up to 30 minutes. Your answers are saved automatically as you type.",
    questions: [
      {
        key: "q1",
        prompt:
          "Explain the difference between HTTP 401 and 403. Then state the exact status code a server should return when an API key is valid but the account is suspended, and name the Cache-Control directive that prevents a response containing an authorization token from being stored by a browser or CDN.",
        max_chars: 2000,
        criteria: ["HTTP & caching semantics"],
        is_core: true,
        answer_key: "401 = unauthenticated (missing/invalid credentials); 403 = authenticated but not permitted. Suspended account with a valid key → 403. Cache-Control: no-store.",
      },
      {
        key: "q2",
        prompt:
          "List the four ANSI SQL transaction isolation levels in increasing strength and, for each, name which of the three anomalies (dirty read, non-repeatable read, phantom read) it still permits.",
        max_chars: 2000,
        criteria: ["Concurrency & isolation knowledge"],
        is_core: true,
        answer_key: "Read uncommitted (dirty, non-repeatable, phantom); Read committed (non-repeatable, phantom); Repeatable read (phantom); Serializable (none).",
      },
      {
        key: "q3",
        prompt:
          "A server's connection count climbs and requests hang. Distinguish the TCP states TIME_WAIT and CLOSE_WAIT, and state which one signals that the server's own application is failing to close sockets — plus one likely cause.",
        max_chars: 2000,
        criteria: ["Networking fundamentals"],
        is_core: true,
        answer_key: "TIME_WAIT is the closing side's short delay after the final ACK; CLOSE_WAIT means the peer closed but the application has not called close(). A CLOSE_WAIT pileup → leaked/unclosed connections (e.g., a code path that opens a socket and never closes it).",
      },
      {
        key: "q4",
        prompt:
          "Name the three monitoring signals the acronym RED stands for and, for each, state which kind of incident it would first reveal.",
        max_chars: 2000,
        criteria: ["Observability fundamentals"],
        is_core: true,
        answer_key: "RED = Rate, Errors, Duration. Rate: traffic loss (e.g., total outage or drop). Errors: failing requests (e.g., 5xx spike). Duration: latency regression (e.g., slowdown without errors).",
      },
    ],
    test_cases: [
      { name: "http semantics", expected: "401 vs 403 distinguished; suspended-but-valid key returns 403; Cache-Control: no-store named." },
      { name: "isolation levels", expected: "Four levels with the correct permitted anomalies for each." },
      { name: "tcp states", expected: "TIME_WAIT vs CLOSE_WAIT distinguished; CLOSE_WAIT attributed to the app; one plausible cause." },
      { name: "monitoring", expected: "RED = Rate, Errors, Duration with a correct incident type per signal." },
    ],
    prompt_adaptation_allowed: false,
    rubrics: [
      {
        id: "66666666-6666-6666-6666-666666666691",
        competency: "HTTP & caching semantics",
        version: 1,
        observable_behavior:
          "States HTTP authentication/authorization semantics and cache control precisely (correctness-first).",
        evidence_requirements: [
          "Distinguishes 401 (unauthenticated) from 403 (unauthorized/permitted).",
          "Returns 403 for a suspended account with a valid key.",
          "Names Cache-Control: no-store.",
        ],
        anchors: {
          "1": "Confuses 401 and 403; no cache directive named.",
          "2": "One of the three facts correct; the rest wrong or missing.",
          "3": "401/403 distinction correct and one of the two remaining facts correct.",
          "4": "All three facts correct with accurate phrasing.",
          "5": "All facts exact, plus a correct edge case (e.g., 403 vs 404 for enumeration, or no-cache vs no-store).",
        },
        critical_mistakes: [
          "Returning 401 for a valid-key-but-suspended account.",
          "Confusing no-store with no-cache or must-revalidate.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 30 characters.",
          "Answer describes general web talk with no HTTP status/cache content.",
        ],
        skill_mapping: { skill: "REST APIs", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666692",
        competency: "Concurrency & isolation knowledge",
        version: 1,
        observable_behavior:
          "Recalls transaction isolation levels and their anomaly profiles correctly.",
        evidence_requirements: [
          "Lists all four isolation levels in increasing strength.",
          "Assigns the correct anomalies to each level.",
        ],
        anchors: {
          "1": "Cannot name the levels or confuses anomalies.",
          "2": "Names 2–3 levels with a partial anomaly mapping.",
          "3": "Names all four levels and gets the anomalies mostly right.",
          "4": "All four levels and all anomalies correct.",
          "5": "All correct and explains what each anomaly means in practice.",
        },
        critical_mistakes: [
          "Claiming Serializable permits phantoms.",
          "Putting the levels in the wrong strength order.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 30 characters.",
          "Answer covers generic concurrency with no isolation-level content.",
        ],
        skill_mapping: { skill: "PostgreSQL", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666693",
        competency: "Networking fundamentals",
        version: 1,
        observable_behavior:
          "Explains TCP socket states and maps them to application behavior.",
        evidence_requirements: [
          "Distinguishes TIME_WAIT from CLOSE_WAIT.",
          "Attaches CLOSE_WAIT to the application failing to close sockets.",
          "Names one plausible cause.",
        ],
        anchors: {
          "1": "Confuses the two states or cannot explain either.",
          "2": "Partial explanation; CLOSE_WAIT attribution wrong or missing.",
          "3": "Both states described and CLOSE_WAIT attributed to the app with a cause.",
          "4": "Accurate states, correct attribution, and a specific cause with diagnosis.",
          "5": "Precise, plus how to confirm (ss/lsof, connection dumps) and the fix.",
        },
        critical_mistakes: [
          "Blaming TIME_WAIT for leaked connections on the server side.",
          "No cause given for the pileup.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 30 characters.",
          "Answer covers application code with no TCP content.",
        ],
        skill_mapping: { skill: "Linux Administration", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666694",
        competency: "Observability fundamentals",
        version: 1,
        observable_behavior:
          "Names the RED monitoring signals and matches each to the incident class it reveals.",
        evidence_requirements: [
          "Expands RED correctly (Rate, Errors, Duration).",
          "Gives a correct incident example per signal.",
        ],
        anchors: {
          "1": "Cannot name RED or maps signals wrongly.",
          "2": "Names two of three signals correctly.",
          "3": "Names all three with a correct example for at least one.",
          "4": "All three signals expanded with correct incident mapping.",
          "5": "All correct and adds why RED is paired with latency SLOs in practice.",
        },
        critical_mistakes: [
          "Mixing up Errors and Duration mappings.",
          "Confusing RED with USE (saturation).",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 30 characters.",
          "Answer covers dashboards generically with no RED/monitoring-signal content.",
        ],
        skill_mapping: { skill: "Monitoring", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 602 — work_sample · Data Analyst "Messy dataset triage & metric design"
  // -------------------------------------------------------------------------
  {
    id: "66666666-6666-6666-6666-666666666602",
    requisition_id: ANALYST_REQ,
    competency: "Data Analysis",
    version: 1,
    title: "Messy dataset triage & metric design",
    kind: "work_sample",
    instructions:
      "You receive a sales dataset that 'everyone trusts but nobody checked.' Work through the questions below. No execution environment is provided — answer analytically and concretely, and be explicit about what you would verify before trusting the data.",
    time_policy: "Plan for up to 40 minutes. Your answers are saved automatically as you type.",
    questions: [
      {
        key: "q1",
        prompt:
          "List the checks you would run before trusting the dataset (duplicates, nulls, joins, date ranges, units). For each, say what you would do when the check fails.",
        max_chars: 4000,
        criteria: ["Data quality"],
        is_core: true,
      },
      {
        key: "q2",
        prompt:
          "Write the SQL (or equivalent) you would use to compute average order value per month, and call out exactly where a naive version of this query would mislead a decision-maker.",
        max_chars: 4000,
        criteria: ["Metric integrity"],
        is_core: true,
      },
      {
        key: "q3",
        prompt:
          "Leadership wants ONE chart of the results. Describe what you would show, what you would deliberately not show, and the caveat you would put on it.",
        max_chars: 4000,
        criteria: ["Chart & visualization honesty"],
        is_core: true,
      },
    ],
    test_cases: [
      { name: "data-quality plan", expected: "Concrete checks (duplicates, nulls, joins, ranges, units) with a reaction for each failure." },
      { name: "metric integrity", expected: "SQL for average order value that handles nulls/zeroes/outliers and names the naive-query pitfall." },
      { name: "chart honesty", expected: "One chart chosen deliberately, with excluded views and an explicit caveat." },
    ],
    prompt_adaptation_allowed: true,
    rubrics: [
      {
        id: "66666666-6666-6666-6666-666666666671",
        competency: "Data quality",
        version: 1,
        observable_behavior:
          "Treats the dataset as untrusted until checks pass; names concrete checks and the action each failure triggers.",
        evidence_requirements: [
          "Names at least three distinct checks (duplicates, nulls, joins, ranges, units, timestamps).",
          "For each failure, states a concrete reaction.",
        ],
        anchors: {
          "1": "Trusts the dataset with no checks.",
          "2": "Mentions 'check for errors' generically with no concrete checks or reactions.",
          "3": "Names several concrete checks and a reaction for at least one failure.",
          "4": "Concrete checks with a reaction per failure, including where data would be rejected vs. flagged.",
          "5": "A structured data-quality protocol covering the failure modes listed and the trade-offs of each reaction.",
        },
        critical_mistakes: [
          "Assuming the dataset is clean because 'everyone trusts it.'",
          "Only checking one dimension (e.g., duplicates only).",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer is about chart styling with no data-quality content.",
        ],
        skill_mapping: { skill: "Data Modeling", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666672",
        competency: "Metric integrity",
        version: 1,
        observable_behavior:
          "Computes a metric correctly and can name exactly where a naive computation misleads.",
        evidence_requirements: [
          "Provides concrete SQL or a clear computation for average order value.",
          "Names a specific pitfall (nulls, zero orders, refunds, double-counting, unit mismatch).",
        ],
        anchors: {
          "1": "No computation; metric is hand-waved.",
          "2": "A computation that is wrong or unverifiable; no pitfall identified.",
          "3": "A working computation and one clearly-named pitfall.",
          "4": "A correct computation with multiple pitfalls handled and justified.",
          "5": "A defensible metric definition with edge cases, exclusions, and why the definition matters for the decision.",
        },
        critical_mistakes: [
          "Dividing by a possibly-zero denominator without noting it.",
          "Double-counting orders across joins without noticing.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer contains no computation and no pitfall.",
        ],
        skill_mapping: { skill: "SQL", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666673",
        competency: "Chart & visualization honesty",
        version: 1,
        observable_behavior:
          "Chooses one visualization deliberately, states what is excluded and why, and attaches an honest caveat.",
        evidence_requirements: [
          "Names a specific chart type for a specific audience.",
          "States at least one view deliberately excluded and why.",
          "States the caveat that travels with the chart.",
        ],
        anchors: {
          "1": "No chart decision; would just 'make it look nice.'",
          "2": "A chart choice with no justification, exclusions, or caveat.",
          "3": "A justified chart choice with one exclusion or caveat.",
          "4": "Chart choice justified against the decision, with exclusions and a caveat.",
          "5": "Treats the chart as a decision tool: audience, message, excluded views, caveat, and what would change the conclusion.",
        },
        critical_mistakes: [
          "Choosing a chart that hides variance (e.g., misleading scale) without disclosure.",
          "Presenting the chart without any caveat.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer is about dashboard tooling with no visualization judgment.",
        ],
        skill_mapping: { skill: "Data Visualization", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 603 — work_sample · People Ops "Policy scenario triage"
  // -------------------------------------------------------------------------
  {
    id: "66666666-6666-6666-6666-666666666603",
    requisition_id: PEOPLE_OPS_REQ,
    competency: "People Operations",
    version: 1,
    title: "Policy scenario triage",
    kind: "work_sample",
    instructions:
      "You support a People Operations team. Work through the scenario questions below. Where policy is silent or information is missing, say so explicitly and state what you would escalate and to whom.",
    time_policy: "Plan for up to 35 minutes. Your answers are saved automatically as you type.",
    questions: [
      {
        key: "q1",
        prompt:
          "A manager asks whether an employee can work fully remote. Walk through what you would check first, what information is missing from the request, and when you would escalate instead of deciding.",
        max_chars: 4000,
        criteria: ["Policy application", "Missing-information handling"],
        is_core: true,
      },
      {
        key: "q2",
        prompt:
          "An employee claims reimbursement for a course they completed. Describe the verification steps, where the policy is silent, and how you would record the decision.",
        max_chars: 4000,
        criteria: ["Policy application", "Missing-information handling"],
        is_core: true,
      },
      {
        key: "q3",
        prompt:
          "Write the escalation note you would send to HR leadership for the remote-work case: what you verified, what you did NOT verify, and the exact question you need answered.",
        max_chars: 4000,
        criteria: ["Escalation judgment"],
        is_core: true,
      },
    ],
    test_cases: [
      { name: "missing-info recognition", expected: "Identifies what is missing from the request rather than assuming it." },
      { name: "policy boundaries", expected: "Names where policy is silent and what that implies for the decision." },
      { name: "escalation note", expected: "A note that separates verified facts from unverified claims and asks one clear question." },
    ],
    prompt_adaptation_allowed: true,
    rubrics: [
      {
        id: "66666666-6666-6666-6666-666666666681",
        competency: "Policy application",
        version: 1,
        observable_behavior:
          "Applies policy to a scenario, distinguishing what the policy states from what it does not.",
        evidence_requirements: [
          "Cites the relevant policy area (remote work, leave, L&D reimbursement).",
          "Explicitly names at least one thing the policy does not cover.",
        ],
        anchors: {
          "1": "Invented a policy that does not exist.",
          "2": "References policy vaguely; cannot separate policy from opinion.",
          "3": "Applies the relevant policy and names one area where it is silent.",
          "4": "Applies policy precisely, names the silent areas, and connects them to the decision at hand.",
          "5": "Applies policy, flags ambiguity, identifies what evidence would resolve it, and knows when to escalate.",
        },
        critical_mistakes: [
          "Stating a policy exists when it does not.",
          "Deciding an ambiguous case without flagging the ambiguity.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "Answer is about a different domain (e.g., engineering) with no policy content.",
        ],
        skill_mapping: { skill: "Policy Management", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666682",
        competency: "Missing-information handling",
        version: 1,
        observable_behavior:
          "Does not fill gaps with assumptions; states what is missing and what would resolve it.",
        evidence_requirements: [
          "Names specific missing facts in the scenario.",
          "States what the requester or the requester's manager must supply.",
        ],
        anchors: {
          "1": "Filled the gaps with invented facts.",
          "2": "Sensed something was missing but could not name it.",
          "3": "Names the missing facts and asks for them.",
          "4": "Names missing facts, ranks which matter to the decision, and asks precisely.",
          "5": "Identifies missing facts, explains why each matters, and distinguishes nice-to-know from decision-critical.",
        },
        critical_mistakes: [
          "Processing a request on assumed facts.",
          "Escalating without first gathering available information.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "No missing-information content in the answer.",
        ],
        skill_mapping: { skill: "Stakeholder Management", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
      {
        id: "66666666-6666-6666-6666-666666666683",
        competency: "Escalation judgment",
        version: 1,
        observable_behavior:
          "Writes an escalation that separates verified facts from unverified claims and ends with one clear question.",
        evidence_requirements: [
          "The note separates what was verified from what was not.",
          "The note ends with a single, answerable question.",
        ],
        anchors: {
          "1": "Escalates with no structure; facts and opinions mixed.",
          "2": "Escalates but cannot separate verified from unverified.",
          "3": "A structured note that separates verified from unverified and asks one question.",
          "4": "A note that separates facts, flags assumptions, and asks a question that the recipient can actually answer.",
          "5": "A model escalation: verified facts, explicit unknowns, the decision needed, and the consequence of waiting.",
        },
        critical_mistakes: [
          "Presenting an assumption as a verified fact in the escalation.",
          "Asking a question the recipient cannot answer.",
        ],
        insufficient_evidence_conditions: [
          "Answer is empty or under 60 characters.",
          "No escalation-note content in the answer.",
        ],
        skill_mapping: { skill: "Stakeholder Management", anchor_to_proficiency: { "3": 3, "4": 4, "5": 5 } },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Judgment vocabulary + quote/answer helpers (unchanged contracts).
// ---------------------------------------------------------------------------

export const ASSESSMENT_JUDGMENT_VALUES = ["1", "2", "3", "4", "5", "NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"] as const;

export type JudgmentValue = (typeof ASSESSMENT_JUDGMENT_VALUES)[number];

export function isJudgmentValue(v: unknown): v is JudgmentValue {
  return typeof v === "string" && (ASSESSMENT_JUDGMENT_VALUES as readonly string[]).includes(v);
}

/** Normalize a model/human judgment to the allowed vocabulary. */
export function normalizeJudgment(v: unknown): JudgmentValue {
  if (isJudgmentValue(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return String(Math.round(n)) as JudgmentValue;
  return "NOT_ASSESSED";
}

/** Case-insensitive substring match (verifies a quoted phrase exists verbatim). */
export function quoteExists(quote: string, source: string): boolean {
  const q = String(quote ?? "").trim().toLowerCase();
  const s = String(source ?? "").toLowerCase();
  if (!q) return false;
  return s.includes(q) && q.length >= 3;
}

/** Flatten every submitted answer for a session into one searchable blob. */
export function answersBlob(answers: Record<string, { answer?: string }> | Record<string, string>): string {
  return Object.values(answers ?? {})
    .map((v) => (typeof v === "string" ? v : v?.answer ?? ""))
    .join("\n");
}

/** Pick the answer text for a question key, tolerant of object/string shapes. */
export function answerFor(answers: unknown, key: string): string {
  const a = (answers ?? {}) as Record<string, unknown>;
  const v = a[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return String((v as { answer?: unknown }).answer ?? "");
  return "";
}

/** Which blueprint question keys produce evidence for a rubric competency
 *  (explicit Q→criteria mapping; falls back to the old positional pairing). */
export function questionsForCompetency(
  questions: { key: string; criteria?: string[] }[],
  competency: string,
  positionalIndex?: number
): string[] {
  const mapped = questions
    .filter((q) => (q.criteria ?? []).some((c) => c.toLowerCase() === competency.toLowerCase()))
    .map((q) => q.key);
  if (mapped.length > 0) return mapped;
  const pos = questions[positionalIndex ?? 0];
  return pos ? [pos.key] : [];
}

/** Maximum length of an evidence quote; longer "quotes" are rejected so the
 *  model must cite excerpts, not regurgitate whole answers (excerpt bounds). */
export const MAX_EVIDENCE_QUOTE_CHARS = 600;

// ---------------------------------------------------------------------------
// Judgment item shape (extends the Phase 4 contract with dimensions +
// reviewer-routing metadata; reason/overrides used by the human review path).
// ---------------------------------------------------------------------------

export interface JudgmentItem {
  competency: string;
  judgment: JudgmentValue;
  evidence_quotes: string[];
  anchor_ref: string;
  uncertainty: number;
  suggested_follow_up: string;
  note?: string;
  /** Phase 5: separate dimension scores (correctness / reasoning /
   *  trade_offs / communication). "NA" when a dimension is not applicable. */
  dimensions?: Dimensions;
  /** Server-computed: true when uncertainty or contradictions require human
   *  confirmation before this item may support verified evidence. */
  review_required?: boolean;
  /** Human override reason + audit (set by assessment-review). */
  reason?: string;
  override_from?: string;
}

/** Server-side validation of one judgment item against its rubric + the
 *  candidate's answers. The evidence quotes must literally exist in the
 *  candidate's answer text (against the question keys mapped to this
 *  competency), must respect excerpt bounds, and scores must be in the
 *  allowed vocabulary. */
export function validateJudgmentItem(
  item: unknown,
  rubric: { competency: string; anchors: Record<string, string> },
  answers: unknown,
  competencyQuestionKeys: string[]
): string[] {
  const errors: string[] = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return ["judgment item must be an object"];
  }
  const j = item as Record<string, unknown>;
  const competency = String(j.competency ?? "").trim();
  if (!competency) errors.push("judgment competency missing");
  if (competency && rubric.competency && competency.toLowerCase() !== rubric.competency.toLowerCase()) {
    errors.push(`judgment competency "${competency}" does not match rubric competency "${rubric.competency}"`);
  }
  const judgment = normalizeJudgment(j.judgment);
  if (isJudgmentValue(j.judgment) === false && !(typeof j.judgment === "number")) {
    errors.push(`judgment "${String(j.judgment)}" is not a valid value (1..5, NOT_ASSESSED, INSUFFICIENT_EVIDENCE)`);
  }
  if (judgment !== "NOT_ASSESSED" && judgment !== "INSUFFICIENT_EVIDENCE") {
    const n = Number(judgment);
    if (!rubric.anchors[String(n)]) errors.push(`anchor level ${n} not present in rubric`);
  }
  if (typeof j.anchor_ref === "string" && j.anchor_ref.length > 0) {
    const digits = String(j.anchor_ref).match(/\d/);
    if (!digits) {
      errors.push("anchor_ref must reference an anchor level (1..5)");
    } else {
      const refLevel = Number(digits[0]);
      if (!rubric.anchors[String(refLevel)]) errors.push(`anchor_ref level ${refLevel} not present in rubric`);
    }
  }
  if (j.dimensions !== undefined && j.dimensions !== null) {
    if (typeof j.dimensions !== "object" || Array.isArray(j.dimensions)) {
      errors.push("dimensions must be an object");
    } else {
      for (const [name, v] of Object.entries(j.dimensions as Record<string, unknown>)) {
        if (!DIMENSION_NAMES.includes(name as DimensionName)) {
          errors.push(`dimension "${name}" is not a supported dimension`);
        } else if (!isDimensionScore(v)) {
          errors.push(`dimension "${name}" must be one of ${DIMENSION_SCORES.join("|")}`);
        }
      }
    }
  }
  if (!Array.isArray(j.evidence_quotes)) {
    errors.push("evidence_quotes must be an array");
  } else {
    const blob = competencyQuestionKeys.length > 0
      ? competencyQuestionKeys.map((k) => answerFor(answers, k)).join("\n")
      : answersBlob(answers as Record<string, { answer?: string }>);
    for (const q of j.evidence_quotes as unknown[]) {
      if (typeof q !== "string") {
        errors.push("evidence_quotes entries must be strings");
        continue;
      }
      if (q.length > MAX_EVIDENCE_QUOTE_CHARS) {
        errors.push(`evidence quote exceeds the ${MAX_EVIDENCE_QUOTE_CHARS}-character excerpt bound`);
      }
      if (!quoteExists(q, blob)) errors.push(`evidence quote not found in the candidate's answer: "${q.slice(0, 80)}"`);
    }
  }
  const unc = j.uncertainty;
  if (unc !== undefined && (typeof unc !== "number" || unc < 0 || unc > 1)) errors.push("uncertainty must be a number 0..1");
  if (j.suggested_follow_up !== undefined && j.suggested_follow_up !== null && typeof j.suggested_follow_up !== "string") {
    errors.push("suggested_follow_up must be a string");
  }
  return errors;
}

/** Missing/short answers short-circuit to INSUFFICIENT_EVIDENCE / NOT_ASSESSED
 *  (used before any model call so missing responses never fabricate scores). */
export function defaultJudgmentFor(
  answers: unknown,
  key: string,
  rubric: { competency: string }
): JudgmentItem {
  const text = answerFor(answers, key).trim();
  if (!text) {
    return {
      competency: rubric.competency,
      judgment: "NOT_ASSESSED",
      evidence_quotes: [],
      anchor_ref: "",
      uncertainty: 1,
      suggested_follow_up: "",
      dimensions: {},
      review_required: true,
      note: "No answer was provided for this question.",
    };
  }
  if (text.length < 60) {
    return {
      competency: rubric.competency,
      judgment: "INSUFFICIENT_EVIDENCE",
      evidence_quotes: [],
      anchor_ref: "",
      uncertainty: 1,
      suggested_follow_up: "",
      dimensions: {},
      review_required: true,
      note: "The answer is too short to assess against the rubric.",
    };
  }
  return {
    competency: rubric.competency,
    judgment: "NOT_ASSESSED",
    evidence_quotes: [],
    anchor_ref: "",
    uncertainty: 1,
    suggested_follow_up: "",
    dimensions: {},
    review_required: true,
    note: "Assessment pending.",
  };
}

export const NO_EXECUTION_NOTICE =
  "Code-execution sandboxes are not available in this deployment, so submitted artifacts were reviewed as written work only — no tests were executed and none were simulated.";
