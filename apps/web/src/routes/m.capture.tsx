import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api-client";
import { enqueueNote, listPending } from "../lib/outbox";

export const Route = createFileRoute("/m/capture")({
  component: CapturePage
});

function parseNote(text: string): { title: string; body_md?: string } {
  const trimmed = text.trim();
  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    // Single line — title only
    return { title: trimmed.slice(0, 60) };
  }
  const firstLine = trimmed.slice(0, newlineIndex).trim();
  const rest = trimmed.slice(newlineIndex + 1).trim();
  return { title: firstLine.slice(0, 60), body_md: rest || undefined };
}

function CapturePage() {
  const [text, setText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    void listPending().then((items) => setPendingCount(items.length));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;

    const { title, body_md } = parseNote(trimmed);

    const online = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (!online) {
      await enqueueNote({ title, body_md });
      const items = await listPending();
      setPendingCount(items.length);
      showToast("Saved offline");
      setText("");
      return;
    }

    try {
      await api.createNote({ type: "fleeting", title, body_md });
      showToast("Saved!");
      setText("");
    } catch {
      await enqueueNote({ title, body_md });
      const items = await listPending();
      setPendingCount(items.length);
      showToast("Saved offline");
      setText("");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        boxSizing: "border-box"
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Capture a thought…"
        style={{
          flex: 1,
          fontSize: 20,
          lineHeight: 1.5,
          padding: 16,
          border: "1px solid #333",
          borderRadius: 8,
          background: "#1a1b26",
          color: "#c0caf5",
          resize: "none",
          outline: "none",
          width: "100%",
          boxSizing: "border-box"
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            void handleSave();
          }
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginTop: 12,
          gap: 12
        }}
      >
        <button
          onClick={() => void handleSave()}
          style={{
            flex: 1,
            padding: "14px 0",
            fontSize: 18,
            background: "#7aa2f7",
            color: "#1a1b26",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600
          }}
        >
          Save
        </button>
        {pendingCount > 0 && (
          <span style={{ fontSize: 12, color: "#888" }}>
            queue: {pendingCount} pending
          </span>
        )}
      </div>
      {toast && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 16px",
            background: "#283457",
            borderRadius: 6,
            color: "#c0caf5",
            fontSize: 14,
            textAlign: "center"
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
