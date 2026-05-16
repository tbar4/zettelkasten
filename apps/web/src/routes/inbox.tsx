import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { InboxReviewPane } from "../components/InboxReviewPane";
import { InboxFleetingPane } from "../components/InboxFleetingPane";
import { InboxHighlightsPane } from "../components/InboxHighlightsPane";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  // ML-driven review ranking — separate query so it can fail independently
  const reviewQuery = useQuery({
    queryKey: ["inbox", "review"],
    queryFn: () => api.getInboxReview()
  });

  if (inboxQuery.isLoading) return <p>Loading inbox…</p>;
  if (inboxQuery.isError || !inboxQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load inbox: {String(inboxQuery.error)}
      </p>
    );

  // Merge review results: prefer ML-ranked list when available, fall back to
  // the legacy time-decay `due` list from the main inbox endpoint.
  const reviewItems = reviewQuery.data?.review.length
    ? reviewQuery.data.review
    : inboxQuery.data.due;

  return (
    <div>
      <h2>Inbox</h2>
      <InboxReviewPane items={reviewItems} />
      <InboxFleetingPane items={inboxQuery.data.fleeting} />
      <InboxHighlightsPane items={inboxQuery.data.highlights} />
    </div>
  );
}
