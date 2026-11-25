import { randomUUID } from "node:crypto";
import { updateCourses } from "@/lib/server/courses/store";
import { readObject } from "@/lib/server/with-book";
import type { Course } from "@/lib/shared/courses";

/**
 * Approves a planning chat's latest roadmap: `{ planId }`. The first approval creates the Course; approving the
 * same chat again after more edits updates that Course in place, keeping its id. Answers with the Course.
 */
export async function POST(request: Request) {
  const body = await readObject(request);
  const planId = typeof body?.planId === "string" ? body.planId : null;
  if (!planId) return Response.json({ error: "Expected { planId }." }, { status: 400 });
  let course: Course | null = null;
  let problem = "That planning chat is gone.";
  await updateCourses((current) => {
    const plan = current.plans.find((p) => p.id === planId);
    if (!plan) return current;
    const roadmap = plan.messages.findLast((message) => message.role === "assistant" && message.roadmap)?.roadmap;
    if (!roadmap) {
      problem = "The chat has no roadmap to approve yet.";
      return current;
    }
    const now = new Date().toISOString();
    const existing = plan.courseId ? current.courses.find((c) => c.id === plan.courseId) : undefined;
    course = existing ? { ...existing, ...roadmap, updatedAt: now } : { ...roadmap, id: randomUUID(), planId, createdAt: now, updatedAt: now };
    const made = course;
    return {
      courses: existing ? current.courses.map((c) => (c === existing ? made : c)) : [...current.courses, made],
      plans: current.plans.map((p) => (p === plan ? { ...p, courseId: made.id } : p)),
    };
  });
  return course ? Response.json({ course }) : Response.json({ error: problem }, { status: 409 });
}
