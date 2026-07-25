import React, { useState, useEffect } from 'react';

interface DebouncedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: number | string;
  onChange: (value: number | string) => void;
  debounce?: number;
}

/**
 * Default debounce, in ms.
 *
 * This was 300ms, chosen when a regeneration took seconds and coalescing aggressively was
 * the only way to stay usable. Generation is now well under 200ms for a dense grip, which
 * made the debounce the largest single component of the wait after a keystroke. 150ms still
 * collapses a burst of typing or stepper clicks into one job (the worker also coalesces
 * pending jobs), while roughly halving the delay before the model responds.
 */
const DEFAULT_DEBOUNCE_MS = 150;

const DebouncedInput: React.FC<DebouncedInputProps> = ({
  value: initialValue,
  onChange,
  debounce = DEFAULT_DEBOUNCE_MS,
  ...props
}) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
        if (value !== initialValue) {
             onChange(value);
        }
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, debounce, initialValue, onChange]);

  return (
    <input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
};

export default DebouncedInput;
