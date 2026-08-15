import { create } from "zustand";

import type {
  ArchitectureEdgeKind,
  ArchitectureNodeKind,
} from "@engineering-observatory/shared-types";

export type IntelligenceView =
  "map" | "components" | "impact" | "state" | "api" | "routes" | "health";

type IntelligenceState = {
  view: IntelligenceView;
  selectedNodeId: string | null;
  search: string;
  visibleKinds: ArchitectureNodeKind[];
  visibleEdges: ArchitectureEdgeKind[] | null;
  selectNode: (nodeId: string | null) => void;
  setSearch: (search: string) => void;
  setView: (view: IntelligenceView) => void;
  setVisibleKinds: (kinds: ArchitectureNodeKind[]) => void;
  setVisibleEdges: (edges: ArchitectureEdgeKind[] | null) => void;
  reset: () => void;
};

const DEFAULT_KINDS: ArchitectureNodeKind[] = [
  "component",
  "page",
  "hook",
  "service",
  "store",
  "reducer",
  "selector",
  "action",
  "effect",
  "api-client",
  "route",
  "test",
];

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  view: "map",
  selectedNodeId: null,
  search: "",
  visibleKinds: DEFAULT_KINDS,
  visibleEdges: null,
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setSearch: (search) => set({ search }),
  setView: (view) => set({ view }),
  setVisibleKinds: (visibleKinds) => set({ visibleKinds }),
  setVisibleEdges: (visibleEdges) => set({ visibleEdges }),
  reset: () =>
    set({
      view: "map",
      selectedNodeId: null,
      search: "",
      visibleKinds: DEFAULT_KINDS,
      visibleEdges: null,
    }),
}));
