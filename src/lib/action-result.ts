export type ActionResult =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string };

export type FormAction = (
  previous: ActionResult,
  formData: FormData,
) => Promise<ActionResult>;
