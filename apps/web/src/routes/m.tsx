import { createFileRoute, Outlet, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/m")({
  component: MobileShell
});

function MobileShell() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: "#1a1b26",
        color: "#c0caf5"
      }}
    >
      {/* Main content area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Outlet />
      </div>

      {/* Bottom tab bar */}
      <nav
        style={{
          display: "flex",
          borderTop: "1px solid #333",
          background: "#16161e"
        }}
      >
        <Link
          to="/m/capture"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 0",
            fontSize: 12,
            color: "#7aa2f7",
            textDecoration: "none",
            gap: 4
          }}
          activeProps={{ style: { color: "#c0caf5", fontWeight: 700 } }}
        >
          <span style={{ fontSize: 22 }}>✏️</span>
          Capture
        </Link>
        <Link
          to="/m/inbox"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 0",
            fontSize: 12,
            color: "#7aa2f7",
            textDecoration: "none",
            gap: 4
          }}
          activeProps={{ style: { color: "#c0caf5", fontWeight: 700 } }}
        >
          <span style={{ fontSize: 22 }}>📥</span>
          Inbox
        </Link>
      </nav>
    </div>
  );
}
