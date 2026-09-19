// Reusable stat block for role homes — design-system tones only.
export function StatBlock({
  label,
  value,
  tone,
  definition,
}: {
  label: string;
  value: number | string | null;
  tone: "primary" | "dark" | "muted" | "subtle" | "outline";
  definition?: string;
}) {
  const cls = {
    primary: "bg-primary text-white",
    dark: "bg-foreground text-white",
    muted: "bg-muted text-foreground",
    subtle: "bg-primary/10 text-primary",
    outline: "bg-white border border-border text-foreground",
  }[tone];
  return (
    <div className={`flex flex-col justify-between gap-6 rounded-lg p-5 transition-all duration-200 hover:scale-[1.02] ${cls}`}>
      <span className={`text-xs font-bold uppercase tracking-wider ${tone === "dark" || tone === "primary" ? "text-white/70" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className="text-4xl font-extrabold tracking-tight">{value ?? "—"}</span>
      {definition && (
        <span className={`text-[11px] leading-snug ${tone === "dark" || tone === "primary" ? "text-white/60" : "text-muted-foreground"}`}>{definition}</span>
      )}
    </div>
  );
}
