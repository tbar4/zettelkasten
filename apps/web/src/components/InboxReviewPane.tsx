import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface ReviewItem {
  id: string;
  title: string;
  type: string;
  next_due_at: string;
}

interface InboxReviewPaneProps {
  items: ReviewItem[];
}

export function InboxReviewPane({ items }: InboxReviewPaneProps) {
  const qc = useQueryClient();

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      action
    }: {
      id: string;
      action: "keep" | "archive";
    }) => api.postReview(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  return (
    <div className="inbox-pane">
      <h3>Today's review ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">Nothing due. Come back tomorrow.</p>
      ) : (
        items.map((n) => (
          <div key={n.id} className="inbox-row">
            <Link
              to="/notes/$noteId"
              params={{ noteId: n.id }}
              className="inbox-row-title"
            >
              {n.title}
            </Link>
            <span style={{ color: "#888", fontSize: 11 }}>{n.type}</span>
            <div className="inbox-row-actions">
              <button
                onClick={() => reviewMutation.mutate({ id: n.id, action: "keep" })}
                disabled={reviewMutation.isPending}
              >
                Keep
              </button>
              <button
                onClick={() => {
                  if (confirm("Archive this note?")) {
                    reviewMutation.mutate({ id: n.id, action: "archive" });
                  }
                }}
                disabled={reviewMutation.isPending}
              >
                Archive
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
