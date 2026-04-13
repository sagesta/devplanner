/**
 * Lightweight markdown renderer — no external deps.
 * Handles the subset that the AI agent actually produces:
 *   **bold**, *italic*, `code`, ```code blocks```,
 *   # headings, - / * unordered lists, 1. ordered lists,
 *   [text](url) links, --- horizontal rules, line breaks.
 */

type Segment =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string };

/** Parse inline markdown (bold / italic / code / links) into React nodes */
function renderInline(text: string): React.ReactNode[] {
  // Pattern order matters — code > bold > italic > link
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const raw = match[0];
    if (raw.startsWith("`")) {
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-foreground/90"
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (raw.startsWith("**")) {
      nodes.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (raw.startsWith("*")) {
      nodes.push(
        <em key={match.index} className="italic">
          {raw.slice(1, -1)}
        </em>
      );
    } else if (raw.startsWith("[")) {
      // link
      const linkText = match[2] ?? "";
      const href = match[3] ?? "#";
      nodes.push(
        <a
          key={match.index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-primary hover:text-primary-hover"
        >
          {linkText}
        </a>
      );
    }
    last = match.index + raw.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Render a single markdown block-level line group */
function renderLine(line: string, idx: number): React.ReactNode {
  // Headings
  const h3 = line.match(/^### (.+)/);
  if (h3)
    return (
      <h3 key={idx} className="mt-3 mb-0.5 text-[0.85rem] font-semibold text-foreground">
        {renderInline(h3[1]!)}
      </h3>
    );
  const h2 = line.match(/^## (.+)/);
  if (h2)
    return (
      <h2 key={idx} className="mt-3 mb-1 text-[0.9rem] font-bold text-foreground">
        {renderInline(h2[1]!)}
      </h2>
    );
  const h1 = line.match(/^# (.+)/);
  if (h1)
    return (
      <h1 key={idx} className="mt-3 mb-1 text-[1rem] font-bold text-foreground">
        {renderInline(h1[1]!)}
      </h1>
    );

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim()))
    return <hr key={idx} className="my-2 border-white/10" />;

  // Empty line → spacer
  if (!line.trim()) return <div key={idx} className="h-2" />;

  return <span key={idx}>{renderInline(line)}</span>;
}

// ─── Main export ──────────────────────────────────────────────────────────────

import React from "react";

export function MarkdownMessage({ content }: { content: string }) {
  // Pre-pass: split into block-level segments
  // (fenced code blocks, unordered lists, ordered lists, paragraphs)
  const blocks: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push(
        <pre
          key={`cb-${i}`}
          className="my-2 overflow-x-auto rounded-lg bg-white/5 p-3 font-mono text-[0.78rem] leading-relaxed text-foreground/90"
          data-lang={lang || undefined}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++; // skip closing ```
      continue;
    }

    // Unordered list run
    if (/^[-*•]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i]!)) {
        items.push(
          <li key={i} className="ml-1">
            {renderInline(lines[i]!.replace(/^[-*•]\s/, ""))}
          </li>
        );
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="my-1.5 ml-4 list-disc space-y-0.5 text-[0.85rem]">
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list run
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(
          <li key={i} className="ml-1">
            {renderInline(lines[i]!.replace(/^\d+\.\s/, ""))}
          </li>
        );
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="my-1.5 ml-4 list-decimal space-y-0.5 text-[0.85rem]">
          {items}
        </ol>
      );
      continue;
    }

    // Regular line
    blocks.push(
      <p key={i} className="text-[0.85rem] leading-relaxed">
        {renderLine(line, i)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
}
