import { Outlet, createRootRoute, Link } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            Zettelkasten
          </Link>
        </h1>
      </header>
      <Outlet />
    </>
  )
});
