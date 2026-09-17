// ---------------------------------------------------------------------------
// WorkSense seed payload — single source of truth for demo data.
// Everything is pre-computed static JSON (no live generation, no Qwen calls).
// Skill-match records live in generated-seed-fits.ts, produced offline by the
// deterministic engine so they always agree with skill-match computations.
// ---------------------------------------------------------------------------

import type { FitRecord } from "./skill-graph-engine.ts";
import { SEED_FITS } from "./generated-seed-fits.ts";

export const DEMO_ORG_ID = "11111111-1111-1111-1111-111111111111";

export const DEMO_ACCOUNTS = [
  { email: "dana@worksense.demo", password: "WorkSenseDemo!2026", name: "Dana Whitmore", twinId: "22222222-2222-2222-2222-222222222201" },
  { email: "riley@worksense.demo", password: "WorkSenseDemo!2026", name: "Riley Morgan", twinId: "22222222-2222-2222-2222-222222222208" },
  { email: "jordan@worksense.demo", password: "WorkSenseDemo!2026", name: "Jordan Reyes", twinId: "22222222-2222-2222-2222-222222222202" },
  { email: "chris@worksense.demo", password: "WorkSenseDemo!2026", name: "Chris Okafor", twinId: "22222222-2222-2222-2222-222222222209" },
  { email: "alex@worksense.demo", password: "WorkSenseDemo!2026", name: "Alex Chen", twinId: "22222222-2222-2222-2222-222222222203" },
  { email: "sam@worksense.demo", password: "WorkSenseDemo!2026", name: "Samira Patel", twinId: "22222222-2222-2222-2222-222222222204" },
];

