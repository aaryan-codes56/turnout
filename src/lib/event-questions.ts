import { z } from "zod";

export const MAX_CUSTOM_QUESTIONS = 5;

export const customQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(["short_text", "single_select", "checkbox"]),
    label: z
      .string()
      .trim()
      .min(1, "Every question needs a label.")
      .max(120, "Question labels can be at most 120 characters."),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .refine(
    (question) =>
      question.type !== "single_select" || (question.options?.length ?? 0) >= 2,
    { error: "A dropdown question needs at least two options." },
  );

export type CustomQuestion = z.infer<typeof customQuestionSchema>;
export type RegistrationAnswers = Record<string, string | boolean>;

export const customQuestionsSchema = z
  .array(customQuestionSchema)
  .max(MAX_CUSTOM_QUESTIONS, `An event can have at most ${MAX_CUSTOM_QUESTIONS} questions.`)
  .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length, {
    error: "Question ids must be unique.",
  });

/**
 * Checks answers against the event's questions as stored on the server, and
 * drops anything that wasn't asked. Returns an error message or the answers.
 */
export function validateAnswers(
  questions: readonly CustomQuestion[],
  raw: Record<string, unknown>,
): { error: string } | { answers: RegistrationAnswers } {
  const answers: RegistrationAnswers = {};

  for (const question of questions) {
    const value = raw[question.id];

    if (question.type === "checkbox") {
      if (question.required && value !== true) {
        return { error: `Please tick "${question.label}".` };
      }
      answers[question.id] = value === true;
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (question.required) {
        return { error: `Please answer "${question.label}".` };
      }
      continue;
    }
    if (text.length > 500) {
      return { error: `"${question.label}" can be at most 500 characters.` };
    }
    if (question.type === "single_select" && !question.options?.includes(text)) {
      return { error: `Choose one of the options for "${question.label}".` };
    }
    answers[question.id] = text;
  }

  return { answers };
}
