// The chat canvas: opens a panel that points at the shared provider. One provider serves every
// open instance; it starts on the first open and stops (with a new generation next time) when
// the last instance closes.

import type { TemplateConfig } from "../shared/config.mts";
import type { Logger } from "./bridge.mts";

export interface CanvasOpenContext {
  instanceId: string;
}

export interface CanvasOpenResult {
  url?: string;
  title?: string;
  status?: string;
}

export interface CanvasActionSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  handler: (ctx: unknown) => unknown;
}

export interface CanvasSpec {
  id: string;
  displayName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  actions?: CanvasActionSpec[];
  open: (ctx: CanvasOpenContext) => Promise<CanvasOpenResult> | CanvasOpenResult;
  onClose?: (ctx: CanvasOpenContext) => Promise<void> | void;
}

export interface ProviderHandle {
  url: string;
  close(): Promise<void>;
}

export interface ChatCanvas<C> {
  canvas: C;
  /** Closes the provider regardless of open instances. */
  shutdown(): Promise<void>;
}

const OPEN_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: true,
});

/**
 * `createCanvas` is the SDK factory (injected so only extension.mts imports the SDK).
 * `ensureProvider()` is called whenever no provider is running and must resolve to
 * `{ url, close() }`.
 */
export function createChatCanvas<C>(input: {
  config: Pick<TemplateConfig, "canvasId" | "displayName" | "description">;
  createCanvas: (spec: CanvasSpec) => C;
  ensureProvider: () => Promise<ProviderHandle>;
  log?: Logger;
}): ChatCanvas<C> {
  const { config, createCanvas, ensureProvider, log = () => {} } = input;
  const instances = new Set<string>();
  let provider: ProviderHandle | null = null;
  let starting: Promise<ProviderHandle> | null = null;
  let stopping: Promise<void> = Promise.resolve();

  async function acquire(): Promise<ProviderHandle> {
    await stopping;
    if (provider) return provider;
    if (!starting) {
      starting = ensureProvider().then(
        (started) => {
          provider = started;
          starting = null;
          return started;
        },
        (error: unknown) => {
          starting = null;
          throw error;
        },
      );
    }
    return starting;
  }

  function release(): Promise<void> {
    if (instances.size > 0 || !provider) return stopping;
    const closing = provider;
    provider = null;
    stopping = stopping
      .then(() => closing.close())
      .catch((error: unknown) => {
        log(
          `Provider close failed: ${error instanceof Error ? error.message : "error"}`,
          "warning",
        );
      });
    return stopping;
  }

  const canvas = createCanvas({
    id: config.canvasId,
    displayName: config.displayName,
    description: config.description,
    inputSchema: { ...OPEN_INPUT_SCHEMA },
    actions: [
      {
        name: "status",
        description: "Reports whether the chat panel is running and how many panels are open.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => ({ running: provider !== null, openPanels: instances.size }),
      },
    ],
    async open(ctx) {
      // Registered first so a concurrent close cannot stop the provider this open is about to use.
      instances.add(ctx.instanceId);
      let running: ProviderHandle;
      try {
        running = await acquire();
      } catch (error) {
        instances.delete(ctx.instanceId);
        throw error;
      }
      return { url: running.url, title: config.displayName, status: "Connected to this session" };
    },
    async onClose(ctx) {
      instances.delete(ctx.instanceId);
      await release();
    },
  });

  return {
    canvas,
    async shutdown() {
      instances.clear();
      if (starting) {
        try {
          await starting;
        } catch {
          // Nothing to stop.
        }
      }
      await release();
      await stopping;
    },
  };
}
