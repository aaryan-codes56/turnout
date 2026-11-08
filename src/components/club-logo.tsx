import { cn } from "@/lib/utils";

export function ClubLogo({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  const sharedClasses = cn("size-20 shrink-0 rounded-xl", className);

  if (logoUrl) {
    return (
      // next/image only loads from allowlisted hosts, and clubs paste a link
      // from anywhere.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(sharedClasses, "object-cover")}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        sharedClasses,
        "flex items-center justify-center bg-stub font-heading text-5xl font-black",
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
