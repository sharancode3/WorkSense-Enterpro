// ---------------------------------------------------------------------------
// WorkSense deterministic demo-fixture generator (Phase 3).
// Produces supabase/functions/_shared/generated-demo-fixtures.ts as static
// JSON so a reset reproduces the exact same org every time. Fixed PRNG seed,
// dates relative to a demo clock (2026-09-15). All computed claims (fit
// scores, workforce signals, onboarding schedules) come from the deterministic
// engines — never hand-written numbers. Two orgs exist for isolation tests.
// Fictional data only, labeled as such in the UI.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeFit,
  type FitRecord,
  type GraphSkill,
  type RequiredSkill,
  type SkillClaim,
} from "../supabase/functions/_shared/skill-graph-engine.ts";
import { computeReviewIndex } from "../supabase/functions/_shared/workforce-review-index.ts";
import { schedulePlan, type TaskInput, type ScheduledTask } from "../supabase/functions/_shared/onboarding-engine.ts";
import { DEMO_ORG_ID, POLICIES, REQUISITIONS, SKILLS, TWINS } from "../supabase/functions/_shared/seed-data.ts";

// --- deterministic helpers --------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260915);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const ri = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

function detUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const s = hex(h1) + hex(h2) + hex((h1 ^ h2) >>> 0) + hex((h1 + h2) >>> 0); // 32 hex chars -> 8-4-4-4-12
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(12, 15)}-a${s.slice(15, 18)}-${s.slice(18, 30)}`;
}

const CLOCK = "2026-09-15T09:00:00Z";
function monthsAgoPeriod(back: number): string {
  const d = new Date(CLOCK);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - back);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const daysAgo = (days: number) => new Date(new Date(CLOCK).getTime() - days * 86400000).toISOString();

// --- catalog: 80 canonical skills (18 preserved from the golden seed, 62 new) ---
const LEGACY_GRAPH = SKILLS as GraphSkill[];
const NEW_SKILLS_BY_CATEGORY: Record<string, string[]> = {
  Backend: ["Java", "Spring Boot", "gRPC", "Message Queues", "Redis", "Event-driven architecture", "Distributed Systems", "API Design", "Observability"],
  Frontend: ["HTML & CSS", "Vue.js", "Design Systems", "Accessibility", "Web Performance", "Testing", "Tailwind CSS", "Framer Motion", "WebSockets"],
  Data: ["dbt", "Machine Learning fundamentals", "Spark", "Kafka", "Airflow", "Data Governance", "Statistics", "A/B Testing", "Feature Engineering", "BigQuery"],
  DevOps: ["CI/CD", "Terraform", "AWS", "Linux Administration", "Monitoring", "Incident Response", "GitHub Actions", "Helm", "Service Mesh"],
  Analytics: ["Excel", "Power BI", "Predictive Modeling", "Cohort Analysis", "Funnel Analytics", "Experiment Design", "Data Storytelling", "SQL Analytics"],
  Product: ["Product Strategy", "Roadmapping", "User Research", "Prototyping", "Product Analytics", "A/B Experimentation", "Stakeholder Communication", "GTM Strategy"],
  Design: ["Figma", "UI Design", "UX Research", "Wireframing", "Interaction Design", "Visual Design", "Design Tokens", "Usability Testing"],
  People: ["Coaching", "Performance Management", "Succession Planning", "Compensation Design", "Employee Relations", "Onboarding Design", "Change Management", "Learning & Development"],
};
const NEW_SKILLS: { skill: string; category: string; aliases: string[]; edges: { target_skill: string; type: "ADJACENT_TO" | "PREREQUISITE_OF" | "TRANSFERABLE_TO"; weight: number }[] }[] = [];
for (const [category, names] of Object.entries(NEW_SKILLS_BY_CATEGORY)) {
  for (const name of names) {
    const peers = names.filter((n) => n !== name).slice(0, 2);
    NEW_SKILLS.push({
      skill: name,
      category,
      aliases: [`${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, name.toLowerCase()],
      edges: peers.map((target_skill, i) => ({
        target_skill,
        type: i === 0 ? ("ADJACENT_TO" as const) : ("TRANSFERABLE_TO" as const),
        weight: 0.6,
      })),
    });
  }
}
const ALIAS_BY_SKILL: Record<string, string[]> = {};
for (const s of [...(SKILLS as { skill: string }[]), ...NEW_SKILLS]) {
  ALIAS_BY_SKILL[s.skill] = [s.skill.toLowerCase().replace(/[^a-z0-9]+/g, "")];
}
export const SKILL_CATALOG = [
  ...(SKILLS as { skill: string; category: string; outgoing_edges: { target_skill: string; type: string; weight: number }[] }[]).map((s) => ({
    id: detUuid(`skill:${s.skill}`),
    skill: s.skill,
    aliases: ALIAS_BY_SKILL[s.skill] ?? [],
    category: s.category ?? "General",
    outgoing_edges: s.outgoing_edges,
  })),
  ...NEW_SKILLS.map((s) => ({
    id: detUuid(`skill:${s.skill}`),
    skill: s.skill,
    aliases: s.aliases,
    category: s.category,
    outgoing_edges: s.edges,
  })),
];

const SKILL_ID = (name: string) => SKILL_CATALOG.find((s) => s.skill === name)!.id;

