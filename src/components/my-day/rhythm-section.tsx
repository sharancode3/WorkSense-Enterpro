import { Activity, BarChart3, Flame, PieChart as PieIcon } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart as RePie, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { MyDayResult } from "@/lib/api";
import { addDaysKey, dayKeyLabel } from "./format";

const PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--accent))",
  "hsl(var(--secondary))",
];

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg bg-white p-4 shadow-card sm:p-5 ${className}`}>
      <h3 className="text-sm font-extrabold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function TodayRing({ analytics }: { analytics: MyDayResult["analytics"] }) {
  const { completion_pct, done_personal_today, eligible_personal_today, blocked, waiting } = analytics.today;
  const pct = completion_pct ?? 0;
  const R = 42;
  const C = 2 * Math.PI * R;
  const empty = eligible_personal_today === 0;
  return (
    <Card title="Today's completion" subtitle="Personal tasks & routines due today — blocked and waiting items are excluded.">
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${pct}% of personal tasks and routines due today are done`}>
            <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={empty ? "hsl(var(--muted))" : "hsl(var(--secondary))"}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * C} ${C}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold text-foreground">{empty ? "—" : `${pct}%`}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">done today</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p><span className="font-bold text-foreground">{done_personal_today}</span> of {eligible_personal_today} eligible done</p>
          <p><span className="font-bold text-foreground">{blocked}</span> blocked · <span className="font-bold text-foreground">{waiting}</span> waiting</p>
          <p className="text-[11px]">Blocked & waiting never count against you.</p>
        </div>
      </div>
    </Card>
  );
}

function ModuleDonut({ analytics }: { analytics: MyDayResult["analytics"] }) {
  const rows = analytics.modules;
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Card title="Today by area" subtitle="Where today's open items come from.">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing open today — a quiet day.</p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <ChartContainer config={{}} className="aspect-square h-40">
            <RePie>
              <Pie data={rows} dataKey="count" nameKey="label" innerRadius={46} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                {rows.map((r, i) => (
                  <Cell key={r.module} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            </RePie>
          </ChartContainer>
          <ul className="flex w-full flex-col gap-1">
            {rows.map((r, i) => (
              <li key={r.module} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="font-semibold text-foreground">{r.label}</span>
                <span className="ml-auto text-muted-foreground">
                  {r.count} · {total > 0 ? Math.round((r.count / total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TrendChart({ analytics, todayKey }: { analytics: MyDayResult["analytics"]; todayKey: string }) {
  const data = analytics.trend7.map((t) => ({ ...t, label: dayKeyLabel(t.date) }));
  return (
    <Card title="Last 7 days" subtitle="Personal & routine completions you checked off (private to you)." className="lg:col-span-2">
      <ChartContainer config={{}} className="aspect-auto h-44 w-full">
        <BarChart data={data} barCategoryGap="28%">
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={26} />
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Bar dataKey="routines" stackId="a" fill="hsl(var(--chart-3))" radius={[0, 0, 0, 0]} name="Routines" />
          <Bar dataKey="personal" stackId="a" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} name="Personal" />
        </BarChart>
      </ChartContainer>
      {todayKey && (
        <p className="mt-2 text-right text-[11px] text-muted-foreground">Today: {analytics.trend7.find((t) => t.date === todayKey)?.done ?? 0} completion(s)</p>
      )}
    </Card>
  );
}

function WeekConsistency({ analytics, todayKey }: { analytics: MyDayResult["analytics"]; todayKey: string }) {
  const byDate = new Map(analytics.trend7.map((t) => [t.date, t.done]));
  const days: { key: string; label: string; done: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDaysKey(todayKey, -i);
    days.push({ key, label: dayKeyLabel(key), done: (byDate.get(key) ?? 0) > 0 });
  }
  const { days_active_last7, this_week_done, private_note } = analytics.rhythm;
  return (
    <Card title="Week consistency" subtitle="A rhythm signal — not a performance score.">
      <div className="flex items-end justify-between gap-2">
        {days.map((d) => (
          <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${d.done ? "some completions" : "none"}`}>
            <span className={`h-7 w-7 rounded-full ${d.done ? "bg-secondary text-white" : "bg-muted text-muted-foreground"}`} aria-hidden="true" />
            <span className="text-[10px] font-semibold text-muted-foreground">{new Date(`${d.key}T12:00:00.000Z`).getUTCDate()}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Flame className="h-4 w-4 text-accent" />
        <span>
          Active on <span className="font-bold text-foreground">{days_active_last7}</span> of the last {analytics.rhythm.days_total} days ·{" "}
          <span className="font-bold text-foreground">{this_week_done}</span> this week
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{private_note}</p>
    </Card>
  );
}

function WorkflowHealth({ analytics }: { analytics: MyDayResult["analytics"] }) {
  const { attention, ready, waiting, note } = analytics.workflow_health;
  const total = attention + ready + waiting;
  const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <Card title="Workflow today" subtitle="Actions from the role projection — completed in their own centers.">
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No workflow actions in scope today.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${attention} attention, ${ready} ready, ${waiting} waiting`}>
            <div className="bg-destructive" style={{ width: `${seg(attention)}%` }} title={`Needs attention: ${attention}`} />
            <div className="bg-primary" style={{ width: `${seg(ready)}%` }} title={`Ready: ${ready}`} />
            <div className="bg-muted-foreground/30" style={{ width: `${seg(waiting)}%` }} title={`Waiting: ${waiting}`} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> Attention {attention}</li>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Ready {ready}</li>
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" /> Waiting {waiting}</li>
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
        </>
      )}
    </Card>
  );
}

export function RhythmSection({ result }: { result: MyDayResult }) {
  const { analytics, today_date } = result;
  return (
    <section aria-label="My rhythm" className="mt-10">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">My rhythm</h2>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <PieIcon className="h-3 w-3" /> Not a productivity score
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TodayRing analytics={analytics} />
        <ModuleDonut analytics={analytics} />
        <TrendChart analytics={analytics} todayKey={today_date} />
        <WeekConsistency analytics={analytics} todayKey={today_date} />
        <WorkflowHealth analytics={analytics} />
      </div>
      <ul className="mt-4 flex flex-col gap-1 text-[11px] text-muted-foreground">
        {analytics.honesty.map((h) => (
          <li key={h} className="flex items-start gap-1.5">
            <BarChart3 className="mt-0.5 h-3 w-3 shrink-0" /> {h}
          </li>
        ))}
      </ul>
    </section>
  );
}
