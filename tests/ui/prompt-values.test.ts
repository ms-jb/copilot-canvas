import { expect, it } from "vite-plus/test";
import {
  answerValues,
  hasMissingValues,
  initialValues,
} from "../../ui/src/features/prompts/form-values";
import { promptTitle } from "../../ui/src/features/prompts/labels";
import type { FormPrompt, PendingPrompt } from "../../ui/src/shared";

const prompt: FormPrompt = {
  requestId: "form-request",
  createdAt: "2026-10-17T12:00:00Z",
  kind: "form",
  message: "Enter details",
  supported: true,
  fields: [
    { name: "name", label: "Name", type: "string", required: true },
    { name: "enabled", label: "Enabled", type: "boolean", required: true },
    { name: "count", label: "Count", type: "integer", required: false, default: 0 },
    { name: "ratio", label: "Ratio", type: "number", required: false },
    { name: "choice", label: "Choice", type: "enum", required: false },
  ],
};

it("initializes drafts without selecting a choice or accepting the form", () => {
  expect(initialValues(prompt)).toEqual({
    name: "",
    enabled: false,
    count: 0,
    ratio: "",
    choice: "",
  });
  expect(hasMissingValues(prompt, initialValues(prompt))).toBe(true);
  expect(hasMissingValues(prompt, { ...initialValues(prompt), name: "Canvas" })).toBe(false);
});

it("preserves defaults including false, zero and empty strings", () => {
  const withDefaults: FormPrompt = {
    ...prompt,
    fields: prompt.fields.map((field) => ({
      ...field,
      default: field.type === "boolean" ? false : field.type === "integer" ? 0 : "",
    })),
  };
  expect(initialValues(withDefaults)).toEqual(initialValues(prompt));
});

it("serializes only described, nonempty fields and converts finite numeric drafts", () => {
  const values = {
    name: "  Canvas  ",
    enabled: false,
    count: "3",
    ratio: "0.25",
    choice: "",
    unrelated: "ignored",
  };
  expect(answerValues(prompt, values)).toEqual({
    name: "  Canvas  ",
    enabled: false,
    count: 3,
    ratio: 0.25,
  });
  expect(values.count).toBe("3");
  expect(values.unrelated).toBe("ignored");
});

it("leaves invalid numeric values for authoritative host validation", () => {
  expect(answerValues(prompt, { count: "NaN", ratio: "Infinity" })).toEqual({
    count: "NaN",
    ratio: "Infinity",
  });
});

it("retains the titles for every prompt kind", () => {
  const base = { requestId: "request-id", createdAt: prompt.createdAt };
  const prompts: PendingPrompt[] = [
    { ...base, kind: "permission", permission: "command", detail: "echo hello" },
    { ...base, kind: "question", question: "Where?", choices: [], allowFreeform: true },
    prompt,
    { ...base, kind: "plan", summary: "Plan", plan: "", actions: ["interactive"] },
  ];
  expect(prompts.map((value) => promptTitle(value, "Copilot"))).toEqual([
    "Allow Copilot to run a command?",
    "Copilot has a question",
    "Copilot needs a few details",
    "Approve this plan?",
  ]);
});