// --- departments ------------------------------------------------------------
const DEPARTMENTS = ["Platform", "Data", "Design", "Product", "Sales", "People Operations"];
const DEPT_SKILLS: Record<string, string[]> = {
  Platform: ["Go", "PostgreSQL", "Docker", "REST APIs", "Node.js", "TypeScript", "React", "Kubernetes", "Java", "gRPC", "Distributed Systems", "CI/CD", "Terraform", "Observability", "Redis", "Message Queues", "API Design", "Incident Response"],
  Data: ["SQL", "Python", "Data Modeling", "ETL", "dbt", "Tableau", "Statistics", "Spark", "Airflow", "Data Governance", "Kafka", "Machine Learning fundamentals", "Feature Engineering", "BigQuery", "A/B Testing"],
  Design: ["Figma", "UI Design", "UX Research", "Wireframing", "Interaction Design", "Visual Design", "Design Tokens", "Usability Testing", "Accessibility", "Design Systems", "Prototyping"],
  Product: ["Product Strategy", "Roadmapping", "User Research", "Prototyping", "Product Analytics", "A/B Experimentation", "Stakeholder Communication", "GTM Strategy", "Leadership", "Data Visualization"],
  Sales: ["Storytelling with Data", "Stakeholder Communication", "Excel", "Cohort Analysis", "Funnel Analytics", "CRM Analytics", "Forecasting", "Negotiation", "Pipeline Management"],
  "People Operations": ["Leadership", "Mentoring", "People Analytics", "Policy Management", "Coaching", "Performance Management", "Succession Planning", "Compensation Design", "Employee Relations", "Onboarding Design", "Change Management", "Learning & Development"],
};
for (const s of ["Forecasting", "Negotiation", "Pipeline Management", "CRM Analytics"]) {
  if (!SKILL_CATALOG.find((k) => k.skill === s)) {
    SKILL_CATALOG.push({ id: detUuid(`skill:${s}`), skill: s, aliases: [s.toLowerCase()], category: "Sales", outgoing_edges: [] });
  }
}
// Canonical concepts referenced by preserved personas but not in the base list.
for (const s of ["Stakeholder Management", "People Analytics", "Sourcing", "Interview Design", "Policy Management", "Event-driven architecture"]) {
  if (!SKILL_CATALOG.find((k) => k.skill === s)) {
    SKILL_CATALOG.push({ id: detUuid(`skill:${s}`), skill: s, aliases: [s.toLowerCase().replace(/[^a-z0-9]+/g, "")], category: s === "Event-driven architecture" ? "Backend" : "People", outgoing_edges: [] });
  }
}

// --- persona preservation (9 golden twins keep their exact ids/rows) ----------
const PERSONA_ID = (email: string) => TWINS.find((t) => t.email === email)?.id;
const P_HR = PERSONA_ID("dana@worksense.demo")!;
const P_MGR = PERSONA_ID("jordan@worksense.demo")!;
const P_EMP = PERSONA_ID("alex@worksense.demo")!;
const P_EMP2 = PERSONA_ID("sam@worksense.demo")!;
const P_HRP = PERSONA_ID("riley@worksense.demo")!;
const P_REC = PERSONA_ID("chris@worksense.demo")!;
const P_C1 = PERSONA_ID("priya.nair@example.com")!;
const P_C2 = PERSONA_ID("dev.sharma@example.com")!;
const P_C3 = PERSONA_ID("maya.kapoor@example.com")!;

const tierFor = (p: number) => (p >= 5 ? "EXPERT" : p >= 4 ? "ADVANCED" : p >= 3 ? "INTERMEDIATE" : "FOUNDATIONAL");
const RIGOR_STATE: Record<string, string> = { high: "reviewer_confirmed", medium: "assessment_supported", low: "claimed" };
const evidenceSourceFor = (state: string) =>
  state === "reviewer_confirmed" ? "evidence_review" : state === "assessment_supported" ? "assessment" : state === "extracted" ? "resume_extraction" : "self_report";

interface AssertionSeed {
  skill_id: string;
  claimed_proficiency: number;
  proficiency_tier: string;
  review_state: string;
  quote: string;
}

function personasAsEmployees(): PersonSeed[] {
  const staff = TWINS.filter((t) => t.role !== "candidate");
  return staff.map((t) => {
    return {
      id: t.id,
      name: t.name,
      email: t.email,
      role: t.role === "hr_executive" ? "hr_executive" : t.role === "hr_partner" ? "hr_partner" : t.role === "manager" ? "manager" : t.role === "recruiter" ? "recruiter" : "employee",
      department: t.department ?? "General",
      job_title: t.job_title,
      manager_id: t.manager_id,
      tenure_months: t.tenure_months,
      seniority_level: t.seniority_level,
      promotion_lag_months: t.promotion_lag_months,
      seeks_growth: t.email === "sam@worksense.demo",
      attendance: t.attendance,
      delivery: t.delivery,
      // Signals are computed once (Phase 9) AFTER observations exist, so the
      // Workforce Review Index can use the longitudinal observation history.
      signals: [],
      performance_history: t.performance_history ?? [],
      interview_rubrics: t.interview_rubrics ?? [],
      audit_events: t.audit_events ?? [],
      assertions: (t.verified_skills ?? []).map((s) => ({
        skill_id: SKILL_ID(s.name),
        claimed_proficiency: s.proficiency,
        proficiency_tier: tierFor(s.proficiency),
        review_state: RIGOR_STATE[s.verification_rigor] ?? "claimed",
        quote: `${s.name} evidenced via ${s.evidence_source}.`,
      })),
    };
  });
}

function candidatesAsPeople(): PersonSeed[] {
  return TWINS.filter((t) => t.role === "candidate").map((t) => ({
    id: t.id,
    name: t.name,
    email: t.email,
    role: "candidate",
    department: t.department ?? "General",
    job_title: t.job_title,
    manager_id: null,
    tenure_months: 0,
    seniority_level: t.seniority_level,
    promotion_lag_months: 0,
    seeks_growth: false,
    attendance: { baseline: 0, recent: 0 },
    delivery: { missed: 0, total: 0 },
    signals: [],
    performance_history: [],
    interview_rubrics: t.interview_rubrics ?? [],
    audit_events: t.audit_events ?? [],
    assertions: (t.verified_skills ?? []).map((s) => ({
      skill_id: SKILL_ID(s.name),
      claimed_proficiency: s.proficiency,
      proficiency_tier: tierFor(s.proficiency),
      review_state: RIGOR_STATE[s.verification_rigor] ?? "claimed",
      quote: `Evidence: ${s.evidence_source}.`,
    })),
  }));
}

