import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentByteLength, validateAttachments, type SendAttachment } from "../../shared";
import { attachmentFileName, attachmentFileType, attachmentSelectionError } from "./files";

export interface DraftAttachment {
  id: number;
  file: SendAttachment;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result.split(",")[1] ?? "");
      else reject(new Error("Could not read this attachment."));
    };
    reader.onerror = () => reject(new Error("Could not read this attachment."));
    reader.onabort = () => reject(new Error("Reading the attachment was interrupted."));
    reader.readAsDataURL(file);
  });
}

/** Draft bytes stay in this view's memory, never localStorage or a background upload. */
export function useAttachments() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const nextId = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = async (files: File[]) => {
    if (inFlight.current || files.length === 0) return;
    const failure = attachmentSelectionError(
      files,
      items.length,
      items.reduce((sum, item) => sum + attachmentByteLength(item.file.data), 0),
    );
    if (failure) {
      setError(failure);
      return;
    }
    inFlight.current = true;
    setReading(true);
    setError(null);
    try {
      const additions: DraftAttachment[] = [];
      for (const file of files) {
        const mimeType = attachmentFileType(file)!;
        const attachment = {
          name: attachmentFileName(file.name, mimeType),
          mimeType,
          data: await readFile(file),
        };
        const parsed = validateAttachments([attachment]);
        if (!parsed.ok) throw new Error(parsed.message);
        additions.push({ id: nextId.current++, file: parsed.value[0] });
      }
      if (mounted.current) setItems((current) => [...current, ...additions]);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Could not read the attachment.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const remove = useCallback((ids: readonly number[]) => {
    setItems((current) => current.filter((item) => !ids.includes(item.id)));
    setError(null);
  }, []);
  return { items, reading, error, add, remove };
}
