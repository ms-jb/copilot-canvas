// Subscribe before loading history; compose independently testable session services.
import { LIMITS } from "../../shared/contract.mjs";
import { createTranscriptStore } from "../../shared/transcript.mjs";
import { createControlsService } from "../controls/service.mjs";
import { createPromptService } from "../prompts/service.mjs";
import { describeSessionError } from "../logging.mjs";
import { createEventSequencer } from "./event-sequencer.mjs";
import { createSendController } from "./send-controller.mjs";
import { createSessionActions } from "./actions.mjs";
import { createQueueTracker } from "./queue.mjs";
import { createContextTracker } from "./context.mjs";
import { createSkillCatalog } from "../skills/catalog.mjs";
export function createSessionBridge(session, { store = createTranscriptStore(), log = () => { }, controls = createControlsService(session, { log }), prompts = createPromptService(session, { log }), coalesceMs = 50, sendTimeoutMs = LIMITS.sendTimeoutMs, } = {}) {
    let disposed = false;
    const events = createEventSequencer({ log, coalesceMs });
    const queue = createQueueTracker(session.rpc?.queue, (state) => {
        if (!disposed)
            events.emitNow({ type: "queue", queue: state });
    }, 
    // `sends` is created below; the tracker only calls this once a client asks to send now.
    { sendImmediate: async (text, requestId) => (await sends.send(text, requestId)).ok });
    const context = createContextTracker(session.rpc, (state) => {
        if (!disposed)
            events.emitNow({ type: "context", context: state });
    }, { log });
    const skills = createSkillCatalog(session.rpc, { log });
    const sends = createSendController({
        send: async (options) => session.send({ ...options, ...(await skills.expand(options.prompt)) }),
    }, {
        log,
        sendTimeoutMs,
        admit(messageId, requestId, mode) {
            if (typeof messageId === "string" && messageId.length > 0) {
                events.emit(store.tagRequest(messageId, requestId));
                if (mode === "enqueue")
                    queue.admitted(messageId, requestId);
            }
        },
    });
    const actions = createSessionActions(session, log);
    function onSessionEvent(event) {
        if (!event.agentId) {
            if (event.type === "user.message") {
                const id = event.data?.messageId ?? event.id;
                if (typeof id === "string")
                    queue.confirmed(id);
            }
            if (["abort", "assistant.idle", "session.idle", "pending_messages.modified"].includes(event.type)) {
                void queue.refresh();
            }
        }
        try {
            events.emit(store.applyEvent(event));
        }
        catch (error) {
            log(`Failed to apply session event: ${describeSessionError(error)}`, "warning");
        }
        try {
            prompts.applyEvent(event);
        }
        catch (error) {
            log(`Failed to track a pending request: ${describeSessionError(error)}`, "warning");
        }
        context.applyEvent(event);
    }
    // History overlaps live events; the transcript store de-duplicates them by event id.
    const unsubscribeSession = session.on(onSessionEvent);
    const unsubscribeControls = controls.subscribe((next) => {
        if (!disposed)
            events.emitNow({ type: "controls", controls: next });
    });
    const unsubscribePrompts = prompts.subscribe((next) => {
        if (!disposed)
            events.emitNow({ type: "prompts", prompts: next });
    });
    const history = (async () => {
        try {
            const historyEvents = await session.getEvents();
            if (!disposed && Array.isArray(historyEvents))
                events.emit(store.mergeHistory(historyEvents));
        }
        catch (error) {
            log(`Could not load session history: ${describeSessionError(error)}`, "warning");
        }
        if (!disposed) {
            void context.refresh();
            await queue.refresh();
        }
    })();
    const ready = Promise.all([history, controls.ready, prompts.ready]).then(() => undefined);
    return {
        sessionId: session.sessionId,
        ready,
        getSnapshot: () => ({
            seq: events.seq,
            snapshot: {
                ...store.snapshot(),
                prompts: prompts.list(),
                queue: queue.snapshot(),
                context: context.snapshot(),
            },
            controls: controls.get(),
        }),
        subscribe: events.subscribe,
        send: sends.send,
        listSkills: () => skills.list(),
        readContext: async () => ((await context.refresh()) === "failed" ? null : context.snapshot()),
        changeQueue: (change) => queue.change(change),
        applyControl: (change) => controls.apply(change),
        reloadExtensions: actions.reloadExtensions,
        stop: async () => {
            const outcome = await actions.stop();
            if (outcome === "stopped")
                void queue.refresh();
            return outcome;
        },
        respond: (requestId, response) => prompts.respond(requestId, response),
        refreshPrompts: () => prompts.refresh(),
        dispose() {
            if (disposed)
                return;
            disposed = true;
            actions.dispose();
            try {
                unsubscribeSession();
            }
            catch {
                // Session may already be disconnected.
            }
            unsubscribeControls();
            controls.dispose();
            unsubscribePrompts();
            prompts.dispose();
            events.dispose();
            sends.dispose();
            queue.dispose();
            context.dispose();
        },
    };
}
