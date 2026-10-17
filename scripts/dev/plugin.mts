import { randomUUID } from "node:crypto";
import type { Plugin } from "vite-plus";
import { API, ERROR_CODES } from "../../extension-src/shared/contract.mts";
import { loadConfig } from "../../extension-src/shared/config.mts";
import { COOKIE } from "./fixtures.mts";
import { createSessions } from "./session.mts";
import { createScenarios } from "./scenarios.mts";
import { createMockHandler, error } from "./http.mts";

export function devMock(repoRoot: string): Plugin {
  const config = loadConfig(repoRoot);
  const generation = `dev-mock-${randomUUID().slice(0, 8)}`;
  const sessions = createSessions();
  const scenarios = createScenarios(sessions);
  const handle = createMockHandler({ repoRoot, config, generation, sessions, scenarios });
  const routes = new Set<string>(Object.values(API));
  return {
    name: "copilot-canvas-dev-mock",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0] ?? "";
        const route = /(?:^|\/)(api\/[a-z]+)$/.exec(pathname)?.[1];
        if (!route || !routes.has(route)) return next();
        handle(route, req, res).catch(() => {
          if (!res.headersSent) error(res, ERROR_CODES.internal, "Mock failed.");
        });
      });
    },
    // The page sends no Referer, so the scenario travels from `?state=` to the API as a cookie.
    transformIndexHtml: () => [
      {
        tag: "script",
        injectTo: "head-prepend",
        children: `(()=>{const s=new URLSearchParams(location.search).get("state");document.cookie="${COOKIE}="+(s&&/^[a-z]+$/.test(s)?s:"")+"; path=/; SameSite=Strict";})();`,
      },
    ],
  };
}
