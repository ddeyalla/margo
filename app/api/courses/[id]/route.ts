import { updateCourses } from "@/lib/server/courses/store";

/** Removes a Course. Its books, cards and quiz results stay; the planning chat stays too, free to approve again. */
export async function DELETE(_request: Request, { params }: RouteContext<"/api/courses/[id]">) {
  const { id } = await params;
  let found = false;
  await updateCourses((current) => {
    found = current.courses.some((course) => course.id === id);
    return {
      courses: current.courses.filter((course) => course.id !== id),
      plans: current.plans.map((plan) => (plan.courseId === id ? { ...plan, courseId: null } : plan)),
    };
  });
  return found ? new Response(null, { status: 204 }) : Response.json({ error: "No such course." }, { status: 404 });
}
