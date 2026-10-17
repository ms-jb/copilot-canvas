import { expect, it } from "vite-plus/test";
import {
  ATTACHMENT_LIMITS,
  validateSendPayload,
  transcriptAttachments,
  validateEntry,
} from "../src/shared/contract.mts";
import { createTranscriptStore } from "../src/shared/transcript.mts";

const png = {
  name: "screen.png",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
};
const payload = { requestId: "request-1", sessionId: "session-1", text: "Look at this." };

it("accepts optional attachments, attachment-only sends and unchanged text-only sends", () => {
  expect(validateSendPayload(payload)).toEqual({
    ok: true,
    value: { ...payload, mode: "immediate" },
  });
  expect(validateSendPayload({ ...payload, attachments: [] }).ok).toBe(true);
  expect(validateSendPayload({ ...payload, text: "", attachments: [png] }).ok).toBe(true);
  expect(
    validateSendPayload({
      ...payload,
      attachments: [png, { name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=" }],
    }).ok,
  ).toBe(true);
});

it("rejects paths, URLs, executable images, unsafe names, unknown fields and malformed base64", () => {
  const badAttachments: unknown[] = [
    null,
    {},
    "file.png",
    [null],
    [{ ...png, path: "C:\\secrets.txt" }],
    [{ ...png, url: "https://example.test/image" }],
    [{ ...png, type: "file" }],
    [{ ...png, mimeType: "image/svg+xml" }],
    [{ ...png, mimeType: "image/png; charset=utf-8" }],
    [{ ...png, data: "data:image/png;base64,aGVsbG8=" }],
    [{ ...png, data: "" }],
    [{ ...png, data: "aaaa aaaa" }],
    [{ ...png, data: "a===" }],
    [{ ...png, data: "ab==" }],
    [{ ...png, data: "abc" }],
    [{ ...png, data: 123 }],
    ...[
      "../screen.png",
      "C:\\screen.png",
      "/screen.png",
      "CON.png",
      "screen.png.exe",
      "bad\u0000.png",
      "bad\u202e.png",
      "bad.png ",
      ".hidden.png",
      "a".repeat(121) + ".png",
    ].map((name) => [{ ...png, name }]),
  ];
  for (const attachments of badAttachments) {
    expect(
      validateSendPayload({ ...payload, attachments }).ok,
      JSON.stringify(attachments).slice(0, 120),
    ).toBe(false);
  }
  expect(validateSendPayload({ ...payload, text: "", attachments: [] }).ok).toBe(false);
});

it("limits count, individual bytes and total decoded bytes", () => {
  expect(validateSendPayload({ ...payload, attachments: Array(5).fill(png) }).ok).toBe(false);
  const data = Buffer.alloc(ATTACHMENT_LIMITS.maxBytes).toString("base64");
  expect(validateSendPayload({ ...payload, attachments: [{ ...png, data }] }).ok).toBe(true);
  expect(
    validateSendPayload({
      ...payload,
      attachments: [
        { ...png, data: Buffer.alloc(ATTACHMENT_LIMITS.maxBytes + 1).toString("base64") },
      ],
    }).ok,
  ).toBe(false);
  expect(validateSendPayload({ ...payload, attachments: Array(3).fill({ ...png, data }) }).ok).toBe(
    false,
  );
});

it("projects inline image previews and passive filename chips, never file paths or URLs", () => {
  const native = { type: "blob", displayName: png.name, mimeType: png.mimeType, data: png.data };
  expect(transcriptAttachments([native])).toEqual([
    { name: png.name, preview: { mimeType: png.mimeType, data: png.data } },
  ]);
  expect(
    transcriptAttachments([
      { type: "file", displayName: "notes.txt", path: "C:\\private\\notes.txt" },
      { ...native, data: undefined, assetId: "sha256:secret" },
      { ...native, displayName: "../private.png" },
      { ...native, mimeType: "image/svg+xml", data: "PHN2Zz4=" },
    ]),
  ).toMatchObject([
    { name: "notes.txt" },
    { name: "screen.png" },
    { name: "Attachment 3" },
    { name: "screen.png" },
  ]);
  expect(
    transcriptAttachments([
      { ...native, data: Buffer.alloc(ATTACHMENT_LIMITS.maxPreviewBytes + 1).toString("base64") },
    ]),
  ).toEqual([{ name: "screen.png" }]);
  const entry = { id: "user:1", kind: "user", text: "", timestamp: "now" };
  expect(
    validateEntry({
      ...entry,
      attachments: [
        {
          name: "screen.png",
          preview: {
            mimeType: "image/png",
            data: "bm90IGFuIGltYWdl",
          },
        },
      ],
    }),
  ).toBe(false);
});

it("keeps attachment-only user events visible and hides injected messages", () => {
  const store = createTranscriptStore();
  store.applyEvent({
    id: "event-1",
    type: "user.message",
    timestamp: "2026-10-17T12:00:00Z",
    data: {
      content: "",
      messageId: "message-1",
      attachments: [
        { type: "blob", displayName: png.name, mimeType: png.mimeType, data: png.data },
      ],
    },
  });
  expect(store.snapshot().entries[0]).toMatchObject({
    text: "",
    attachments: [{ name: "screen.png", preview: { data: png.data } }],
  });
  store.applyEvent({
    id: "hidden",
    type: "user.message",
    timestamp: "now",
    data: { content: "", source: "system", attachments: [png] },
  });
  expect(store.snapshot().entries).toHaveLength(1);
});
