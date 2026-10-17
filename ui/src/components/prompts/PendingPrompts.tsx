import { Alert, Button, Checkbox, NativeSelect, Textarea, TextInput } from "@mantine/core";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { respondToPrompt, type SendContext } from "../../api";
import { MarkdownView } from "../../MarkdownView";
import type {
  FormPrompt,
  FormValue,
  PendingPrompt,
  PermissionKind,
  PermissionPrompt,
  PlanAction,
  PlanPrompt,
  PromptResponse,
  QuestionPrompt,
} from "../../shared";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "../ChatIcons";
import styles from "./PendingPrompts.module.css";

type Answer = (response: PromptResponse) => Promise<void>;

interface Failure {
  tone: "error" | "uncertain";
  message: string;
}

interface PendingPromptsProps {
  prompts: PendingPrompt[];
  context: SendContext | null;
  disabled: boolean;
  assistantName: string;
  onStale: () => void;
}

const MAX_ANSWER = 4000;

const PERMISSION_TITLES: Record<PermissionKind, string> = {
  command: "run a command",
  write: "edit a file",
  read: "read a file",
  path: "access these locations",
  url: "open a web address",
  mcp: "use a tool",
  tool: "use a tool",
  memory: "save a memory",
  extension: "change an extension",
  workflow: "run a workflow",
  other: "continue",
};

const DETAIL_LABELS: Record<PermissionKind, string> = {
  command: "Command",
  write: "Change",
  read: "Location",
  path: "Locations",
  url: "Address",
  mcp: "Arguments",
  tool: "Arguments",
  memory: "Memory",
  extension: "Details",
  workflow: "Workflow",
  other: "Details",
};

const PLAN_ACTION_LABELS: Record<PlanAction, string> = {
  interactive: "Approve and start",
  autopilot: "Approve on autopilot",
  autopilot_fleet: "Approve on autopilot, in parallel",
  exit_only: "Approve, don't start yet",
};

