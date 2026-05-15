import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (open) {
      setQ("");
      setHighlight(0);
    }
  }, [open]);

  const resultsQuery = useQuery({
    queryKey: ["notes", "search", q],
    queryFn: () => api.searchNotes(q),
    enabled: open
  });

  const results = resultsQuery.data?.notes ?? [];

  const handleKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[highlight];
      if (picked) {
        onClose();
        navigate({ to: "/notes/$noteId", params: { noteId: picked.id } });
      }
    }
  };

  if (!open) return null;

  return (
    <div className="cmdp-backdrop" onClick={onClose}>
      <div className="cmdp" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKey}
          placeholder="Search notes…"
        />
        {results.length === 0 ? (
          <div className="cmdp-empty">
            {resultsQuery.isLoading ? "Searching…" : "No matches."}
          </div>
        ) : (
          results.map((n, i) => (
            <button
              key={n.id}
              type="button"
              className={`cmdp-result ${
                i === highlight ? "cmdp-result-active" : ""
              }`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onClose();
                navigate({
                  to: "/notes/$noteId",
                  params: { noteId: n.id }
                });
              }}
            >
              <span>{n.title}</span>
              <span className="cmdp-result-type">{n.type}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
