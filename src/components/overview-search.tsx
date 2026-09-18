import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CornerDownLeft, Loader2, Search, SearchX, UserCheck, Users, X } from "lucide-react";
import { fetchOverviewSearch, type OverviewSearchResult } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { NAV_SECTIONS } from "@/lib/navigation";
import { type Role } from "@/lib/rbac";

const GROUP_META = {
  people: { label: "People", icon: Users },
  candidates: { label: "Candidates", icon: UserCheck },
  roles: { label: "Roles & requisitions", icon: Briefcase },
  actions: { label: "Actions & modules", icon: CornerDownLeft },
} as const;

type GroupKey = keyof typeof GROUP_META;

interface Row {
  group: GroupKey;
  key: string;
  label: string;
  sub: string | null;
  to: string;
}

const LIMIT = 5;

export function OverviewSearch() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the server query (250ms) while the input stays immediate.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ["overview-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: () => fetchOverviewSearch(debounced),
    staleTime: 30_000,
  });
  const data: OverviewSearchResult | null = debounced.length >= 2 && !search.isError ? (search.data ?? null) : null;

  // Actions = static RBAC-driven navigation (client-side by design — same
  // source as the app shell, nothing sensitive).
  const actions = useMemo(() => {
    const flat = NAV_SECTIONS.flatMap((s) => s.items)
      .filter((i) => i.show(role as Role))
      .filter((i) => (i.label + " " + i.to).toLowerCase().includes(debounced.toLowerCase()));
    return flat.slice(0, LIMIT).map((i) => ({ group: "actions" as const, key: i.to, label: i.label, sub: null, to: i.to }));
  }, [debounced, role]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return actions;
    const out: Row[] = [];
    out.push(
      ...data.people.slice(0, LIMIT).map((p) => ({
        group: "people" as const,
        key: `p-${p.id}`,
        label: p.name,
        sub: [p.job_title, p.department].filter(Boolean).join(" · ") || "Worker",
        to: `/workforce?twin=${p.id}`,
      }))
    );
    out.push(
      ...data.candidates.slice(0, LIMIT).map((c) => ({
        group: "candidates" as const,
        key: `c-${c.id}`,
        label: c.name,
        sub: c.department ?? "Candidate",
        to: `/recruitment?cand=${c.id}`,
      }))
    );
    out.push(
      ...data.roles.slice(0, LIMIT).map((r) => ({
        group: "roles" as const,
        key: `r-${r.id}`,
        label: r.title,
        sub: `${r.department ?? "—"} · ${r.status.replace(/_/g, " ")}`,
        to: `/recruitment?req=${r.id}`,
      }))
    );
    out.push(...actions);
    return out;
  }, [data, actions]);

  const total = rows.length;
  const groupsPresent = new Set(rows.map((r) => r.group)).size;

  // Close when clicking outside; reset active index when the result set changes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  useEffect(() => setActive(0), [debounced, rows.length, open]);

  const go = (to: string) => {
    setOpen(false);
    setQ("");
    setDebounced("");
    navigate(to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      if (open && rows[active]) {
        e.preventDefault();
        go(rows[active].to);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showPanel = open && q.trim().length > 0;
  const searching = debounced.length >= 2 && search.isLoading;

  return (
    <div ref={rootRef} className="relative w-full max-w-md" role="search" aria-label="Search people, candidates, roles and actions">
      <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
        {searching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people, candidates, roles…"
          aria-label="Search the overview"
          className="h-full w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
        {(q.length > 0 || debounced) && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setDebounced("");
            }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-border">
          {debounced.length < 2 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Type at least 2 characters to search.</p>
          ) : search.isError ? (
            <p className="px-4 py-3 text-sm text-destructive">Search is unavailable right now — try again shortly.</p>
          ) : searching ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching {data?.scope === "team" ? "your team" : "the org"}…
            </p>
          ) : total === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <SearchX className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">No matches for “{q.trim()}”</p>
              <p className="text-xs text-muted-foreground">Try a person name, department, role title, or module name.</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {(["people", "candidates", "roles", "actions"] as GroupKey[]).map((g) => {
                const groupRows = rows.filter((r) => r.group === g);
                if (groupRows.length === 0) return null;
                const meta = GROUP_META[g];
                const Icon = meta.icon;
                return (
                  <div key={g}>
                    <p className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Icon className="h-3 w-3" /> {meta.label}
                      {g !== "actions" && <span className="ml-auto normal-case tracking-normal">bounded to {LIMIT}</span>}
                    </p>
                    {groupRows.map((r, i) => {
                      const idx = rows.indexOf(r);
                      const RowLink = (
                        <>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-semibold text-foreground">{r.label}</span>
                            {r.sub && <span className="truncate text-xs text-muted-foreground">{r.sub}</span>}
                          </span>
                          {idx === active && <CornerDownLeft className="h-4 w-4 shrink-0 text-primary" />}
                        </>
                      );
                      return (
                        <Link
                          key={r.key}
                          to={r.to}
                          onClick={() => go(r.to)}
                          onMouseEnter={() => setActive(idx)}
                          className={`flex items-center gap-2 px-4 py-2 transition-colors ${idx === active ? "bg-primary/10" : ""}`}
                        >
                          {RowLink}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/60 px-4 py-2 text-[11px] text-muted-foreground">
                <span className="font-semibold">
                  {total} result{total === 1 ? "" : "s"} · {groupsPresent} group{groupsPresent === 1 ? "" : "s"}
                </span>
                <span>Scope: {data?.scope === "team" ? "your team (server-enforced)" : "entire org"}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
