import React, { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ExcalidrawInitialDataState,
  AppState,
  BinaryFiles
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "../lib/api-client";

const ExcalidrawLazy = React.lazy(async () => {
  const mod = await import("@excalidraw/excalidraw");
  await import("@excalidraw/excalidraw/index.css");
  return { default: mod.Excalidraw };
});

interface Props {
  topicNoteId: string;
}

export function TopicCanvas({ topicNoteId }: Props) {
  const qc = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState("");

  const canvasQuery = useQuery({
    queryKey: ["canvas", topicNoteId],
    queryFn: () => api.canvasByTopic(topicNoteId)
  });

  const notesQuery = useQuery({
    queryKey: ["notes"],
    queryFn: () => api.listNotes()
  });

  const updateMutation = useMutation({
    mutationFn: (patch: { scene_data?: string; viewport?: string; theme?: string }) => {
      const canvasId = canvasQuery.data!.id;
      return api.updateCanvas(canvasId, patch);
    }
  });

  const addItemMutation = useMutation({
    mutationFn: ({ noteId }: { noteId: string }) => {
      const canvasId = canvasQuery.data!.id;
      return api.addCanvasItem(canvasId, { noteId, x: 100, y: 100 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canvas", topicNoteId] });
      setSelectedNoteId("");
    }
  });

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, _files: BinaryFiles) => {
      if (!canvasQuery.data) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const sceneData = JSON.stringify({ elements, appState });
        updateMutation.mutate({ scene_data: sceneData });
      }, 1500);
    },
    [canvasQuery.data, updateMutation]
  );

  const initialData = useMemo((): ExcalidrawInitialDataState | undefined => {
    if (!canvasQuery.data?.scene_data) return undefined;
    try {
      return JSON.parse(canvasQuery.data.scene_data) as ExcalidrawInitialDataState;
    } catch {
      return undefined;
    }
  }, [canvasQuery.data?.scene_data]);

  if (canvasQuery.isLoading) return <p>Loading canvas…</p>;
  if (canvasQuery.isError)
    return <p style={{ color: "#f7768e" }}>Failed to load canvas</p>;
  if (!canvasQuery.data) return null;

  const canvas = canvasQuery.data;
  const availableNotes = (notesQuery.data?.notes ?? []).filter(
    (n) => n.type !== "topic"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 8, padding: "8px 0", alignItems: "center" }}>
        <select
          value={selectedNoteId}
          onChange={(e) => setSelectedNoteId(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— pick a note —</option>
          {availableNotes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title} ({n.type})
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (selectedNoteId) addItemMutation.mutate({ noteId: selectedNoteId });
          }}
          disabled={!selectedNoteId || addItemMutation.isPending}
        >
          Add to canvas
        </button>
        {canvas.items.length > 0 && (
          <span style={{ fontSize: 12, color: "#888" }}>
            {canvas.items.length} card{canvas.items.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <React.Suspense fallback={<p>Loading Excalidraw…</p>}>
          <ExcalidrawLazy
            initialData={initialData}
            onChange={handleChange}
          />
        </React.Suspense>
      </div>
    </div>
  );
}
