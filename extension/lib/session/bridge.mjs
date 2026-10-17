// Subscribe before loading history; compose independently testable session services.
import { LIMITS } from "../../shared/contract.mjs";
import { createTranscriptStore } from "../../shared/transcript.mjs";
import { createControlsService } from "../controls/service.mjs";
import { createPromptService } from "../prompts/service.mjs";
import { describeSessionError } from "../logging.mjs";
import { createEventSequencer } from "./event-sequencer.mjs";
import { createSendController } from "./send-controller.mjs";
import { createSessionActions } from "./actions.mjs";
export function createSessionBridge(session, { store = createTranscriptStore(), log = () => { }, controls = createControlsService(session, { log }), prompts = createPromptService(session, { log }), coalesceMs = 50, sendTimeoutMs = LIMITS.sendTimeoutMs, } = {}) {
    let disposed = false;
    const events = createEventSequencer({ log, coalesceMs });
    const sends = createSendController(session, {
        log,
        sendTimeoutMs,
        admit(messageId, requestId) {
            if (typeof messageId === "string" && messageId.length > 0) {
                events.emit(store.tagRequest(messageId, requestId));
            }
        },
    });
    const actions = createSessionActions(session, log);
    function onSessionEvent(event) {
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
    })();
    const ready = Promise.all([history, controls.ready, prompts.ready]).then(() => undefined);
    return {
        sessionId: session.sessionId,
        ready,
        getSnapshot: () => ({
            seq: events.seq,
            snapshot: { ...store.snapshot(), prompts: prompts.list() },
            controls: controls.get(),
        }),
        subscribe: events.subscribe,
        send: sends.send,
        applyControl: (change) => controls.apply(change),
        reloadExtensions: actions.reloadExtensions,
        stop: actions.stop,
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
        },
    };
}
