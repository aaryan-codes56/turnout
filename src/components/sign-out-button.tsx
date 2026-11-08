"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await authClient.signOut();
    router.push("/");
    router.refresh();
    setIsSigningOut(false);
  }

  return (
    <Button
      variant="ghost"
      className="h-11 px-3 text-base font-bold"
      disabled={isSigningOut}
      onClick={signOut}
    >
      Sign out
    </Button>
  );
}
