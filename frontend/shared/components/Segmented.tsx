import './segmented.css';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Optional counter shown after the label. */
  count?: number;
};

type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
};

/** Segmented selector for mutually exclusive options (tabs, status filters). */
export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
          className="segmented-option"
        >
          {option.label}
          {option.count !== undefined && <span className="segmented-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
