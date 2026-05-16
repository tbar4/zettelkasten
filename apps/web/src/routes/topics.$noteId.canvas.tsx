import { createFileRoute } from "@tanstack/react-router";
import { TopicCanvas } from "../components/TopicCanvas";

export const Route = createFileRoute("/topics/$noteId/canvas")({
  component: CanvasPage
});

function CanvasPage() {
  const { noteId } = Route.useParams();
  return (
    <div style={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
      <TopicCanvas topicNoteId={noteId} />
    </div>
  );
}
