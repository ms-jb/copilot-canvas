import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { devMock } from "./scripts/dev-mock.mts";
import { syncExtension } from "./scripts/sync-extension.mts";

const root = fileURLToPath(new URL(".", import.meta.url));
const ignore = ["_ref/**", ".impeccable/**", "extension/**", "node_modules/**"];

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
  lint: { ignorePatterns: ignore, options: { typeAware: true, typeCheck: true } },
});
