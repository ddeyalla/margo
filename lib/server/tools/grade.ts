import { gradeAnswer, MAX_POINTS, rubricPoints } from "../check/grade";
import { ToolError } from "./schema";
import { defineTool } from "./tool";
import { PASSAGE_FIELD, PROVIDER_FIELD, requireChecker } from "./verify";

/* The other tool that asks a model. It grades and returns; nothing is stored and no schedule moves. */

export const gradeAnswerTool = defineTool({
  name: "grade_answer",
  description:
    'Grades the reader\'s free-text answer to a study question against the passage, in a call separate from the tutor. What counts as right is fixed first, from the expected answer and the passage, before the answer is read; the answer is then marked point by point. Returns a score from 0 to 1, a verdict (right, partly, wrong), a confidence, and the first gap with the stretch of the passage that shows it. When "unsure" is true, show the gap and let the reader decide: do not present the verdict as settled. The reader can always overrule a grade. Pass back the "rubric" from an earlier grade of the same question to skip the first call.',
  effect: "read",
  input: {
    question: { type: "string", max: 2_000, description: "The question the reader answered." },
    answer: { type: "string", max: 8_000, description: "The reader's answer, as they wrote it." },
    passage: PASSAGE_FIELD,
    expected: { type: "string", max: 2_000, optional: true, description: "The answer stored for the question. Needed unless `rubric` is given." },
    rubric: { type: "list", max: MAX_POINTS, optional: true, description: "The points a right answer must make, as an earlier grade_answer returned them.", item: { type: "string" } },
    provider: PROVIDER_FIELD,
  },
  run: async ({ question, answer, passage, expected, rubric, provider }) => {
    const points = rubric === undefined ? undefined : rubricPoints(rubric);
    if (typeof points === "string") throw new ToolError(points.replace('"points"', '"rubric"'));
    if (!points && !expected) throw new ToolError('Give "expected", the answer stored for the question, or a "rubric" from an earlier grade.');
    const checker = await requireChecker(provider);
    const grade = await gradeAnswer(checker.provider, { question, answer, passage, expected, rubric: points }, checker.model, new AbortController().signal);
    return { ...grade, model: checker.model };
  },
});
