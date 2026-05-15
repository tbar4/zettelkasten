import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return (
    <div>
      <p>Welcome. The note list will appear here once Task 11 lands.</p>
    </div>
  );
}
