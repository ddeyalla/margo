import { Suspense } from "react";
import { connection } from "next/server";
import { PageShell } from "@/components/courses/PageShell";
import { PlanChat } from "@/components/courses/PlanChat";
import { Spinner } from "@/components/ui";
import { readCourses } from "@/lib/server/courses/store";
import { readSettings } from "@/lib/server/settings";

/** The home chat that plans a Course. `?q=` starts it with that message; `?id=` reopens a chat. */
export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <PageShell>
      <h1 className="mb-6 text-display text-paper">Plan a course</h1>
      <Suspense fallback={<Spinner />}>
        <Plan searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Plan({ searchParams }: Pick<PageProps<"/plan">, "searchParams">) {
  await connection();
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const id = one(params.id);
  const [{ plans }, settings] = await Promise.all([readCourses(), readSettings()]);
  const plan = id ? (plans.find((p) => p.id === id) ?? null) : null;
  return <PlanChat initialPlan={plan} firstMessage={plan ? null : one(params.q)} provider={settings.provider} models={settings.models} />;
}
