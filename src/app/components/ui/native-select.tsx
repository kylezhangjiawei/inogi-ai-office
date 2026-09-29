import * as React from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";

type NativeSelectProps = Omit<React.ComponentPropsWithoutRef<typeof SelectTrigger>, "children" | "onChange" | "value" | "defaultValue" | "size" | "onInvalid"> & {
  children: React.ReactNode;
  contentClassName?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  onValueChange?: (value: string) => void;
  onInvalid?: React.FormEventHandler<HTMLSelectElement>;
  placeholder?: React.ReactNode;
  name?: string;
  form?: string;
  required?: boolean;
  autoComplete?: string;
};

type Option = { value: string; label: React.ReactNode; disabled: boolean; group?: string };

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children).map((child) => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) return optionText(child.props.children);
    return typeof child === "string" || typeof child === "number" ? String(child) : "";
  }).join("");
}

function collectOptions(children: React.ReactNode, group?: string, disabled = false): Option[] {
  return React.Children.toArray(children).flatMap((child): Option[] => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement> & { label?: string }>(child)) return [];
    if (child.type === React.Fragment) return collectOptions(child.props.children, group, disabled);
    if (child.type === "optgroup") return collectOptions(child.props.children, child.props.label, disabled || !!child.props.disabled);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? optionText(child.props.children)), label: child.props.label ?? child.props.children, disabled: disabled || !!child.props.disabled, group }];
  });
}

// Keep the native form control for FormData, required validation and real change events.
// The visible interaction is the project's Radix Select.
function NativeSelect({ children, className, contentClassName, value, defaultValue, onChange,
  onValueChange, onInvalid, placeholder, name, form, required, autoComplete, disabled, ...triggerProps }: NativeSelectProps) {
  const options = collectOptions(children);
  const initialValue = String(defaultValue ?? options.find((option) => !option.disabled)?.value ?? "");
  const [internalValue, setInternalValue] = React.useState(initialValue);
  const selectedValue = value === undefined ? internalValue : String(value);
  const nativeRef = React.useRef<HTMLSelectElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((option) => option.value === selectedValue);

  React.useEffect(() => {
    const owner = nativeRef.current?.form;
    if (!owner || value !== undefined) return;
    const reset = () => setInternalValue(initialValue);
    owner.addEventListener("reset", reset);
    return () => owner.removeEventListener("reset", reset);
  }, [initialValue, value, form]);

  function handleValueChange(nextValue: string) {
    const control = nativeRef.current;
    if (!control) return;
    control.value = nextValue.slice("option:".length);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderItem(option: Option, index: number) {
    return <SelectItem key={option.value + "-" + index} value={"option:" + option.value} disabled={option.disabled}>{option.label}</SelectItem>;
  }

  return (
    <>
      <Select value={"option:" + selectedValue} disabled={disabled} onValueChange={handleValueChange}>
        <SelectTrigger ref={triggerRef} {...triggerProps} className={className} aria-required={required || undefined}>
          <SelectValue placeholder={placeholder}>{selectedOption?.label ?? placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent className={contentClassName}>
          {options.map((option, index) => {
            if (!option.group) return renderItem(option, index);
            if (options[index - 1]?.group === option.group) return null;
            const end = options.findIndex((item, itemIndex) => itemIndex > index && item.group !== option.group);
            return <SelectGroup key={option.group + "-" + index}><SelectLabel>{option.group}</SelectLabel>{options.slice(index, end < 0 ? undefined : end).map(renderItem)}</SelectGroup>;
          })}
        </SelectContent>
      </Select>
      <select
        ref={nativeRef}
        data-slot="select-native"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        value={selectedValue}
        onChange={(event) => {
          setInternalValue(event.target.value);
          onValueChange?.(event.target.value);
          onChange?.(event);
        }}
        onInvalid={onInvalid}
        onFocus={() => triggerRef.current?.focus()}
        style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, padding: 0, margin: -1, border: 0, clipPath: "inset(50%)", overflow: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}
      >
        {!options.some((option) => option.value === selectedValue) && <option value={selectedValue} />}
        {children}
      </select>
    </>
  );
}

export { NativeSelect };
