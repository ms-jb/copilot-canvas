import type { IncomingMessage, ServerResponse } from "node:http";
import {
  API,
  CONTRACT_VERSION,
  ERROR_CODES,
  HEADERS,
  HTTP_STATUS_BY_CODE,
  IDENTITY_APP,
  LIMITS,
  toPublicOrigin,
  validateControlsPayload,
  validateReloadPayload,
  validateRespondPayload,
  validateSendPayload,
} from "../../extension-src/shared/contract.mts";
import type { loadConfig } from "../../extension-src/shared/config.mts";
import { COOKIE, CSRF_TOKEN, SCENARIOS, SESSION_ID } from "./fixtures.mts";
import type { Scenario } from "./fixtures.mts";
import { applyChange, broadcast, fits, setPrompts, setStatus, upsert } from "./session.mts";
import type { MockSessions } from "./session.mts";
import { sleep } from "./scenarios.mts";
import type { MockScenarios } from "./scenarios.mts";

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function error(res: ServerResponse, code: string, message: string) {
  json(res, HTTP_STATUS_BY_CODE[code] ?? 500, { ok: false, code, message });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > LIMITS.maxBodyBytes) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function scenarioOf(req: IncomingMessage): Scenario {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z]+)`).exec(req.headers.cookie ?? "");
  const value = match?.[1] as Scenario | undefined;
  return value && SCENARIOS.includes(value) ? value : "live";
}

export function createMockHandler(options: {
  repoRoot: string;
  config: ReturnType<typeof loadConfig>;
  generation: string;
  sessions: MockSessions;
  scenarios: MockScenarios;
}) {
  const { repoRoot, config, generation, sessions, scenarios } = options;
  const { enqueue, runTurn, scheduleAuto } = scenarios;

  // Writes are pinned like the real provider: matching generation and CSRF token required.
  function checkWrite(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.headers[HEADERS.generation] !== generation) {
      error(res, ERROR_CODES.staleProvider, "The provider was restarted.");
      return false;
    }
    if (req.headers[HEADERS.csrf] !== CSRF_TOKEN) {
      error(res, ERROR_CODES.forbidden, "Forbidden.");
      return false;
    }
    return true;
  }

  return async function handle(route: string, req: IncomingMessage, res: ServerResponse) {
    const session = sessions.get(scenarioOf(req));
    const method = req.method ?? "GET";
    const expected =
      route === API.send ||
      route === API.controls ||
      route === API.respond ||
      route === API.reload ||
      route === API.stop
        ? "POST"
        : "GET";
    if (method !== expected) return error(res, ERROR_CODES.methodNotAllowed, "Method not allowed.");

    switch (route) {
      case API.identity:
        return json(res, 200, { app: IDENTITY_APP, contractVersion: CONTRACT_VERSION, generation });
      case API.bootstrap:
        return json(res, 200, {
          contractVersion: CONTRACT_VERSION,
          generation,
          sessionId: SESSION_ID,
          csrfToken: CSRF_TOKEN,
          config: {
            assistantName: config.assistantName,
            description: config.description,
            defaultView: config.defaultView,
            sourceDir: repoRoot,
          },
          snapshot: { entries: session.entries, status: session.status, prompts: session.prompts },
          controls: session.controls,
        });
      case API.share: {
        const raw = process.env.DEV_PUBLIC_URL;
        const publicUrl =
          raw === "off" ? null : (toPublicOrigin(raw) ?? "https://example.devtunnels.ms");
        return json(res, 200, { publicUrl });
      }
      case API.events: {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(
          `event: snapshot\ndata: ${JSON.stringify({
            seq: session.seq,
            generation,
            snapshot: {
              entries: session.entries,
              status: session.status,
              prompts: session.prompts,
            },
            controls: session.controls,
          })}\n\n`,
        );
        session.clients.add(res);
        const keepalive = setInterval(() => res.write(": keepalive\n\n"), LIMITS.keepaliveMs);
        req.on("close", () => {
          clearInterval(keepalive);
          session.clients.delete(res);
        });
        if (session === sessions.peek("live") && session.status.phase === "idle") scheduleAuto();
        return;
      }
      case API.send: {
        if (!checkWrite(req, res)) return;
        const parsed = validateSendPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        const messageId = `mock-msg-${sessions.nextId()}`;
        json(res, 200, {
          ok: true,
          status: "accepted",
          requestId: parsed.value.requestId,
          messageId,
        });
        const { text, requestId } = parsed.value;
        enqueue(session, async () => {
          upsert(session, {
            id: `user:${messageId}`,
            kind: "user",
            text,
            timestamp: new Date().toISOString(),
            requestId,
          });
          const reply = `This is a **preview**, so your message was not sent anywhere. In a real session, Copilot would answer here.\n\nYou wrote:\n\n> ${text.split("\n").join("\n> ")}`;
          await runTurn(session, reply, "read_notes", false);
        });
        return;
      }
      case API.controls: {
        if (!checkWrite(req, res)) return;
        const parsed = validateControlsPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        await sleep(350);
        const next = structuredClone(session.controls);
        const failure = applyChange(next, parsed.value.change);
        if (failure) return error(res, failure, "That setting can't be changed here.");
        session.controls = next;
        broadcast(session, "controls", { controls: next });
        return json(res, 200, { ok: true, controls: next });
      }
      case API.respond: {
        if (!checkWrite(req, res)) return;
        const parsed = validateRespondPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        const { requestId, response } = parsed.value;
        const prompt = session.prompts.find((item) => item.requestId === requestId);
        if (!prompt) {
          return error(res, ERROR_CODES.promptResolved, "This request is no longer waiting.");
        }
        if (!fits(prompt, response)) {
          return error(res, ERROR_CODES.badRequest, "That answer doesn't match this request.");
        }
        await sleep(300);
        const remaining = session.prompts.filter((item) => item.requestId !== requestId);
        setPrompts(session, remaining);
        json(res, 200, { ok: true, status: "accepted" });
        if (scenarios.resolvePrompt(requestId)) return;
        if (remaining.length === 0) {
          enqueue(session, async () => {
            const reply =
              "Thanks, that's all I needed. This is a **preview**, so nothing actually ran.";
            await runTurn(session, reply, "read_notes", false);
          });
        }
        return;
      }
      case API.reload: {
        if (!checkWrite(req, res)) return;
        const parsed = validateReloadPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        // The preview has no extensions to reload, so it only acknowledges.
        return json(res, 200, { ok: true, status: "scheduled" });
      }
      case API.stop: {
        if (!checkWrite(req, res)) return;
        const parsed = validateReloadPayload(await readJson(req));
        if (!parsed.ok) return error(res, parsed.code, parsed.message);
        // The preview shows the result of a stop; a scripted turn may still finish its steps.
        setPrompts(session, []);
        setStatus(session, { phase: "idle" });
        return json(res, 200, { ok: true, status: "stopped" });
      }
    }
  };
}
