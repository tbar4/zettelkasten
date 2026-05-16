import { Outlet, createRootRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { useCommandPalette } from "../lib/use-command-palette";
import { startFlushLoop } from "../lib/outbox-flush";
import { api } from "../lib/api-client";

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
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
          ⌘K to search
        </span>
      </header>
      <Outlet />
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
