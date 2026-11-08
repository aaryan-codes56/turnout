import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { brand } from "@/lib/brand";
import { getCurrentUser } from "@/server/auth/session";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
      <Link href="/" className="font-heading text-3xl font-black">
        {brand.name}
      </Link>
      {user ? (
        <SignOutButton />
      ) : (
        <Link
          href="/sign-in"
          className="inline-flex h-11 items-center font-bold underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
