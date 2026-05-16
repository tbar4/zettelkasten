import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { api } from "../lib/api-client";
import type { AskCitationNote, AskEvent } from "../lib/api-client";

export const Route = createFileRoute("/ask")({
  component: AskPage
});

/** Render markdown [[Title]] wikilinks as clickable search links */
function renderCitations(text: string): string {
  return text.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, title: string) =>
      `<a href="/search?q=${encodeURIComponent(title)}" style="color:#7aa2f7">[[${title}]]</a>`
  );
}

function CitationCard({
  note,
  onClick
}: {
  note: AskCitationNote;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid #333",
        borderRadius: 6,
        padding: "8px 12px",
        cursor: "pointer",
        flex: "0 0 auto",
        minWidth: 180,
        maxWidth: 220,
        background: "#1a1b26"
      }}
      title={`Similarity: ${(note.similarity * 100).toFixed(1)}%`}
    >
      <div style={{ fontSize: 13, color: "#c0caf5", marginBottom: 4 }}>
        {note.title}
      </div>
      <div style={{ fontSize: 11, color: "#666" }}>
        {note.type} · {(note.similarity * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function AskPage() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [citations, setCitations] = useState<AskCitationNote[]>([]);
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const abortRef = useRef<boolean>(false);

  async function handleAsk() {
    if (!question.trim() || streaming) return;
    setStreaming(true);
    setError(null);
    setCitations([]);
    setAnswer("");
    abortRef.current = false;

    try {
      for await (const evt of api.ask(question)) {
        if (abortRef.current) break;
        handleEvent(evt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
    }
  }

  function handleEvent(evt: AskEvent) {
    switch (evt.type) {
      case "citations":
        setCitations(evt.notes);
        break;
      case "token":
        setAnswer((prev) => prev + evt.value);
        break;
      case "error":
        setError(evt.message);
        break;
      case "done":
        break;
    }
  }

  async function handleDraft() {
    if (!answer.trim() || draftLoading) return;
    setDraftLoading(true);
    try {
      const { draft } = await api.askDraft({
        question,
        answer,
        citedNoteIds: citations.map((n) => n.id)
      });
      // Create the note directly and navigate to it
      const note = await api.createNote({
        type: "permanent",
        title: question.slice(0, 80) || "Draft from Ask",
        body_md: draft
      });
      await navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraftLoading(false);
    }
  }

  function handleCitationClick(note: AskCitationNote) {
    void navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
  }

  const canDraft = answer.trim().length > 0 && !streaming;

  return (
    <div style={{ maxWidth: 800 }}>
      <h2>Ask your Zettelkasten</h2>

      {/* Question input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleAsk();
          }}
          placeholder="Ask a question about your notes…"
          rows={3}
          style={{
            flex: 1,
            background: "#1a1b26",
            color: "#c0caf5",
            border: "1px solid #333",
            borderRadius: 6,
            padding: 10,
            fontSize: 14,
            resize: "vertical"
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => void handleAsk()}
            disabled={!question.trim() || streaming}
            style={{
              padding: "10px 20px",
              background: streaming ? "#333" : "#7aa2f7",
              color: "#1a1b26",
              border: "none",
              borderRadius: 6,
              cursor: streaming ? "not-allowed" : "pointer",
              fontWeight: 600
            }}
          >
            {streaming ? "Asking…" : "Ask"}
          </button>
          {streaming && (
            <button
              onClick={() => { abortRef.current = true; }}
              style={{
                padding: "6px 12px",
                background: "transparent",
                color: "#f7768e",
                border: "1px solid #f7768e",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12
              }}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p style={{ color: "#f7768e", marginBottom: 16 }}>Error: {error}</p>
      )}

      {/* Citations panel */}
      {citations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px", color: "#9ece6a", fontSize: 13 }}>
            Sources ({citations.length})
          </h4>
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4
            }}
          >
            {citations.map((note) => (
              <CitationCard
                key={note.id}
                note={note}
                onClick={() => handleCitationClick(note)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Answer */}
      {(answer || streaming) && (
        <div
          style={{
            background: "#1a1b26",
            border: "1px solid #333",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16
          }}
        >
          <div
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: renderCitations(answer) + (streaming ? "▌" : "")
            }}
            style={{
              color: "#c0caf5",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              fontSize: 14
            }}
          />
        </div>
      )}

      {/* Draft as permanent note */}
      {canDraft && (
        <button
          onClick={() => void handleDraft()}
          disabled={draftLoading}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: "#9ece6a",
            border: "1px solid #9ece6a",
            borderRadius: 6,
            cursor: draftLoading ? "not-allowed" : "pointer",
            fontSize: 13
          }}
        >
          {draftLoading ? "Drafting…" : "Draft as permanent note"}
        </button>
      )}
    </div>
  );
}
