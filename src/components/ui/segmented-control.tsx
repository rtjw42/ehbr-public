import { cn } from "@/lib/utils";

// A compact two-or-more-way toggle: options sit in a tinted track, the selected
// one lifts onto a solid `background` chip. Shared across the app (BookingForm
// mode swaps, the first-run preferences setup) so every segmented choice reads as
// one component. Generic over the option value type.
export const SegmentedControl = <T extends string>({
  value,
  onChange,
  options,
  ariaLabelledBy,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabelledBy?: string;
}) => (
  <div
    role="group"
    aria-labelledby={ariaLabelledBy}
    className="grid gap-1 rounded-lg bg-foreground/[0.06] p-1"
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => option.value !== value && onChange(option.value)}
        aria-pressed={option.value === value}
        className={cn(
          "min-h-11 rounded-md px-2 text-sm font-medium transition-colors duration-fast",
          option.value === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