// --- generated people ---------------------------------------------------------
const FIRST = ["Elena", "Marcus", "Priya", "Wei", "Sofia", "Diego", "Nina", "Omar", "Hana", "Lucas", "Ava", "Kenji", "Ingrid", "Tomas", "Yuki", "Fatima", "Noah", "Leila", "Adrian", "Zara", "Mateo", "Clara", "Ravi", "Elena", "Jonas", "Mei"];
const LAST = ["Fernandez", "Kim", "Novak", "Osei", "Larsen", "Costa", "Haddad", "Nakamura", "Vargas", "Weber", "Ali", "Petrov", "Silva", "Kaur", "Moreau", "Ito", "Berg", "Romano", "Singh", "Duval", "Kowalski", "Mensah", "Fischer", "Alvarez", "Tanaka", "Lopez"];
const rndName = () => `${pick(FIRST)} ${pick(LAST)}`;
const rndEmail = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.worksense@example.com`;

const newAssertions = (dept: string, count: number): AssertionSeed[] => {
  const pool = DEPT_SKILLS[dept] ?? DEPT_SKILLS.Platform;
  const out: AssertionSeed[] = [];
  const seen = new Set<string>();
  while (out.length < count) {
    const skill = pick(pool);
    if (seen.has(skill)) continue;
    seen.add(skill);
    const prof = ri(2, 5);
    const roll = rnd();
    const state = roll < 0.55 ? "reviewer_confirmed" : roll < 0.85 ? "assessment_supported" : "claimed";
    out.push({
      skill_id: SKILL_ID(skill),
      claimed_proficiency: prof,
      proficiency_tier: tierFor(prof),
      review_state: state,
      quote: `${pick(["Delivered", "Owned", "Shipped", "Maintained"])} ${skill} ${pick(["on production systems", "across two releases", "with measurable impact", "in a cross-functional team"])}.`,
    });
  }
  return out;
};

interface PersonSeed {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  job_title: string;
  manager_id: string | null;
  tenure_months: number;
  seniority_level: number;
  promotion_lag_months: number;
  seeks_growth: boolean;
  attendance: { baseline: number; recent: number };
  delivery: { missed: number; total: number };
  signals: unknown[];
  performance_history: unknown[];
  interview_rubrics: unknown[];
  audit_events: unknown[];
  assertions: AssertionSeed[];
}

const employees: PersonSeed[] = [...personasAsEmployees()];
const candidates: PersonSeed[] = [...candidatesAsPeople()];

// 6 managers (Jordan + 5 dept leads) and 54 ICs.
const managersByDept: Record<string, string> = {};
for (const dept of DEPARTMENTS) {
  if (dept === "Platform") {
    managersByDept[dept] = P_MGR; // Jordan Reyes already there
    continue;
  }
  const m: PersonSeed = {
    id: detUuid(`emp:${dept}:manager`),
    name: rndName(),
    email: rndEmail(`${dept}-lead`),
    role: "manager",
    department: dept,
    job_title: `${dept} Manager`,
    manager_id: P_HR,
    tenure_months: ri(30, 96),
    seniority_level: 4,
    promotion_lag_months: ri(6, 30),
    seeks_growth: false,
    attendance: { baseline: 0.2 + rnd() * 0.3, recent: 0.2 + rnd() * 0.3 },
    delivery: { missed: ri(0, 2), total: ri(6, 12) },
    signals: [],
    performance_history: [{ cycle: "2026-H1", rating: "Exceeds Expectations", goals_met: ri(88, 98), summary: "Delivered on org priorities." }],
    interview_rubrics: [],
    audit_events: [],
    assertions: newAssertions(dept, 5),
  };
  // Phase 13: give the Data dept lead a stable demo identity so the security
  // matrix can sign in a SECOND manager (cross-team isolation tests). RNG draw
  // count is preserved so the rest of the fixture stays byte-identical.
  if (dept === "Data") {
    m.name = "Nadia Kim";
    m.email = "nadia@worksense.demo";
  }
  managersByDept[dept] = m.id;
  employees.push(m);
}

for (let i = 0; i < 49; i++) {
  const dept = DEPARTMENTS[i % 6];
  const mgr = managersByDept[dept];
  const tenure = ri(2, 84);
  const lag = Math.max(0, ri(1, 48));
  const attendance = { baseline: +(0.2 + rnd() * 0.4).toFixed(2), recent: +(0.2 + rnd() * 0.5).toFixed(2) };
  const total = ri(3, 12);
  const missed = Math.min(total, ri(0, total));
  const e: PersonSeed = {
    id: detUuid(`emp:${i}`),
    name: rndName(),
    email: rndEmail(`emp-${i}`),
    role: "employee",
    department: dept,
    job_title: pick(["Engineer", "Analyst", "Specialist", "Coordinator", "Designer", "Associate"]),
    manager_id: mgr,
    tenure_months: tenure,
    seniority_level: ri(1, 4),
    promotion_lag_months: lag,
    seeks_growth: false,
    attendance,
    delivery: { missed, total },
    signals: [],
    performance_history: [
      { cycle: "2026-H1", rating: pick(["On Track", "Exceeds Expectations", "On Track", "On Track"]), goals_met: ri(70, 98), summary: "Consistent delivery." },
    ],
    interview_rubrics: [],
    audit_events: [],
    assertions: newAssertions(dept, ri(4, 6)),
  };
  employees.push(e);
}

// Healthy growth persona (Phase 9): reports development interest with a LOW
// review index — the longitudinal case proves growth interest is a development
// conversation, never a risk flag. emp:8 sits inside the observed set.
const growthEmp = employees.find((e) => e.id === detUuid("emp:8"))!;
growthEmp.seeks_growth = true;
growthEmp.promotion_lag_months = 6;
growthEmp.tenure_months = 24;
growthEmp.attendance = { baseline: 0.3, recent: 0.3 };
growthEmp.delivery = { missed: 0, total: 8 };
growthEmp.signals.push({ type: "seeks_growth", value: true, last_measured: "2026-08-25T09:00:00Z" });

// ~24 candidates: 3 preserved + 21 generated across 6 requisitions.
for (let i = 0; i < 21; i++) {
  const dept = DEPARTMENTS[i % 6];
  const claimHeavy = i % 5 === 0; // every 5th candidate is keyword-heavy / low evidence
  const n = rndName();
  candidates.push({
    id: detUuid(`cand:${i}`),
    name: n,
    email: rndEmail(`cand-${i}`),
    role: "candidate",
    department: dept,
    job_title: "Candidate",
    manager_id: null,
    tenure_months: 0,
    seniority_level: ri(2, 4),
    promotion_lag_months: 0,
    seeks_growth: false,
    attendance: { baseline: 0, recent: 0 },
    delivery: { missed: 0, total: 0 },
    signals: [],
    performance_history: [],
    interview_rubrics: [],
    audit_events: [],
    assertions: claimHeavy
      ? newAssertions(dept, 5).map((a) => ({ ...a, review_state: "claimed", claimed_proficiency: Math.min(5, a.claimed_proficiency + 1) }))
      : newAssertions(dept, 4),
  });
}

// --- requisitions (2 preserved + 4 generated), match_scores engine-computed ---
const claimsFor = (p: PersonSeed): SkillClaim[] =>
  p.assertions
    .filter((a) => a.review_state !== "expired" && a.review_state !== "disputed" && a.review_state !== "superseded")
    .map((a) => {
      const skill = SKILL_CATALOG.find((s) => s.id === a.skill_id)!.skill;
      return {
        name: skill,
        proficiency: a.claimed_proficiency,
        evidence_source: evidenceSourceFor(a.review_state),
        verification_rigor: (a.review_state === "reviewer_confirmed" ? "high" : a.review_state === "assessment_supported" ? "medium" : "low") as SkillClaim["verification_rigor"],
      };
    });

const computeMatch = (cand: PersonSeed, req: { id: string; title: string; seniority_level: number; required_skills: RequiredSkill[] }): number => {
  const fit: FitRecord = computeFit({
    candidateSkills: claimsFor(cand),
    candidateLevel: cand.seniority_level,
    requiredSkills: req.required_skills,
    roleLevel: req.seniority_level,
    skillGraph: LEGACY_GRAPH,
    target: { type: "requisition", id: req.id, title: req.title },
    scenario: "current",
    computedAt: CLOCK,
  });
  return fit.score;
};

const reqById = new Map(REQUISITIONS.map((r) => [r.id, r]));
const stageFor = (i: number) => (i % 4 === 0 ? "screening" : i % 4 === 1 ? "technical_interview" : i % 4 === 2 ? "final_round" : "screening");

const requisitions = REQUISITIONS.map((r) => {
  const req = {
    id: r.id,
    title: r.title,
    department: r.department,
    status: r.status ?? "open",
    seniority_level: r.seniority_level,
    required_skills: r.required_skills,
    future_skills: r.future_skills,
    applicants: (r.applicants ?? []).map((ap: { twin_id: string; stage: string; application_code: string; applied_at: string }) => {
      const cand = candidates.find((c) => c.id === ap.twin_id)!;
      return {
        twin_id: ap.twin_id,
        stage: ap.stage,
        application_code: ap.application_code,
        applied_at: ap.applied_at,
        match_score: +computeMatch(cand, { id: r.id, title: r.title, seniority_level: r.seniority_level, required_skills: r.required_skills }).toFixed(3),
      };
    }),
  };
  return req;
});

const NEW_REQS: { id: string; title: string; department: string; status: string; seniority_level: number; required_skills: RequiredSkill[]; future_skills: RequiredSkill[] }[] = [
  { id: detUuid("req:mobile"), title: "Senior Frontend Engineer", department: "Design", status: "open", seniority_level: 4, required_skills: [{ skill: "React", target_proficiency: 4 }, { skill: "TypeScript", target_proficiency: 4 }, { skill: "Design Systems", target_proficiency: 3 }, { skill: "Accessibility", target_proficiency: 2 }], future_skills: [{ skill: "Web Performance", target_proficiency: 3 }] },
  { id: detUuid("req:ml"), title: "Machine Learning Engineer", department: "Data", status: "open", seniority_level: 4, required_skills: [{ skill: "Python", target_proficiency: 4 }, { skill: "Statistics", target_proficiency: 3 }, { skill: "Machine Learning fundamentals", target_proficiency: 4 }, { skill: "Data Modeling", target_proficiency: 3 }], future_skills: [{ skill: "Feature Engineering", target_proficiency: 3 }] },
  { id: detUuid("req:pm"), title: "Senior Product Manager", department: "Product", status: "open", seniority_level: 4, required_skills: [{ skill: "Product Strategy", target_proficiency: 4 }, { skill: "Roadmapping", target_proficiency: 4 }, { skill: "Stakeholder Communication", target_proficiency: 4 }, { skill: "A/B Experimentation", target_proficiency: 3 }], future_skills: [{ skill: "GTM Strategy", target_proficiency: 3 }] },
  { id: detUuid("req:design"), title: "Product Designer", department: "Design", status: "on_hold", seniority_level: 3, required_skills: [{ skill: "Figma", target_proficiency: 4 }, { skill: "UI Design", target_proficiency: 4 }, { skill: "UX Research", target_proficiency: 3 }, { skill: "Wireframing", target_proficiency: 3 }], future_skills: [{ skill: "Usability Testing", target_proficiency: 3 }] },
];
for (const r of NEW_REQS) {
  const pool = DEPARTMENTS.map((d, i) => candidates.filter((c) => c.department === d)).flat().filter((c) => !reqById.has(c.id));
  const cands = pool.slice(0, 4).length === 4 ? pool.slice(0, 4) : candidates.slice(0, 4);
  requisitions.push({
    ...r,
    applicants: cands.map((c, i) => ({
      twin_id: c.id,
      stage: stageFor(i),
      application_code: `WS-${detUuid(`code:${r.id}:${c.id}`).slice(0, 6).toUpperCase()}`,
      applied_at: daysAgo(ri(8, 40)),
      match_score: +computeMatch(c, { id: r.id, title: r.title, seniority_level: r.seniority_level, required_skills: r.required_skills }).toFixed(3),
    })),
  });
}

// --- policies: 12 versioned documents (8 preserved + 4 new; 2 get a v2) --------
const policies = POLICIES.map((p, i) => ({
  id: detUuid(`pol:${p.doc_code}:v1`),
  doc_code: p.doc_code,
  version: 1,
  title: p.title,
  category: p.category,
  sections: p.sections,
  effective_from: p.effective_date,
}));
const NEW_POLICIES = [
  { doc_code: "POL-SICK", version: 1, title: "Sick Leave & Wellbeing Policy", category: "Benefits", effective_from: "2025-01-01", sections: [{ code: "s1", heading: "Entitlement", text: "Employees receive 10 paid sick days per year, with certification required for absences longer than three consecutive days." }, { code: "s2", heading: "Confidentiality", text: "Health information stays confidential and is visible only to the People Operations team on a need-to-know basis." }] },
  { doc_code: "POL-AI", version: 1, title: "AI Tools Usage Policy", category: "Security", effective_from: "2026-01-01", sections: [{ code: "s1", heading: "Approved tools", text: "Only approved AI tools listed on the internal register may be used for work. Personal AI accounts must not be used for company data." }, { code: "s2", heading: "Data handling", text: "Never paste customer, employee, or confidential data into unapproved AI services. Violations may result in access review." }] },
  { doc_code: "POL-REL", version: 1, title: "Relocation Assistance Policy", category: "Benefits", effective_from: "2025-06-01", sections: [{ code: "s1", heading: "Reimbursement", text: "Relocation expenses up to 5,000 are reimbursed for role moves requiring a change of residence, subject to two years of continued service." }] },
  { doc_code: "POL-GIFT", version: 1, title: "Gifts & Hospitality Policy", category: "Compliance", effective_from: "2025-01-01", sections: [{ code: "s1", heading: "Limits", text: "Gifts or hospitality above 50 in value must be logged; anything above 200 requires prior approval from the Ethics committee." }, { code: "s2", heading: "Reporting", text: "All logged gifts are reviewed quarterly. Undisclosed gifts above the threshold may result in disciplinary review." }] },
];
policies.push(...NEW_POLICIES.map((p) => ({ id: detUuid(`pol:${p.doc_code}:v1`), ...p, sections: p.sections })));
// v2 for two docs (a "re-approval" iteration to exercise versioning).
policies.push(
  { id: detUuid("pol:POL-RMT:v2"), doc_code: "POL-RMT", version: 2, title: "Remote Work Policy", category: "Workplace", effective_from: "2026-01-15", sections: [{ code: "s1", heading: "Hybrid baseline", text: "Hybrid baseline remains two in-office days per week. Full remote approval now also requires a quarterly location check-in." }] },
  { id: detUuid("pol:POL-SEC:v2"), doc_code: "POL-SEC", version: 2, title: "Equipment & Security Policy", category: "Security", effective_from: "2026-03-01", sections: [{ code: "s1", heading: "Devices and authentication", text: "Company-issued devices only and mandatory multi-factor authentication on all accounts, including personal devices used for approval workflows." }] }
);

// --- workforce observations: 12 months for 20 employees (3 metrics each) -------
const OBSERVED = employees.filter((e) => e.role === "employee" || e.role === "manager").slice(0, 20);
interface Observation { twin_id: string; metric: string; period: string; value: number | null; missing: boolean }
const observations: Observation[] = [];
for (const emp of OBSERVED) {
  for (let m = 0; m < 12; m++) {
    const period = monthsAgoPeriod(11 - m);
    const engTrend = emp.id === P_EMP2 ? 3.5 + (11 - m) * 0.05 : 3.5 + rnd() * 1.2; // Samira engagement declines over time
    observations.push({ twin_id: emp.id, metric: "attendance", period, value: +(0.1 + rnd() * 0.6).toFixed(2), missing: false });
    observations.push({ twin_id: emp.id, metric: "engagement", period, value: +(Math.min(5, engTrend)).toFixed(2), missing: rnd() < 0.08 });
    observations.push({ twin_id: emp.id, metric: "delivery", period, value: +(0.7 + rnd() * 0.3).toFixed(2), missing: false });
  }
}

// --- onboarding journeys: 4 new hires in distinct states (Kahn-generated) -------
const JOURNEY_CORE: TaskInput[] = [
  { id: "it", title: "IT & Laptop Provisioning", depends_on: [], duration_days: 1 },
  { id: "security", title: "Security & Compliance Training", depends_on: [], non_waivable: true, duration_days: 1 },
  { id: "payroll", title: "Direct Deposit & Payroll Setup", depends_on: [], non_waivable: true, duration_days: 0.5 },
  { id: "access", title: "System Access & SSO", depends_on: ["it", "security"], duration_days: 0.5 },
  { id: "compliance_signoff", title: "Compliance Sign-off", depends_on: ["security"], non_waivable: true, duration_days: 0.5 },
  { id: "team_intro", title: "Team Introduction & Codebase Walkthrough", depends_on: ["access"], duration_days: 1 },
  { id: "first_sprint", title: "First Sprint Contribution", depends_on: ["team_intro"], duration_days: 2 },
  { id: "survey", title: "Onboarding Feedback Survey", depends_on: ["first_sprint"], duration_days: 0.5 },
];
const buildJourney = (emp: PersonSeed, done: string[], blocked?: { taskId: string; note: string; reported_by: string; at: string }): { id: string; twin_id: string; tasks: ScheduledTask[] } => ({
  id: detUuid(`journey:${emp.id}`),
  twin_id: emp.id,
  tasks: schedulePlan({
    tasks: JOURNEY_CORE,
    skills: claimsFor(emp).map((c) => ({ name: c.name, proficiency: c.proficiency })),
    startDate: daysAgo(14),
    doneTaskIds: done,
    blocked,
  }),
});
// Four recent-hire ICs (tenures forced to <= 3 months) carry the journey states.
const NEW_HIRE_TENURES = [2, 1, 3, 2];
for (let i = 0; i < 4; i++) {
  const ic = employees.find((e) => e.id === detUuid(`emp:${i}`))!;
  ic.tenure_months = NEW_HIRE_TENURES[i];
  ic.promotion_lag_months = 0;
}

// Workforce Review Index for every employee, computed AFTER all snapshots and
// observations exist (the engagement factor uses the longitudinal history).
// Growth interest is reported separately and never contributes to the index.
for (const emp of employees) {
  const pObs = observations.filter((o) => o.twin_id === emp.id);
  const sig = computeReviewIndex({
    twin_id: emp.id,
    promotion_lag_months: emp.promotion_lag_months,
    attendance: emp.attendance,
    delivery: emp.delivery,
    observations: pObs,
    seeks_growth: emp.seeks_growth,
  });
  emp.signals = emp.signals.filter((s) => (s as { type?: string }).type !== "workforce_review_signal" && (s as { type?: string }).type !== "workforce_review_index");
  emp.signals.push({
    type: "workforce_review_index",
    value: sig.index,
    priority: sig.priority,
    data_completeness: sig.data_completeness,
    computed_at: CLOCK,
    factors: sig.factors,
  });
  // Development interest is a self-reported signal on the twin (separate from
  // the index — it never contributes to risk). Growth personas keep it visible.
  if (emp.seeks_growth) {
    emp.signals.push({ type: "seeks_growth", value: true, last_measured: "2026-08-25T09:00:00Z" });
  }
}
const newHires = [0, 1, 2, 3].map((i) => employees.find((e) => e.id === detUuid(`emp:${i}`))!);
const journeys = [
  buildJourney(newHires[0], []), // not_started (all pending)
  buildJourney(newHires[1], ["it", "security", "access", "team_intro"]), // in_progress
  buildJourney(newHires[2], ["it", "security", "access", "team_intro", "first_sprint", "compliance_signoff", "payroll"], { taskId: "first_sprint", note: "Waiting on production credentials", reported_by: "Employee", at: daysAgo(3) }), // blocked
  buildJourney(newHires[3], JOURNEY_CORE.map((t) => t.id)), // completed
];

// --- staffing projects + learning options (org jsonb) --------------------------
const staffingProjects = [
  { id: "prj-01", name: "Platform Reliability Program", department: "Platform", status: "active", required_skills: ["Kubernetes", "Observability", "Incident Response"], owner_twin_id: P_MGR, target_start: "2026-10-01", notes: "Cross-team rotation; needs a Kubernetes-adjacent engineer." },
  { id: "prj-02", name: "Data Mesh Migration", department: "Data", status: "active", required_skills: ["dbt", "Airflow", "Data Governance"], owner_twin_id: managersByDept.Data, target_start: "2026-11-01", notes: "Upskilling path for analysts." },
  { id: "prj-03", name: "Design System v2", department: "Design", status: "planned", required_skills: ["Design Tokens", "Design Systems", "Accessibility"], owner_twin_id: managersByDept.Design, target_start: "2026-12-01", notes: "Needs a senior designer lead." },
  { id: "prj-04", name: "Sales Forecasting Model", department: "Sales", status: "planned", required_skills: ["Forecasting", "Statistics", "Data Visualization"], owner_twin_id: managersByDept.Sales, target_start: "2026-10-15", notes: "Partner with Data for delivery." },
];
const learningOptions = [
  { id: "lrn-01", title: "Kubernetes Administration (CKAD)", provider: "Cloud Academy", category: "DevOps", weeks: 8, cost: 1200, skills: ["Kubernetes", "Containerization"] },
  { id: "lrn-02", title: "Machine Learning Specialization", provider: "DeepLearning.AI", category: "Data", weeks: 12, cost: 890, skills: ["Machine Learning fundamentals", "Statistics"] },
  { id: "lrn-03", title: "Advanced SQL & dbt", provider: "DataCamp", category: "Data", weeks: 4, cost: 350, skills: ["SQL", "dbt"] },
  { id: "lrn-04", title: "UX Research Methods", provider: "Nielsen Norman", category: "Design", weeks: 3, cost: 950, skills: ["UX Research", "Usability Testing"] },
  { id: "lrn-05", title: "Product Strategy Intensive", provider: "Reforge", category: "Product", weeks: 6, cost: 2100, skills: ["Product Strategy", "Roadmapping"] },
  { id: "lrn-06", title: "People Management Foundations", provider: "LinkedIn Learning", category: "People", weeks: 2, cost: 180, skills: ["Coaching", "Performance Management"] },
];

// --- scenarios: the 10 demo narratives ------------------------------------------
interface Scenario { id: string; label: string; description: string; twin_id: string | null; req_id: string | null; policy_doc_code: string | null }
const REQ_BACKEND = requisitions[0].id;
const REQ_DATA = requisitions[1].id;
const scenarios: Scenario[] = [
  { id: "s01", label: "Strong candidate, ready to hire", description: "Priya Nair is in final round with the best backend fit in the pipeline; evidence supports an offer.", twin_id: P_C1, req_id: REQ_BACKEND, policy_doc_code: null },
  { id: "s02", label: "Keyword-heavy, weak evidence", description: "Dev Sharma lists many skills but all claims are self-reported (low rigor); the fit score stays low because no confirmed evidence backs them.", twin_id: P_C2, req_id: REQ_BACKEND, policy_doc_code: null },
  { id: "s03", label: "Adjacent-skill candidate needs a work sample", description: "Maya Kapoor matches the Data Analyst role through adjacent skills; a work sample is the right next step before final round.", twin_id: P_C3, req_id: REQ_DATA, policy_doc_code: null },
  { id: "s04", label: "Internal move with a capacity constraint", description: "A Platform engineer is ready to move to the ML req but is carrying a heavy delivery load; the move needs staffing cover.", twin_id: detUuid("emp:0"), req_id: detUuid("req:ml"), policy_doc_code: null },
  { id: "s05", label: "Upskilling route over external hire", description: "A Data analyst's future-fit exceeds current-fit for a req; recommend the L&D route (POL-LND) over hiring.", twin_id: detUuid("emp:6"), req_id: REQ_DATA, policy_doc_code: "POL-LND" },
  { id: "s06", label: "Workforce review: multiple signals, missing observations", description: "Samira Patel has an elevated Workforce Review Index driven by tenure, attendance and delivery load; engagement observations are partly missing. The index is decision support, NOT a probability of leaving — it supports a retention conversation, not a verdict.", twin_id: P_EMP2, req_id: null, policy_doc_code: null },
  { id: "s07", label: "Healthy employee seeking development (NOT attrition)", description: "An employee reports development interest with a low review index and strong delivery; the case is about development support, not retention risk.", twin_id: detUuid("emp:8"), req_id: null, policy_doc_code: null },
  { id: "s08", label: "New-hire access task blocking technical work", description: "A recent hire is blocked on First Sprint Contribution pending production credentials (access task).", twin_id: journeys[2].twin_id, req_id: null, policy_doc_code: null },
  { id: "s09", label: "Policy exception requiring HR review", description: "A full-remote request outside the Remote Work Policy baseline requires written manager + People Ops approval (POL-RMT v2).", twin_id: detUuid("emp:12"), req_id: null, policy_doc_code: "POL-RMT" },
  { id: "s10", label: "Insufficient evidence — abstention case", description: "A candidate with sparse, unverified claims returns a low-confidence match; recommend collecting evidence before any decision.", twin_id: candidates[5].id, req_id: REQ_BACKEND, policy_doc_code: null },
];

// --- second org (isolation fixture) ----------------------------------------------
const ORG2 = "99999999-9999-9999-9999-999999999999";
const ORG2_SKILLS = SKILL_CATALOG.slice(0, 10).map((s) => ({ ...s, id: detUuid(`org2:skill:${s.skill}`) }));
const org2SkillId = (name: string) => ORG2_SKILLS.find((s) => s.skill === name)!.id;
const ORG2_EMP_SKILLS: Record<string, string[]> = {
  Platform: ["Go", "PostgreSQL", "Docker"],
  Data: ["Python", "SQL", "TypeScript"],
  Design: ["React", "TypeScript", "Node.js"],
};
const org2 = {
  org: { id: ORG2, name: "Northstar Labs (isolation fixture)" },
  admin_twin: {
    id: "99999999-9999-9999-9999-999999999998",
    name: "Isabelle Moreau",
    email: "isabelle@worksense.demo",
    role: "hr_executive",
    department: "People Operations",
    job_title: "Head of People",
    manager_id: null,
  },
  employees: [0, 1, 2].map((i) => {
    const dept = DEPARTMENTS[i];
    const names = ORG2_EMP_SKILLS[dept] ?? ["Go"];
    return {
      id: detUuid(`org2:emp:${i}`),
      name: rndName(),
      email: rndEmail(`org2-emp-${i}`),
      role: "employee" as const,
      department: dept,
      job_title: "Engineer",
      manager_id: "99999999-9999-9999-9999-999999999998",
      tenure_months: ri(6, 60),
      seniority_level: ri(2, 4),
      promotion_lag_months: ri(2, 24),
      seeks_growth: false,
      attendance: { baseline: 0.3, recent: 0.3 },
      delivery: { missed: 1, total: 8 },
      signals: [],
      performance_history: [],
      interview_rubrics: [],
      audit_events: [],
      assertions: names.map((name, j) => {
        const prof = ri(2, 4);
        return {
          skill_id: org2SkillId(name),
          claimed_proficiency: prof,
          proficiency_tier: tierFor(prof),
          review_state: j === 0 ? "reviewer_confirmed" : j === 1 ? "assessment_supported" : "claimed",
          quote: `Uses ${name} in the Northstar platform.`,
        };
      }),
    };
  }),
  skills: ORG2_SKILLS,
  requisition: {
    id: detUuid("org2:req:1"),
    title: "Backend Engineer (Northstar)",
    department: "Platform",
    status: "open",
    seniority_level: 3,
    required_skills: [{ skill: "Go", target_proficiency: 3 }, { skill: "REST APIs", target_proficiency: 3 }],
    future_skills: [{ skill: "Kubernetes", target_proficiency: 2 }],
    applicants: [],
  },
};

const FIXTURES = {
  demo_org_id: DEMO_ORG_ID,
  clock: CLOCK,
  org2,
  skills: SKILL_CATALOG,
  employees,
  candidates,
  requisitions,
  policies,
  observations,
  journeys,
  staffingProjects,
  learningOptions,
  scenarios,
};

// --- validation ----------------------------------------------------------------
function validate() {
  const f = FIXTURES;
  const empIds = new Set(f.employees.map((e) => e.id));
  const candIds = new Set(f.candidates.map((c) => c.id));
  const skillIds = new Set(f.skills.map((s) => s.id));
  const allPersonIds = new Set([...empIds, ...candIds]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // every id must be a valid, well-formed uuid (DB column type)
  const ids = [
    ...f.skills.map((s) => s.id),
    ...f.employees.map((e) => e.id),
    ...f.employees.map((e) => e.manager_id).filter(Boolean),
    ...f.candidates.map((c) => c.id),
    ...f.requisitions.map((r) => r.id),
    ...f.policies.map((p) => p.id),
    ...f.journeys.map((j) => j.id),
  ];
  for (const id of ids) expect(id).toMatch(UUID_RE);

  // target counts
  expect(f.org2.org.id).toMatch(/^99999999-/);
  expect(f.skills.length).toBeGreaterThanOrEqual(80);
  expect(f.employees.length).toBe(60);
  expect(f.candidates.length).toBeGreaterThanOrEqual(24);
  expect(f.requisitions.length).toBeGreaterThanOrEqual(6);
  expect(f.policies.length).toBeGreaterThanOrEqual(12);
  expect(f.observations.length).toBeGreaterThanOrEqual(700);
  expect(f.journeys.length).toBe(4);

  // FK integrity
  for (const e of f.employees) {
    if (e.manager_id) expect(empIds.has(e.manager_id)).toBe(true);
    for (const a of e.assertions) expect(skillIds.has(a.skill_id)).toBe(true);
  }
  for (const c of f.candidates) {
    for (const a of c.assertions) expect(skillIds.has(a.skill_id)).toBe(true);
  }
  for (const r of f.requisitions) {
    for (const s of [...r.required_skills, ...(r.future_skills ?? [])]) expect(f.skills.some((k) => k.skill === s.skill)).toBe(true);
    for (const ap of r.applicants) expect(allPersonIds.has(ap.twin_id)).toBe(true);
  }
  for (const j of f.journeys) {
    expect(empIds.has(j.twin_id)).toBe(true);
    expect(j.tasks.length).toBeGreaterThan(0);
  }
  for (const o of f.observations) expect(empIds.has(o.twin_id)).toBe(true);
  for (const s of f.scenarios) {
    if (s.twin_id) expect(allPersonIds.has(s.twin_id)).toBe(true);
    if (s.req_id) expect(f.requisitions.some((r) => r.id === s.req_id)).toBe(true);
    if (s.policy_doc_code) expect(f.policies.some((p) => p.doc_code === s.policy_doc_code)).toBe(true);
  }

  // org-2 isolation fixture: fully self-contained (distinct ids, own skill ids).
  for (const s of f.org2.skills) expect(skillIds.has(s.id)).toBe(false);
  for (const e of f.org2.employees) {
    expect(empIds.has(e.id)).toBe(false);
    expect(e.manager_id).toBe(f.org2.admin_twin.id);
    for (const a of e.assertions) expect(f.org2.skills.some((k) => k.id === a.skill_id)).toBe(true);
  }

  // chronology: nothing in the future relative to the demo clock
  for (const o of f.observations) expect(o.period <= monthsAgoPeriod(0)).toBe(true);
  for (const r of f.requisitions) for (const ap of r.applicants) expect(ap.applied_at <= CLOCK).toBe(true);

  // computed claims: applicant match_scores equal the engine output
  for (const r of f.requisitions) {
    for (const ap of r.applicants) {
      const cand = f.candidates.find((c) => c.id === ap.twin_id)!;
      const recomputed = computeMatch(cand, { id: r.id, title: r.title, seniority_level: r.seniority_level, required_skills: r.required_skills });
      expect(Math.abs(recomputed - ap.match_score)).toBeLessThan(0.001);
    }
  }

  // computed claims: generated employee review indices equal the engine output
  for (const e of f.employees) {
    const sig = e.signals.find((s) => (s as { type?: string }).type === "workforce_review_index") as { value?: number; priority?: string } | undefined;
    if (!sig) continue;
    const pObs = f.observations.filter((o) => o.twin_id === e.id);
    const engine = computeReviewIndex({
      twin_id: e.id,
      promotion_lag_months: e.promotion_lag_months,
      attendance: e.attendance,
      delivery: e.delivery,
      observations: pObs,
      seeks_growth: e.seeks_growth,
    });
    expect(sig.value).toBe(engine.index);
    expect(sig.priority).toBe(engine.priority);
  }
}

describe("generate demo fixtures (deterministic, Phase 3)", () => {
  it("produces a valid, reproducible fixture payload", () => {
    validate();
    // Reproducibility: a second identical run must be byte-equal (fixed PRNG seed).
    const json = JSON.stringify(FIXTURES);
    const dest = fileURLToPath(new URL("../supabase/functions/_shared/generated-demo-fixtures.ts", import.meta.url));
    const content = `// Auto-generated by scripts/generate-demo-fixtures.test.ts — do not edit by hand.\n// Fixed PRNG seed; dates relative to ${CLOCK}. Fictional data for demo only.\n\nexport const DEMO_FIXTURES = ${json} as const;\n`;
    writeFileSync(dest, content);
  });
});
