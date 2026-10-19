import { ActionIcon, CopyButton, ScrollArea, Table, VisuallyHidden } from "@mantine/core";
import { compiler, RuleType, type MarkdownToJSX } from "markdown-to-jsx/react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, Icon } from "./components/ChatIcons";
import {
  availableClipboard,
  createCodeCopyController,
  highlightCode,
  parseCodeFenceLanguage,
} from "./features/markdown/code-blocks";
import { sanitizeHref } from "./markdown";
import styles from "./MarkdownView.module.css";

function CodeBlock({
  languageLabel,
  highlightLanguage,
  value,
  streaming,
}: {
  languageLabel: string | null;
  highlightLanguage: ReturnType<typeof parseCodeFenceLanguage>["language"];
  value: string;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const controller = useRef(
    createCodeCopyController({
      clipboard: availableClipboard(),
      onCopied: setCopied,
    }),
  );

  useEffect(() => () => controller.current.dispose(), []);

  useEffect(() => {
    setHighlighted(null);
    if (streaming || !highlightLanguage) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void highlightCode(value, highlightLanguage).then((html) => {
        if (disposed) return;
        setHighlighted(html);
      });
    }, 120);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [highlightLanguage, streaming, value]);

  const copy = async () => {
    const done = await controller.current.copy(value);
    if (!done) {
      setCopied(false);
    }
  };

  return (
    <figure className={styles.code}>
      <figcaption className={styles.codeHeader}>
        {languageLabel ? <span className={styles.codeLang}>{languageLabel}</span> : <span />}
        <CopyButton value={value} timeout={1500}>
          {() => (
            <span className={styles.copyWrap}>
              <ActionIcon
                variant="subtle"
                color={copied ? "teal" : "gray"}
                onClick={() => void copy()}
                aria-label={copied ? "Copied code" : "Copy code"}
                disabled={!controller.current.canCopy}
                size="lg"
              >
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </ActionIcon>
              <span className={styles.copyText} aria-live="polite">
                {copied ? "Copied" : "Copy"}
              </span>
            </span>
          )}
        </CopyButton>
      </figcaption>
      <ScrollArea type="auto" scrollbarSize={8}>
        <pre tabIndex={0}>
          <code
            className={highlighted ? styles.codeHighlighted : undefined}
            dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
          >
            {highlighted ? null : value}
          </code>
        </pre>
      </ScrollArea>
    </figure>
  );
}

// Below this width per column, a table scrolls sideways inside its own container.
const TABLE_COLUMN_MIN_PX = 110;

function MarkdownTable({
  node,
  render,
}: {
  node: MarkdownToJSX.TableNode;
  render: (cell: MarkdownToJSX.ASTNode[]) => ReactNode;
}) {
  const align = (column: number) => node.align[column] ?? undefined;
  return (
    <Table.ScrollContainer
      minWidth={node.header.length * TABLE_COLUMN_MIN_PX}
      type="native"
      className={styles.table}
    >
      <Table withTableBorder withColumnBorders striped fz="sm" verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            {node.header.map((cell, column) => (
              <Table.Th key={column} ta={align(column)} fw={600}>
                {render(cell)}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {node.cells.map((row, index) => (
            <Table.Tr key={index}>
              {row.map((cell, column) => (
                <Table.Td key={column} ta={align(column)}>
                  {render(cell)}
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// A read-only mark, not a checkbox that looks clickable; screen readers hear it as a word.
function TaskMark({ done }: { done: boolean }) {
  return (
    <span className={styles.task} data-done={done || undefined}>
      <Icon size={16}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        {done && <path d="m8.5 12 2.5 2.5 4.5-5" />}
      </Icon>
      <VisuallyHidden>{done ? "Done: " : "Not done: "}</VisuallyHidden>
    </span>
  );
}

const renderRule =
  (streaming: boolean): MarkdownToJSX.Options["renderRule"] =>
  (next, node, renderChildren, state) => {
    switch (node.type) {
      case RuleType.codeBlock: {
        const { label, language } = parseCodeFenceLanguage(node.lang);
        return (
          <CodeBlock
            key={state.key}
            languageLabel={label}
            highlightLanguage={language}
            value={node.text.replace(/\n$/u, "")}
            streaming={streaming}
          />
        );
      }
      // Headings sit below the page's own and carry no ids, which would repeat across messages.
      case RuleType.heading:
        return (
          <div
            key={state.key}
            role="heading"
            aria-level={Math.min(node.level + 2, 6)}
            className={styles.heading}
            data-level={Math.min(node.level, 4)}
          >
            {renderChildren(node.children, state)}
          </div>
        );
      case RuleType.link: {
        const href = node.target === null ? null : sanitizeHref(node.target);
        return href ? (
          <a key={state.key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {renderChildren(node.children, state)}
          </a>
        ) : (
          <span key={state.key}>{renderChildren(node.children, state)}</span>
        );
      }
      // No image is ever fetched: its description stands in for it.
      case RuleType.image:
        return node.alt ? (
          <span key={state.key} className={styles.image}>
            Image: {node.alt}
          </span>
        ) : null;
      case RuleType.gfmTask:
        return <TaskMark key={state.key} done={node.completed} />;
      case RuleType.table:
        return (
          <MarkdownTable
            key={state.key}
            node={node}
            render={(cell) => renderChildren(cell, state)}
          />
        );
      default:
        return next();
    }
  };

// Raw HTML is never parsed, so a tag shows as the text it is. The only URL that survives is a link
// href that passed `sanitizeHref` (http, https and mailto); images never get a src.
const options = (optimizeForStreaming: boolean): MarkdownToJSX.Options => ({
  disableParsingRawHTML: true,
  ignoreHTMLBlocks: true,
  disableFrontmatter: true,
  forceBlock: true,
  wrapper: null,
  optimizeForStreaming,
  sanitizer: (value, tag, attribute) =>
    tag === "a" && attribute === "href" ? sanitizeHref(value) : null,
  renderRule: renderRule(optimizeForStreaming),
});
const settled = options(false);
// Text still arriving holds back syntax that isn't closed yet, so a half-written **word** never flashes.
const arriving = options(true);

interface MarkdownViewProps {
  text: string;
  /** Shows a caret after the last block while the text is still arriving. */
  streaming?: boolean;
  /** "sm" sets the text a step smaller, for side panels and drawers. */
  size?: "sm";
}

/**
 * Renders GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks) as React elements.
 * Text always goes through React text nodes, so nothing from the input is ever interpreted as HTML.
 */
export const MarkdownView = memo(function MarkdownView({
  text,
  streaming,
  size,
}: MarkdownViewProps) {
  return (
    <div className={styles.md} data-streaming={streaming ? "true" : undefined} data-size={size}>
      {compiler(text, streaming ? arriving : settled)}
    </div>
  );
});
