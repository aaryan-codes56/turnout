import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { allowedEmailDomains } from "@/server/auth/auth";
import { SIGN_IN_ERROR } from "@/server/auth/email-domain";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

function errorMessage(code: string | string[] | undefined): string | null {
  if (code === undefined) return null;
  if (code === SIGN_IN_ERROR.domainNotAllowed) {
    const domains = allowedEmailDomains.map((d) => `@${d}`).join(" or ");
    return `That Google account can't sign in. Choose your ${domains} account.`;
  }
  if (code === SIGN_IN_ERROR.emailNotVerified) {
    return "Google hasn't verified that email address. Verify it with Google, then sign in again.";
  }
  return "Sign-in didn't finish. Try again.";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/");

  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 pt-12 pb-16">
      <h1 className="font-heading text-7xl leading-none font-black">Sign in</h1>
      <p className="mt-4 text-lg leading-relaxed">
        Use your college Google account. Personal Gmail accounts can&apos;t sign
        in.
      </p>
      {message && (
        <p
          role="alert"
          className="mt-6 rounded-lg bg-destructive/10 p-4 text-destructive"
        >
          {message}
        </p>
      )}
      <div className="mt-8">
        <GoogleSignInButton />
      </div>
    </main>
  );
}
