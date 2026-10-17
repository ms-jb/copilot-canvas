// Minimal ambient typings for the parts of the Copilot extension SDK this template uses.
// The SDK is provided by the Copilot app at runtime and is deliberately not a dependency.

declare module "@github/copilot-sdk/extension" {
  export interface SessionEvent {
    id?: string;
    type: string;
    timestamp: string;
    agentId?: string;
    data?: Record<string, any>;
  }

  export interface CopilotSession {
    readonly sessionId: string;
    send(options: { prompt: string }): Promise<string>;
    getEvents(): Promise<SessionEvent[]>;
    on(handler: (event: SessionEvent) => void): () => void;
    on(eventType: string, handler: (event: SessionEvent) => void): () => void;
    log(
      message: string,
      options?: { level?: "info" | "warning" | "error"; ephemeral?: boolean },
    ): Promise<void>;
  }

  export interface CanvasOpenRequest {
    sessionId: string;
    extensionId: string;
    canvasId: string;
    instanceId: string;
    input?: unknown;
  }

  export interface CanvasOpenResult {
    url?: string;
    title?: string;
    status?: string;
  }

  export interface CanvasAction {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    handler: (ctx: unknown) => unknown;
  }

  export interface CanvasOptions {
    id: string;
    displayName: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    actions?: CanvasAction[];
    open: (ctx: CanvasOpenRequest) => Promise<CanvasOpenResult> | CanvasOpenResult;
    onClose?: (ctx: CanvasOpenRequest) => Promise<void> | void;
  }

  export class Canvas {
    readonly declaration: unknown;
  }

  export function createCanvas(options: CanvasOptions): Canvas;

  export interface JoinSessionConfig {
    /** Emit assistant.message_delta events while responses are generated. */
    streaming?: boolean;
    canvases?: Canvas[];
  }

  export function joinSession(config?: JoinSessionConfig): Promise<CopilotSession>;
}
