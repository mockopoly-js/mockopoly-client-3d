import { useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import type { KitStyle } from './tokens';

export interface FieldProps {
  /** 11px caps label above the input. */
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Helper text below. Turns red when `error` is set. */
  hint?: ReactNode;
  error?: boolean;
  maxLength?: number;
  /** Escape hatch for autoComplete, inputMode, name, onKeyDown … */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className' | 'style'>;
  className?: string;
  style?: KitStyle;
}

/**
 * Text field. 44px tall — the input itself, not just a wrapper.
 *
 * The gold underline is an inset shadow rather than a border, so focus does not
 * change the box's metrics and nothing reflows when you tap it.
 *
 * @example <Field label="Your name" value={name} onChange={setName} placeholder="Name" />
 */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error = false,
  maxLength,
  inputProps,
  className,
  style,
}: FieldProps) {
  const id = useId();

  return (
    <label className={cx('kit-field', className)} style={style} htmlFor={id}>
      {label !== undefined && <span className="kit-field__label">{label}</span>}
      <input
        {...inputProps}
        id={id}
        className="kit-field__input"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); }}
      />
      {hint !== undefined && (
        <span className={cx('kit-field__hint', error && 'kit-field__hint--error')}>{hint}</span>
      )}
    </label>
  );
}

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Number of cells. Room codes are 6. */
  cells?: number;
  /** Uppercase everything as it is typed. Default true. */
  uppercase?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: KitStyle;
}

/**
 * Room-code input: N display cells over one real, invisible, full-bleed input.
 *
 * The real input is what makes paste, autofill, the software keyboard and
 * screen readers work — the mockup's version was a display-only div, which is
 * fine in a mockup and useless in production. The cells are
 * `pointer-events:none`; the 44px wrapper is the single tap target.
 *
 * DELIBERATE EXCEPTION to the 12px dead-space rule: the cells sit 8px apart
 * because they are not interactive. One control, one target.
 *
 * @example <CodeInput value={code} onChange={setCode} ariaLabel="Room code" />
 */
export function CodeInput({
  value,
  onChange,
  cells = 6,
  uppercase = true,
  ariaLabel = 'Code',
  className,
  style,
}: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chars = value.split('');

  return (
    <div
      className={cx('kit-code', focused && 'is-focus', className)}
      style={style}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        className="kit-code__input"
        value={value}
        maxLength={cells}
        aria-label={ariaLabel}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => { setFocused(true); }}
        onBlur={() => { setFocused(false); }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value.slice(0, cells);
          onChange(uppercase ? next.toUpperCase() : next);
        }}
      />
      {Array.from({ length: cells }, (_, i) => (
        <i
          key={i}
          className={cx('kit-code__cell', focused && i === chars.length && 'is-caret')}
          aria-hidden="true"
        >
          {chars[i] ?? ''}
        </i>
      ))}
    </div>
  );
}
