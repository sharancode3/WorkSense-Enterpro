import { ArrowRight } from "lucide-react";

// Neutral card tones — the single brand blue plus ink/neutral surfaces.
// Green/amber/red are reserved for semantic states and never used as
// arbitrary category colors on role cards.
export type CardTone = "primary" | "dark" | "muted" | "outline";

const TONE_CLASS: Record<CardTone, { block: string; hover: string }> = {
  primary: { block: "bg-primary text-white", hover: "hover:bg-primary/85" },
  dark: { block: "bg-foreground text-white", hover: "hover:bg-black" },
  muted: { block: "bg-muted text-foreground", hover: "hover:bg-border" },
  outline: { block: "bg-white border border-border text-foreground", hover: "hover:bg-muted" },
};

interface RoleCardProps {
  tone: CardTone;
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
  cta: string;
  loading?: boolean;
  onClick: () => void;
}

export function RoleCard({ tone, eyebrow, title, description, meta, cta, loading, onClick }: RoleCardProps) {
  const t = TONE_CLASS[tone] ?? TONE_CLASS.muted;
  const onDark = tone === "primary" || tone === "dark";
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`group flex flex-col items-start gap-4 rounded-lg p-6 text-left transition-all duration-200 hover:scale-[1.02] disabled:cursor-wait disabled:opacity-70 ${t.block} ${t.hover}`}
    >
      <span
        className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
          onDark ? "bg-white/15 text-white" : "bg-foreground/10 text-foreground/70"
        }`}
      >
        {eyebrow}
      </span>
      <span className="text-2xl font-extrabold leading-tight tracking-tight">{title}</span>
      <span className={`text-sm leading-relaxed ${onDark ? "text-white/85" : "text-foreground/75"}`}>
        {description}
      </span>
      {meta && (
        <span className={`break-all font-mono text-xs ${onDark ? "text-white/60" : "text-muted-foreground"}`}>
          {meta}
        </span>
      )}
      <span className="mt-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2.5} />
      </span>
    </button>
  );
}
