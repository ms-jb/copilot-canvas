import { afterEach, expect, it, vi } from "vite-plus/test";
import { createAttachmentStaging } from "../../src/host/session/attachments.mts";
import { createSendController } from "../../src/host/session/send-controller.mts";
import { ATTACHMENT_LIMITS, type SendAttachment } from "../../src/shared/contract.mts";
import { deferred } from "./fixtures";

const png: SendAttachment = {
  name: "screen.png",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
};
afterEach(() => vi.useRealTimers());

it("stages private SDK blobs per session and releases them without touching files", () => {
  const first = createAttachmentStaging();
  const second = createAttachmentStaging();
  const lease = first.stage([png]);
  expect(lease.attachments).toEqual([
    {
      type: "blob",
      data: png.data,
      mimeType: "image/png",
      displayName: "screen.png",
    },
  ]);
  expect(first.sizeBytes).toBe(Buffer.from(png.data, "base64").length);
  expect(second.sizeBytes).toBe(0);
  lease.release();
  lease.release();
  expect(first.sizeBytes).toBe(0);
  expect(lease.attachments).toEqual([]);
  first.dispose();
  second.dispose();
});

it("rejects spoofed images, paths, unsafe names, invalid UTF-8 and false PDFs before staging", () => {
  const staging = createAttachmentStaging();
  for (const file of [
    { ...png, data: Buffer.from("<svg>bad</svg>").toString("base64") },
    { ...png, name: "../screen.png" },
    { ...png, path: "C:\\private\\screen.png" },
    { name: "bad.txt", mimeType: "text/plain", data: "/w==" },
    { name: "bad.txt", mimeType: "text/plain", data: "AA==" },
    { name: "bad.pdf", mimeType: "application/pdf", data: png.data },
  ]) {
    expect(() => staging.stage([file as SendAttachment])).toThrow();
    expect(staging.sizeBytes).toBe(0);
  }
  expect(() => staging.stage(Array(5).fill(png))).toThrow();
  const text: SendAttachment = { name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=" };
  const pdf: SendAttachment = {
    name: "notes.pdf",
    mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.7\n").toString("base64"),
  };
  staging.stage([text, pdf]);
  staging.dispose();
  expect(staging.sizeBytes).toBe(0);
  expect(() => staging.stage([png])).toThrow("closed");
});

it("caps all concurrent staging, expires leases and cleans up on disposal", () => {
  vi.useFakeTimers();
  const staging = createAttachmentStaging();
  const large: SendAttachment = {
    name: "notes.txt",
    mimeType: "text/plain",
    data: Buffer.alloc(ATTACHMENT_LIMITS.maxBytes, 65).toString("base64"),
  };
  staging.stage([large, large]);
  expect(() => staging.stage([large])).toThrow("still being sent");
  expect(() =>
    staging.stage([
      { ...large, data: Buffer.alloc(ATTACHMENT_LIMITS.maxBytes + 1, 65).toString("base64") },
    ]),
  ).toThrow();
  vi.advanceTimersByTime(ATTACHMENT_LIMITS.ttlMs);
  expect(staging.sizeBytes).toBe(0);
  const lease = staging.stage([png]);
  staging.dispose();
  expect(lease.attachments).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("sends blobs once, retains uncertainty and admits a late SDK acknowledgement without resending", async () => {
  vi.useFakeTimers();
  const native = deferred<string>();
  const session = { send: vi.fn(() => native.promise) };
  const admit = vi.fn();
  const controller = createSendController(session, { admit, log: vi.fn(), sendTimeoutMs: 20 });
  const result = controller.send("", "request-1", [png]);
  await vi.advanceTimersByTimeAsync(21);
  expect(await result).toMatchObject({ status: "uncertain" });
  expect(session.send).toHaveBeenCalledWith({
    prompt: "",
    mode: "immediate",
    attachments: [{ type: "blob", data: png.data, mimeType: png.mimeType, displayName: png.name }],
  });
  expect(await controller.send("", "request-1", [png])).toMatchObject({
    code: "duplicate_request",
  });
  native.resolve("message-1");
  await vi.advanceTimersByTimeAsync(0);
  expect(admit).toHaveBeenCalledWith("message-1", "request-1", "immediate");
  expect(session.send).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  controller.dispose();
});

it("refuses invalid bytes before native send and cancels undispatched sends on disposal", async () => {
  const session = { send: vi.fn(async () => "message-1") };
  const controller = createSendController(session, {
    admit: vi.fn(),
    log: vi.fn(),
    sendTimeoutMs: 100,
  });
  expect(await controller.send("test", "request-1", [{ ...png, data: "aGVsbG8=" }])).toMatchObject({
    status: "rejected",
  });
  expect(session.send).not.toHaveBeenCalled();
  const pending = controller.send("test", "request-2", [png]);
  controller.dispose();
  await pending;
  expect(session.send).not.toHaveBeenCalled();
});
