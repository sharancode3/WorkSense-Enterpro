import { ArrowRight } from "lucide-react";

export type CardTone = "primary" | "secondary" | "accent" | "muted";

const TONE_CLASS: Record<CardTone, { block: string; hover: string }> = {
  primary: { block: "bg-primary text-white", hover: "hover:bg-primary/85" },
  secondary: { block: "bg-secondary text-white", hover: "hover:bg-secondary/85" },
  accent: { block: "bg-accent text-foreground", hover: "hover:bg-accent/85" },
  muted: { block: "bg-muted text-foreground", hover: "hover:bg-border" },
};

interface RoleCardProps {
  tone: CardTone;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  loading?: boolean;
  onClick: () => void;
}

export function RoleCard({ tone, eyebrow, title, description, cta, loading, onClick }: RoleCardProps) {
  const t = TONE_CLASS[tone];
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`group flex flex-col items-start gap-4 rounded-lg p-6 text-left transition-all duration-200 hover:scale-[1.02] disabled:cursor-wait disabled:opacity-70 ${t.block} ${t.hover}`}
    >
      <span
        className={`text-xs font-bold uppercase tracking-wider ${
          tone === "accent" || tone === "muted" ? "text-foreground/60" : "text-white/70"
        }`}
      >
        {eyebrow}
      </span>
      <span className="text-2xl font-extrabold leading-tight tracking-tight">{title}</span>
      <span className={`text-sm leading-relaxed ${tone === "accent" || tone === "muted" ? "text-foreground/75" : "text-white/85"}`}>
        {description}
      </span>
      <span className="mt-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2.5} />
      </span>
    </button>
  );
}
