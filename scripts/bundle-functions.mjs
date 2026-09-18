// Bundles each backend function's index.ts with its shared dependencies inlined.
// The Enter Cloud deploy pipeline stages only supabase/functions/<fn>/index.ts,
// so sibling _shared/ modules cannot be imported at runtime.
// Edit supabase/functions/_shared/* and <fn>/source.ts, then run:
//   node scripts/bundle-functions.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(`${root}${p}`, "utf8");
const write = (p, c) => writeFileSync(`${root}${p}`, c);

// Shared modules only ever import from other shared modules — drop all imports.
const stripAllImports = (src) => src.replace(/^import .*;$/gm, "");
// Function bodies import only from ../_shared/ — drop those, keep esm.sh etc.
// Handles single-line AND multi-line named imports (a multi-line import would
// otherwise survive and break the bundle at deploy time).
const stripSharedImports = (src) =>
  src
    .replace(/import\s*\{[^}]*\}\s*from\s*"\.\.\/_shared\/[^"]+";/gs, "")
    .replace(/^import .* from "\.\.\/_shared\/.*";$/gm, "");

const engine = stripAllImports(read("supabase/functions/_shared/skill-graph-engine.ts"));
const onboarding = stripAllImports(read("supabase/functions/_shared/onboarding-engine.ts"));
const onboardingV2 = stripAllImports(read("supabase/functions/_shared/onboarding-v2.ts"));
const qwen = stripAllImports(read("supabase/functions/_shared/qwen.ts"));
const policy = stripAllImports(read("supabase/functions/_shared/policy-retrieval.ts"));
const reviewIndex = stripAllImports(read("supabase/functions/_shared/workforce-review-index.ts"));
const myWorkEngine = stripAllImports(read("supabase/functions/_shared/my-work-engine.ts"));
const performance = stripAllImports(read("supabase/functions/_shared/performance-intelligence.ts"));
const recEngine = stripAllImports(read("supabase/functions/_shared/recommendation-engine.ts"));
const workflow = stripAllImports(read("supabase/functions/_shared/workflow-engine.ts"));
const jobs = stripAllImports(read("supabase/functions/_shared/jobs.ts"));
const validate = stripAllImports(read("supabase/functions/_shared/validate.ts"));
const evidence = stripAllImports(read("supabase/functions/_shared/evidence.ts"));
const resume = stripAllImports(read("supabase/functions/_shared/resume.ts"));
const generated = stripAllImports(read("supabase/functions/_shared/generated-seed-fits.ts"));
const journey = stripAllImports(read("supabase/functions/_shared/generated-seed-journey.ts"));
const fixtures = stripAllImports(read("supabase/functions/_shared/generated-demo-fixtures.ts"));
const seed = stripAllImports(read("supabase/functions/_shared/seed-data.ts"));
const stageEngine = stripAllImports(read("supabase/functions/_shared/stage-engine.ts"));
const assessment = stripAllImports(read("supabase/functions/_shared/assessment.ts"));
const candidateCompare = stripAllImports(read("supabase/functions/_shared/candidate-compare.ts"));
const onboardingQueue = stripAllImports(read("supabase/functions/_shared/onboarding-queue.ts"));
const pcontext = stripAllImports(read("supabase/functions/_shared/policy-context.ts"));
const leave = stripAllImports(read("supabase/functions/_shared/leave-calc.ts"));
const llmcache = stripAllImports(read("supabase/functions/_shared/llm-cache.ts"));
const policyseed = stripAllImports(read("supabase/functions/_shared/policy-seed.ts"));

const planner = stripAllImports(read("supabase/functions/_shared/staffing-planner.ts"));
const SHARED = { planner, engine, onboarding, onboardingV2, qwen, policy, reviewIndex, performance, recEngine, workflow, jobs, validate, evidence, resume, generated, journey, fixtures, seed, stageEngine, assessment, pcontext, leave, policyseed, llmcache, myWorkEngine, candidateCompare, onboardingQueue };

// Function -> shared dependencies (in import order) it needs inlined.
const FNS = {
  "reset-demo": ["generated", "journey", "seed", "fixtures", "assessment", "policyseed", "onboardingV2", "reviewIndex", "engine"],
  "skill-match": ["engine", "evidence"],
  "extract-resume": ["engine", "qwen", "jobs", "validate", "evidence", "llmcache"],
  "rubric": ["qwen", "validate"],
  "interview-kit": ["engine", "qwen", "jobs", "validate"],
  "evaluate-interview": ["qwen", "validate"],
  "recruiter-decision": ["engine"],
  "requisition": [],
  "onboarding-plan": ["engine", "onboardingV2"],
  "onboarding-approve": [],
  "onboarding-task": ["onboardingV2"],
  "policy-qa": ["qwen", "policy", "validate", "pcontext", "leave", "policyseed", "llmcache"],
  "escalate": [],
  "workforce-signal": ["reviewIndex"],
  "workforce-review-index": ["reviewIndex"],
  "workforce-review-action": [],
  "performance-summary": ["performance", "qwen"],
  "performance-draft": [],
  "performance-synthesis": ["qwen", "validate"],
  "recommendation-review": ["workflow"],
  "recommendation-execute": ["workflow"],
  "action-task-update": ["workflow"],
  "recommendation-scan": ["engine", "recEngine", "reviewIndex", "workflow", "qwen", "validate"],
  "dashboard": ["engine", "reviewIndex"],
  "my-work": ["reviewIndex", "myWorkEngine"],
  "staffing-comparison": ["planner", "qwen"],
  "admin-access": [],
  "model-job": ["jobs"],
  "health": ["qwen"],
  "resume-import": ["qwen", "jobs", "validate", "resume"],
  "resume-review": ["engine", "evidence", "resume"],
  "resume-download": [],
  "assessment-blueprint": ["assessment"],
  "assessment-session": ["jobs"],
  "assessment-evaluate": ["qwen", "jobs", "validate", "assessment"],
  "assessment-review": ["engine", "evidence", "assessment"],
  "application-stage": ["engine", "stageEngine"],
  "candidate-compare": ["candidateCompare"],
  "onboarding-queue": ["onboardingQueue"],
};

const header = `// GENERATED by scripts/bundle-functions.mjs — do not edit by hand.
// Edit supabase/functions/_shared/* and <fn>/source.ts, then re-run the bundler.

`;

for (const [name, deps] of Object.entries(FNS)) {
  const body = stripSharedImports(read(`supabase/functions/${name}/source.ts`));
  const parts = deps.map((d) => SHARED[d]);
  const out = `${header}${[...parts, body].join("\n\n")}`;
  write(`supabase/functions/${name}/index.ts`, out);
  console.log(`bundled ${name} (${deps.join(", ") || "no shared deps"})`);
}
