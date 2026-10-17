import { useEffect, useMemo, useRef, useState } from "react";
import { makeRequestId, sendMessage } from "../api";
import { Composer, type ComposerNotice } from "../components/Composer";
import { StatusChip } from "../components/StatusChip";
import { Transcript, type PendingMessage } from "../components/Transcript";
import { resolvePending } from "../shared";
import type { ViewProps } from "./types";

interface UncertainSend {
  requestId: string;
  text: string;
}

export function ChatView({ connection }: ViewProps) {
  const { context, phase, view, markStale } = connection;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<UncertainSend | null>(null);
  // Set synchronously before any await so a double click or key repeat can never send twice.
  const inFlight = useRef(false);

  const visiblePending = useMemo(
    () => resolvePending(pending, view.entries),
    [pending, view.entries],
  );

  useEffect(() => {
    if (visiblePending.length !== pending.length) setPending(visiblePending);
  }, [visiblePending, pending.length]);

  // A send we were unsure about can still show up in the transcript (late acknowledgement).
  useEffect(() => {
    if (!uncertain) return;
    const confirmed = view.entries.some(
      (entry) => entry.kind === "user" && entry.requestId === uncertain.requestId,
    );
    if (!confirmed) return;
    setUncertain(null);
    setNotice(null);
    setDraft((current) => (current === uncertain.text ? "" : current));
  }, [uncertain, view.entries]);

  const submit = async () => {
    const text = draft;
    if (inFlight.current || !context || phase === "stale" || text.trim().length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    setUncertain(null);

    const requestId = makeRequestId();
    setPending((current) => [...current, { requestId, text, state: "sending" }]);

    try {
      const outcome = await sendMessage(context, requestId, text);
      switch (outcome.kind) {
        case "accepted":
          setPending((current) =>
            current.map((item) =>
              item.requestId === requestId
                ? { ...item, state: "accepted", messageId: outcome.messageId }
                : item,
            ),
          );
          setDraft("");
          break;
        case "rejected":
          setPending((current) => current.filter((item) => item.requestId !== requestId));
          setNotice({ kind: "error", message: outcome.message });
          break;
        case "stale":
          setPending((current) => current.filter((item) => item.requestId !== requestId));
          markStale();
          break;
        case "uncertain":
          // Keep the draft and never resend automatically; the user decides after checking.
          setPending((current) => current.filter((item) => item.requestId !== requestId));
          setUncertain({ requestId, text });
          setNotice({ kind: "uncertain", message: outcome.message });
          break;
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const disabledReason =
    phase === "stale"
      ? "The provider restarted. Reload this panel to send messages."
      : context === null
        ? "Connecting…"
        : undefined;

  return (
    <div className="chat-view">
      <div className="chat-status">
        <StatusChip status={view.status} />
      </div>
      <Transcript entries={view.entries} pending={visiblePending} />
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submit()}
        busy={busy}
        disabledReason={disabledReason}
        notice={notice}
      />
    </div>
  );
}
