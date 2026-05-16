import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api-client";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type SearchMode = "text" | "semantic";

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [mode, setMode] = useState<SearchMode>("text");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    if (open) {
      setQ("");
      setDebouncedQ("");
      setHighlight(0);
    }
  }, [open]);

  // Debounce query for semantic mode (250ms), instant for text mode
  useEffect(() => {
    if (mode === "semantic") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedQ(q);
      }, 250);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    } else {
      setDebouncedQ(q);
    }
  }, [q, mode]);

  const textResultsQuery = useQuery({
    queryKey: ["notes", "search", debouncedQ],
    queryFn: () => api.searchNotes(debouncedQ),
    enabled: open && mode === "text"
  });

  const semanticResultsQuery = useQuery({
    queryKey: ["notes", "search", "semantic", debouncedQ],
    queryFn: () => api.searchSemantic(debouncedQ),
    enabled: open && mode === "semantic" && debouncedQ.trim().length > 0
  });

  const textResults = textResultsQuery.data?.notes ?? [];
  const semanticResults = semanticResultsQuery.data?.results ?? [];
  const semanticReason = semanticResultsQuery.data?.reason;
  const isNoEmbedding = semanticReason === "no-embedding" || semanticReason === "ml-unavailable";

  const results = mode === "text" ? textResults : semanticResults;
  const isLoading =
    mode === "text" ? textResultsQuery.isLoading : semanticResultsQuery.isFetching;

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
        <div className="cmdp-toolbar">
          <button
            type="button"
            className={`cmdp-mode-btn ${mode === "text" ? "cmdp-mode-btn-active" : ""}`}
            onClick={() => {
              setMode("text");
              setHighlight(0);
            }}
          >
            Text
          </button>
          <button
            type="button"
            className={`cmdp-mode-btn ${mode === "semantic" ? "cmdp-mode-btn-active" : ""}`}
            onClick={() => {
              setMode("semantic");
              setHighlight(0);
            }}
          >
            Semantic
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKey}
          placeholder={mode === "semantic" ? "Semantic search…" : "Search notes…"}
        />
        {mode === "semantic" && debouncedQ.trim().length > 0 && !isLoading && isNoEmbedding && (
          <div className="cmdp-empty">
            ML embedding not ready — try again soon
          </div>
        )}
        {results.length === 0 && !(mode === "semantic" && isNoEmbedding) ? (
          <div className="cmdp-empty">
            {isLoading
              ? "Searching…"
              : mode === "semantic" && debouncedQ.trim().length === 0
              ? "Type to search semantically…"
              : "No matches."}
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
              {"similarity" in n && typeof n.similarity === "number" && (
                <span className="cmdp-result-similarity">
                  {Math.round(n.similarity * 100)}%
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
