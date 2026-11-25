"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

/** Removes the Course after a second click. Its books, cards and notes are untouched. */
export function DeleteCourse({ id }: { id: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    const response = await fetch(`/api/courses/${id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) router.push("/");
    else setError("The course could not be removed.");
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="ghost" onClick={() => (armed ? void remove() : setArmed(true))} onBlur={() => setArmed(false)}>
        <Trash2 />
        {armed ? "Click again to remove" : "Remove course"}
      </Button>
      {error ? <span className="text-label text-danger">{error}</span> : null}
    </span>
  );
}
