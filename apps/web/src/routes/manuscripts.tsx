import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/manuscripts")({
  component: ManuscriptsLayout
});

function ManuscriptsLayout() {
  return <Outlet />;
}
