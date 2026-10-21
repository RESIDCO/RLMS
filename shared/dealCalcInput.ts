/**
 * Decimal text for calculator percent and number fields.
 * Intermediate text is kept on screen and is not committed.
 */

export const COMPLETE_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

const INTERMEDIATE = new Set(["", "-", ".", "-."]);

export function isCompleteNumber(text: string): boolean {
  return COMPLETE_NUMBER.test(text);
}

export function isIntermediateNumber(text: string): boolean {
  return INTERMEDIATE.has(text) || !isCompleteNumber(text);
}

/** Display a stored fraction as a percent, or a plain number. Trailing zeros from binary floats are trimmed. */
export function formatScaled(value: number | null | undefined, scale: number): string {
  if (value == null || !Number.isFinite(value)) return "";
  const shown = scale === 1 ? value : Math.round(value * scale * 100) / 100;
  if (!Number.isFinite(shown)) return "";
  return String(shown);
}

export type DecimalCommit = {
  text: string;
  /** Null when this keystroke must not change the stored value. */
  value: number | null;
  commit: boolean;
};

/**
 * scale 100 stores a percent as a fraction (7.8 → 0.078).
 * scale 1 stores the number (12. → 12).
 * A complete token commits. "", "-", ".", and "-." do not.
 */
export function commitDecimalText(text: string, scale: number): DecimalCommit {
  if (!isCompleteNumber(text)) return { text, value: null, commit: false };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { text, value: null, commit: false };
  const value = scale === 1 ? parsed : parsed / scale;
  return { text, value, commit: true };
}

export function blurDecimalText(input: {
  text: string;
  committed: number | null;
  scale: number;
  allowNull: boolean;
}): { text: string; value: number | null; commit: boolean } {
  if (isCompleteNumber(input.text)) {
    const next = commitDecimalText(input.text, input.scale);
    return { text: input.text, value: next.value, commit: true };
  }
  if (input.text.trim() === "" && input.allowNull) {
    return { text: "", value: null, commit: true };
  }
  return { text: formatScaled(input.committed, input.scale), value: input.committed, commit: false };
}
