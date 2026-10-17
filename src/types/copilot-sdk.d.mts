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

  // Session settings RPCs. Marked experimental by the SDK, so every member is optional here and
  // the host feature-detects each function at runtime before offering the matching control.
  export type SessionMode = "interactive" | "plan" | "autopilot";
  export type ContextTier = "default" | "long_context";

  export interface CurrentModel {
    modelId?: string;
    reasoningEffort?: string;
    contextTier?: ContextTier;
  }

  export interface ModeSetResult {
    status?: string;
    modelChanged?: boolean;
    modeApplied?: boolean;
    message?: string;
    warning?: string;
  }

  export interface ModelSwitchToRequest {
    modelId: string;
    reasoningEffort?: string | null;
    contextTier?: ContextTier;
    source?: "model_picker";
  }

  export interface ModelSwitchToResult {
    modelId?: string;
    deferred?: boolean;
    status?: string;
    message?: string;
    modelState?: CurrentModel;
  }

  export interface SessionModelList {
    list: unknown[];
  }

  export interface SessionModeRpc {
    get?: () => Promise<SessionMode>;
    set?: (params: { mode: SessionMode; expectedMode?: SessionMode }) => Promise<ModeSetResult>;
  }

  export interface SessionModelRpc {
    getCurrent?: () => Promise<CurrentModel>;
    switchTo?: (params: ModelSwitchToRequest) => Promise<ModelSwitchToResult>;
    setReasoningEffort?: (params: {
      reasoningEffort: string;
    }) => Promise<{ reasoningEffort: string }>;
    list?: (params?: { skipCache?: boolean }) => Promise<SessionModelList>;
  }

  export interface SessionRpc {
    queue?: { pendingItems?: () => Promise<unknown> };
    tools?: {
      execute?: (request: {
        name: string;
        arguments: Record<string, never>;
        toolCallId: string;
      }) => Promise<unknown>;
    };
    mode?: SessionModeRpc;
    model?: SessionModelRpc;
    permissions?: SessionPermissionsRpc;
    ui?: SessionUiRpc;
    extensions?: { reload?: () => Promise<void> };
  }

  // Pending-request RPCs (experimental). Feature-detected at runtime like the settings above.
  export type PermissionDecision =
    | { kind: "approve-once"; approvedInteractively?: boolean }
    | { kind: "reject"; feedback?: string };

  export interface PermissionDecisionRequest {
    requestId: string;
    result: PermissionDecision;
    decisionContext?: {
      outcome: "auto_approved" | "autopilot_denied" | "prompted_user";
      source: "assisted_approval" | "human_response" | "host_policy" | "unattended_fallback";
      surface: "tui" | "prompt_mode" | "copilot_app" | "acp" | "sdk";
      responseCapability?: "interactive" | "headless" | "none";
    };
  }

  export interface PendingPermissionRequestList {
    items: { requestId: string; request: unknown; recoveryEpisodeId?: string }[];
  }

  export interface SessionPermissionsRpc {
    handlePendingPermissionRequest?: (
      params: PermissionDecisionRequest,
    ) => Promise<{ success: boolean }>;
    pendingRequests?: () => Promise<PendingPermissionRequestList>;
  }

  export type ExitPlanModeAction = "exit_only" | "interactive" | "autopilot" | "autopilot_fleet";

  export interface SessionUiRpc {
    handlePendingUserInput?: (params: {
      requestId: string;
      response: { answer: string; wasFreeform: boolean };
    }) => Promise<{ success: boolean }>;
    handlePendingElicitation?: (params: {
      requestId: string;
      result: {
        action: "accept" | "decline" | "cancel";
        content?: Record<string, string | number | boolean | string[]>;
      };
    }) => Promise<{ success: boolean }>;
    handlePendingExitPlanMode?: (params: {
      requestId: string;
      response: {
        approved: boolean;
        selectedAction?: ExitPlanModeAction;
        autoApproveEdits?: boolean;
        feedback?: string;
      };
    }) => Promise<{ success: boolean }>;
  }

  export interface CopilotSession {
    readonly sessionId: string;
    readonly rpc?: SessionRpc;
    send(options: {
      prompt: string;
      mode?: "immediate" | "enqueue";
      attachments?: { type: "blob"; data: string; mimeType: string; displayName?: string }[];
    }): Promise<string>;
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
