import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const EMPTY_OPTION_VALUE = "__radix_empty_option__";

type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "value" | "defaultValue"
> & {
  children: React.ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  onValueChange?: (value: string) => void;
};

function normalizeValue(value: string | number | undefined) {
  if (value === undefined) return undefined;
  const nextValue = String(value);
  return nextValue === "" ? EMPTY_OPTION_VALUE : nextValue;
}

function denormalizeValue(value: string) {
  return value === EMPTY_OPTION_VALUE ? "" : value;
}

function getOptionText(children: React.ReactNode) {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  return React.Children.toArray(children).join("");
}

function NativeSelect({
  children,
  className,
  disabled,
  value,
  defaultValue,
  onChange,
  onValueChange,
  placeholder,
  name,
}: NativeSelectProps) {
  const options = React.Children.toArray(children).filter(React.isValidElement);
  const selectedOption = options.find((option) => {
    const optionValue = normalizeValue(option.props.value ?? "");
    return optionValue === normalizeValue(value);
  });
  const fallbackPlaceholder =
    selectedOption && React.isValidElement(selectedOption)
      ? getOptionText(selectedOption.props.children)
      : placeholder;

  function handleValueChange(nextValue: string) {
    const rawValue = denormalizeValue(nextValue);
    onValueChange?.(rawValue);
    if (onChange) {
      onChange({
        target: { value: rawValue },
        currentTarget: { value: rawValue },
      } as React.ChangeEvent<HTMLSelectElement>);
    }
  }

  return (
    <>
      {name ? <input type="hidden" name={name} value={String(value ?? defaultValue ?? "")} /> : null}
      <Select
        value={normalizeValue(value)}
        defaultValue={normalizeValue(defaultValue)}
        disabled={disabled}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={fallbackPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, index) => {
            if (!React.isValidElement(option)) return null;
            const optionValue = normalizeValue(option.props.value ?? "");
            return (
              <SelectItem
                key={`${optionValue}-${index}`}
                value={optionValue ?? EMPTY_OPTION_VALUE}
                disabled={Boolean(option.props.disabled)}
              >
                {option.props.children}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </>
  );
}

export { NativeSelect };