export const POLICIES = [
  {
    id: "pol-01",
    title: "Remote Work Policy",
    category: "Workplace",
    doc_code: "POL-RMT",
    effective_date: "2025-01-01",
    summary: "Hybrid model: 2 in-office days per week baseline; full remote requires manager + People Ops approval.",
    sections: [
      {
        code: "s1",
        heading: "Hybrid baseline",
        text: "WorkSense operates on a hybrid model. Employees are expected in office two days per week (Tuesday and Thursday baseline) unless their role is designated remote-first. Requests for full-time remote work require written approval from the reporting manager and People Operations.",
      },
      {
        code: "s2",
        heading: "Re-approval and compliance",
        text: "Re-approval is required every six months or when role or team changes. Failure to obtain approval before changing work location may result in loss of remote eligibility.",
      },
    ],
  },
  {
    id: "pol-02",
    title: "Leave & Time Off Policy",
    category: "Benefits",
    doc_code: "POL-LVE",
    effective_date: "2025-01-01",
    summary: "24 days annual paid leave, accrued monthly; 10+ consecutive days requires 4 weeks notice.",
    sections: [
      {
        code: "s1",
        heading: "Accrual and notice",
        text: "Employees accrue 24 days of paid annual leave per year on a monthly basis. Leave requests of ten or more consecutive days must be submitted at least four weeks in advance and require manager approval.",
      },
      {
        code: "s2",
        heading: "Carryover and emergency leave",
        text: "Unused leave carries over up to five days per year. Emergency leave does not require advance notice but must be logged on the first working day.",
      },
    ],
  },
  {
    id: "pol-03",
    title: "Learning & Development Reimbursement",
    category: "Development",
    doc_code: "POL-LND",
    effective_date: "2025-01-01",
    summary: "Up to 2,500 per year for role-relevant training; certifications tied to roadmap priorities.",
    sections: [
      {
        code: "s1",
        heading: "Reimbursement budget",
        text: "Employees may claim reimbursement up to 2,500 per calendar year for role-relevant courses, certifications, and conferences. Claims must include proof of completion and a one-paragraph relevance statement.",
      },
      {
        code: "s2",
        heading: "Prioritization and pre-approval",
        text: "Certifications aligned with the current quarter's skill roadmap are prioritized in review. Pre-approval is required for expenses above 1,000.",
      },
    ],
  },
  {
    id: "pol-04",
    title: "Internal Mobility Policy",
    category: "Career",
    doc_code: "POL-MOB",
    effective_date: "2025-01-01",
    summary: "Eligible after 12 months in role; must inform manager before applying; 30-day transition.",
    sections: [
      {
        code: "s1",
        heading: "Eligibility",
        text: "Employees are eligible to apply for internal roles after completing twelve months in their current role, unless a documented exception is approved by both managers.",
      },
      {
        code: "s2",
        heading: "Process and transition",
        text: "Candidates must inform their current manager before applying. The transition window is thirty days unless both managers agree on a shorter handover. A rejected internal application carries no negative record.",
      },
    ],
  },
  {
    id: "pol-05",
    title: "Performance Review Cycle",
    category: "Performance",
    doc_code: "POL-PERF",
    effective_date: "2025-01-01",
    summary: "Two review cycles per year; calibration sessions ensure cross-team fairness.",
    sections: [
      {
        code: "s1",
        heading: "Review cadence",
        text: "Performance reviews run twice per year (mid-year and end-of-year). Each cycle includes manager assessment, peer feedback, and a self-assessment submitted two weeks before the review meeting.",
      },
      {
        code: "s2",
        heading: "Calibration and ratings",
        text: "A calibration session aligns ratings across teams. Ratings use a five-level scale from 'Needs Improvement' to 'Exceptional'.",
      },
    ],
  },
  {
    id: "pol-06",
    title: "Parental Leave Policy",
    category: "Benefits",
    doc_code: "POL-PAR",
    effective_date: "2025-01-01",
    summary: "16 weeks fully paid for primary caregivers; 6 weeks for secondary; return-to-work support.",
    sections: [
      {
        code: "s1",
        heading: "Leave entitlement",
        text: "Primary caregivers receive sixteen weeks of fully paid parental leave; secondary caregivers receive six weeks. Leave may be taken in one continuous block or, with manager approval, split.",
      },
      {
        code: "s2",
        heading: "Return-to-work support",
        text: "Return-to-work support includes a phased schedule for the first two weeks back and access to an internal parenting community.",
      },
    ],
  },
  {
    id: "pol-07",
    title: "Equipment & Security Policy",
    category: "Security",
    doc_code: "POL-SEC",
    effective_date: "2025-01-01",
    summary: "Company-issued devices only; MFA mandatory; annual security training required.",
    sections: [
      {
        code: "s1",
        heading: "Devices and authentication",
        text: "Work must be performed on company-issued devices. Multi-factor authentication is mandatory on all accounts.",
      },
      {
        code: "s2",
        heading: "Training and loss reporting",
        text: "Annual security training is required for continued system access; non-completion within 60 days of the due date suspends access. Lost devices must be reported within 24 hours.",
      },
    ],
  },
  {
    id: "pol-08",
    title: "Overtime & Comp Time Policy",
    category: "Workplace",
    doc_code: "POL-OVT",
    effective_date: "2025-01-01",
    summary: "Overtime requires manager pre-approval; compensated as time-off on a 1:1 basis.",
    sections: [
      {
        code: "s1",
        heading: "Pre-approval",
        text: "Overtime requires manager pre-approval unless responding to a declared incident.",
      },
      {
        code: "s2",
        heading: "Compensation",
        text: "Approved overtime is compensated as equivalent time off on a 1:1 basis, to be taken within 90 days. Employees are expected to track overtime in the time system the same week it is worked.",
      },
    ],
  },
];

