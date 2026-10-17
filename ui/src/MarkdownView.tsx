import type { ReactNode } from "react";
import type { InlineNode, MarkdownNode } from "./markdown";
import { memo, useMemo } from "react";
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
            className={`md-heading md-heading-${node.level}`}
          >
            {renderInline(node.children)}
          </div>
        );
      case "codeBlock":
        return (
          <pre key={index} data-lang={node.lang}>
            <code>{node.value}</code>
          </pre>
        );
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

/** Renders Markdown as React elements built from the parser's allow-listed AST. */
export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  const nodes = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{renderBlocks(nodes)}</div>;
});
