// ---------------------------------------------------------------------------
// Phase 7 policy seed — deterministic additions on top of the fixture corpus:
//  - POL-LVE v2 (current Leave & Time Off) that SUPERSEDES the fixture v1,
//  - POL-CAT v1 (Catering Reimbursement) that is EXPIRED (out of date window),
//  - POL-RMT-EU (EU Remote-First Exception) scoped to EU locations only,
//  - employee work_location / worker_type overrides for context resolution.
// Text is authored (never generated); the leave engine constants in
// leave-calc.ts match POL-LVE v2 exactly.
// ---------------------------------------------------------------------------

export const POLICY_ADDITIONS = [
  {
    id: "aaaaaaa1-1111-1111-1111-111111111111",
    doc_code: "POL-LVE",
    version: 2,
    title: "Leave & Time Off Policy",
    category: "Benefits",
    effective_from: "2026-01-01",
    effective_to: null,
    applicable_locations: ["All"],
    applicable_worker_types: ["All"],
    supersedes_doc_id: null, // set at insert time to the seeded v1 row
    sections: [
      {
        code: "s1",
        heading: "Accrual and notice",
        text: "Employees accrue 24 days of paid annual leave per year, credited monthly at two days per full month of service. Leave requests of ten or more consecutive days must be submitted at least four weeks in advance and require manager approval.",
      },
      {
        code: "s2",
        heading: "Carryover and public holidays",
        text: "Unused leave carries over up to three days into the following leave year. Emergency leave does not require advance notice but must be logged on the first working day. Public holidays observed at the employee's applicable work location do not reduce the annual leave balance.",
      },
      {
        code: "s3",
        heading: "Leave year and mid-year joins",
        text: "The leave year runs from 1 January to 31 December. Employees who join part-way through the leave year accrue for the months they are employed during that year, credited at two days per full month. Unused accrued leave at year-end carries over up to three days.",
      },
    ],
  },
  {
    id: "aaaaaaa1-1111-1111-1111-111111111112",
    doc_code: "POL-CAT",
    version: 1,
    title: "Catering Reimbursement Policy",
    category: "Workplace",
    effective_from: "2024-01-01",
    effective_to: "2024-12-31",
    applicable_locations: ["All"],
    applicable_worker_types: ["All"],
    supersedes_doc_id: null,
    sections: [
      {
        code: "s1",
        heading: "Coverage",
        text: "The organisation reimburses up to 150 per month for in-office catering expenses during approved events.",
      },
    ],
  },
  {
    id: "aaaaaaa1-1111-1111-1111-111111111113",
    doc_code: "POL-RMT-EU",
    version: 1,
    title: "EU Remote-First Exception",
    category: "Workplace",
    effective_from: "2026-02-01",
    effective_to: null,
    applicable_locations: ["EU"],
    applicable_worker_types: ["All"],
    supersedes_doc_id: null,
    sections: [
      {
        code: "s1",
        heading: "Remote-first exception",
        text: "Employees whose applicable work location is in the EU may work remotely up to four days per week without individual approval, subject to their team's hybrid baseline.",
      },
    ],
  },
];

/** Static employee context overrides applied by reset-demo (fixtures untouched). */
export const TWIN_CONTEXT_OVERRIDES: Record<string, { work_location: string; worker_type: string }> = {
  "dana@worksense.demo": { work_location: "US", worker_type: "full_time" },
  "riley@worksense.demo": { work_location: "US", worker_type: "full_time" },
  "jordan@worksense.demo": { work_location: "US", worker_type: "full_time" },
  "chris@worksense.demo": { work_location: "US", worker_type: "full_time" },
  "alex@worksense.demo": { work_location: "US", worker_type: "full_time" },
  "sam@worksense.demo": { work_location: "US", worker_type: "full_time" },
};

/** Public holidays used by the leave-calc holiday test/demo (US, 2026/2027). */
export const US_PUBLIC_HOLIDAYS_2026 = ["2026-01-01", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25", "2027-01-01"];
