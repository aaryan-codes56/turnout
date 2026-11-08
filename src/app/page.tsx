import Link from "next/link";

import { AdmitStub } from "@/components/admit-stub";
import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-12 overflow-x-clip px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
      <section>
        <h1 className="font-heading text-[clamp(4rem,19vw,7.5rem)] leading-[0.88] font-black">
          {brand.tagline}
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed">
          {brand.description}
        </p>
        <div className="mt-8">
          {user ? (
            <p className="text-lg font-bold">
              You&apos;re signed in as {user.name}.
            </p>
          ) : (
            <Link
              href="/sign-in"
              className={cn(buttonVariants(), "h-12 px-6 text-base")}
            >
              Sign in with your college account
            </Link>
          )}
        </div>
      </section>
      <AdmitStub />
    </main>
  );
}
