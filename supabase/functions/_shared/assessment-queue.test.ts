import { describe, expect, it } from "vitest";
import { buildAssessmentQueue, type AssessmentQueueInput } from "./assessment-queue";

const org = "11111111-1111-1111-1111-111111111111";
const clock = "2026-09-18T09:00:00Z";

function base(): AssessmentQueueInput {
  return {
    orgId: org,
    clock,
    sessions: [],
    applications: [],
    blueprints: [],
    twins: [],
    requisitions: [],
    assessments: [],
    jobs: [],
  };
}

const twin = { id: "22222222-2222-2222-2222-222222222205", name: "Priya Rana", email: "priya@worksense.demo" };
const app = {
  id: "a1",
  application_code: "WS-2026-0001",
  requisition_id: "r1",
  candidate_twin_id: twin.id,
  org_id: org,
};
const bp = { id: "b1", artifact_spec: { title: "People Ops Work Sample", kind: "work_sample" } };
const bpInterview = { id: "b2", artifact_spec: { title: "People Ops Interview", kind: "interview" } };
const req = { id: "r1", title: "People Operations Lead" };

describe("assessment queue — session categories", () => {
  it("routes sessions into the right queues by status and type", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bp, bpInterview],
      requisitions: [req],
      sessions: [
        { id: "s1", session_type: "interview", status: "invited", expires_at: "2026-09-20T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b2" },
        { id: "s2", session_type: "work_sample", status: "submitted", expires_at: "2026-09-19T09:00:00Z", submitted_at: "2026-09-18T08:00:00Z", created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" },
        { id: "s3", session_type: "knowledge_assessment", status: "in_progress", expires_at: "2026-09-21T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" },
        { id: "s4", session_type: "work_sample", status: "expired", expires_at: "2026-09-10T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" },
      ],
    });
    // 5.2 upcoming interviews: only open interview sessions.
    expect(q.queues.upcoming_interviews.map((s) => s.session_id)).toEqual(["s1"]);
    // 5.2 invitations awaiting response: invited only.
    expect(q.queues.invitations_awaiting_response.map((s) => s.session_id)).toEqual(["s1"]);
    // 5.2 incomplete scorecards: submitted with no evaluation yet.
    expect(q.queues.incomplete_scorecards.map((s) => s.session_id)).toEqual(["s2"]);
    expect(q.queues.submitted_assessments.map((s) => s.session_id)).toEqual(["s2"]);
    // Every item is linked to candidate / application / role.
    const item = q.queues.incomplete_scorecards[0];
    expect(item.candidate.name).toBe("Priya Rana");
    expect(item.role.title).toBe("People Operations Lead");
    expect(item.role.application_code).toBe("WS-2026-0001");
    expect(item.blueprint_title).toBe("People Ops Work Sample");
  });

  it("a submitted session with an evaluation leaves the incomplete scorecards queue", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bp],
      requisitions: [req],
      sessions: [{ id: "s2", session_type: "work_sample", status: "submitted", expires_at: "2026-09-19T09:00:00Z", submitted_at: "2026-09-18T08:00:00Z", created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" }],
      assessments: [{ id: "as1", twin_id: twin.id, requisition_id: "r1", type: "work_sample", created_at: "2026-09-18T08:30:00Z", reviewed_at: null, result: { session_id: "s2", blueprint_title: "People Ops Work Sample" } }],
    });
    expect(q.queues.incomplete_scorecards).toHaveLength(0);
    expect(q.queues.submitted_assessments.map((s) => s.session_id)).toEqual(["s2"]);
  });

  it("sorts upcoming interviews by soonest expiry first", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bpInterview],
      requisitions: [req],
      sessions: [
        { id: "late", session_type: "interview", status: "invited", expires_at: "2026-09-25T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b2" },
        { id: "soon", session_type: "interview", status: "in_progress", expires_at: "2026-09-19T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b2" },
      ],
    });
    expect(q.queues.upcoming_interviews.map((s) => s.session_id)).toEqual(["soon", "late"]);
  });

  it("does not count closed or non-interview sessions as upcoming interviews", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bp, bpInterview],
      requisitions: [req],
      sessions: [
        { id: "x1", session_type: "interview", status: "submitted", expires_at: "2026-09-20T09:00:00Z", submitted_at: "2026-09-18T08:00:00Z", created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b2" },
        { id: "x2", session_type: "work_sample", status: "invited", expires_at: "2026-09-20T09:00:00Z", submitted_at: null, created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" },
      ],
    });
    expect(q.queues.upcoming_interviews).toHaveLength(0);
  });
});

