/**
 * App-wide repair money input: user types dollars ($ / commas / 2 dp);
 * callers store integer cents. Never asks for cents.
 */
import type { InputHTMLAttributes } from "react";
import {
  formatMoneyInputOnBlur,
  sanitizeMoneyTyping,
} from "./moneyFormat";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  /** Display string (dollars with optional $ / commas while editing). */
  value: string;
  onValueChange: (next: string) => void;
  /** Reformat to $X,XXX.XX on blur (default true). */
  formatOnBlur?: boolean;
};

export function MoneyInput({
  value,
  onValueChange,
  formatOnBlur = true,
  className,
  placeholder = "$0.00",
  ...rest
}: Props) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      className={className}
      value={value}
      onChange={(e) => onValueChange(sanitizeMoneyTyping(e.target.value))}
      onBlur={(e) => {
        if (formatOnBlur) {
          onValueChange(formatMoneyInputOnBlur(e.target.value));
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
