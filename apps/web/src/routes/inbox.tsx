import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { InboxReviewPane } from "../components/InboxReviewPane";
import { InboxFleetingPane } from "../components/InboxFleetingPane";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  if (inboxQuery.isLoading) return <p>Loading inbox…</p>;
  if (inboxQuery.isError || !inboxQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load inbox: {String(inboxQuery.error)}
      </p>
    );

  return (
    <div>
      <h2>Inbox</h2>
      <InboxReviewPane items={inboxQuery.data.due} />
      <InboxFleetingPane items={inboxQuery.data.fleeting} />
    </div>
  );
}
