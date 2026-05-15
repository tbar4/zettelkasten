import { Outlet, createRootRoute, Link } from "@tanstack/react-router";
import { CommandPalette } from "../components/CommandPalette";
import { useCommandPalette } from "../lib/use-command-palette";

function Root() {
  const { open, setOpen } = useCommandPalette();
  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            Zettelkasten
          </Link>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
            ⌘K to search
          </span>
        </h1>
      </header>
      <Outlet />
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
