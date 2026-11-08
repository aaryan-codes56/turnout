import type { ReactNode } from "react";

// A small markdown subset: headings, lists, paragraphs, bold, italics and
// links. It builds React elements and never injects HTML, so text in an event
// description can't become a script. See docs/decisions.md.

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (!/^https?:\/\//i.test(href)) return label;
      return (
        <a
          key={index}
          href={href}
          rel="noopener noreferrer nofollow"
          target="_blank"
          className="underline underline-offset-4"
        >
          {label}
        </a>
      );
    }
    return part;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className="grid max-w-prose gap-4 text-lg leading-relaxed">
      {blocks.map((block, index) => {
        const lines = block.trim().split("\n");
        if (!block.trim()) return null;

        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="grid list-disc gap-1 pl-6">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        const heading = /^(#{1,3})\s+(.*)$/.exec(block.trim());
        if (heading && lines.length === 1) {
          return (
            <h2 key={index} className="font-heading text-3xl font-black">
              {renderInline(heading[2])}
            </h2>
          );
        }

        return (
          <p key={index} className="whitespace-pre-line">
            {renderInline(block.trim())}
          </p>
        );
      })}
    </div>
  );
}
