import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Turns off Markdown's block syntax, so a title such as "1. Call Sam" or "# 3 things" keeps its text: only inline
 * marks (bold, italics, strikethrough, code, links) apply.
 */
function inlineOnly(this: { data(): unknown }) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({
    disable: {
      null: ["blockQuote", "codeFenced", "codeIndented", "definition", "headingAtx", "htmlFlow", "htmlText", "list", "setextUnderline", "thematicBreak"],
    },
  });
}

/** Links open in a new tab, and a click on one is the link's alone (it doesn't rename or select the task). */
function Link({ node: _node, children, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

const inline: Components = { p: ({ children }) => <>{children}</>, a: Link };
/** Where a link can't go (inside a button), its text stays. */
const inlineNoLinks: Components = { p: ({ children }) => <>{children}</>, a: ({ children }) => <>{children}</> };
const block: Components = { a: Link };

/**
 * A title's inline Markdown. Rendered as React elements (never raw HTML), and unsafe link targets such as
 * `javascript:` are dropped by react-markdown.
 */
export function InlineMarkdown({ text, links = true }: { text: string; links?: boolean }): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, inlineOnly]} components={links ? inline : inlineNoLinks}>
      {text}
    </ReactMarkdown>
  );
}

/** Notes: GitHub-flavoured Markdown (lists, tables, code, task lists shown but not tickable). */
export function BlockMarkdown({ text }: { text: string }): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={block}>
      {text}
    </ReactMarkdown>
  );
}
