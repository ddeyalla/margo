import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/lib/shared/types";

describe("tidyTitle", () => {
  it("drops the empty buyer's-name stamp some publishers leave in the title", () => {
    expect(tidyTitle("Build a Large Language Model (From Scratch) (for )")).toBe("Build a Large Language Model (From Scratch)");
    expect(tidyTitle("Thing ()")).toBe("Thing");
    expect(tidyTitle("Build a Large Language Model (From Scratch) (for \u200b \u200b)")).toBe("Build a Large Language Model (From Scratch)");
  });

  it("keeps brackets that say something, and never empties a title", () => {
    expect(tidyTitle("Fine-Tuning AI (for Raymond Rhine)")).toBe("Fine-Tuning AI (for Raymond Rhine)");
    expect(tidyTitle("()")).toBe("()");
  });
});
