---
name: add-data-endpoint
description: "Use when a canvas customization needs outside data, such as 'show my open PRs' or 'show my agenda'. Add a read-only host GET endpoint and an optional phone route."
---

# Add a read-only data endpoint

Read `AGENTS.md` and `.github/skills/customization-workflow/SKILL.md`.
This skill owns the data path; use `add-view-or-panel` for its presentation.
Reads do not authorize sending, editing, scheduling or other external writes.

## 1. Define a small read

- Confirm the service, account, repository or calendar scope, fields to display,
  freshness requirement and whether the information should appear on the phone.
- Use the user's existing host-side authentication. If it is missing, report
  what sign-in is needed; do not ask for a token in chat or put one in config.
- Return only display fields. Set limits for item count, text length, upstream
  pagination, execution time and response size before implementing the reader.
- Keep a new host reader under `src/host/`, separate from HTTP routing.
  Make its external read replaceable in tests so tests need no live account.

## 2. Extend the shared contract

- In `src/shared/contract.mts`, add the relative path to `API`, a
  response type and a runtime validator. Existing paths use `api/...`, without
  a leading slash or provider token.
- Read `validateBootstrap` and `validateIdentity` for validation conventions.
  Validate upstream values before returning them, including link schemes and
  field sizes; a TypeScript type assertion does not validate JSON.
- Represent empty results, unavailable data and stale cached data distinctly.
  Include freshness information if data can be cached.
- Re-export browser-used types and validators through `ui/src/shared.ts`.
  Keep the shared contract free of Node-only imports and credentials.

## 3. Implement the host read and route

- For a new CLI-backed reader, use Node's `execFile` from `node:child_process`
  with an executable and argument array, a finite timeout, an output limit and
  `shell: false`. Use the CLI's machine-readable output; parse and validate it.
- Build arguments from validated values. Never accept a browser-supplied
  executable, shell command, arbitrary URL or credential. Keep service targets
  and allowed scope under host control.
- For an HTTP reader, use a fixed service origin, a request timeout and limits
  on response bytes and pagination. Do not turn the endpoint into a general proxy.
- If repeated reads need caching, keep it in the host with a short explicit TTL.
  Separate account/scope entries, share concurrent refreshes and discard expired
  data unless the response explicitly labels it stale. Avoid tight retry loops.
- In `src/host/http/routes.mts`, add a case to `route` inside
  `createRoutes`, after the existing Host, Origin and capability checks.
  Follow `API.share` for the GET-only method check using `notAllowed`.
- Return through `sendJson` or `sendError` so sensitive-response headers remain.
  If adding an error code, update `ERROR_CODES` and `HTTP_STATUS_BY_CODE`.
  Map upstream failures to short, safe messages; do not log raw command output,
  headers, tokens, private records or credential-bearing error strings.
- Preserve `readJsonPost`, `staleGeneration` and the session checks in
  `src/host/http/request-policy.mts`. The new read is not a reason to alter POST security.

## 4. Connect the UI and optional phone route

- Add the client read in `ui/src/api.ts` using `getJson<unknown>` plus the new
  validator. `getJson` checks HTTP/JSON errors, not the response's field shapes.
- Keep requests relative to the page through that helper. Absolute `/api/...`
  requests bypass the provider's capability prefix on desktop.
- Use an `AbortSignal`, cancel obsolete work and ignore responses after the
  connection becomes stale. Keep loading, empty, stale and error states explicit.
- If phone access is part of the request, add exactly the new path with `"GET"`
  to `ROUTES` in `gateway/gateway.mts`. Otherwise leave it inaccessible there.
  A running `npm run devtunnel` keeps the routes it started with, so restart it after
  installing (it reuses the same tunnel and link). Until the canvas has reloaded
  onto the new build, the gateway forwards to the old provider, which answers 404.
- The gateway drops query strings. Prefer host-configured scope and client-side
  filtering of a small result; do not silently depend on query parameters.
- Preserve existing protected POST routes and `PINNED_WRITES`. Do not forward
  authorization/cookie headers or expose the provider capability path.
- Add synthetic responses to `scripts/dev-mock.mts`; previews must not call
  the user's live service or require their credentials.

## 5. Verify failure behavior

- Add focused `vite-plus/test` tests under `tests/` for valid, empty and malformed
  upstream data, missing authentication, timeout, item limits and cache expiry
  when caching exists. Verify failures do not become successful empty results.
- Use `tests/contract.test.ts` for validator patterns and
  `tests/security.test.ts` for Host/Origin cases. Exercise the new provider route
  through `createProviderServer`, including wrong methods and invalid prefixes.
- If changing the gateway, extend `tests/gateway.test.ts` to prove that only the
  intended GET is forwarded and unrelated paths/methods remain refused.
- Run the relevant tests and complete `customization-workflow`. Verify both the
  installed desktop read and the phone read when phone access was requested.

## Don't

- Do not fetch external data from the renderer or loosen CSP/CORS to permit it.
- Do not bind the provider or gateway to anything except `127.0.0.1`.
- Do not weaken CSRF, generation, session checks or owner-only tunnel access.
- Do not store secrets in the repository, `template.config.json` or `extension/`.
- Do not add external mutations to a GET or auto-answer permission prompts.
- Do not add a heavy SDK for a small read, or hand-edit generated `extension/`.
