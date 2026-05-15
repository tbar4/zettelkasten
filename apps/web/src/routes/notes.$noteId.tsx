import {
  createFileRoute,
  useNavigate,
  useRouter
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { NoteEditor } from "../components/NoteEditor";
import { LinksPanel } from "../components/LinksPanel";
import { NoteTopBar } from "../components/NoteTopBar";
import { LiteratureSourceBlock } from "../components/LiteratureSourceBlock";

export const Route = createFileRoute("/notes/$noteId")({
  component: NoteDetail
});

function NoteDetail() {
  const { noteId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const noteQuery = useQuery({
    queryKey: ["notes", noteId],
    queryFn: () => api.getNote(noteId)
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  useEffect(() => {
    if (noteQuery.data && hydratedFor !== noteQuery.data.id) {
      setTitle(noteQuery.data.title);
      setBody(noteQuery.data.body_md ?? "");
      setHydratedFor(noteQuery.data.id);
    }
  }, [noteQuery.data, hydratedFor]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!noteQuery.data) throw new Error("no note");
      const isTopic = noteQuery.data.type === "topic";
      return api.updateNote(
        noteId,
        {
          title,
          ...(isTopic ? {} : { body_md: body })
        },
        noteQuery.data.updated_at
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", noteId] });
      qc.invalidateQueries({ queryKey: ["notes", noteId, "links"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.archiveNote(noteId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/" });
    }
  });

  if (noteQuery.isLoading) return <p>Loading…</p>;
  if (noteQuery.isError)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load: {String(noteQuery.error)}
      </p>
    );
  if (!noteQuery.data) return null;

  const isTopic = noteQuery.data.type === "topic";

  return (
    <div>
      <NoteTopBar note={noteQuery.data} onBack={() => router.history.back()} />

      {noteQuery.data.type === "literature" && (
        <LiteratureSourceBlock sources={noteQuery.data.sources} />
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ width: "100%", fontSize: 24, marginTop: 16 }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 16,
          marginTop: 16
        }}
      >
        <div>
          {isTopic ? (
            <p style={{ color: "#888" }}>
              Topic notes have no body. The title is the description.
            </p>
          ) : (
            <NoteEditor value={body} onChange={setBody} />
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                if (confirm("Archive this note?")) archiveMutation.mutate();
              }}
            >
              Archive
            </button>
            {updateMutation.isError && (
              <span style={{ color: "#f7768e", alignSelf: "center" }}>
                {String(updateMutation.error)}
              </span>
            )}
          </div>
        </div>

        <LinksPanel noteId={noteId} />
      </div>
    </div>
  );
}
