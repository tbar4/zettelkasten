import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface HighlightItem {
  id: string;
  text: string;
  source_title: string;
}

interface InboxHighlightsPaneProps {
  items: HighlightItem[];
}

export function InboxHighlightsPane({ items }: InboxHighlightsPaneProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const promoteMutation = useMutation({
    mutationFn: (highlightId: string) => api.promoteHighlight(highlightId),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
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
          const rowPending = promoteMutation.variables === h.id;
          return (
            <div key={h.id} className="inbox-row">
              <div className="inbox-row-title" style={{ display: "flex", flexDirection: "column" }}>
                <span>{h.text}</span>
                <span style={{ color: "#888", fontSize: 11 }}>
                  from {h.source_title}
                </span>
              </div>
              <div className="inbox-row-actions">
                <button
                  onClick={() => promoteMutation.mutate(h.id)}
                  disabled={rowPending}
                >
                  Promote
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
