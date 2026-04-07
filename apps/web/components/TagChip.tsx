import { cn } from "@/lib/utils";

/**
 * TagChip — colored pill for displaying tags.
 * Uses inline styles for the dynamic tag color hex values.
 */
export function TagChip({
  name,
  color,
  onRemove,
  size = "sm",
  className,
}: {
  name: string;
  color: string | null;
  onRemove?: () => void;
  size?: "sm" | "xs";
  className?: string;
}) {
  const hex = color ?? "#6B7280";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        size === "sm"
          ? "px-2 py-0.5 text-[10px]"
          : "px-1.5 py-px text-[8px]",
        className
      )}
      style={{
        backgroundColor: `${hex}20`,
        borderColor: `${hex}40`,
        color: hex,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: hex }}
      />
      {name}
      {onRemove && (
        <button
          type="button"
          className="ml-0.5 rounded-full hover:opacity-70 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={`Remove tag "${name}"`}
        >
          ×
        </button>
      )}
    </span>
  );
}
