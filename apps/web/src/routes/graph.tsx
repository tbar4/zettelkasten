import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { SigmaContainer, useLoadGraph, useRegisterEvents } from "@react-sigma/core";
import Graph from "graphology";
import "@react-sigma/core/lib/react-sigma.min.css";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/graph")({
  component: GraphPage
});

const TYPE_COLORS: Record<string, string> = {
  fleeting: "#888888",
  literature: "#9ece6a",
  permanent: "#7aa2f7",
  topic: "#bb9af7"
};

interface GraphData {
  nodes: { id: string; title: string; type: string }[];
  edges: { id: string; source: string; target: string; link_type: string }[];
}

function GraphLoader({
  data,
  typeFilter
}: {
  data: GraphData;
  typeFilter: string | null;
}) {
  const loadGraph = useLoadGraph();
  useEffect(() => {
    const graph = new Graph({ multi: true });
    const includedNodes = new Set<string>();
    for (const n of data.nodes) {
      if (typeFilter && n.type !== typeFilter) continue;
      includedNodes.add(n.id);
      graph.addNode(n.id, {
        label: n.title,
        size: 4,
        color: TYPE_COLORS[n.type] ?? "#cccccc",
        x: Math.random(),
        y: Math.random()
      });
    }
    for (const e of data.edges) {
      if (!includedNodes.has(e.source) || !includedNodes.has(e.target)) continue;
      try {
        graph.addEdgeWithKey(e.id, e.source, e.target, {
          color: "#444",
          size: 1
        });
      } catch {
        // Duplicate-key insert: ignore; a previous render may already have added it.
      }
    }
    loadGraph(graph);
  }, [data, typeFilter, loadGraph]);
  return null;
}

function GraphEvents({ onNodeClick }: { onNodeClick: (id: string) => void }) {
  const registerEvents = useRegisterEvents();
  useEffect(() => {
    registerEvents({
      clickNode: (e) => onNodeClick(e.node)
    });
  }, [registerEvents, onNodeClick]);
  return null;
}

function GraphPage() {
  const navigate = useNavigate();
  const graphQuery = useQuery({
    queryKey: ["graph"],
    queryFn: () => api.getGraph()
  });
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const types = useMemo(() => {
    if (!graphQuery.data) return [];
    return [...new Set(graphQuery.data.nodes.map((n) => n.type))].sort();
  }, [graphQuery.data]);

  if (graphQuery.isLoading) return <p>Loading graph…</p>;
  if (graphQuery.isError || !graphQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load graph: {String(graphQuery.error)}
      </p>
    );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => setTypeFilter(null)}
          style={{
            background: typeFilter === null ? "#333" : "#1a1a1a"
          }}
        >
          all ({graphQuery.data.nodes.length})
        </button>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              background: typeFilter === t ? "#333" : "#1a1a1a",
              color: TYPE_COLORS[t] ?? "inherit"
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ height: "70vh", border: "1px solid #222", borderRadius: 4 }}>
        <SigmaContainer
          style={{ height: "100%", background: "#0f0f0f" }}
          settings={{
            renderLabels: true,
            labelColor: { color: "#e8e8e8" },
            labelSize: 11,
            defaultEdgeColor: "#444",
            defaultNodeColor: "#cccccc"
          }}
        >
          <GraphLoader data={graphQuery.data} typeFilter={typeFilter} />
          <GraphEvents
            onNodeClick={(id) =>
              navigate({ to: "/notes/$noteId", params: { noteId: id } })
            }
          />
        </SigmaContainer>
      </div>
    </div>
  );
}
