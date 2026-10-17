import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { devMock } from "./scripts/dev-mock.mts";
import { syncExtension } from "./scripts/sync-extension.mts";

const root = fileURLToPath(new URL(".", import.meta.url));
const ignore = ["extension/**", "node_modules/**"];
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
