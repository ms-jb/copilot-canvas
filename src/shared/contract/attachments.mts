import { ERROR_CODES } from "./errors.mts";
import { isPlainObject, makeError, type ValidationResult } from "./validation.mts";

export const ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 4,
  maxBytes: 5 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxSendBodyBytes: 17 * 1024 * 1024,
  maxNameChars: 120,
  maxPreviewBytes: 64 * 1024,
  ttlMs: 10 * 60 * 1000,
});

export const ATTACHMENT_EXTENSIONS = Object.freeze({
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "log"],
  "text/markdown": ["md"],
  "text/csv": ["csv"],
  "application/json": ["json"],
});
export type AttachmentMimeType = keyof typeof ATTACHMENT_EXTENSIONS;

export interface SendAttachment {
  name: string;
  mimeType: AttachmentMimeType;
  /** Standard base64, without a data URL prefix. Paths and URLs are never accepted. */
  data: string;
}

export interface TranscriptAttachment {
  name: string;
  /** Present only for a small, validated inline image. Never an external URL or host path. */
  preview?: { mimeType: AttachmentMimeType; data: string };
}

export function isAttachmentMimeType(value: unknown): value is AttachmentMimeType {
  return typeof value === "string" && Object.hasOwn(ATTACHMENT_EXTENSIONS, value);
}

export function isSafeAttachmentName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ATTACHMENT_LIMITS.maxNameChars &&
    /^[\p{L}\p{N}][\p{L}\p{N} ._()-]*$/u.test(value) &&
    !/[. ]$/.test(value) &&
    !value.includes("..") &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
  );
}

export function attachmentByteLength(data: string): number {
  return (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

/** Reject ambiguous/nonstandard base64 before decoding it at either edge. */
export function validAttachmentData(data: unknown, maxBytes: number): data is string {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
    attachmentByteLength(data) > maxBytes
  )
    return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (data.endsWith("==")) return alphabet.indexOf(data.at(-3)!) % 16 === 0;
  if (data.endsWith("=")) return alphabet.indexOf(data.at(-2)!) % 4 === 0;
  return true;
}

export function validateAttachments(value: unknown): ValidationResult<SendAttachment[]> {
  if (!Array.isArray(value) || value.length > ATTACHMENT_LIMITS.maxCount) {
    return makeError(ERROR_CODES.badRequest, "Attach at most four files.");
  }
  let total = 0;
  const attachments: SendAttachment[] = [];
  for (const item of value) {
    if (
      !isPlainObject(item) ||
      Object.keys(item).some((key) => !["name", "mimeType", "data"].includes(key)) ||
      !isSafeAttachmentName(item.name) ||
      !isAttachmentMimeType(item.mimeType)
    )
      return makeError(ERROR_CODES.badRequest, "An attachment has an invalid name, type or field.");
    const extension = item.name.split(".").at(-1)?.toLowerCase() ?? "";
    const extensions: readonly string[] = ATTACHMENT_EXTENSIONS[item.mimeType];
    if (!extensions.includes(extension)) {
      return makeError(ERROR_CODES.badRequest, "The attachment's extension must match its type.");
    }
    if (!validAttachmentData(item.data, ATTACHMENT_LIMITS.maxBytes)) {
      return makeError(ERROR_CODES.badRequest, "Attachment data must be base64, up to 5 MiB.");
    }
    total += attachmentByteLength(item.data);
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
      return makeError(ERROR_CODES.payloadTooLarge, "Attachments must total no more than 12 MiB.");
    }
    attachments.push({ name: item.name, mimeType: item.mimeType, data: item.data });
  }
  return { ok: true, value: attachments };
}

/** Signature checks are shared with the host; SVG/HTML are never image previews. */
export function sniffImage(bytes: Uint8Array): AttachmentMimeType | undefined {
  const starts = (magic: number[], offset = 0) =>
    magic.every((byte, index) => bytes[offset + index] === byte);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (starts([255, 216, 255])) return "image/jpeg";
  if (starts([71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97)
    return "image/gif";
  if (starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8)) return "image/webp";
  return undefined;
}

export function validateTranscriptAttachment(value: unknown): value is TranscriptAttachment {
  if (!isPlainObject(value) || !isSafeAttachmentName(value.name)) return false;
  if (value.preview === undefined) return true;
  const preview = value.preview;
  return (
    isPlainObject(preview) &&
    isAttachmentMimeType(preview.mimeType) &&
    preview.mimeType.startsWith("image/") &&
    validAttachmentData(preview.data, ATTACHMENT_LIMITS.maxPreviewBytes) &&
    sniffImage(Uint8Array.from(atob(preview.data.slice(0, 16)), (c) => c.charCodeAt(0))) ===
      preview.mimeType
  );
}

/** Project only display names and small inline image bytes, never native paths or references. */
export function transcriptAttachments(value: unknown): TranscriptAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, ATTACHMENT_LIMITS.maxCount).flatMap((item, index) => {
    if (!isPlainObject(item)) return [];
    const candidate = typeof item.name === "string" ? item.name : item.displayName;
    const name = isSafeAttachmentName(candidate) ? candidate : `Attachment ${index + 1}`;
    const attachment = { name, preview: { mimeType: item.mimeType, data: item.data } };
    return [validateTranscriptAttachment(attachment) ? attachment : { name }];
  });
}
