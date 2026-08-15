import { createHash } from "node:crypto";

import type {
  ArchitectureGraph,
  ArchitectureIssue,
  ArchitectureNode,
  FrontendHealthCategory,
  FrontendHealthScore,
  ProjectProfile,
  Severity,
} from "@engineering-observatory/shared-types";

export type SourceDocument = {
  path: string;
  text: string;
  lineCount: number;
};

type IssueInput = Omit<ArchitectureIssue, "id">;

function stableId(...values: string[]) {
  return createHash("sha256")
    .update(values.join("|"))
    .digest("hex")
    .slice(0, 24);
}

function issue(input: IssueInput): ArchitectureIssue {
  return {
    ...input,
    id: stableId(input.ruleId, input.location.path, input.title),
  };
}

function severityForCount(count: number): Severity {
  return count >= 20 ? "high" : count >= 13 ? "medium" : "low";
}

function firstLine(text: string, pattern: RegExp): number {
  const index = text.search(pattern);
  return index < 0 ? 1 : text.slice(0, index).split("\n").length;
}

function findImportCycle(graph: ArchitectureGraph): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "imports") continue;
    const values = adjacency.get(edge.source) ?? [];
    values.push(edge.target);
    adjacency.set(edge.source, values);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(nodeId: string): string[] | null {
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(Math.max(0, start)), nodeId];
    }
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    active.add(nodeId);
    stack.push(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(nodeId);
    return null;
  }

  for (const nodeId of adjacency.keys()) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

function couplingIssues(graph: ArchitectureGraph): ArchitectureIssue[] {
  const outgoing = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!["imports", "calls", "renders", "injects"].includes(edge.kind)) {
      continue;
    }
    const values = outgoing.get(edge.source) ?? new Set<string>();
    values.add(edge.target);
    outgoing.set(edge.source, values);
  }
  return graph.nodes.flatMap((node) => {
    const count = outgoing.get(node.id)?.size ?? 0;
    if (count <= 12) return [];
    return [
      issue({
        ruleId: "architecture.coupling.high",
        category: "architecture",
        severity: severityForCount(count),
        title: `${node.name} has high outgoing coupling`,
        explanation: `${node.name} has ${count} resolved architecture dependencies. High fan-out increases coordination and regression surface, although imports alone do not prove poor cohesion.`,
        location: node.location,
        scoreDeduction: count >= 20 ? 10 : 6,
        evidence: { dependencies: count, threshold: 12 },
      }),
    ];
  });
}