export const SKILLS = [
  { skill: "Go", category: "Backend", outgoing_edges: [{ target_skill: "REST APIs", type: "ADJACENT_TO", weight: 0.6 }, { target_skill: "TypeScript", type: "TRANSFERABLE_TO", weight: 0.55 }] },
  { skill: "TypeScript", category: "Frontend", outgoing_edges: [{ target_skill: "React", type: "PREREQUISITE_OF", weight: 0.8 }, { target_skill: "Node.js", type: "ADJACENT_TO", weight: 0.7 }] },
  { skill: "React", category: "Frontend", outgoing_edges: [{ target_skill: "TypeScript", type: "ADJACENT_TO", weight: 0.75 }] },
  { skill: "Node.js", category: "Backend", outgoing_edges: [{ target_skill: "REST APIs", type: "ADJACENT_TO", weight: 0.75 }] },
  { skill: "Docker", category: "DevOps", outgoing_edges: [{ target_skill: "Containerization", type: "ADJACENT_TO", weight: 0.8 }] },
  { skill: "Containerization", category: "DevOps", outgoing_edges: [{ target_skill: "Kubernetes", type: "PREREQUISITE_OF", weight: 0.85 }] },
  { skill: "Kubernetes", category: "DevOps", outgoing_edges: [] },
  { skill: "PostgreSQL", category: "Data", outgoing_edges: [{ target_skill: "SQL", type: "ADJACENT_TO", weight: 0.9 }, { target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.65 }] },
  { skill: "SQL", category: "Data", outgoing_edges: [{ target_skill: "Data Modeling", type: "PREREQUISITE_OF", weight: 0.9 }, { target_skill: "Python", type: "ADJACENT_TO", weight: 0.6 }] },
  { skill: "Python", category: "Data", outgoing_edges: [{ target_skill: "Data Modeling", type: "ADJACENT_TO", weight: 0.7 }, { target_skill: "ETL", type: "ADJACENT_TO", weight: 0.7 }, { target_skill: "TypeScript", type: "TRANSFERABLE_TO", weight: 0.5 }] },
  { skill: "Data Modeling", category: "Data", outgoing_edges: [{ target_skill: "ETL", type: "ADJACENT_TO", weight: 0.6 }] },
  { skill: "ETL", category: "Data", outgoing_edges: [] },
  { skill: "Tableau", category: "Analytics", outgoing_edges: [{ target_skill: "Data Visualization", type: "ADJACENT_TO", weight: 0.8 }] },
  { skill: "Data Visualization", category: "Analytics", outgoing_edges: [{ target_skill: "Storytelling with Data", type: "TRANSFERABLE_TO", weight: 0.6 }] },
  { skill: "Storytelling with Data", category: "Analytics", outgoing_edges: [] },
  { skill: "REST APIs", category: "Backend", outgoing_edges: [{ target_skill: "Containerization", type: "ADJACENT_TO", weight: 0.4 }] },
  { skill: "Leadership", category: "People", outgoing_edges: [{ target_skill: "Mentoring", type: "ADJACENT_TO", weight: 0.8 }] },
  { skill: "Mentoring", category: "People", outgoing_edges: [] },
];

export const REQUISITIONS = [
  {
    id: "33333333-3333-3333-3333-333333333301",
    title: "Senior Backend Engineer",
    department: "Platform",
    seniority_level: 4,
    required_skills: [
      { skill: "Go", target_proficiency: 4 },
      { skill: "PostgreSQL", target_proficiency: 3 },
      { skill: "Docker", target_proficiency: 3 },
      { skill: "REST APIs", target_proficiency: 3 },
    ],
    future_skills: [
      { skill: "Kubernetes", target_proficiency: 2 },
      { skill: "Event-driven architecture", target_proficiency: 2 },
    ],
    applicants: [
      { twin_id: "22222222-2222-2222-2222-222222222205", stage: "final_round", application_code: "WS-PRIYA-2026", applied_at: "2026-08-12T09:00:00Z", match_score: 0.655 },
      { twin_id: "22222222-2222-2222-2222-222222222206", stage: "screening", application_code: "WS-DEV-2026", applied_at: "2026-09-02T09:00:00Z", match_score: 0.248 },
    ],
    audit_events: [
      { actor: "dana@worksense.demo", action: "created", note: "Requisition opened", timestamp: "2026-08-05T09:00:00Z" },
    ],
  },
  {
    id: "33333333-3333-3333-3333-333333333302",
    title: "Data Analyst",
    department: "Data",
    seniority_level: 3,
    required_skills: [
      { skill: "SQL", target_proficiency: 4 },
      { skill: "Python", target_proficiency: 3 },
      { skill: "Data Modeling", target_proficiency: 3 },
      { skill: "Tableau", target_proficiency: 2 },
    ],
    future_skills: [
      { skill: "dbt", target_proficiency: 2 },
      { skill: "Machine Learning fundamentals", target_proficiency: 2 },
    ],
    applicants: [
      { twin_id: "22222222-2222-2222-2222-222222222207", stage: "technical_interview", application_code: "WS-MAYA-2026", applied_at: "2026-08-20T09:00:00Z", match_score: 0.83 },
    ],
    audit_events: [
      { actor: "dana@worksense.demo", action: "created", note: "Requisition opened", timestamp: "2026-08-08T09:00:00Z" },
    ],
  },
];

