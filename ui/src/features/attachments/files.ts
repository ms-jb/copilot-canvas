import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_LIMITS,
  isAttachmentMimeType,
  isSafeAttachmentName,
  type AttachmentMimeType,
} from "../../shared";

/** Some browsers expose only files, others file items plus a duplicate files list. */
export function clipboardFiles(clipboard: {
  items: ArrayLike<{ kind: string; getAsFile(): File | null }>;
  files: ArrayLike<File>;
}): File[] {
  const files = Array.from(clipboard.items)
    .filter((item) => item.kind === "file")
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  return files.length ? files : Array.from(clipboard.files);
}

export const ATTACHMENT_ACCEPT = Object.entries(ATTACHMENT_EXTENSIONS)
  .flatMap(([mimeType, extensions]) => [
    mimeType,
    ...extensions.map((extension) => `.${extension}`),
  ])
  .join(",");

export function attachmentFileType(file: {
  type: string;
  name: string;
}): AttachmentMimeType | null {
  if (isAttachmentMimeType(file.type)) return file.type;
  if (file.type !== "" && file.type !== "application/octet-stream") return null;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    (Object.entries(ATTACHMENT_EXTENSIONS).find(([, extensions]) =>
      (extensions as readonly string[]).includes(extension ?? ""),
    )?.[0] as AttachmentMimeType | undefined) ?? null
  );
}

export function attachmentFileName(name: string, mimeType: AttachmentMimeType): string {
  const suffix = ATTACHMENT_EXTENSIONS[mimeType][0];
  const base =
    name
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.[^.]*$/, "") ?? "";
  const cleaned = base
    .replace(/[^\p{L}\p{N} _()-]/gu, "_")
    .replace(/^[ _-]+/, "")
    .trim();
  const safe = `${cleaned.slice(0, ATTACHMENT_LIMITS.maxNameChars - suffix.length - 1) || "attachment"}.${suffix}`;
  return isSafeAttachmentName(safe) ? safe : `attachment.${suffix}`;
}

export function attachmentSelectionError(
  files: readonly { size: number; type: string; name: string }[],
  currentCount: number,
  currentBytes: number,
): string | null {
  if (currentCount + files.length > ATTACHMENT_LIMITS.maxCount) return "Attach at most four files.";
  if (files.some((file) => !attachmentFileType(file))) {
    return "Use PNG, JPEG, GIF, WebP, PDF, or text files (TXT, MD, CSV, JSON).";
  }
  if (files.some((file) => file.size === 0 || file.size > ATTACHMENT_LIMITS.maxBytes)) {
    return "Each attachment must contain data and be no larger than 5 MiB.";
  }
  if (
    currentBytes + files.reduce((total, file) => total + file.size, 0) >
    ATTACHMENT_LIMITS.maxTotalBytes
  ) {
    return "Attachments must total no more than 12 MiB.";
  }
  return null;
}
