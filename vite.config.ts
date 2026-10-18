import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { devMock } from "./scripts/dev-mock.mts";
import { inlineAppleTouchIcon } from "./scripts/inline-apple-touch-icon.mts";
import { syncExtension } from "./scripts/sync-extension.mts";

const root = fileURLToPath(new URL(".", import.meta.url));
const ignore = ["extension/**", "node_modules/**"];
// Renderer UI uses native Mantine components (see AGENTS.md, "UI: native Mantine first").
const mantine = (component: string) => `Use Mantine ${component}, not raw markup.`;
const mantineInstead = [
  { element: "button", message: mantine("Button, ActionIcon, UnstyledButton or CloseButton") },
  { element: "input", message: mantine("TextInput, Checkbox, Switch, Radio or FileButton") },
  { element: "select", message: mantine("NativeSelect, Select or SegmentedControl") },
  { element: "textarea", message: mantine("Textarea") },
  { element: "dialog", message: mantine("Modal, Drawer or Popover") },
  { element: "progress", message: mantine("Progress, RingProgress or Loader") },
  { element: "meter", message: mantine("Progress or RingProgress") },
  { element: "table", message: mantine("Table") },
  { element: "img", message: mantine("Image or Avatar") },
  { element: "a", message: mantine("Anchor") },
  { element: "header", message: mantine("AppShell.Header or Group") },
  { element: "nav", message: mantine("AppShell.Navbar, NavLink or Tabs") },
  { element: "main", message: mantine("AppShell.Main") },
  { element: "aside", message: mantine("AppShell.Aside") },
  { element: "footer", message: mantine("AppShell.Footer") },
];
// Renders Markdown syntax to its own HTML elements.
const rawMarkupExempt = ["ui/src/MarkdownView.tsx"];
// Template code predating the rule. Migrate a file to Mantine, then delete it here; never add one.
const mantineDebt = [
  "ui/src/components/Composer.tsx",
  "ui/src/components/Message.tsx",
  "ui/src/components/SendButton.tsx",
  "ui/src/components/Transcript.tsx",
  "ui/src/components/controls/ControlPicker.tsx",
  "ui/src/components/controls/SessionControls.tsx",
  "ui/src/features/attachments/AttachmentList.tsx",
  "ui/src/features/prompts/FormBody.tsx",
  "ui/src/features/prompts/PendingPrompts.tsx",
  "ui/src/features/sessions/SessionsSection.tsx",
  "ui/src/layout/Shell.tsx",
  "ui/src/layout/Sidebar.tsx",
  "ui/src/layout/TopBar.tsx",
  "ui/src/views/panels/AddPanelCard.tsx",
];
const uiRestrictedImports = [
  "**/src/host/**",
  "**/src/shared/node/**",
  "**/src/extension.mts",
  "**/gateway/**",
  "**/scripts/**",
];

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [
    react(),
    // `vp dev` only: a scripted stand-in for the extension's API (see scripts/dev-mock.mts).
    devMock(root),
    {
      name: "inline-apple-touch-icon",
      apply: "build",
      transformIndexHtml: async (html) => inlineAppleTouchIcon(html, root),
    },
    {
      // After the renderer is written, compile the host so `vp build` yields a complete extension/.
      name: "sync-extension",
      apply: "build",
      closeBundle: () => syncExtension(root),
    },
  ],
  build: { outDir: "../extension/ui", emptyOutDir: true },
  test: { root, include: ["tests/**/*.test.ts"] },
  fmt: { ignorePatterns: [...ignore, "package-lock.json"] },
  lint: {
    ignorePatterns: ignore,
    // An explicit list replaces the defaults: keep them and add import-cycle detection.
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    options: { typeAware: true, typeCheck: true },
    rules: {
      "import/no-cycle": ["error", { ignoreTypes: true }],
    },
    overrides: [
      {
        files: ["ui/**/*.tsx"],
        excludeFiles: [...rawMarkupExempt, ...mantineDebt],
        plugins: ["react"],
        rules: {
          "react/forbid-elements": ["error", { forbid: mantineInstead }],
          // The plugin is here for forbid-elements; its default rules are a separate cleanup.
          "react/jsx-key": "off",
          "react/purity": "off",
          "react/refs": "off",
          "react/set-state-in-effect": "off",
        },
      },
      {
        files: ["ui/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: uiRestrictedImports,
                  message: "The renderer must not import host, Node runtime, gateway or scripts.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["ui/**"],
        excludeFiles: ["ui/src/shared.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [...uiRestrictedImports, "**/src/shared/**"],
                  message: "Use ui/src/shared.ts for browser-safe shared code; no server imports.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/**", "gateway/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/ui/**"],
                  message: "Share code through src/shared, not the renderer.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/shared/**"],
        excludeFiles: ["src/shared/node/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "**/host/**",
                    "**/node/**",
                    "**/extension.mts",
                    "**/gateway/**",
                    "**/ui/**",
                    "**/scripts/**",
                    "node:*",
                  ],
                  message:
                    "Browser-safe shared modules must not depend on application or Node code.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["gateway/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/ui/**", "**/src/host/**"],
                  message:
                    "The gateway uses shared code and the wire protocol, not host or UI code.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["tests/**"],
        rules: { "no-restricted-imports": "off" },
      },
    ],
  },
});
