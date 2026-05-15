import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../lib/api-client";

interface TagEditorProps {
  noteId: string;
  tags: string[];
}

const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;

export function TagEditor({ noteId, tags }: TagEditorProps) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const suggestQuery = useQuery({
    queryKey: ["tags", "suggest", input],
    queryFn: () => api.suggestTags(input),
    enabled: showSuggest
  });

  const setTagsMutation = useMutation({
    mutationFn: (next: string[]) => api.setNoteTags(noteId, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", noteId] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const addTag = (name: string) => {
    const cleaned = name.trim().toLowerCase();
    if (!cleaned || !KEBAB_RE.test(cleaned)) return;
    if (tags.includes(cleaned)) {
      setInput("");
      return;
    }
    setTagsMutation.mutate([...tags, cleaned]);
    setInput("");
  };

  const removeTag = (name: string) => {
    setTagsMutation.mutate(tags.filter((t) => t !== name));
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]!);
    } else if (e.key === "Escape") {
      setShowSuggest(false);
    }
  };

  return (
    <div className="tag-editor" ref={wrapperRef}>
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button
            type="button"
            className="tag-chip-remove"
            onClick={() => removeTag(t)}
            aria-label={`Remove tag ${t}`}
            disabled={setTagsMutation.isPending}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ position: "relative" }}>
        <input
          className="tag-editor-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggest(true);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 100)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? "add tag…" : ""}
          disabled={setTagsMutation.isPending}
        />
        {showSuggest && (suggestQuery.data?.tags.length ?? 0) > 0 && (
          <div className="tag-editor-suggest">
            {suggestQuery.data!.tags
              .filter((t) => !tags.includes(t.name))
              .slice(0, 6)
              .map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(t.name);
                  }}
                >
                  {t.name}{" "}
                  <span style={{ color: "#666" }}>×{t.count}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
