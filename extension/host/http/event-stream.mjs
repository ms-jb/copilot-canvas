import { ERROR_CODES, SSE_EVENTS } from "../../shared/contract.mjs";
import { baseHeaders, sendError } from "./responses.mjs";
const MAX_SSE_CLIENTS = 16;
const MAX_SSE_BUFFERED_BYTES = 2 * 1024 * 1024;
// Recent events kept so a page that reconnects after a short gap gets only what it missed.
const RESUME_EVENTS = 400;
const isStreaming = (item) => "streaming" in item && item.streaming === true;
/** The text `next` adds to `previous`, when nothing else about the item changed; else null. */
function appendedText(previous, next) {
    if (typeof previous.text !== "string" || typeof next.text !== "string")
        return null;
    if (next.text.length <= previous.text.length || !next.text.startsWith(previous.text))
        return null;
    const keys = Object.keys(next);
    if (keys.length !== Object.keys(previous).length)
        return null;
    for (const key of keys) {
        if (key !== "text" && next[key] !== previous[key])
            return null;
    }
    return next.text.slice(previous.text.length);
}
export function createEventStream({ bridge, policy, generation, keepaliveMs, }) {
    const clients = new Set();
    const recent = [];
    // Subscribed before any client, so an event is always in `recent` before a client sees it.
    const unsubscribeRecent = bridge.subscribe((event) => {
        recent.push(event);
        if (recent.length > RESUME_EVENTS)
            recent.shift();
    });
    /** The events a page missed since `lastEventId` (`<generation>:<seq>`), or null to resync. */
    function missedSince(lastEventId) {
        if (typeof lastEventId !== "string")
            return null;
        const split = lastEventId.lastIndexOf(":");
        if (split < 0 || lastEventId.slice(0, split) !== generation)
            return null;
        const last = Number(lastEventId.slice(split + 1));
        const newest = recent.at(-1);
        if (!Number.isInteger(last) || !newest || last > newest.seq || recent[0].seq > last + 1) {
            return null;
        }
        return recent.filter((event) => event.seq > last);
    }
    function closeSse(client) {
        if (client.closed)
            return;
        client.closed = true;
        if (client.keepalive)
            clearInterval(client.keepalive);
        client.unsubscribe();
        clients.delete(client);
        try {
            client.res.end();
        }
        catch {
            // Socket already gone.
        }
    }
    function writeSse(client, name, data) {
        if (client.closed)
            return;
        const seq = data.seq;
        const id = seq === undefined ? "" : `id: ${generation}:${seq}\n`;
        const ok = client.res.write(`${id}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        if (!ok && client.res.writableLength > MAX_SSE_BUFFERED_BYTES)
            closeSse(client);
    }
    /**
     * Sends a streaming item as an `append` of its new text when this client already has the rest,
     * otherwise whole. A reply streamed in n deltas then costs O(n) bytes instead of O(n²).
     */
    function writeItem(client, seq, target, item) {
        const key = `${target}:${item.id}`;
        const previous = client.streaming.get(key);
        const streaming = isStreaming(item);
        if (streaming)
            client.streaming.set(key, item);
        else
            client.streaming.delete(key);
        const text = previous && streaming ? appendedText(previous, item) : null;
        if (text !== null) {
            const data = { seq, target, id: item.id, text };
            writeSse(client, SSE_EVENTS.append, data);
        }
        else if (target === "entry") {
            writeSse(client, SSE_EVENTS.entry, { seq, entry: item });
        }
        else {
            writeSse(client, SSE_EVENTS.activity, { seq, item });
        }
    }
    function handleEvents(req, res) {
        if (policy.staleGeneration(req)) {
            sendError(res, ERROR_CODES.staleProvider, "The provider was restarted.");
            return;
        }
        res.writeHead(200, {
            ...baseHeaders("text/event-stream; charset=utf-8"),
            connection: "keep-alive",
            "x-accel-buffering": "no",
        });
        res.flushHeaders();
        req.socket.setNoDelay(true);
        req.socket.setTimeout(0);
        const client = {
            res,
            closed: false,
            keepalive: null,
            unsubscribe: () => { },
            streaming: new Map(),
        };
        const dispatch = (event) => {
            switch (event.type) {
                case "entry":
                    writeItem(client, event.seq, "entry", event.entry);
                    break;
                case "status":
                    writeSse(client, SSE_EVENTS.status, { seq: event.seq, status: event.status });
                    break;
                case "controls":
                    writeSse(client, SSE_EVENTS.controls, { seq: event.seq, controls: event.controls });
                    break;
                case "prompts":
                    writeSse(client, SSE_EVENTS.prompts, { seq: event.seq, prompts: event.prompts });
                    break;
                case "queue":
                    writeSse(client, SSE_EVENTS.queue, { seq: event.seq, queue: event.queue });
                    break;
                case "context":
                    writeSse(client, SSE_EVENTS.context, { seq: event.seq, context: event.context });
                    break;
                case "activity":
                    writeItem(client, event.seq, "activity", event.item);
                    break;
            }
        };
        // Subscribe and catch up in the same tick so no event is missed or duplicated. A page whose
        // Last-Event-ID is still covered gets the events it missed; any other gets a snapshot.
        const missed = missedSince(req.headers["last-event-id"]);
        if (missed) {
            missed.forEach(dispatch);
            client.unsubscribe = bridge.subscribe(dispatch);
        }
        else {
            client.unsubscribe = bridge.subscribe(dispatch);
            const { seq, snapshot, controls } = bridge.getSnapshot();
            writeSse(client, SSE_EVENTS.snapshot, { seq, generation, snapshot, controls });
            for (const entry of snapshot.entries) {
                if (isStreaming(entry))
                    client.streaming.set(`entry:${entry.id}`, entry);
            }
            for (const item of snapshot.activity ?? []) {
                if (isStreaming(item))
                    client.streaming.set(`activity:${item.id}`, item);
            }
        }
        bridge.refreshPrompts();
        client.keepalive = setInterval(() => {
            if (!client.closed)
                res.write(": keepalive\n\n");
        }, keepaliveMs);
        client.keepalive.unref();
        clients.add(client);
        while (clients.size > MAX_SSE_CLIENTS) {
            const oldest = clients.values().next().value;
            if (!oldest)
                break;
            closeSse(oldest);
        }
        const onClose = () => closeSse(client);
        req.on("close", onClose);
        res.on("close", onClose);
        res.on("error", onClose);
    }
    return {
        handleEvents,
        close() {
            unsubscribeRecent();
            for (const client of Array.from(clients))
                closeSse(client);
        },
    };
}
