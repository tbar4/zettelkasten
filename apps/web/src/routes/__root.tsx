import { Outlet, createRootRoute, Link } from "@tanstack/react-router";
import { CommandPalette } from "../components/CommandPalette";
import { useCommandPalette } from "../lib/use-command-palette";

function Root() {
  const { open, setOpen } = useCommandPalette();
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
