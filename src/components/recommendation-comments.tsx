import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquareText, Send } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { recommendationCommentAdd, recommendationCommentList, type RecommendationCommentRow } from "@/lib/api";

export function CommentsPanel({
  recId,
  actorNames,
}: {
  recId: string;
  /** Resolves an actor twin id to a display name; falls back to the raw id. */
  actorNames: (twinId: string) => string | null;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<"all" | "approvers">("all");
  const [busy, setBusy] = useState(false);

  const comments = useQuery({
    queryKey: ["rec-comments", user?.id ?? "anon", recId],
    queryFn: async () => {
      const res = await recommendationCommentList(recId);
      return res.comments;
    },
  });

  const addComment = async () => {
    const body = draft.trim();
    if (body.length === 0) return;
    setBusy(true);
    try {
      await recommendationCommentAdd(recId, body, visibility);
      setDraft("");
      toast.success("Comment added.");
      void qc.invalidateQueries({ queryKey: ["rec-comments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add comment.");
    } finally {
      setBusy(false);
    }
  };

  const items: RecommendationCommentRow[] = comments.data ?? [];

  return (
    <div className="mt-4 rounded-lg bg-muted/60 p-4">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <MessageSquareText className="h-4 w-4" /> Comments ({items.length}) — persisted per recommendation, visible to approvers
      </p>

      {items.length > 0 && (
        <ul className="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {items.map((c) => (
            <li key={c.id} className="rounded-md bg-white px-3 py-2 text-xs">
              <p className="font-semibold text-foreground">
                {actorNames(c.actor_twin_id) ?? "Unknown"}
                {c.actor_role ? ` · ${c.actor_role.replace("_", " ")}` : ""}
                {c.visibility === "approvers" ? " · decision note" : ""}
                <span className="ml-1 font-normal text-muted-foreground">· {new Date(c.created_at).toLocaleString()}</span>
              </p>
              <p className="mt-0.5 leading-relaxed text-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment for the approver team…"
          aria-label="New comment"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "all" | "approvers")}
            aria-label="Comment visibility"
            className="h-8 rounded-md border border-border bg-white px-2 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
          >
            <option value="all">Visible to all org members</option>
            <option value="approvers">Approvers only</option>
          </select>
          <Button size="sm" onClick={() => void addComment()} disabled={busy || draft.trim().length === 0} className="ml-auto">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Add comment
          </Button>
        </div>
      </div>
    </div>
  );
}
