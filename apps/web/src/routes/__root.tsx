import { Outlet, createRootRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CommandPalette } from "../components/CommandPalette";
import { useCommandPalette } from "../lib/use-command-palette";
import { startFlushLoop } from "../lib/outbox-flush";
import { api } from "../lib/api-client";

function MlStatusBadge() {
  const { data } = useQuery({
    queryKey: ["ml", "embedding-status"],
    queryFn: () => api.getEmbeddingStatus(),
    refetchInterval: 30_000,
    // Don't show an error state — badge is purely informational
    retry: false
  });

  if (!data) return null;

  const { total, embedded, stale } = data;
  const allDone = stale === 0 && total > 0;
  const color = allDone ? "#9ece6a" : stale > 0 ? "#e0af68" : "#666";
  const tooltip = `ML embeddings: ${embedded}/${total} embedded${stale > 0 ? `, ${stale} stale` : ""}`;

  return (
    <span
      title={tooltip}
      style={{
        fontSize: 11,
        color,
        cursor: "default",
        userSelect: "none"
      }}
    >
      ML {embedded}/{total}
    </span>
  );
}

function Root() {
  const { open, setOpen } = useCommandPalette();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMobile = pathname.startsWith("/m/") || pathname === "/m";

  useEffect(() => {
    const cleanup = startFlushLoop(api);
    return cleanup;
  }, []);

  if (isMobile) {
    return <Outlet />;
  }

  return (
    <>
      <header style={{ marginBottom: 24, display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1 style={{ margin: 0 }}>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            Zettelkasten
          </Link>
        </h1>
        <Link to="/inbox" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Inbox
        </Link>
        <Link to="/graph" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Graph
        </Link>
        <Link to="/import/notion" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Import
        </Link>
        <Link to="/manuscripts" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Manuscripts
        </Link>
        <Link to="/settings/link-types" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Link Types
        </Link>
        <Link to="/settings/sources" style={{ fontSize: 14, color: "#7aa2f7" }}>
          Sources
        </Link>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
          ⌘K to search
        </span>
        <MlStatusBadge />
      </header>
      <Outlet />
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
