import { expect, it } from "vite-plus/test";
import {
  attachmentFileName,
  attachmentFileType,
  attachmentSelectionError,
  clipboardFiles,
} from "../../ui/src/features/attachments/files";
import { ATTACHMENT_LIMITS, isSafeAttachmentName } from "../../src/shared/contract.mts";

it("extracts file clipboard items once, falls back to files and leaves ordinary text alone", () => {
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  expect(
    clipboardFiles({
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => file },
      ],
      files: [file],
    }),
  ).toEqual([file]);
  expect(
    clipboardFiles({ items: [{ kind: "file", getAsFile: () => null }], files: [file] }),
  ).toEqual([file]);
  expect(clipboardFiles({ items: [{ kind: "string", getAsFile: () => null }], files: [] })).toEqual(
    [],
  );
});

it("accepts supported files, infers missing types and rejects executable images", () => {
  expect(attachmentFileType({ name: "picture.JPG", type: "" })).toBe("image/jpeg");
  expect(attachmentFileType({ name: "notes.txt", type: "text/plain" })).toBe("text/plain");
  expect(attachmentFileType({ name: "notes.md", type: "application/octet-stream" })).toBe(
    "text/markdown",
  );
  expect(attachmentFileType({ name: "diagram.svg", type: "image/svg+xml" })).toBeNull();
  expect(attachmentFileType({ name: "program.exe", type: "" })).toBeNull();
});

it("makes safe display names without preserving paths or ambiguous extensions", () => {
  for (const name of [
    "../screen.png",
    "C:\\Users\\private\\screenshot.png",
    "CON.png",
    "bad\u202e.png",
    "a".repeat(250) + ".png",
    "",
  ]) {
    expect(isSafeAttachmentName(attachmentFileName(name, "image/png"))).toBe(true);
  }
  expect(attachmentFileName("C:\\Users\\private\\screenshot.png", "image/png")).toBe(
    "screenshot.png",
  );
  expect(attachmentFileName("image.exe", "image/png")).toBe("image.png");
});

it("enforces limits before reading any file bytes", () => {
  const file = { size: 10, name: "screen.png", type: "image/png" };
  expect(attachmentSelectionError([file], 0, 0)).toBeNull();
  expect(attachmentSelectionError([file], 4, 0)).toContain("four");
  expect(attachmentSelectionError([{ ...file, size: 0 }], 0, 0)).toContain("5 MiB");
  expect(
    attachmentSelectionError([{ ...file, size: ATTACHMENT_LIMITS.maxBytes + 1 }], 0, 0),
  ).toContain("5 MiB");
  expect(attachmentSelectionError([file], 0, ATTACHMENT_LIMITS.maxTotalBytes)).toContain("12 MiB");
});
