import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AGENT_SORTS, type AgentSort } from "../state/agents";
import { cn } from "../lib/utils";

type Props = {
  value: AgentSort;
  onChange: (sort: AgentSort) => void;
};

/** Small "Sort: <current>" dropdown that orders the machine list. */
export function AgentSortMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = AGENT_SORTS.find((option) => option.value === value) ?? AGENT_SORTS[0];

  // Close on a click elsewhere or on Escape. pointerdown rather than click so
  // the menu is gone before the click lands on whatever is underneath it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
      >
        <span>Sort: {current.label}</span>
        <ChevronDown aria-hidden className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Sort machines"
          className="absolute right-0 z-20 mt-1 min-w-[11rem] overflow-hidden rounded-md border bg-card p-1 shadow-md"
        >
          {AGENT_SORTS.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition hover:bg-accent hover:text-accent-foreground",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {/* Always rendered so the labels line up whether or not it shows. */}
                <Check aria-hidden className={cn("h-3 w-3 shrink-0", !active && "invisible")} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
