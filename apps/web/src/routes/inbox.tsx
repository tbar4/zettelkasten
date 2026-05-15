import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  return (
    <div>
      <h2>Inbox</h2>
      <p style={{ color: "#888" }}>Panes will appear here (Tasks 12-14).</p>
    </div>
  );
}
