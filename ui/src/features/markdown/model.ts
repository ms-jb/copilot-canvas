export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "emphasis"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "break" };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: "codeBlock"; lang?: string; value: string }
  | { type: "list"; ordered: boolean; start?: number; items: BlockNode[][] }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "rule" };

export type MarkdownNode = BlockNode;

export const MAX_DEPTH = 6;

/** One shared scan budget for the whole document, including nested blocks and inline nodes. */
export interface Budget {
  remaining: number;
}
