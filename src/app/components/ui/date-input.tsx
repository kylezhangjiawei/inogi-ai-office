import * as React from 'react';
import { DatePicker } from './date-picker';

/** Keep the real native form contract behind the project's visible date picker.
 * Existing callers retain ChangeEvent, FormData, min/max/step, required and refs.
 */
export const DateInput = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function DateInput(
  { className, id, value, defaultValue, onChange, onInvalid, onFocus, autoFocus, ...props }, forwardedRef,
) {
  const nativeRef = React.useRef<HTMLInputElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const errorId = React.useId();
  const [internalValue, setInternalValue] = React.useState(String(defaultValue ?? ''));
  const [validationMessage, setValidationMessage] = React.useState('');
  const dateValue = value === undefined ? internalValue : String(value ?? '');
  React.useEffect(() => {
    const form = nativeRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => { setInternalValue(String(defaultValue ?? '')); setValidationMessage(''); };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue, value, props.form]);
  React.useEffect(() => {
    if (nativeRef.current?.validity.valid) setValidationMessage('');
  }, [dateValue, props.min, props.max, props.required, props.disabled]);

  function selectDate(nextValue: string) {
    const input = nativeRef.current;
    if (!input || props.disabled || props.readOnly) return;
    // Use the native setter so React sees an actual change, not a fabricated event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return <>
    <DatePicker ref={triggerRef} id={id} value={dateValue} onValueChange={selectDate}
      min={props.min === undefined ? undefined : String(props.min)} max={props.max === undefined ? undefined : String(props.max)}
      disabled={props.disabled} readOnly={props.readOnly} autoFocus={autoFocus} className={className}
      title={props.title} tabIndex={props.tabIndex}
      aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']}
      aria-required={props.required || props['aria-required']}
      aria-invalid={validationMessage ? true : props['aria-invalid']}
      aria-describedby={[props['aria-describedby'], validationMessage && errorId].filter(Boolean).join(' ') || undefined} />
    <input {...props} type="date" data-slot="date-native" aria-hidden="true" tabIndex={-1}
      className="sr-only top-0 left-0" value={dateValue}
      ref={(node) => { nativeRef.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }}
      onChange={(event) => { setInternalValue(event.target.value); setValidationMessage(''); onChange?.(event); }}
      onInvalid={(event) => {
        onInvalid?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        setValidationMessage(event.currentTarget.validationMessage);
        triggerRef.current?.focus();
      }}
      onFocus={(event) => { onFocus?.(event); triggerRef.current?.focus(); }} />
    {validationMessage && <span id={errorId} role="alert" className="text-xs text-destructive">{validationMessage}</span>}
  </>;
});
