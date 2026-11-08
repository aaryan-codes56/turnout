const MAX_SLUG_LENGTH = 60;

export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Drop accents left over from NFKD.
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}
