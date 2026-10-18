import type { LanguageFn } from "highlight.js";

const CODE_INFO = /^[A-Za-z0-9_+#.-]{1,32}$/u;
const COPY_FEEDBACK_MS = 1500;

type HighlighterCore = {
  registerLanguage: (name: string, language: LanguageFn) => void;
  highlight: (
    value: string,
    options: { language: string; ignoreIllegals: boolean },
  ) => {
    value: string;
  };
};

const languageLoaders = {
  bash: () => import("highlight.js/lib/languages/bash"),
  css: () => import("highlight.js/lib/languages/css"),
  go: () => import("highlight.js/lib/languages/go"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
} as const;

type HighlightLanguage = keyof typeof languageLoaders;

const aliases: Record<string, HighlightLanguage> = {
  bash: "bash",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  css: "css",
  go: "go",
  golang: "go",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  javascript: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  typescript: "typescript",
  html: "xml",
  svg: "xml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

export function parseCodeFenceLanguage(info?: string): {
  label: string | null;
  language: HighlightLanguage | null;
} {
  if (!info) return { label: null, language: null };
  const token = info.trim().split(/\s+/u, 1)[0] ?? "";
  if (!token || !CODE_INFO.test(token)) return { label: null, language: null };
  const normalized = token.toLowerCase();
  return {
    label: normalized,
    language: Object.hasOwn(aliases, normalized) ? aliases[normalized]! : null,
  };
}

let corePromise: Promise<HighlighterCore> | null = null;
const registered = new Set<HighlightLanguage>();
const registrations = new Map<HighlightLanguage, Promise<void>>();

async function getCore() {
  if (corePromise) return corePromise;
  corePromise = import("highlight.js/lib/core").then((module) => module.default as HighlighterCore);
  return corePromise;
}

async function ensureRegistered(language: HighlightLanguage) {
  if (registered.has(language)) return;
  const inFlight = registrations.get(language);
  if (inFlight) return inFlight;
  const pending = (async () => {
    const [core, languageModule] = await Promise.all([getCore(), languageLoaders[language]()]);
    core.registerLanguage(language, languageModule.default);
    registered.add(language);
  })();
  registrations.set(language, pending);
  await pending;
}

export async function highlightCode(value: string, language: HighlightLanguage | null) {
  if (!language || !value) return null;
  try {
    await ensureRegistered(language);
    const core = await getCore();
    return core.highlight(value, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

export type ClipboardLike = { writeText: (value: string) => Promise<void> };

export function availableClipboard(
  clipboard: { writeText?: (value: string) => Promise<void> } | null | undefined = globalThis
    .navigator?.clipboard,
): ClipboardLike | null {
  return typeof clipboard?.writeText === "function"
    ? { writeText: (value) => clipboard.writeText!.call(clipboard, value) }
    : null;
}

export function createCodeCopyController({
  clipboard = availableClipboard(),
  onCopied,
  delayMs = COPY_FEEDBACK_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
}: {
  clipboard?: ClipboardLike | null;
  onCopied: (copied: boolean) => void;
  delayMs?: number;
  schedule?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };

  return {
    canCopy: clipboard !== null,
    copy: async (value: string) => {
      if (!clipboard) return false;
      try {
        await clipboard.writeText(value);
        onCopied(true);
        clear();
        timer = schedule(() => {
          onCopied(false);
          timer = null;
        }, delayMs);
        return true;
      } catch {
        onCopied(false);
        clear();
        return false;
      }
    },
    dispose: clear,
  };
}