export const JOURNEY_TASKS = [
  { id: "t1", title: "IT account & laptop setup", depends_on: [], status: "done", waived: false, approvals: [{ role: "it", approved: true, timestamp: "2026-08-01T10:00:00Z" }] },
  { id: "t2", title: "Security & compliance training", depends_on: [], status: "done", waived: false, approvals: [] },
  { id: "t3", title: "Team introduction & codebase walkthrough", depends_on: ["t1"], status: "done", waived: false, approvals: [] },
  { id: "t4", title: "First sprint contribution", depends_on: ["t1", "t3"], status: "in_progress", waived: false, approvals: [] },
  { id: "t5", title: "30-day manager check-in", depends_on: ["t2"], status: "pending", waived: false, approvals: [{ role: "manager", approved: false, timestamp: null }] },
  { id: "t6", title: "Onboarding feedback survey", depends_on: ["t4", "t5"], status: "pending", waived: false, approvals: [] },
];

export const JOURNEY_AUDIT_EVENTS = [
  { actor: "system", action: "created", note: "Onboarding journey generated", timestamp: "2026-07-20T09:00:00Z" },
];

export const RECOMMENDATIONS = [
  {
    id: "44444444-4444-4444-4444-444444444401",
    org_id: DEMO_ORG_ID,
    twin_id: "22222222-2222-2222-2222-222222222204",
    category: "workforce_review",
    urgency: "high",
    evidence_ledger: [
      { source: "WORKFORCE_REVIEW_SIGNAL", fact: "Signal 68/100 — multiple workforce indicators warrant HR review (decision support, not a prediction)." },
      { source: "ENGAGEMENT_SURVEY", fact: "Survey 3.1 / 5 (declining over 2 cycles)." },
      { source: "ATTENDANCE", fact: "Recent unapproved absence pattern above own baseline." },
      { source: "PERFORMANCE", fact: "Latest rating: Exceeds Expectations — strong, stable delivery across 4 cycles." },
    ],
    executive_summary: "Samira combines strong, consistent delivery with a Workforce Review Signal of 68/100 driven by declining engagement, an above-baseline absence pattern and 40 months without a band change. The evidence supports a manager-led retention conversation and a concrete growth or mobility option.",
    proposed_action: {
      title: "Manager review for retention intervention",
      description: "Open a manager-led check-in with Samira within the week. Focus on engagement drivers and growth path.",
      steps: [
        { order: 1, action: "Book a 1:1 focused on engagement, not performance." },
        { order: 2, action: "Review the workforce signal factors together." },
        { order: 3, action: "Propose a growth or mobility option (internal role, project, or upskilling)." },
        { order: 4, action: "Log the outcome in the recommendation record." },
      ],
    },
    status: "needs_review",
    required_signoff_role: "manager",
    reviewer_rationale: {},
    audit_events: [{ actor: "system", action: "created", note: "Triggered by intelligence scan (RETENTION_INTERVENTION).", timestamp: "2026-09-10T09:00:00Z" }],
  },
  {
    id: "44444444-4444-4444-4444-444444444402",
    org_id: DEMO_ORG_ID,
    twin_id: "22222222-2222-2222-2222-222222222203",
    category: "mobility",
    urgency: "low",
    evidence_ledger: [
      { source: "SKILL_GRAPH", fact: "78% current fit vs Senior Backend Engineer; Docker → Containerization → Kubernetes adjacent ladder." },
      { source: "PERFORMANCE", fact: "Latest rating: On Track — 80% goals met in first cycle." },
      { source: "ONBOARDING_PROGRESS", fact: "3/6 onboarding tasks complete; first contribution in progress." },
    ],
    executive_summary: "Alex is mid-onboarding but already shows a clear adjacent path toward Containerization and Kubernetes within the current team. The skill graph supports early exposure to Kubernetes work as a low-urgency growth step.",
    proposed_action: {
      title: "Expose Alex to Kubernetes work",
      description: "Assign a Kubernetes-adjacent task in the next sprint to build the adjacent-skill bridge.",
      steps: [
        { order: 1, action: "Assign containerization-adjacent story." },
        { order: 2, action: "Pair with a team member on the platform cluster." },
        { order: 3, action: "Add Kubernetes to the L&D plan for next cycle." },
      ],
    },
    status: "needs_review",
    required_signoff_role: "manager",
    reviewer_rationale: {},
    audit_events: [{ actor: "system", action: "created", note: "Triggered by intelligence scan (INTERNAL_MOBILITY).", timestamp: "2026-09-08T09:00:00Z" }],
  },
  {
    id: "44444444-4444-4444-4444-444444444403",
    org_id: DEMO_ORG_ID,
    twin_id: "22222222-2222-2222-2222-222222222205",
    category: "recruitment",
    urgency: "medium",
    evidence_ledger: [
      { source: "INTERVIEW_RUBRIC", fact: "Final-round average score 0.87; technical round 0.87, final round 0.88." },
      { source: "SKILL_MATCH", fact: "0.655 deterministic match vs Senior Backend Engineer; direct Go/PostgreSQL/Docker, REST APIs adjacent." },
      { source: "PIPELINE_STAGE", fact: "Final round reached; best backend-engineer fit in the pipeline." },
    ],
    executive_summary: "Priya cleared the final round with the strongest backend-engineer skill match in the pipeline and top rubric scores. The evidence supports moving to an offer stage.",
    proposed_action: {
      title: "Advance candidate to offer stage",
      description: "Priya cleared final round with strong rubric scores and the best backend-engineer skill match in the pipeline. Recommend moving to offer.",
      steps: [
        { order: 1, action: "Review rubric details and references." },
        { order: 2, action: "Prepare offer package aligned to band." },
        { order: 3, action: "Log outcome in the recommendation record." },
      ],
    },
    status: "needs_review",
    required_signoff_role: "hr_executive",
    reviewer_rationale: {},
    audit_events: [{ actor: "system", action: "created", note: "Triggered by intelligence scan (RECRUITMENT).", timestamp: "2026-09-13T09:00:00Z" }],
  },
];

