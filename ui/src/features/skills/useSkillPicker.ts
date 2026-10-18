import { useCombobox } from "@mantine/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { pickerKey, rankSkills } from "./model";
import { insertSkill, insertSlash, slashTokenAt, type DraftEdit } from "./slashToken";
import { useSkills } from "./useSkills";

interface Options {
  /** The draft as the field shows it. */
  text: string;
  onChange: (text: string) => void;
  /** Off while the draft can't be edited or dictation is adding words. */
  enabled: boolean;
  sessionId: string | undefined;
  field: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The composer's `/` skill picker: which skills the slash word at the caret could mean (anywhere in
 * the draft, see slashToken.ts), the Mantine Combobox store that shows them, and the keys and picks
 * that fill one in. Choosing a skill only writes `/name ` into the draft; sending it is what runs
 * it, as in the Copilot CLI.
 */
export function useSkillPicker({ text, onChange, enabled, sessionId, field }: Options) {
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  // An IME is still composing a word; the picker waits for the committed text.
  const [composing, setComposing] = useState(false);
  // The draft Escape (or a click away) closed the picker on; any edit opens it again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const token = enabled ? slashTokenAt(text, caret.start, caret.end, composing) : null;
  const query = token?.query ?? null;
  const skills = useSkills(sessionId, query !== null);
  const matches = useMemo(
    () => (query === null || !skills ? [] : rankSkills(skills, query)),
    [skills, query],
  );
  const available = Boolean(skills?.length);
  const open = available && query !== null && dismissed !== text;
  const combobox = useCombobox({ opened: open, onDropdownClose: () => setDismissed(text) });

  useEffect(() => {
    if (open) setActiveId(combobox.selectFirstOption());
  }, [open, matches]);

  const place = (at: number) => {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(at, at);
    setCaret({ start: at, end: at });
  };
  // Put the caret after a filled-in command once the field shows it.
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    pendingCaret.current = null;
    if (at !== null) place(at);
  }, [text]);

  const write = ({ text: next, caret: at }: DraftEdit) => {
    setDismissed(null);
    if (next === text) return place(at);
    pendingCaret.current = at;
    onChange(next);
  };
  const track = (input: HTMLTextAreaElement) => {
    setCaret({ start: input.selectionStart, end: input.selectionEnd });
  };

  return {
    combobox,
    matches,
    open,
    /** False while the session has no skills to offer. */
    available,
    pick: (name: string) => {
      if (token) write(insertSkill(text, token, name));
    },
    /** The Skills button: start a slash word at the caret, keeping the rest of the draft. */
    start: () => write(insertSlash(text, caret.end)),
    /** Follow the caret from the field's change and select events. */
    track,
    /** True when the open picker used the key; the composer then leaves it alone. */
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      const { key, shiftKey, ctrlKey, metaKey, altKey } = event;
      const isComposing = event.nativeEvent.isComposing;
      const action = pickerKey({ key, shiftKey, ctrlKey, metaKey, altKey, isComposing });
      if (!action || (action === "pick" && matches.length === 0)) return false;
      event.preventDefault();
      if (action === "close") setDismissed(text);
      else if (action === "pick") {
        if (combobox.getSelectedOptionIndex() === -1) combobox.selectFirstOption();
        combobox.clickSelectedOption();
      } else {
        setActiveId(
          action === "next" ? combobox.selectNextOption() : combobox.selectPreviousOption(),
        );
      }
      return true;
    },
    /** IME composition tracking, plus combobox semantics while skills are on offer. */
    fieldProps: {
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
        setComposing(false);
        track(event.currentTarget);
      },
      ...(available && {
        "aria-haspopup": "listbox" as const,
        "aria-autocomplete": "list" as const,
        "aria-expanded": open,
        "aria-controls": open ? combobox.listId || undefined : undefined,
        "aria-activedescendant": open ? (activeId ?? undefined) : undefined,
      }),
    },
  };
}

export type SkillPickerState = ReturnType<typeof useSkillPicker>;
