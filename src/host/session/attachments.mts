import {
  ATTACHMENT_LIMITS,
  attachmentByteLength,
  sniffImage,
  validateAttachments,
  type SendAttachment,
} from "../../shared/contract/attachments.mts";

export interface NativeAttachment {
  type: "blob";
  data: string;
  mimeType: string;
  displayName: string;
}

/** One bridge's private staging memory. No browser-supplied path is ever read or written. */
export function createAttachmentStaging() {
  const leases = new Set<{ bytes: number; attachments: NativeAttachment[]; release: () => void }>();
  let totalBytes = 0;
  let disposed = false;

  function stage(input: readonly SendAttachment[]) {
    if (disposed) throw new Error("The attachment session is closed.");
    const parsed = validateAttachments(input);
    if (!parsed.ok) throw new Error(parsed.message);
    const bytes = parsed.value.reduce((sum, item) => sum + attachmentByteLength(item.data), 0);
    if (totalBytes + bytes > ATTACHMENT_LIMITS.maxTotalBytes) {
      throw new Error(
        "Another message's attachments are still being sent. Wait before sending more.",
      );
    }
    for (const item of parsed.value) {
      const buffer = Buffer.from(item.data, "base64");
      if (item.mimeType.startsWith("image/")) {
        if (sniffImage(buffer) !== item.mimeType)
          throw new Error("The image bytes do not match its type.");
      } else if (item.mimeType === "application/pdf") {
        if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-")
          throw new Error("The file is not a PDF.");
      } else {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
          if (text.includes("\0")) throw new Error("Binary text");
        } catch {
          throw new Error("Text attachments must contain UTF-8 text.");
        }
      }
    }
    const attachments: NativeAttachment[] = parsed.value.map((item) => ({
      type: "blob",
      data: item.data,
      mimeType: item.mimeType,
      displayName: item.name,
    }));
    const lease = {
      bytes,
      attachments,
      release() {
        if (!leases.delete(lease)) return;
        clearTimeout(timer);
        totalBytes -= bytes;
        attachments.length = 0;
      },
    };
    const timer = setTimeout(() => lease.release(), ATTACHMENT_LIMITS.ttlMs);
    timer.unref?.();
    leases.add(lease);
    totalBytes += bytes;
    return lease;
  }

  return {
    stage,
    get sizeBytes() {
      return totalBytes;
    },
    dispose() {
      disposed = true;
      for (const lease of leases) lease.release();
    },
  };
}
