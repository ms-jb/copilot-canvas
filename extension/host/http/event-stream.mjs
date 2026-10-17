import { ERROR_CODES, SSE_EVENTS } from "../../shared/contract.mjs";
import { baseHeaders, sendError } from "./responses.mjs";
const MAX_SSE_CLIENTS = 16;
const MAX_SSE_BUFFERED_BYTES = 2 * 1024 * 1024;
export function createEventStream({ bridge, policy, generation, keepaliveMs, }) {
    const clients = new Set();
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
        const ok = client.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        if (!ok && client.res.writableLength > MAX_SSE_BUFFERED_BYTES)
            closeSse(client);
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
        const client = { res, closed: false, keepalive: null, unsubscribe: () => { } };
        // Subscribe and snapshot in the same tick so no event is missed or duplicated.
        client.unsubscribe = bridge.subscribe((event) => {
            switch (event.type) {
                case "entry":
                    writeSse(client, SSE_EVENTS.entry, { seq: event.seq, entry: event.entry });
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
            }
        });
        const { seq, snapshot, controls } = bridge.getSnapshot();
        writeSse(client, SSE_EVENTS.snapshot, { seq, generation, snapshot, controls });
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
            for (const client of Array.from(clients))
                closeSse(client);
        },
    };
}
