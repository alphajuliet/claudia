import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Turns off Markdown's block syntax, so a title such as "1. Call Sam" or "# 3 things" keeps its text: only inline
 * marks (bold, italics, strikethrough, code, links) apply. Images, footnotes and tables are off too, so a title can't
 * load a remote image or render as nothing.
 */
function inlineOnly(this: { data(): unknown }) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({
    disable: {
      null: [
        "blockQuote", "codeFenced", "codeIndented", "definition", "headingAtx", "htmlFlow", "htmlText", "list", "setextUnderline",
        "thematicBreak", "labelStartImage", "gfmFootnoteDefinition", "gfmFootnoteCall", "gfmPotentialFootnoteCall", "table",
      ],
    },
  });
}

/**
 * Links to other sites open in a new tab, and a click on one is the link's alone (it doesn't rename or select the
 * task). An in-page link (a footnote) stays in the page; a link whose target was dropped as unsafe is plain text.
 */
function Link({ node: _node, children, href, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  if (!href) return <>{children}</>;
  const away = /^[a-z][a-z0-9+.-]*:/i.test(href);
  return (
    <a {...props} href={href} {...(away ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

/** A title's Markdown as plain text (for labels and messages): marks and link targets dropped. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2");
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
