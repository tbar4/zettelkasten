import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manuscripts/$manuscriptId")({
  component: ManuscriptDetailPage
});

function ManuscriptDetailPage() {
  const { manuscriptId } = Route.useParams();
  return <div>Manuscript {manuscriptId}</div>;
}
