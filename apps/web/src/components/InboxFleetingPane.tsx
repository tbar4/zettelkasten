import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface FleetingItem {
  id: string;
  title: string;
  type: string;
}

interface InboxFleetingPaneProps {
  items: FleetingItem[];
}

export function InboxFleetingPane({ items }: InboxFleetingPaneProps) {
  const qc = useQueryClient();

  // Promote requires the current updated_at for If-Match. Fetch lazily on click.
  const promoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const note = await api.getNote(noteId);
      return api.promoteToPermanent(noteId, note.updated_at);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.archiveNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  return (
    <div className="inbox-pane">
      <h3>Fleeting ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">No fleeting notes to process.</p>
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
            <div className="inbox-row-actions">
              <button
                onClick={() => promoteMutation.mutate(n.id)}
                disabled={promoteMutation.isPending}
              >
                Promote
              </button>
              <button
                onClick={() => {
                  if (confirm("Archive this fleeting note?")) {
                    archiveMutation.mutate(n.id);
                  }
                }}
                disabled={archiveMutation.isPending}
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
