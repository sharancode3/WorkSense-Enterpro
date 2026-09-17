// ---------------------------------------------------------------------------
// Phase 13 — Schema/contract validation (automated layer 2).
// Static invariants that keep the security model honest: every table has RLS
// enabled, policies are org/team scoped, client-facing RPCs are revoked, the
// idempotency constraint exists, and the generated types agree with the
// migrations. These run in `pnpm check` alongside the engine unit tests.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const TYPES_PATH = join(__dirname, "..", "src", "integrations", "supabase", "types.ts");

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^migration_/.test(f))
  .sort();
const migrationsSql = migrationFiles.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
const allSql = migrationsSql.join("\n;\n");
const typesTs = readFileSync(TYPES_PATH, "utf8");

/** Every create table must later have RLS enabled (same or subsequent file). */
function rlsCoveredTables(): { missing: string[]; tables: string[] } {
  const tables: string[] = [];
  const missing: string[] = [];
  for (let i = 0; i < migrationsSql.length; i++) {
    const re = /create table\s+(?:public\.)?([a-z_0-9]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(migrationsSql[i]))) {
      const name = m[1];
      if (tables.includes(name)) continue;
      tables.push(name);
      const later = migrationsSql.slice(i).join("\n;\n");
      if (!new RegExp(`enable\\s+row\\s+level\\s+security`, "i").test(later) ||
          !new RegExp(`alter\\s+table\\s+(?:public\\.)?${name}\\s+enable\\s+row\\s+level\\s+security`, "i").test(later)) {
        missing.push(name);
      }
    }
  }
  return { missing, tables };
}

describe("Phase 13 contract: every table ships with RLS enabled", () => {
  const { missing, tables } = rlsCoveredTables();
  it("discovers tables in migrations", () => {
    expect(tables.length).toBeGreaterThanOrEqual(20);
  });
  it("every created table has RLS enabled in the same or a later migration", () => {
    expect(missing).toEqual([]);
  });
});

describe("Phase 13 contract: client write surface is revoked", () => {
  it("convert_candidate_to_employee is revoked from public, anon, authenticated", () => {
    const idx = allSql.search(/revoke execute on function public\.convert_candidate_to_employee/);
    expect(idx).toBeGreaterThan(-1);
    const tail = allSql.slice(idx, idx + 400);
    expect(tail).toMatch(/from\s+public,\s*anon,\s*authenticated/);
  });
  it("workflow transition RPCs are revoked from clients", () => {
    expect(allSql).toMatch(/revoke all on function public\.workflow_recommendation_transition/);
    expect(allSql).toMatch(/revoke all on function public\.workflow_action_task_transition/);
  });
});

describe("Phase 13 contract: digital_twins read policies are scoped", () => {
  it("has a self/HR/team select policy and an HR-only write policy", () => {
    expect(allSql).toMatch(/create policy twin_select on public\.digital_twins/);
    expect(allSql).toMatch(/public\.is_team_member\(id\)/);
    expect(allSql).toMatch(/create policy twin_write on public\.digital_twins for all using \(\s*\(select role from public\.current_twin\(\)\) = 'hr_executive'/);
  });
});

describe("Phase 13 contract: client writes never bypass the workflow state machine", () => {
  // The app writes recommendations/onboarding exclusively through backend
  // functions or revoked transition RPCs. A manager must not be able to PATCH
  // team rows directly (Phase 13 hardening removed the is_team_member write
  // branch — re-add and this test fails, guarding the regression). Migrations
  // may recreate a policy; the LAST definition in file order is authoritative.
  const lastPolicy = (pattern: RegExp) => {
    const all = [...allSql.matchAll(pattern)];
    return all.length ? all[all.length - 1][0] : "";
  };
  it("rec_write is hr_executive-only (no is_team_member write branch)", () => {
    const policy = lastPolicy(/create policy rec_write on public\.recommendations[\s\S]*?with check \([\s\S]*?\);/gi);
    expect(policy).toMatch(/'hr_executive'/);
    expect(policy).not.toMatch(/is_team_member/);
  });
  it("onboarding_write is hr_executive-only (no is_team_member write branch)", () => {
    const policy = lastPolicy(/create policy onboarding_write on public\.onboarding_journeys[\s\S]*?with check \([\s\S]*?\);/gi);
    expect(policy).toMatch(/'hr_executive'/);
    expect(policy).not.toMatch(/is_team_member/);
  });
});

describe("Phase 13 contract: requisition lifecycle (Phase 12)", () => {
  it("adds job_requisitions.status with a 4-value check", () => {
    const mig = allSql.match(/add column status text not null default 'open'[\s\S]{0,120}check \(status in \('open', 'on_hold', 'filled', 'closed'\)\)/);
    expect(mig).not.toBeNull();
  });
  it("generated types reflect job_requisitions.status", () => {
    const block = typesTs.match(/job_requisitions: \{[\s\S]*?\n\s{8}\}/)?.[0] ?? "";
    expect(block).toMatch(/status: string/);
  });
});

describe("Phase 13 contract: idempotency + regression traps", () => {
  it("workflow_events enforces UNIQUE(resource_type, resource_id, request_id)", () => {
    expect(allSql).toMatch(/unique\s*\(resource_type,\s*resource_id,\s*request_id\)/i);
  });
  it("applications uses candidate_twin_id (regression trap)", () => {
    const create = allSql.match(/create table (?:public\.)?applications \([\s\S]*?\);/i)?.[0] ?? "";
    expect(create).toMatch(/candidate_twin_id\s+uuid/);
  });
  it("action_tasks ships updated_at for staleness tracking", () => {
    expect(allSql).toMatch(/alter table (?:public\.)?action_tasks add column updated_at/);
  });
});

describe("Phase 13 contract: candidate data stays behind the candidate-status function", () => {
  it("no public policy grants candidates access to scores/rubrics tables", () => {
    // assessments / assessment_rubrics must not have a broad anon-write policy.
    for (const tbl of ["assessments", "assessment_rubrics", "candidate_sessions"]) {
      const re = new RegExp(`create policy \\w+ on public\\.${tbl} for all`, "i");
      expect(re.test(allSql), `${tbl} must not have a broad write policy`).toBe(false);
    }
  });
});
