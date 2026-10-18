import { useEffect, useMemo, useRef, useState } from "react";
import { makeRequestId, requestQueueChange, requestStop, sendMessage } from "../api";
import { ActivityBar } from "../components/ActivityBar";
import { Composer, type ComposerNotice } from "../components/Composer";
import { PendingPrompts } from "../features/prompts/PendingPrompts";
import { useStopOnEscape } from "../components/stopOnEscape";
import { Transcript, type PendingMessage } from "../components/Transcript";
import { QueuedMessages, queueRows } from "../components/QueuedMessages";
import { onSuggestedPrompt } from "../composerDraft";
import { resolvePending, transcriptAttachments, type QueueChange, type SendMode } from "../shared";
import { useAttachments } from "../features/attachments/useAttachments";
import { appendDictation } from "../features/dictation/model";
import styles from "./ChatView.module.css";
import type { ViewProps } from "./types";

interface UncertainSend {
  requestId: string;
  text: string;
  attachmentIds: number[];
}

export function ChatView({ connection }: ViewProps) {
  const { context, phase, config, view, markStale } = connection;
  const assistantName = config?.assistantName || "Copilot";
  // Nothing can reach the session: keep drafts, but don't let a send or an answer start.
  const locked = phase === "stale" || phase === "offline";
  const [draft, setDraft] = useState("");
  const attachments = useAttachments();
  const removeAttachments = attachments.remove;
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<UncertainSend | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Set synchronously before any await so a double click or key repeat can never send twice.
  const inFlight = useRef(false);
  const [stopping, setStopping] = useState(false);
  const running = view.status.phase === "working" || view.status.phase === "waiting";

  const stop = async () => {
    if (stopping || !context) return;
    setStopping(true);
    try {
      const outcome = await requestStop(context);
      if (outcome.kind === "stale") markStale();
      else if (outcome.kind === "failed") setNotice({ kind: "error", message: outcome.message });
    } finally {
      setStopping(false);
    }
  };
  const onStop = running && context && !locked ? () => void stop() : undefined;
  useStopOnEscape(root, onStop);

  // Optimistic copies disappear as soon as the transcript confirms them, so a message never shows twice.
  const visiblePending = useMemo(
    () => resolvePending(pending, view.entries, view.queue?.removedRequestIds),
    [pending, view.entries, view.queue],
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
    removeAttachments(uncertain.attachmentIds);
  }, [uncertain, view.entries, removeAttachments]);

  const changeQueue = async (change: QueueChange): Promise<string | null> => {
    if (!context || locked) return "Not connected.";
    const outcome = await requestQueueChange(context, change);
    if (outcome.kind === "stale") markStale();
    return outcome.kind === "done" || outcome.kind === "gone" ? null : outcome.message;
  };

  const pickPrompt = (text: string) => {
    setDraft(text);
    input.current?.focus();
  };

  // Suggestions from elsewhere in the shell (for example the aside) land in this composer.
  useEffect(() => onSuggestedPrompt(pickPrompt), []);

  const submit = async (mode: SendMode = "immediate", override?: string) => {
    const text = override ?? draft;
    if (
      inFlight.current ||
      attachments.reading ||
      !context ||
      locked ||
      (text.trim().length === 0 && attachments.items.length === 0)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    setUncertain(null);

    const requestId = makeRequestId();
    const sentItems = attachments.items;
    const files = sentItems.map((item) => item.file);
    const createdAt = new Date().toISOString();
    setPending((current) => [
      ...current,
      {
        requestId,
        text,
        state: "sending",
        createdAt,
        attachments: transcriptAttachments(files),
        mode,
      },
    ]);

    try {
      const outcome = await sendMessage(context, requestId, text, files, mode);
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
          attachments.remove(sentItems.map((item) => item.id));
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
          setUncertain({ requestId, text, attachmentIds: sentItems.map((item) => item.id) });
          setNotice({ kind: "uncertain", message: outcome.message });
          break;
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={styles.chat} ref={root}>
      <Transcript
        entries={view.entries}
        pending={visiblePending.filter((item) => item.mode !== "enqueue")}
        activity={view.activity}
        live={running}
        streaming={view.status.phase === "working"}
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
              disabled={locked}
              assistantName={assistantName}
              onStale={markStale}
            />
            <ActivityBar status={view.status} promptShown={view.prompts.length > 0} />
            <QueuedMessages
              rows={queueRows(
                view.queue?.items,
                visiblePending.filter((item) => item.mode === "enqueue"),
              )}
              onChange={changeQueue}
              disabled={locked}
            />
          </div>
        </div>
        <Composer
          connection={connection}
          value={draft}
          onChange={setDraft}
          onSubmit={(mode, text) => void submit(mode, text)}
          busy={busy}
          disabled={locked || context === null}
          notice={notice}
          assistantName={assistantName}
          inputRef={input}
          onStop={onStop}
          stopping={stopping}
          attachments={attachments}
          onDictation={(text) => {
            setDraft((current) => appendDictation(current, text));
            input.current?.focus();
          }}
        />
      </div>
    </div>
  );
}
