import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface HighlightItem {
  id: string;
  text: string;
  source_title: string;
  source_id: string;
  promotion_score: number | null;
}

interface InboxHighlightsPaneProps {
  items: HighlightItem[];
}

function scoreChipStyle(score: number | null): React.CSSProperties {
  if (score === null) return { display: "none" };
  // Color grade: low (gray) → mid (yellow) → high (green)
  const pct = Math.max(0, Math.min(1, score));
  let bg = "#888";
  if (pct >= 0.7) bg = "#73daca"; // green
  else if (pct >= 0.4) bg = "#e0af68"; // yellow
  else bg = "#9d7cd8"; // purple (low priority)
  return {
    display: "inline-block",
    background: bg,
    color: "#1a1b26",
    borderRadius: 4,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 600,
    marginLeft: 6,
    verticalAlign: "middle"
  };
}

export function InboxHighlightsPane({ items }: InboxHighlightsPaneProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const promoteMutation = useMutation({
    mutationFn: async (h: HighlightItem) => {
      const note = await api.promoteHighlight(h.id);
      // Record feedback (fire-and-forget — don't block navigation)
      void api.recordHighlightFeedback({
        highlightId: h.id,
        action: "promoted",
        draftText: h.text,
        finalText: h.text
      });
      return note;
    },
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    }
  });

  const dismissMutation = useMutation({
    mutationFn: async (h: HighlightItem) => {
      // Record rejection feedback
      await api.recordHighlightFeedback({
        highlightId: h.id,
        action: "rejected",
        draftText: h.text
      });
      // The dismiss endpoint is the same highlights promote, but we also
      // need to actually dismiss it server-side. For now, we invalidate
      // the inbox so the user sees the highlight vanish after feedback.
      // (Actual dismiss endpoint if present would be called here.)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
    }
  });

  return (
    <div className="inbox-pane">
      <h3>Highlights ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">
          No un-promoted highlights. Start the readwise worker or check back later.
        </p>
      ) : (
        items.map((h) => {
          const promoteRowPending = promoteMutation.isPending && promoteMutation.variables?.id === h.id;
          const dismissRowPending = dismissMutation.isPending && dismissMutation.variables?.id === h.id;
          return (
            <div key={h.id} className="inbox-row">
              <div className="inbox-row-title" style={{ display: "flex", flexDirection: "column" }}>
                <span>
                  {h.text}
                  {h.promotion_score !== null && (
                    <span style={scoreChipStyle(h.promotion_score)}>
                      {Math.round(h.promotion_score * 100)}%
                    </span>
                  )}
                </span>
                <span style={{ color: "#888", fontSize: 11 }}>
                  from {h.source_title}
                </span>
              </div>
              <div className="inbox-row-actions">
                <button
                  onClick={() => promoteMutation.mutate(h)}
                  disabled={promoteRowPending || dismissRowPending}
                >
                  Promote
                </button>
                <button
                  onClick={() => dismissMutation.mutate(h)}
                  disabled={promoteRowPending || dismissRowPending}
                  style={{ marginLeft: 6, opacity: 0.7 }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
