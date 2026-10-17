import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "./components/ChatIcons";
import styles from "./MarkdownView.module.css";
import type { InlineNode, MarkdownNode } from "./markdown";
import { parseMarkdown } from "./markdown";

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "break":
        return <br key={index} />;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "emphasis":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function CodeBlock({ lang, value }: { lang?: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className={styles.code}>
      <figcaption className={styles.codeHeader}>
        <span className={styles.codeLang}>{lang ?? "text"}</span>
        {canCopy && (
          <button
            type="button"
            className={styles.copy}
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
          </button>
        )}
      </figcaption>
      <pre tabIndex={0}>
        <code>{value}</code>
      </pre>
    </figure>
  );
}

function renderBlocks(nodes: MarkdownNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "paragraph":
        return <p key={index}>{renderInline(node.children)}</p>;
      case "heading":
        return (
          <div
            key={index}
            role="heading"
            aria-level={node.level + 2}
            className={styles.heading}
            data-level={node.level}
          >
            {renderInline(node.children)}
          </div>
        );
      case "codeBlock":
        return <CodeBlock key={index} lang={node.lang} value={node.value} />;
      case "blockquote":
        return <blockquote key={index}>{renderBlocks(node.children)}</blockquote>;
      case "rule":
        return <hr key={index} />;
      case "list": {
        const items = node.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderBlocks(item)}</li>
        ));
        return node.ordered ? (
          <ol key={index} start={node.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
    }
  });
}

interface MarkdownViewProps {
  text: string;
  /** Shows a caret after the last block while the text is still arriving. */
  streaming?: boolean;
}

/**
 * Renders Markdown as React elements built from the parser's allow-listed AST. Text always goes
 * through React text nodes, so nothing from the input is ever interpreted as HTML.
 */
export const MarkdownView = memo(function MarkdownView({ text, streaming }: MarkdownViewProps) {
  const nodes = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={styles.md} data-streaming={streaming ? "true" : undefined}>
      {renderBlocks(nodes)}
    </div>
  );
});