function graphIssues(graph: ArchitectureGraph): ArchitectureIssue[] {
  const issues = couplingIssues(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const cycle = findImportCycle(graph);
  if (cycle) {
    const first = nodesById.get(cycle[0] ?? "");
    const names = cycle.map((id) => nodesById.get(id)?.name ?? id).slice(0, 8);
    if (first) {
      issues.push(
        issue({
          ruleId: "architecture.dependency.circular",
          category: "architecture",
          severity: "high",
          title: "Circular dependency detected",
          explanation: `The resolved import graph contains a cycle: ${names.join(" → ")}. Cycles make initialization order and change isolation harder to reason about.`,
          location: first.location,
          scoreDeduction: 12,
          evidence: { cycle: names },
        }),
      );
    }
  }

  for (const node of graph.nodes) {
    if (
      node.kind === "route" &&
      node.metadata.lazy === false &&
      node.name !== "/"
    ) {
      issues.push(
        issue({
          ruleId: "performance.route.missing-lazy-boundary",
          category: "performance",
          severity: "medium",
          title: `Route ${node.name} is loaded eagerly`,
          explanation:
            "The static route definition references its page eagerly. Confirm the measured bundle impact before adding a lazy boundary.",
          location: node.location,
          scoreDeduction: 5,
          evidence: {
            route: node.name,
            bundleSize: "not-measured",
            lazy: false,
          },
        }),
      );
    }
    if (
      (node.kind === "component" || node.kind === "page") &&
      typeof node.metadata.lineCount === "number" &&
      node.metadata.lineCount > 350
    ) {
      issues.push(
        issue({
          ruleId: "maintainability.component.large",
          category: "maintainability",
          severity: node.metadata.lineCount > 700 ? "high" : "medium",
          title: `${node.name} is a large component`,
          explanation: `${node.name} spans ${node.metadata.lineCount} lines. Size is a review signal, not proof that the component lacks cohesion.`,
          location: node.location,
          scoreDeduction: node.metadata.lineCount > 700 ? 10 : 6,
          evidence: { lines: node.metadata.lineCount, threshold: 350 },
        }),
      );
    }
    if (
      node.framework === "angular" &&
      node.kind === "component" &&
      node.metadata.onPush === false
    ) {
      issues.push(
        issue({
          ruleId: "performance.angular.on-push-missing",
          category: "performance",
          severity: "low",
          title: `${node.name} does not declare OnPush`,
          explanation:
            "No OnPush change-detection strategy was detected. This is a candidate for measurement, not an automatic refactor recommendation.",
          location: node.location,
          scoreDeduction: 2,
          evidence: { onPush: false },
        }),
      );
    }
    if (
      (node.kind === "component" || node.kind === "page") &&
      node.metadata.largeListWithoutVirtualization === true
    ) {
      issues.push(
        issue({
          ruleId: "performance.list.virtualization-candidate",
          category: "performance",
          severity: "medium",
          title: `${node.name} renders a list without detected virtualization`,
          explanation:
            "A render-time array map was detected without a known virtualization library in the file. List size and measured render cost determine whether virtualization is justified.",
          location: node.location,
          scoreDeduction: 5,
          evidence: { virtualizationDetected: false },
        }),
      );
    }
  }
  return issues;
}

function sourceIssues(
  documents: SourceDocument[],
  profile: ProjectProfile,
): ArchitectureIssue[] {
  const issues: ArchitectureIssue[] = [];
  const hasVirtualizationDependency = profile.projects.some((project) =>
    Object.keys(project.dependencies).some((dependency) =>
      ["react-window", "react-virtualized", "@tanstack/react-virtual"].includes(
        dependency,
      ),
    ),
  );

  for (const document of documents) {
    const location = (pattern: RegExp) => {
      const line = firstLine(document.text, pattern);
      return { path: document.path, lineStart: line, lineEnd: line };
    };
    if (/dangerouslySetInnerHTML\s*=/.test(document.text)) {
      issues.push(
        issue({
          ruleId: "security.react.dangerous-html",
          category: "security",
          severity: "high",
          title: "dangerouslySetInnerHTML usage detected",
          explanation:
            "Raw HTML rendering bypasses React escaping. The source and sanitization path must be verified before treating this as exploitable.",
          location: location(/dangerouslySetInnerHTML\s*=/),
          scoreDeduction: 12,
          evidence: { pattern: "dangerouslySetInnerHTML" },
        }),
      );
    }
    if (/\[innerHTML\]\s*=/.test(document.text)) {
      issues.push(
        issue({
          ruleId: "security.angular.inner-html",
          category: "security",
          severity: "medium",
          title: "Angular innerHTML binding detected",
          explanation:
            "Angular sanitizes supported bindings, but the value origin and any trust bypass still require review.",
          location: location(/\[innerHTML\]\s*=/),
          scoreDeduction: 7,
          evidence: { pattern: "[innerHTML]" },
        }),
      );
    }
    if (
      /bypassSecurityTrust(?:Html|Script|Url|ResourceUrl)\s*\(/.test(
        document.text,
      )
    ) {
      issues.push(
        issue({
          ruleId: "security.angular.sanitizer-bypass",
          category: "security",
          severity: "high",
          title: "Angular sanitizer bypass detected",
          explanation:
            "A DomSanitizer trust bypass suppresses framework sanitization. Confirm that only trusted, constrained values reach this call.",
          location: location(/bypassSecurityTrust/),
          scoreDeduction: 14,
          evidence: { pattern: "bypassSecurityTrust*" },
        }),
      );
    }
    if (
      /localStorage\.setItem\s*\(\s*["'][^"']*(?:token|auth|session|secret)/i.test(
        document.text,
      )
    ) {
      issues.push(
        issue({
          ruleId: "security.browser.sensitive-local-storage",
          category: "security",
          severity: "medium",
          title: "Sensitive browser state may be stored in localStorage",
          explanation:
            "A security-related key is written to localStorage, which is readable by injected scripts. Verify the threat model and token lifetime.",
          location: location(/localStorage\.setItem/),
          scoreDeduction: 7,
          evidence: { sink: "localStorage.setItem", value: "redacted" },
        }),
      );
    }
    if (
      /\.subscribe\s*\(/.test(document.text) &&
      !/(?:takeUntilDestroyed|takeUntil|async\s*pipe|\|\s*async)/.test(
        document.text,
      )
    ) {
      issues.push(
        issue({
          ruleId: "maintainability.angular.subscription-cleanup",
          category: "maintainability",
          severity: "medium",
          title: "Subscription cleanup was not detected",
          explanation:
            "A direct subscription was detected without a recognized lifecycle cleanup pattern in the same file. Ownership may still exist elsewhere.",
          location: location(/\.subscribe\s*\(/),
          scoreDeduction: 5,
          evidence: { cleanupDetected: false },
        }),
      );
    }
    if (
      !hasVirtualizationDependency &&
      document.lineCount > 100 &&
      /\.map\s*\([^)]*=>\s*(?:\(|<)/s.test(document.text)
    ) {
      // The component-level issue is emitted from node metadata. This branch is
      // intentionally evidence collection only to avoid duplicate deductions.
    }
  }
  return issues;
}

function scoreHealth(issues: ArchitectureIssue[]): FrontendHealthScore[] {
  const categories: FrontendHealthCategory[] = [
    "architecture",
    "performance",
    "security",
    "maintainability",
  ];
  return categories.map((category) => {
    const categoryIssues = issues.filter((item) => item.category === category);
    const byRule = new Map<string, ArchitectureIssue[]>();
    for (const item of categoryIssues) {
      const values = byRule.get(item.ruleId) ?? [];
      values.push(item);
      byRule.set(item.ruleId, values);
    }
    const deductions = [...byRule.entries()]
      .map(([ruleId, values]) => ({
        ruleId,
        occurrences: values.length,
        points: Math.min(
          30,
          values.reduce((total, value) => total + value.scoreDeduction, 0),
        ),
      }))
      .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
    return {
      category,
      score: Math.max(
        0,
        100 - deductions.reduce((total, value) => total + value.points, 0),
      ),
      deductions,
    };
  });
}

export function evaluateArchitectureHealth(
  graph: ArchitectureGraph,
  documents: SourceDocument[],
  profile: ProjectProfile,
): { issues: ArchitectureIssue[]; health: FrontendHealthScore[] } {
  const issues = [
    ...graphIssues(graph),
    ...sourceIssues(documents, profile),
  ].sort((left, right) =>
    `${left.location.path}:${left.location.lineStart ?? 0}:${left.ruleId}`.localeCompare(
      `${right.location.path}:${right.location.lineStart ?? 0}:${right.ruleId}`,
    ),
  );
  return { issues, health: scoreHealth(issues) };
}

export function isComponentLike(node: ArchitectureNode) {
  return node.kind === "component" || node.kind === "page";
}
