import { Button, Checkbox, NativeSelect, TextInput } from "@mantine/core";
import { useState } from "react";
import { MarkdownView } from "../../MarkdownView";
import type { FormPrompt, FormValue } from "../../shared";
import { Actions, MAX_ANSWER, type BodyProps } from "./PromptBody";
import { answerValues, hasMissingValues, initialValues } from "./form-values";
import styles from "./PendingPrompts.module.css";

export function FormBody({ prompt, locked, busy, onAnswer }: BodyProps<FormPrompt>) {
  const [values, setValues] = useState(() => initialValues(prompt));
  const [action, setAction] = useState<"accept" | "decline" | null>(null);
  const set = (name: string, value: FormValue) =>
    setValues((current) => ({ ...current, [name]: value }));

  const missing = hasMissingValues(prompt, values);
  const submit = () => {
    if (locked || missing) return;
    const out = answerValues(prompt, values);
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