export function promptTitle(prompt: PendingPrompt, assistantName: string): string {
  switch (prompt.kind) {
    case "permission":
      return `Allow ${assistantName} to ${PERMISSION_TITLES[prompt.permission]}?`;
    case "question":
      return `${assistantName} has a question`;
    case "form":
      return `${assistantName} needs a few details`;
    case "plan":
      return "Approve this plan?";
  }
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * The requests the session is waiting on, answered right here. One card is in focus at a time;
 * every decision is an explicit click, nothing is pre-selected, and nothing takes focus away from
 * the composer. A request answered elsewhere simply disappears.
 */
export function PendingPrompts({
  prompts,
  context,
  disabled,
  assistantName,
  onStale,
}: PendingPromptsProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  const [sending, setSending] = useState<string | null>(null);
  // Set synchronously before any await so a double click can never answer twice.
  const inFlight = useRef(new Set<string>());

  const visible = prompts.filter((prompt) => !answered.has(prompt.requestId));
  const index = Math.max(
    0,
    visible.findIndex((prompt) => prompt.requestId === focusedId),
  );
  const current = visible[index];

  // Forget local bookkeeping for requests the session no longer lists.
  useEffect(() => {
    const live = new Set(prompts.map((prompt) => prompt.requestId));
    setAnswered((set) => {
      const next = new Set([...set].filter((id) => live.has(id)));
      return next.size === set.size ? set : next;
    });
    setFailures((map) => {
      const keys = Object.keys(map).filter((id) => live.has(id));
      return keys.length === Object.keys(map).length
        ? map
        : Object.fromEntries(keys.map((id) => [id, map[id]!]));
    });
  }, [prompts]);

  if (!current) return null;
  const requestId = current.requestId;

  const answer: Answer = async (response) => {
    if (!context || disabled || inFlight.current.has(requestId)) return;
    inFlight.current.add(requestId);
    setSending(requestId);
    setFailures((map) => without(map, requestId));
    try {
      const outcome = await respondToPrompt(context, requestId, response);
      switch (outcome.kind) {
        case "accepted":
        case "resolved":
          setAnswered((set) => new Set(set).add(requestId));
          break;
        case "stale":
          onStale();
          break;
        case "rejected":
        case "uncertain":
          setFailures((map) => ({
            ...map,
            [requestId]: {
              tone: outcome.kind === "rejected" ? "error" : "uncertain",
              message: outcome.message,
            },
          }));
          break;
      }
    } finally {
      inFlight.current.delete(requestId);
      setSending((value) => (value === requestId ? null : value));
    }
  };

  const busy = sending === requestId;
  const locked = disabled || context === null || busy;
  const failure = failures[requestId];
  const title = promptTitle(current, assistantName);
  const headingId = `prompt-title-${index}`;
  const go = (step: number) => {
    const next = visible[(index + step + visible.length) % visible.length];
    if (next) setFocusedId(next.requestId);
  };

  return (
    <section className={styles.stack} aria-label="Waiting for your answer">
      <div className={styles.liveRegion} role="status" aria-live="polite">
        {title}
      </div>
      <article className={styles.card} aria-labelledby={headingId} aria-busy={busy}>
        <header className={styles.header}>
          <span className={styles.icon}>
            <AlertIcon size={18} />
          </span>
          <h2 className={styles.title} id={headingId}>
            {title}
          </h2>
          {visible.length > 1 && (
            <nav className={styles.pager} aria-label="Pending requests">
              <button
                type="button"
                className={styles.pagerButton}
                onClick={() => go(-1)}
                aria-label="Previous request"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <span className={styles.count}>
                {index + 1} of {visible.length}
              </span>
              <button
                type="button"
                className={styles.pagerButton}
                onClick={() => go(1)}
                aria-label="Next request"
              >
                <ChevronRightIcon size={16} />
              </button>
            </nav>
          )}
        </header>
        <div className={styles.body} key={requestId}>
          {current.kind === "permission" && (
            <PermissionBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "question" && (
            <QuestionBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "form" && (
            <FormBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {current.kind === "plan" && (
            <PlanBody prompt={current} locked={locked} busy={busy} onAnswer={answer} />
          )}
          {failure && (
            <Alert
              color={failure.tone === "error" ? "red" : "yellow"}
              variant="light"
              icon={<AlertIcon size={16} />}
              title={failure.tone === "error" ? "Your answer wasn't applied" : "Not confirmed yet"}
            >
              {failure.message}
            </Alert>
          )}
        </div>
      </article>
    </section>
  );
}

interface BodyProps<P> {
  prompt: P;
  locked: boolean;
  busy: boolean;
  onAnswer: Answer;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

function PermissionBody({ prompt, locked, busy, onAnswer }: BodyProps<PermissionPrompt>) {
  const [choice, setChoice] = useState<"approve" | "deny" | null>(null);
  const decide = (decision: "approve" | "deny") => {
    setChoice(decision);
    void onAnswer({ kind: "permission", decision });
  };
  return (
    <>
      {prompt.subject && <p className={styles.subject}>{prompt.subject}</p>}
      {prompt.intent && <p className={styles.intent}>{prompt.intent}</p>}
      {prompt.detail && (
        <pre className={styles.detail} tabIndex={0} aria-label={DETAIL_LABELS[prompt.permission]}>
          {prompt.detail}
        </pre>
      )}
      {prompt.warning && (
        <p className={styles.warning}>
          <AlertIcon size={14} />
          <span>{prompt.warning}</span>
        </p>
      )}
      <Actions>
        <Button
          className={styles.button}
          variant="default"
          disabled={locked}
          loading={busy && choice === "deny"}
          onClick={() => decide("deny")}
        >
          Deny
        </Button>
        <Button
          className={styles.button}
          disabled={locked}
          loading={busy && choice === "approve"}
          onClick={() => decide("approve")}
        >
          Allow once
        </Button>
      </Actions>
    </>
  );
}

function QuestionBody({ prompt, locked, busy, onAnswer }: BodyProps<QuestionPrompt>) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const canSend = !locked && text.trim().length > 0;
  const sendText = () => {
    if (!canSend) return;
    setPicked(null);
    void onAnswer({ kind: "question", answer: text.trim(), freeform: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!event.repeat) sendText();
  };
  return (
    <>
      <div className={styles.message}>
        <MarkdownView text={prompt.question} />
      </div>
      {prompt.choices.length > 0 && (
        <div className={styles.choices} role="group" aria-label="Choices">
          {prompt.choices.map((choice) => (
            <Button
              key={choice}
              className={styles.choice}
              variant="default"
              justify="flex-start"
              disabled={locked}
              loading={busy && picked === choice}
              onClick={() => {
                setPicked(choice);
                void onAnswer({ kind: "question", answer: choice, freeform: false });
              }}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      {prompt.allowFreeform && (
        <div className={styles.freeform}>
          <Textarea
            aria-label="Your answer"
            placeholder={
              prompt.choices.length > 0 ? "Or type your own answer…" : "Type your answer…"
            }
            autosize
            minRows={1}
            maxRows={6}
            maxLength={MAX_ANSWER}
            value={text}
            readOnly={busy}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
          />
          <Actions>
            <Button
              className={styles.button}
              disabled={!canSend}
              loading={busy && picked === null}
              onClick={sendText}
            >
              Send answer
            </Button>
          </Actions>
        </div>
      )}
    </>
  );
}

function initialValues(prompt: FormPrompt): Record<string, FormValue> {
  return Object.fromEntries(
    prompt.fields.map((field) => [
      field.name,
      field.default ?? (field.type === "boolean" ? false : ""),
    ]),
  );
}

function FormBody({ prompt, locked, busy, onAnswer }: BodyProps<FormPrompt>) {
  const [values, setValues] = useState(() => initialValues(prompt));
  const [action, setAction] = useState<"accept" | "decline" | null>(null);
  const set = (name: string, value: FormValue) =>
    setValues((current) => ({ ...current, [name]: value }));

  const missing = prompt.fields.some(
    (field) => field.required && field.type !== "boolean" && values[field.name] === "",
  );
  const submit = () => {
    if (locked || missing) return;
    const out: Record<string, FormValue> = {};
    for (const field of prompt.fields) {
      const value = values[field.name];
      if (value === "" || value === undefined) continue;
      const numeric = field.type === "number" || field.type === "integer";
      out[field.name] = numeric && Number.isFinite(Number(value)) ? Number(value) : value;
    }
    setAction("accept");
    void onAnswer({ kind: "form", action: "accept", values: out });
  };
  const decline = () => {
    setAction("decline");
    void onAnswer({ kind: "form", action: "decline" });
  };

  return (
    <>
      {prompt.source && <p className={styles.subject}>{prompt.source}</p>}
      <div className={styles.message}>
        <MarkdownView text={prompt.message} />
      </div>
      {!prompt.supported ? (
        <p className={styles.intent}>This one has to be answered in the Copilot app.</p>
      ) : (
        prompt.fields.length > 0 && (
          <form
            className={styles.fields}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {prompt.fields.map((field) => {
              const value = values[field.name];
              const common = {
                label: field.label,
                description: field.description,
                disabled: locked,
              };
              if (field.type === "boolean") {
                return (
                  <Checkbox
                    key={field.name}
                    {...common}
                    checked={value === true}
                    onChange={(event) => set(field.name, event.currentTarget.checked)}
                  />
                );
              }
              if (field.type === "enum") {
                return (
                  <NativeSelect
                    key={field.name}
                    {...common}
                    required={field.required}
                    value={String(value ?? "")}
                    onChange={(event) => set(field.name, event.currentTarget.value)}
                    data={[
                      { value: "", label: "Choose…", disabled: field.required },
                      ...(field.options ?? []),
                    ]}
                  />
                );
              }
              const numeric = field.type !== "string";
              return (
                <TextInput
                  key={field.name}
                  {...common}
                  required={field.required}
                  type={numeric ? "number" : "text"}
                  inputMode={
                    numeric ? (field.type === "integer" ? "numeric" : "decimal") : undefined
                  }
                  min={field.minimum}
                  max={field.maximum}
                  step={field.type === "integer" ? 1 : numeric ? "any" : undefined}
                  minLength={field.minLength}
                  maxLength={field.maxLength ?? MAX_ANSWER}
                  value={String(value ?? "")}
                  onChange={(event) => set(field.name, event.currentTarget.value)}
                />
              );
            })}
            <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
          </form>
        )
      )}
      <Actions>
        <Button
          className={styles.button}
          variant="default"
          disabled={locked}
          loading={busy && action === "decline"}
          onClick={decline}
        >
          Decline
        </Button>
        {prompt.supported && (
          <Button
            className={styles.button}
            disabled={locked || missing}
            loading={busy && action === "accept"}
            onClick={submit}
          >
            Submit
          </Button>
        )}
      </Actions>
    </>
  );
}

function PlanBody({ prompt, locked, busy, onAnswer }: BodyProps<PlanPrompt>) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  // The recommended action leads visually; nothing is ever chosen on the user's behalf.
  const ordered = prompt.recommended
    ? [prompt.recommended, ...prompt.actions.filter((action) => action !== prompt.recommended)]
    : prompt.actions;

  const approve = (action: PlanAction) => {
    setPending(action);
    void onAnswer({ kind: "plan", approved: true, action });
  };
  const sendFeedback = () => {
    setPending("changes");
    const text = feedback.trim();
    void onAnswer(
      text ? { kind: "plan", approved: false, feedback: text } : { kind: "plan", approved: false },
    );
  };

  return (
    <>
      <div className={styles.message}>
        <MarkdownView text={prompt.summary} />
      </div>
      {prompt.plan && (
        <div className={styles.plan} tabIndex={0} role="region" aria-label="Plan">
          <MarkdownView text={prompt.plan} />
        </div>
      )}
      {revising ? (
        <div className={styles.freeform}>
          <Textarea
            aria-label="What should change?"
            placeholder="What should change?"
            autosize
            minRows={2}
            maxRows={6}
            maxLength={MAX_ANSWER}
            value={feedback}
            readOnly={busy}
            onChange={(event) => setFeedback(event.currentTarget.value)}
          />
          <Actions>
            <Button
              className={styles.button}
              variant="default"
              disabled={locked}
              onClick={() => setRevising(false)}
            >
              Back
            </Button>
            <Button
              className={styles.button}
              disabled={locked}
              loading={busy && pending === "changes"}
              onClick={sendFeedback}
            >
              Send feedback
            </Button>
          </Actions>
        </div>
      ) : (
        <Actions>
          <Button
            className={styles.button}
            variant="default"
            disabled={locked}
            onClick={() => setRevising(true)}
          >
            Request changes
          </Button>
          {ordered.map((action, position) => (
            <Button
              key={action}
              className={styles.button}
              variant={position === 0 ? "filled" : "default"}
              disabled={locked}
              loading={busy && pending === action}
              onClick={() => approve(action)}
            >
              {PLAN_ACTION_LABELS[action]}
            </Button>
          ))}
        </Actions>
      )}
    </>
  );
}