describe("assessment queue — evaluations awaiting review and failed jobs", () => {
  it("lists unreviewed model evaluations with candidate/role linkage", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bp],
      requisitions: [req],
      sessions: [{ id: "s2", session_type: "work_sample", status: "submitted", expires_at: "2026-09-19T09:00:00Z", submitted_at: "2026-09-18T08:00:00Z", created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" }],
      assessments: [
        { id: "as1", twin_id: twin.id, requisition_id: "r1", type: "work_sample", created_at: "2026-09-18T08:30:00Z", reviewed_at: null, result: { session_id: "s2", blueprint_title: "People Ops Work Sample", review_required: true, ai: { model: "qwen-plus", evaluated_at: "2026-09-18T08:31:00Z" } } },
        { id: "as2", twin_id: twin.id, requisition_id: "r1", type: "interview", created_at: "2026-09-18T09:00:00Z", reviewed_at: "2026-09-18T09:30:00Z", result: { session_id: null } },
      ],
    });
    expect(q.queues.awaiting_reviewer_confirmation).toHaveLength(1);
    const [item] = q.queues.awaiting_reviewer_confirmation;
    expect(item.assessment_id).toBe("as1");
    expect(item.review_required).toBe(true);
    expect(item.session_id).toBe("s2");
    expect(item.candidate.name).toBe("Priya Rana");
    expect(item.role.title).toBe("People Operations Lead");
  });

  it("surfaces failed evaluation jobs and links them to their session when recorded", () => {
    const q = buildAssessmentQueue({
      ...base(),
      twins: [twin],
      applications: [app],
      blueprints: [bp],
      requisitions: [req],
      sessions: [{ id: "s2", session_type: "work_sample", status: "submitted", expires_at: "2026-09-19T09:00:00Z", submitted_at: "2026-09-18T08:00:00Z", created_at: "2026-09-17T09:00:00Z", application_id: "a1", blueprint_id: "b1" }],
      jobs: [
        { id: "j1", task: "assessment_evaluation", status: "failed", error_code: "MODEL_UNAVAILABLE", error_message: "upstream timeout", created_at: "2026-09-18T08:40:00Z", finished_at: "2026-09-18T08:40:30Z", output: { session_id: "s2" } },
        { id: "j2", task: "assessment_evaluation", status: "succeeded", error_code: null, error_message: null, created_at: "2026-09-18T08:00:00Z", finished_at: "2026-09-18T08:00:30Z", output: { assessment_id: "as1" } },
        { id: "j3", task: "assessment_evaluation", status: "failed", error_code: "INTERNAL", error_message: "boom", created_at: "2026-09-18T07:00:00Z", finished_at: null, output: null },
      ],
    });
    expect(q.queues.failed_evaluation_jobs).toHaveLength(2);
    expect(q.queues.failed_evaluation_jobs[0].job_id).toBe("j1"); // newest finished first
    expect(q.queues.failed_evaluation_jobs[0].session?.candidate.name).toBe("Priya Rana");
    expect(q.queues.failed_evaluation_jobs[1].job_id).toBe("j3");
    // Unlinked job still surfaced, honestly without a session link.
    expect(q.queues.failed_evaluation_jobs[1].session).toBeNull();
  });

  it("never invents rows: empty input yields empty queues, not fabrications", () => {
    const q = buildAssessmentQueue(base());
    expect(q.queues.upcoming_interviews).toHaveLength(0);
    expect(q.queues.invitations_awaiting_response).toHaveLength(0);
    expect(q.queues.incomplete_scorecards).toHaveLength(0);
    expect(q.queues.submitted_assessments).toHaveLength(0);
    expect(q.queues.awaiting_reviewer_confirmation).toHaveLength(0);
    expect(q.queues.failed_evaluation_jobs).toHaveLength(0);
    expect(q.scope.org_id).toBe(org);
    expect(q.generated_at).toBe(clock);
  });
});