interface TwinSeed {
  id: string;
  org_id: string;
  role: string;
  status: string;
  name: string;
  email: string;
  department: string;
  job_title: string;
  manager_id: string | null;
  tenure_months: number;
  seniority_level: number;
  promotion_lag_months: number;
  attendance: { baseline: number; recent: number };
  delivery: { missed: number; total: number };
  verified_skills: { name: string; proficiency: number; evidence_source: string; verification_rigor: "low" | "medium" | "high" }[];
  interview_rubrics: unknown[];
  performance_history: {
    cycle: string;
    rating: string;
    goals_met?: number;
    feedback?: { sentiment: "positive" | "negative" | "neutral"; text: string }[];
    summary: string;
  }[];
  signals: unknown[];
  audit_events: unknown[];
}

export const TWINS: TwinSeed[] = [
  {
    id: "22222222-2222-2222-2222-222222222201",
    org_id: DEMO_ORG_ID,
    role: "hr_executive",
    status: "active",
    name: "Dana Whitmore",
    email: "dana@worksense.demo",
    department: "People Operations",
    job_title: "VP of People",
    manager_id: null,
    tenure_months: 84,
    seniority_level: 5,
    promotion_lag_months: 30,
    attendance: { baseline: 0.3, recent: 0.35 },
    delivery: { missed: 1, total: 10 },
    verified_skills: [
      { name: "Leadership", proficiency: 5, evidence_source: "performance_review", verification_rigor: "high" },
      { name: "Stakeholder Management", proficiency: 4, evidence_source: "performance_review", verification_rigor: "high" },
      { name: "People Analytics", proficiency: 3, evidence_source: "certification", verification_rigor: "medium" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2025-H2", rating: "Exceeds Expectations", goals_met: 95, feedback: [{ sentiment: "positive", text: "Built the People Ops analytics function from scratch." }], summary: "Built the People Ops analytics function from scratch." },
      { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 90, feedback: [{ sentiment: "positive", text: "Led org-wide retention initiative." }], summary: "Led org-wide retention initiative." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 26, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 0.833, attendance: 0, delivery: 0.1, growth: 0 } },
    ],
    audit_events: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222202",
    org_id: DEMO_ORG_ID,
    role: "manager",
    status: "active",
    name: "Jordan Reyes",
    email: "jordan@worksense.demo",
    department: "Platform",
    job_title: "Engineering Manager",
    manager_id: "22222222-2222-2222-2222-222222222201",
    tenure_months: 48,
    seniority_level: 4,
    promotion_lag_months: 18,
    attendance: { baseline: 0.4, recent: 0.3 },
    delivery: { missed: 1, total: 8 },
    verified_skills: [
      { name: "Leadership", proficiency: 4, evidence_source: "performance_review", verification_rigor: "high" },
      { name: "Go", proficiency: 4, evidence_source: "certification", verification_rigor: "medium" },
      { name: "Mentoring", proficiency: 4, evidence_source: "peer_feedback", verification_rigor: "medium" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2025-H2", rating: "Exceeds Expectations", goals_met: 92, feedback: [{ sentiment: "positive", text: "Shipped platform reliability program." }], summary: "Shipped platform reliability program." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 17, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 0.5, attendance: 0, delivery: 0.125, growth: 0 } },
    ],
    audit_events: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222203",
    org_id: DEMO_ORG_ID,
    role: "employee",
    status: "active",
    name: "Alex Chen",
    email: "alex@worksense.demo",
    department: "Platform",
    job_title: "Backend Engineer",
    manager_id: "22222222-2222-2222-2222-222222222202",
    tenure_months: 3,
    seniority_level: 3,
    promotion_lag_months: 2,
    attendance: { baseline: 0.3, recent: 0.2 },
    delivery: { missed: 0, total: 3 },
    verified_skills: [
      { name: "Go", proficiency: 3, evidence_source: "interview_rubric", verification_rigor: "high" },
      { name: "Docker", proficiency: 2, evidence_source: "project", verification_rigor: "medium" },
      { name: "SQL", proficiency: 2, evidence_source: "project", verification_rigor: "medium" },
    ],
    interview_rubrics: [
      { role: "Backend Engineer", avg_score: 0.85, notes: "Strong systems thinking; growth area in production debugging.", evaluated_at: "2026-06-10T09:00:00Z" },
    ],
    performance_history: [
      { cycle: "2026-H1", rating: "On Track", goals_met: 80, feedback: [{ sentiment: "positive", text: "New hire, first sprint shipped on schedule." }, { sentiment: "neutral", text: "Still ramping on platform specifics." }], summary: "New hire, first sprint shipped on schedule." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 2, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 0.056, attendance: 0, delivery: 0, growth: 0 } },
    ],
    audit_events: [
      { actor: "system", action: "created", note: "Onboarding journey initiated", timestamp: "2026-07-20T09:00:00Z" },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222204",
    org_id: DEMO_ORG_ID,
    role: "employee",
    status: "active",
    name: "Samira Patel",
    email: "sam@worksense.demo",
    department: "Data",
    job_title: "Data Analyst",
    manager_id: "22222222-2222-2222-2222-222222222202",
    tenure_months: 42,
    seniority_level: 3,
    promotion_lag_months: 40,
    attendance: { baseline: 0.5, recent: 1.5 },
    delivery: { missed: 3, total: 8 },
    verified_skills: [
      { name: "SQL", proficiency: 4, evidence_source: "certification", verification_rigor: "high" },
      { name: "Python", proficiency: 3, evidence_source: "project", verification_rigor: "medium" },
      { name: "Tableau", proficiency: 3, evidence_source: "project", verification_rigor: "medium" },
      { name: "Data Modeling", proficiency: 2, evidence_source: "course", verification_rigor: "low" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2024-H2", rating: "Exceeds Expectations", goals_met: 95, feedback: [{ sentiment: "positive", text: "Rebuilt core reporting pipeline." }], summary: "Rebuilt core reporting pipeline." },
      { cycle: "2025-H1", rating: "Exceeds Expectations", goals_met: 93, feedback: [{ sentiment: "positive", text: "Owned executive metrics dashboards." }], summary: "Owned executive metrics dashboards." },
      { cycle: "2025-H2", rating: "Exceeds Expectations", goals_met: 90, feedback: [{ sentiment: "positive", text: "Consistent high output; strong stakeholder trust." }], summary: "Consistent high output; strong stakeholder trust." },
      { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 88, feedback: [{ sentiment: "positive", text: "Top-quartile delivery again." }, { sentiment: "negative", text: "Engagement concerns noted; seeks more scope and leadership exposure." }], summary: "Top-quartile delivery again; engagement concerns noted." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 68, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 1, attendance: 1, delivery: 0.375, growth: 1 } },
      { type: "seeks_growth", value: true, last_measured: "2026-08-25T09:00:00Z" },
      { type: "engagement_survey", value: "3.1 / 5", trend: "declining over 2 cycles", last_measured: "2026-08-25T09:00:00Z" },
    ],
    audit_events: [
      { actor: "system", action: "signal_updated", note: "Workforce review signal recomputed to 78", timestamp: "2026-09-10T09:00:00Z" },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222208",
    org_id: DEMO_ORG_ID,
    role: "hr_partner",
    status: "active",
    name: "Riley Morgan",
    email: "riley@worksense.demo",
    department: "People Operations",
    job_title: "HR Business Partner",
    manager_id: "22222222-2222-2222-2222-222222222201",
    tenure_months: 30,
    seniority_level: 4,
    promotion_lag_months: 12,
    attendance: { baseline: 0.3, recent: 0.4 },
    delivery: { missed: 1, total: 9 },
    verified_skills: [
      { name: "Leadership", proficiency: 4, evidence_source: "performance_review", verification_rigor: "high" },
      { name: "People Analytics", proficiency: 3, evidence_source: "certification", verification_rigor: "medium" },
      { name: "Policy Management", proficiency: 3, evidence_source: "project", verification_rigor: "medium" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 91, feedback: [{ sentiment: "positive", text: "Partnered with Platform and Data orgs on retention." }], summary: "Partnered with Platform and Data orgs on retention." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 18, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 0.333, attendance: 0.333, delivery: 0.111, growth: 0 } },
    ],
    audit_events: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222209",
    org_id: DEMO_ORG_ID,
    role: "recruiter",
    status: "active",
    name: "Chris Okafor",
    email: "chris@worksense.demo",
    department: "Talent Acquisition",
    job_title: "Technical Recruiter",
    manager_id: "22222222-2222-2222-2222-222222222201",
    tenure_months: 18,
    seniority_level: 3,
    promotion_lag_months: 10,
    attendance: { baseline: 0.25, recent: 0.3 },
    delivery: { missed: 2, total: 11 },
    verified_skills: [
      { name: "Sourcing", proficiency: 4, evidence_source: "performance_review", verification_rigor: "high" },
      { name: "Interview Design", proficiency: 3, evidence_source: "certification", verification_rigor: "medium" },
      { name: "Stakeholder Management", proficiency: 3, evidence_source: "peer_feedback", verification_rigor: "medium" },
    ],
    interview_rubrics: [],
    performance_history: [
      { cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: 94, feedback: [{ sentiment: "positive", text: "Filled 12 roles; cut time-to-hire by 20%." }], summary: "Filled 12 roles; cut time-to-hire by 20%." },
    ],
    signals: [
      { type: "workforce_review_signal", value: 16, computed_at: "2026-09-10T09:00:00Z", factors: { tenure: 0.278, attendance: 0.2, delivery: 0.182, growth: 0 } },
    ],
    audit_events: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222205",
    org_id: DEMO_ORG_ID,
    role: "candidate",
    status: "candidate",
    name: "Priya Nair",
    email: "priya.nair@example.com",
    department: "Platform",
    job_title: "Candidate — Senior Backend Engineer",
    manager_id: null,
    tenure_months: 0,
    seniority_level: 4,
    promotion_lag_months: 0,
    attendance: { baseline: 0, recent: 0 },
    delivery: { missed: 0, total: 0 },
    verified_skills: [
      { name: "Go", proficiency: 4, evidence_source: "interview_rubric", verification_rigor: "high" },
      { name: "PostgreSQL", proficiency: 4, evidence_source: "technical_assessment", verification_rigor: "medium" },
      { name: "Docker", proficiency: 3, evidence_source: "resume", verification_rigor: "low" },
      { name: "Kubernetes", proficiency: 2, evidence_source: "resume", verification_rigor: "low" },
    ],
    interview_rubrics: [
      { role: "Senior Backend Engineer", round: "technical", avg_score: 0.87, strengths: ["distributed systems", "database design"], growth_areas: ["observability tooling"], evaluated_at: "2026-09-05T09:00:00Z" },
      { role: "Senior Backend Engineer", round: "final", avg_score: 0.88, strengths: ["system design", "team fit"], growth_areas: [], evaluated_at: "2026-09-12T09:00:00Z" },
    ],
    performance_history: [],
    signals: [],
    audit_events: [
      { actor: "system", action: "stage_changed", note: "Advanced to final_round", timestamp: "2026-09-12T09:00:00Z" },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222206",
    org_id: DEMO_ORG_ID,
    role: "candidate",
    status: "candidate",
    name: "Dev Sharma",
    email: "dev.sharma@example.com",
    department: "Platform",
    job_title: "Candidate — Senior Backend Engineer",
    manager_id: null,
    tenure_months: 0,
    seniority_level: 2,
    promotion_lag_months: 0,
    attendance: { baseline: 0, recent: 0 },
    delivery: { missed: 0, total: 0 },
    verified_skills: [
      { name: "Go", proficiency: 2, evidence_source: "resume", verification_rigor: "low" },
      { name: "Node.js", proficiency: 4, evidence_source: "resume", verification_rigor: "low" },
      { name: "REST APIs", proficiency: 3, evidence_source: "resume", verification_rigor: "low" },
    ],
    interview_rubrics: [],
    performance_history: [],
    signals: [],
    audit_events: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222207",
    org_id: DEMO_ORG_ID,
    role: "candidate",
    status: "candidate",
    name: "Maya Kapoor",
    email: "maya.kapoor@example.com",
    department: "Data",
    job_title: "Candidate — Data Analyst",
    manager_id: null,
    tenure_months: 0,
    seniority_level: 2,
    promotion_lag_months: 0,
    attendance: { baseline: 0, recent: 0 },
    delivery: { missed: 0, total: 0 },
    verified_skills: [
      { name: "SQL", proficiency: 4, evidence_source: "resume", verification_rigor: "low" },
      { name: "Python", proficiency: 3, evidence_source: "resume", verification_rigor: "low" },
      { name: "Data Modeling", proficiency: 3, evidence_source: "resume", verification_rigor: "low" },
      { name: "Tableau", proficiency: 2, evidence_source: "resume", verification_rigor: "low" },
    ],
    interview_rubrics: [
      { role: "Data Analyst", round: "technical", avg_score: 0.74, strengths: ["query optimization", "statistics"], growth_areas: ["dashboard UX"], evaluated_at: "2026-09-08T09:00:00Z" },
    ],
    performance_history: [],
    signals: [],
    audit_events: [],
  },
];

/** Twins ready for insert: auth_user_id linked, computed_fits from the engine-generated seed. */
export function buildTwins(authIds: Record<string, string>) {
  return TWINS.map((t) => ({
    ...t,
    auth_user_id: authIds[t.email] ?? null,
    computed_fits: (SEED_FITS[t.id] ?? []) as FitRecord[],
  }));
}

/** Seed onboarding journey for the mid-onboarding persona (Alex). */
export const SEED_JOURNEY = {
  id: "55555555-5555-5555-5555-555555555555",
  org_id: DEMO_ORG_ID,
  twin_id: "22222222-2222-2222-2222-222222222203",
  tasks: JOURNEY_TASKS,
  status: "pending",
  plan: { start_date: "2026-07-21T09:00:00Z", approvals: [], generated_at: "2026-07-20T09:00:00Z" },
  audit_events: JOURNEY_AUDIT_EVENTS,
};
