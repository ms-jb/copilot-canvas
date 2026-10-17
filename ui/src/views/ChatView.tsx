import { useEffect, useMemo, useRef, useState } from "react";
import { makeRequestId, sendMessage } from "../api";
import { ActivityBar } from "../components/ActivityBar";
import { Composer, type ComposerNotice } from "../components/Composer";
import { PendingPrompts } from "../components/prompts/PendingPrompts";
import { Transcript, type PendingMessage } from "../components/Transcript";
import { onSuggestedPrompt } from "../composerDraft";
import { resolvePending } from "../shared";
import styles from "./ChatView.module.css";
import type { ViewProps } from "./types";

interface UncertainSend {
  requestId: string;
  text: string;
}

export function ChatView({ connection }: ViewProps) {
  const { context, phase, config, view, markStale } = connection;
  const assistantName = config?.assistantName || "Copilot";
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<UncertainSend | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Set synchronously before any await so a double click or key repeat can never send twice.
  const inFlight = useRef(false);

  // Optimistic copies disappear as soon as the transcript confirms them, so a message never shows twice.
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

  const pickPrompt = (text: string) => {
    setDraft(text);
    input.current?.focus();
  };

  // Suggestions from elsewhere in the shell (for example the aside) land in this composer.
  useEffect(() => onSuggestedPrompt(pickPrompt), []);

  const submit = async () => {
    const text = draft;
    if (inFlight.current || !context || phase === "stale" || text.trim().length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    setUncertain(null);

    const requestId = makeRequestId();
    const createdAt = new Date().toISOString();
    setPending((current) => [...current, { requestId, text, state: "sending", createdAt }]);

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

  return (
    <div className={styles.chat}>
      <Transcript
        entries={view.entries}
        pending={visiblePending}
        assistantName={assistantName}
        description={config?.description}
        onPickPrompt={pickPrompt}
      />
      <div className={styles.dock}>
        <div className={styles.activity}>
          <div className={styles.activityInner}>
            <PendingPrompts
              prompts={view.prompts}
              context={context}
              disabled={phase === "stale"}
              assistantName={assistantName}
              onStale={markStale}
            />
            <ActivityBar status={view.status} promptShown={view.prompts.length > 0} />
          </div>
        </div>
        <Composer
          connection={connection}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={phase === "stale" || context === null}
          notice={notice}
          assistantName={assistantName}
          inputRef={input}
        />
      </div>
    </div>
  );
}
