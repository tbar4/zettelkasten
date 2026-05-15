import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NoteType } from "@zk/shared";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  const qc = useQueryClient();
  const notesQuery = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes()
  });

  const [title, setTitle] = useState("");
  const [type, setType] = useState<NoteType>("fleeting");

  const createMutation = useMutation({
    mutationFn: () => api.createNote({ title, type }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  return (
    <div>
      <h2>Notes</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMutation.mutate();
        }}
        style={{ display: "flex", gap: 8, marginBottom: 16 }}
      >
        <input
          placeholder="New note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as NoteType)}
        >
          {NoteType.options.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!title.trim() || createMutation.isPending}>
          {createMutation.isPending ? "Creating…" : "Create"}
        </button>
      </form>

      {notesQuery.isLoading && <p>Loading…</p>}
      {notesQuery.isError && (
        <p style={{ color: "#f7768e" }}>
          Failed to load: {String(notesQuery.error)}
        </p>
      )}

      <ul>
        {notesQuery.data?.notes.map((n) => (
          <li key={n.id} className="note-row">
            {/* @ts-expect-error: route /notes/$noteId added in Task 12 */}
            <Link to="/notes/$noteId" params={{ noteId: n.id }}>
              {n.title}
            </Link>{" "}
            <span style={{ color: "#888", fontSize: 12 }}>· {n.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
