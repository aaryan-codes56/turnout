import Link from "next/link";

const links = [
  { href: "/admin", label: "Clubs" },
  { href: "/admin/super-admins", label: "Super admins" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminNav() {
  return (
    <nav className="flex flex-wrap gap-x-5">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="inline-flex h-11 items-center font-bold underline-offset-4 hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
