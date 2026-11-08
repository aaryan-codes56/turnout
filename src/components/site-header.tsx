import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { brand } from "@/lib/brand";
import { can } from "@/server/auth/permissions";
import { getCurrentActor } from "@/server/auth/session";

const navLink =
  "inline-flex h-11 items-center font-bold underline-offset-4 hover:underline";

export async function SiteHeader() {
  const actor = await getCurrentActor();

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <Link href="/" className="font-heading text-3xl font-black">
        {brand.name}
      </Link>
      {actor ? (
        <nav className="flex flex-wrap items-center justify-end gap-x-3 sm:gap-x-5">
          <Link href="/dashboard" className={navLink}>
            Your clubs
          </Link>
          {can(actor, "club.approve") && (
            <Link href="/admin" className={navLink}>
              Admin
            </Link>
          )}
          <SignOutButton />
        </nav>
      ) : (
        <Link href="/sign-in" className={navLink}>
          Sign in
        </Link>
      )}
    </header>
  );
}
