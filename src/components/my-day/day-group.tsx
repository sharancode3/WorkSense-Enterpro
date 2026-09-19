import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MyDayItem } from "@/lib/api";
import { DayItem } from "./day-item";
import { GROUP_HINT, GROUP_LABEL } from "./format";

const PAGE_SIZE = 8;

export function DayGroup({
  group,
  items,
  todayKey,
  busyKey,
  onAction,
}: {
  group: keyof typeof GROUP_LABEL;
  items: MyDayItem[];
  todayKey: string;
  /** Set of item ids currently pending a server round-trip. */
  busyKey: Set<string>;
  onAction: (item: MyDayItem, to: MyDayItem["status"], opts?: { note?: string; snooze_until?: string }) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, PAGE_SIZE);
  const remainder = items.length - shown.length;

  return (
    <section aria-label={GROUP_LABEL[group]} className="rounded-lg bg-white p-4 shadow-card sm:p-5">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-foreground">{GROUP_LABEL[group]}</h3>
          <p className="text-xs text-muted-foreground">{GROUP_HINT[group]}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{items.length}</span>
      </header>
      <ul className="mt-1 divide-y divide-border">
        {shown.map((item) => (
          <DayItem
            key={item.id}
            item={item}
            todayKey={todayKey}
            busy={busyKey.has(item.id)}
            onAction={(to, opts) => onAction(item, to, opts)}
          />
        ))}
      </ul>
      {remainder > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-primary hover:bg-primary/5"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
          {showAll ? "Show fewer" : `Show ${remainder} more`}
        </button>
      )}
    </section>
  );
}
