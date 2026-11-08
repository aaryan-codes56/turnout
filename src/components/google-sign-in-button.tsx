"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  const [status, setStatus] = useState<"idle" | "redirecting" | "failed">(
    "idle",
  );

  async function signIn() {
    setStatus("redirecting");
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    });
    if (error) setStatus("failed");
  }

  return (
    <div>
      <Button
        className="h-12 w-full text-base"
        disabled={status === "redirecting"}
        onClick={signIn}
      >
        Continue with Google
      </Button>
      {status === "failed" && (
        <p role="alert" className="mt-3 text-destructive">
          Couldn&apos;t reach Google. Check your connection and try again.
        </p>
      )}
    </div>
  );
}
