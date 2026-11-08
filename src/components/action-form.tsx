"use client";

import {
  type ComponentProps,
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from "react";

import type { ActionResult, FormAction } from "@/lib/action-result";

type ActionFormProps = Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: FormAction;
  /** Asks for confirmation first. Use it for anything hard to undo. */
  confirmMessage?: string;
};

const initialState: ActionResult = { status: "idle" };

export function ActionForm({
  action,
  confirmMessage,
  children,
  ...formProps
}: ActionFormProps) {
  const [state, dispatch, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  // Submitting by hand stops React clearing the form when the server reports
  // an error, so nobody has to retype what they wrote.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return (
    <div>
      <form ref={formRef} onSubmit={handleSubmit} {...formProps}>
        <fieldset disabled={isPending} className="contents">
          {children}
        </fieldset>
      </form>
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.status === "success" && state.message && (
        <p role="status" className="mt-2 text-sm font-bold">
          {state.message}
        </p>
      )}
    </div>
  );
}
