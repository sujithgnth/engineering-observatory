import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import {
  Node as MorphNode,
  Project,
  SyntaxKind,
  ts,
  type Node as MorphNodeType,
  type SourceFile,
} from "ts-morph";

import { repositoryIgnorePatterns } from "@engineering-observatory/scanners";
import {
  ArchitectureGraphSchema,
  type ArchitectureEdgeKind,
  type ArchitectureGraph,
  type ArchitectureMetadata,
  type ArchitectureNode,
  type ArchitectureNodeKind,
  type Confidence,
  type FrontendFramework,
  type ProjectProfile,
} from "@engineering-observatory/shared-types";

import { evaluateArchitectureHealth, type SourceDocument } from "./health";

const ANALYZER_VERSION = "1.0.0";
const MAX_SOURCE_FILES = 20_000;
const MAX_SOURCE_FILE_BYTES = 1_000_000;

type SymbolRange = {
  node: ArchitectureNode;
  startLine: number;
  endLine: number;
};

type BuildState = {
  graph: ArchitectureGraph;
  documents: SourceDocument[];
  sourceFiles: SourceFile[];
  relativePath: Map<string, string>;
  moduleByFile: Map<string, ArchitectureNode>;
  symbolsByFile: Map<string, ArchitectureNode[]>;
  rangesByFile: Map<string, SymbolRange[]>;
  nodesByStableKey: Map<string, ArchitectureNode>;
  nameIndex: Map<string, ArchitectureNode[]>;
  importTargets: Map<string, Map<string, ArchitectureNode>>;
  edgeKeys: Set<string>;
};

function hash(value: string, length = 24) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function normalized(relativePath: string) {
  return relativePath.replaceAll(path.sep, "/");
}

function languageFor(filePath: string) {
  if (filePath.endsWith(".tsx")) return "tsx" as const;
  if (filePath.endsWith(".jsx")) return "jsx" as const;
  if (filePath.endsWith(".ts")) return "typescript" as const;
  return "javascript" as const;
}

function testFile(filePath: string) {
  return /(?:^|\/)(?:__tests__\/|[^/]+\.(?:spec|test)\.[jt]sx?$)/.test(
    filePath,
  );
}

function pageFile(filePath: string) {
  return (
    /(?:^|\/)pages?\/.+\.[jt]sx?$/.test(filePath) ||
    /(?:^|\/)app\/.+\/page\.[jt]sx?$/.test(filePath) ||
    /(?:^|\/)app\/page\.[jt]sx?$/.test(filePath)
  );
}

function titleCase(value: string) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function pageName(filePath: string) {
  const parts = filePath.split("/");
  const file = parts.at(-1)?.replace(/\.[^.]+$/, "") ?? "Page";
  const basis = ["page", "index"].includes(file)
    ? (parts.at(-2) ?? "Home")
    : file;
  return `${titleCase(basis) || "Home"}Page`;
}

function frameworkFor(
  filePath: string,
  text: string,
  profile: ProjectProfile,
): FrontendFramework {
  const dependencies = profile.projects.flatMap((project) =>
    Object.keys(project.dependencies),
  );
  if (
    dependencies.includes("next") &&
    (/(?:^|\/)(?:app|pages)\//.test(filePath) || /from\s+["']next\//.test(text))
  ) {
    return "nextjs";
  }
  if (
    /@(?:Component|Injectable|NgModule)\s*\(|@ngrx\/|\bsignal\s*\(/.test(
      text,
    ) ||
    profile.projects.some((project) =>
      project.frameworks.some((framework) => framework.name === "angular"),
    )
  ) {
    return "angular";
  }
  if (
    /(?:from\s+["']react["']|<[A-Z][A-Za-z0-9.]*(?:\s|\/?>)|\buse[A-Z]\w*\s*\()/.test(
      text,
    ) ||
    profile.projects.some((project) =>
      project.frameworks.some((framework) => framework.name === "react"),
    )
  ) {
    return "react";
  }
  return "typescript";
}

function hasJsx(node: MorphNodeType) {
  return node
    .getDescendants()
    .some(
      (descendant) =>
        MorphNode.isJsxElement(descendant) ||
        MorphNode.isJsxSelfClosingElement(descendant) ||
        MorphNode.isJsxFragment(descendant),
    );
}

function isPascalCase(name: string) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function metadataForComponent(
  declarationText: string,
  lineCount: number,
  framework: FrontendFramework,
): ArchitectureMetadata {
  const metadata: ArchitectureMetadata = {
    lineCount,
    largeListWithoutVirtualization:
      /\.map\s*\([^)]*=>\s*(?:\(|<)/s.test(declarationText) &&
      !/(?:useVirtualizer|FixedSizeList|VariableSizeList|react-window|react-virtualized)/.test(
        declarationText,
      ),
  };
  if (framework === "angular") {
    metadata.onPush =
      /changeDetection\s*:\s*ChangeDetectionStrategy\.OnPush/.test(
        declarationText,
      );
    const selector = declarationText.match(
      /selector\s*:\s*["']([^"']+)["']/,
    )?.[1];
    if (selector) metadata.selector = selector;
  }
  return metadata;
}

function addNode(
  state: BuildState,
  input: {
    kind: ArchitectureNodeKind;
    name: string;
    framework: FrontendFramework;
    filePath: string;
    startLine: number;
    endLine: number;
    metadata?: ArchitectureMetadata;
    stableSuffix?: string;
  },
): ArchitectureNode {
  const stableKey = `${input.kind}:${input.filePath}:${input.stableSuffix ?? input.name}`;
  const existing = state.nodesByStableKey.get(stableKey);
  if (existing) return existing;
  const node: ArchitectureNode = {
    id: hash(stableKey),
    stableKey,
    kind: input.kind,
    name: input.name,
    framework: input.framework,
    location: {
      path: input.filePath,
      lineStart: Math.max(1, input.startLine),
      lineEnd: Math.max(input.startLine, input.endLine),
    },
    metadata: input.metadata ?? {},
  };
  state.nodesByStableKey.set(stableKey, node);
  state.graph.nodes.push(node);
  const fileNodes = state.symbolsByFile.get(input.filePath) ?? [];
  fileNodes.push(node);
  state.symbolsByFile.set(input.filePath, fileNodes);
  const values = state.nameIndex.get(input.name) ?? [];
  values.push(node);
  state.nameIndex.set(input.name, values);
  return node;
}

function addDeclaredNode(
  state: BuildState,
  declaration: MorphNodeType,
  input: Omit<Parameters<typeof addNode>[1], "startLine" | "endLine">,
) {
  const node = addNode(state, {
    ...input,
    startLine: declaration.getStartLineNumber(),
    endLine: declaration.getEndLineNumber(),
  });
  const ranges = state.rangesByFile.get(input.filePath) ?? [];
  ranges.push({
    node,
    startLine: declaration.getStartLineNumber(),
    endLine: declaration.getEndLineNumber(),
  });
  state.rangesByFile.set(input.filePath, ranges);
  return node;
}

function addEdge(
  state: BuildState,
  source: ArchitectureNode | undefined,
  target: ArchitectureNode | undefined,
  kind: ArchitectureEdgeKind,
  evidence: { path: string; line: number },
  confidence: Confidence = "high",
) {
  if (!source || !target || source.id === target.id) return;
  const key = `${kind}:${source.id}:${target.id}`;
  if (state.edgeKeys.has(key)) return;
  state.edgeKeys.add(key);
  state.graph.edges.push({
    id: hash(key),
    source: source.id,
    target: target.id,
    kind,
    confidence,
    evidence: {
      path: evidence.path,
      lineStart: Math.max(1, evidence.line),
      lineEnd: Math.max(1, evidence.line),
    },
  });
}

function nodePriority(kind: ArchitectureNodeKind) {
  const priorities: ArchitectureNodeKind[] = [
    "page",
    "component",
    "hook",
    "service",
    "store",
    "api-client",
    "reducer",
    "selector",
    "action",
    "effect",
    "test",
    "utility",
    "module",
    "route",
  ];
  return priorities.indexOf(kind);
}

function primaryNode(state: BuildState, filePath: string) {
  const candidates = state.symbolsByFile.get(filePath) ?? [];
  return [...candidates].sort(
    (left, right) => nodePriority(left.kind) - nodePriority(right.kind),
  )[0];
}

function ownerAt(state: BuildState, filePath: string, line: number) {
  const range = (state.rangesByFile.get(filePath) ?? [])
    .filter((item) => item.startLine <= line && item.endLine >= line)
    .sort(
      (left, right) =>
        left.endLine - left.startLine - (right.endLine - right.startLine),
    )[0];
  return range?.node ?? primaryNode(state, filePath);
}

function kindForCall(
  name: string,
  callText: string,
): ArchitectureNodeKind | null {
  const callee = callText.replace(/\s/g, "");
  if (
    /\b(?:createSlice|configureStore|createStore|createContext|signal)\(/.test(
      callee,
    )
  )
    return "store";
  if (/\bcreateReducer\(/.test(callee) || /Reducer$/.test(name))
    return "reducer";
  if (/\bcreateSelector\(/.test(callee) || /^select[A-Z]/.test(name))
    return "selector";
  if (/\bcreateAction\(/.test(callee)) return "action";
  if (/\bcreateEffect\(/.test(callee)) return "effect";
  if (
    /\b(?:createApi|axios\.create|newApolloClient|newApolloClient)\(/.test(
      callee,
    )
  )
    return "api-client";
  if (
    (callee.startsWith("create") || /\bcreate\(/.test(callee)) &&
    /(?:Store|store)$/.test(name)
  )
    return "store";
  return null;
}

function addSliceChildren(
  state: BuildState,
  filePath: string,
  framework: FrontendFramework,
  declaration: ReturnType<SourceFile["getVariableDeclarations"]>[number],
  store: ArchitectureNode,
) {
  const initializer = declaration.getInitializer();
  if (!initializer || !MorphNode.isCallExpression(initializer)) return;
  const config = initializer.getArguments()[0];
  if (!config || !MorphNode.isObjectLiteralExpression(config)) return;
  for (const propertyName of ["reducers", "selectors"] as const) {
    const property = config.getProperty(propertyName);
    if (!property || !MorphNode.isPropertyAssignment(property)) continue;
    const object = property.getInitializer();
    if (!object || !MorphNode.isObjectLiteralExpression(object)) continue;
    for (const member of object.getProperties()) {
      if (
        !MorphNode.isPropertyAssignment(member) &&
        !MorphNode.isMethodDeclaration(member) &&
        !MorphNode.isShorthandPropertyAssignment(member)
      ) {
        continue;
      }
      const name = member.getName();
      const kind = propertyName === "reducers" ? "action" : "selector";
      const child = addDeclaredNode(state, member, {
        kind,
        name,
        framework,
        filePath,
        metadata: { stateLibrary: "redux-toolkit", store: store.name },
        stableSuffix: `${store.name}:${propertyName}:${name}`,
      });
      addEdge(
        state,
        child,
        store,
        kind === "selector" ? "reads-state" : "writes-state",
        { path: filePath, line: member.getStartLineNumber() },
      );
    }
  }
}

function collectDeclarations(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
  framework: FrontendFramework,
  document: SourceDocument,
) {
  if (testFile(filePath)) {
    addNode(state, {
      kind: "test",
      name: filePath.split("/").at(-1) ?? filePath,
      framework,
      filePath,
      startLine: 1,
      endLine: document.lineCount,
      metadata: { lineCount: document.lineCount },
    });
    return;
  } else {
    const module = addNode(state, {
      kind: "module",
      name: filePath,
      framework,
      filePath,
      startLine: 1,
      endLine: document.lineCount,
      metadata: { lineCount: document.lineCount },
    });
    state.moduleByFile.set(filePath, module);
  }

  for (const declaration of sourceFile.getClasses()) {
    const name =
      declaration.getName() ??
      (pageFile(filePath) ? pageName(filePath) : "DefaultClass");
    const decorators = declaration
      .getDecorators()
      .map((decorator) => decorator.getName());
    let kind: ArchitectureNodeKind | null = null;
    if (decorators.includes("Component"))
      kind = pageFile(filePath) ? "page" : "component";
    else if (decorators.includes("Injectable") || /Service$/.test(name))
      kind = "service";
    else if (/Reducer$/.test(name)) kind = "reducer";
    else if (declaration.isExported() || declaration.isDefaultExport())
      kind = "utility";
    if (!kind) continue;
    const classNode = addDeclaredNode(state, declaration, {
      kind,
      name,
      framework,
      filePath,
      metadata:
        kind === "component" || kind === "page"
          ? metadataForComponent(
              declaration.getText(),
              declaration.getEndLineNumber() -
                declaration.getStartLineNumber() +
                1,
              framework,
            )
          : { decorators },
    });
    for (const property of declaration.getProperties()) {
      const initializer = property.getInitializer();
      if (!initializer || !MorphNode.isCallExpression(initializer)) continue;
      const propertyKind = kindForCall(
        property.getName(),
        initializer.getText(),
      );
      if (!propertyKind) continue;
      const propertyNode = addDeclaredNode(state, property, {
        kind: propertyKind,
        name: property.getName(),
        framework,
        filePath,
        metadata: {
          ...(propertyKind === "effect" ? { stateLibrary: "ngrx" } : {}),
          owner: classNode.name,
        },
        stableSuffix: `${classNode.name}:${property.getName()}`,
      });
      if (propertyKind === "effect") {
        addEdge(state, classNode, propertyNode, "calls", {
          path: filePath,
          line: property.getStartLineNumber(),
        });
      }
    }
  }

  for (const declaration of sourceFile.getFunctions()) {
    const name =
      declaration.getName() ??
      (pageFile(filePath) ? pageName(filePath) : "defaultFunction");
    let kind: ArchitectureNodeKind | null = null;
    if (
      pageFile(filePath) &&
      (declaration.isDefaultExport() || hasJsx(declaration))
    )
      kind = "page";
    else if (/^use[A-Z]/.test(name)) kind = "hook";
    else if (isPascalCase(name) && hasJsx(declaration)) kind = "component";
    else if (/Service$/.test(name)) kind = "service";
    else if (declaration.isExported() || declaration.isDefaultExport())
      kind = "utility";
    if (!kind) continue;
    addDeclaredNode(state, declaration, {
      kind,
      name,
      framework,
      filePath,
      metadata:
        kind === "component" || kind === "page"
          ? metadataForComponent(
              declaration.getText(),
              declaration.getEndLineNumber() -
                declaration.getStartLineNumber() +
                1,
              framework,
            )
          : {},
    });
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    const initializer = declaration.getInitializer();
    let kind: ArchitectureNodeKind | null = null;
    if (initializer && MorphNode.isCallExpression(initializer)) {
      kind = kindForCall(name, initializer.getText());
    }
    if (
      !kind &&
      initializer &&
      (MorphNode.isArrowFunction(initializer) ||
        MorphNode.isFunctionExpression(initializer))
    ) {
      if (pageFile(filePath) && hasJsx(initializer)) kind = "page";
      else if (/^use[A-Z]/.test(name)) kind = "hook";
      else if (isPascalCase(name) && hasJsx(initializer)) kind = "component";
      else if (/Service$/.test(name)) kind = "service";
      else if (declaration.getVariableStatement()?.isExported())
        kind = "utility";
    }
    if (!kind) continue;
    const callText = initializer?.getText() ?? "";
    const metadata: ArchitectureMetadata =
      kind === "component" || kind === "page"
        ? metadataForComponent(
            declaration.getText(),
            declaration.getEndLineNumber() -
              declaration.getStartLineNumber() +
              1,
            framework,
          )
        : {
            stateLibrary: /createSlice|configureStore/.test(callText)
              ? "redux-toolkit"
              : /createSelector|createAction|createReducer|createEffect/.test(
                    callText,
                  )
                ? framework === "angular"
                  ? "ngrx"
                  : "redux"
                : /createContext/.test(callText)
                  ? "react-context"
                  : /signal\(/.test(callText)
                    ? "angular-signals"
                    : callText.trim().startsWith("create") ||
                        /\bcreate\(/.test(callText)
                      ? "zustand"
                      : "unknown",
          };
    const node = addDeclaredNode(state, declaration, {
      kind,
      name,
      framework,
      filePath,
      metadata,
    });
    if (kind === "store" && /createSlice/.test(callText)) {
      addSliceChildren(state, filePath, framework, declaration, node);
    }
  }

  if (
    pageFile(filePath) &&
    !(state.symbolsByFile.get(filePath) ?? []).some(
      (node) => node.kind === "page",
    )
  ) {
    addNode(state, {
      kind: "page",
      name: pageName(filePath),
      framework,
      filePath,
      startLine: 1,
      endLine: document.lineCount,
      metadata: metadataForComponent(
        document.text,
        document.lineCount,
        framework,
      ),
      stableSuffix: "synthetic-page",
    });
  }
}

function relativeFor(state: BuildState, sourceFile: SourceFile | undefined) {
  return sourceFile
    ? state.relativePath.get(path.resolve(sourceFile.getFilePath()))
    : undefined;
}

function targetNamed(
  state: BuildState,
  targetFile: string,
  exportedName: string,
) {
  return (
    (state.symbolsByFile.get(targetFile) ?? []).find(
      (node) => node.name === exportedName,
    ) ?? primaryNode(state, targetFile)
  );
}

function collectImports(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
) {
  const owner = primaryNode(state, filePath);
  const aliases = new Map<string, ArchitectureNode>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const targetFile = relativeFor(
      state,
      declaration.getModuleSpecifierSourceFile(),
    );
    if (!targetFile) continue;
    const fallbackTarget = primaryNode(state, targetFile);
    addEdge(
      state,
      owner,
      fallbackTarget,
      "imports",
      { path: filePath, line: declaration.getStartLineNumber() },
      "high",
    );
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport && fallbackTarget) {
      aliases.set(defaultImport.getText(), fallbackTarget);
    }
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport && fallbackTarget) {
      aliases.set(namespaceImport.getText(), fallbackTarget);
    }
    for (const namedImport of declaration.getNamedImports()) {
      const imported = namedImport.getName();
      const local = namedImport.getAliasNode()?.getText() ?? imported;
      const target = targetNamed(state, targetFile, imported);
      if (target) aliases.set(local, target);
    }
    if (testFile(filePath)) {
      addEdge(state, fallbackTarget, owner, "tested-by", {
        path: filePath,
        line: declaration.getStartLineNumber(),
      });
    }
  }
  state.importTargets.set(filePath, aliases);
}

function lookupName(
  state: BuildState,
  filePath: string,
  name: string,
): ArchitectureNode | undefined {
  return (
    state.importTargets.get(filePath)?.get(name) ??
    (state.symbolsByFile.get(filePath) ?? []).find(
      (node) => node.name === name,
    ) ??
    state.nameIndex.get(name)?.[0]
  );
}

function jsxTagName(node: MorphNodeType): string | null {
  if (
    MorphNode.isJsxOpeningElement(node) ||
    MorphNode.isJsxSelfClosingElement(node)
  ) {
    return node.getTagNameNode().getText().split(".").at(-1) ?? null;
  }
  return null;
}

function collectRendering(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
) {
  const elements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const element of elements) {
    const tag = jsxTagName(element);
    if (!tag || !isPascalCase(tag) || tag === "Route") continue;
    const target = lookupName(state, filePath, tag);
    const owner = ownerAt(state, filePath, element.getStartLineNumber());
    addEdge(
      state,
      owner,
      target,
      "renders",
      { path: filePath, line: element.getStartLineNumber() },
      target ? "high" : "low",
    );
  }
}

function inlineAngularTemplate(
  declaration: ReturnType<SourceFile["getClasses"]>[number],
) {
  const decorator = declaration
    .getDecorators()
    .find((candidate) => candidate.getName() === "Component");
  const argument = decorator?.getArguments()[0];
  if (!argument || !MorphNode.isObjectLiteralExpression(argument)) return null;
  const templateProperty = argument.getProperty("template");
  if (!templateProperty || !MorphNode.isPropertyAssignment(templateProperty)) {
    return null;
  }
  const initializer = templateProperty.getInitializer();
  if (
    !initializer ||
    (!MorphNode.isStringLiteral(initializer) &&
      !MorphNode.isNoSubstitutionTemplateLiteral(initializer))
  ) {
    return null;
  }
  return {
    text: initializer.getLiteralText(),
    line: initializer.getStartLineNumber(),
  };
}

function collectAngularRendering(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
) {
  const selectors = new Map(
    state.graph.nodes.flatMap((node) =>
      typeof node.metadata.selector === "string"
        ? [[node.metadata.selector, node] as const]
        : [],
    ),
  );
  if (selectors.size === 0) return;
  for (const declaration of sourceFile.getClasses()) {
    const template = inlineAngularTemplate(declaration);
    if (!template) continue;
    const owner = declaration.getName()
      ? lookupName(state, filePath, declaration.getName() ?? "")
      : ownerAt(state, filePath, declaration.getStartLineNumber());
    for (const match of template.text.matchAll(/<([a-z][a-z0-9-]*)\b/g)) {
      const selector = match[1];
      if (!selector) continue;
      const target = selectors.get(selector);
      if (!target) continue;
      const lineOffset =
        template.text.slice(0, match.index ?? 0).split("\n").length - 1;
      addEdge(state, owner, target, "renders", {
        path: filePath,
        line: template.line + lineOffset,
      });
    }
  }
}

function cleanLiteral(value: string) {
  return value
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .replace(/^["'`]/, "")
    .replace(/["'`]$/, "")
    .slice(0, 300);
}

function endpointFromCall(
  call: ReturnType<SourceFile["getDescendantsOfKind"]>[number],
) {
  if (!MorphNode.isCallExpression(call)) return null;
  const expression = call.getExpression().getText();
  const argument = call.getArguments()[0];
  if (!argument) return null;
  const raw = cleanLiteral(argument.getText());
  if (!raw || (!raw.startsWith("/") && !/^https?:\/\//.test(raw))) return null;
  if (expression === "fetch" || expression.endsWith(".fetch")) {
    const options = call.getArguments()[1]?.getText() ?? "";
    const method =
      options.match(/method\s*:\s*["']([A-Za-z]+)["']/)?.[1] ?? "GET";
    return { method: method.toUpperCase(), endpoint: raw };
  }
  const method = expression.match(
    /\.(get|post|put|patch|delete|query|mutate)$/i,
  )?.[1];
  if (!method) return null;
  return {
    method: ["query", "mutate"].includes(method.toLowerCase())
      ? method.toUpperCase()
      : method.toUpperCase(),
    endpoint: raw,
  };
}

function apiNode(
  state: BuildState,
  filePath: string,
  framework: FrontendFramework,
  method: string,
  endpoint: string,
  line: number,
) {
  let safeEndpoint = endpoint;
  if (/^https?:\/\//.test(endpoint)) {
    try {
      const url = new URL(endpoint);
      safeEndpoint = `${url.origin}${url.pathname}`;
    } catch {
      safeEndpoint = endpoint;
    }
  }
  return addNode(state, {
    kind: "api-client",
    name: `${method} ${safeEndpoint}`,
    framework,
    filePath,
    startLine: line,
    endLine: line,
    metadata: { role: "endpoint", method, endpoint: safeEndpoint },
    stableSuffix: `endpoint:${method}:${safeEndpoint}`,
  });
}

function identifierRoot(text: string) {
  return text.match(/(?:this\.)?([A-Za-z_$][\w$]*)/)?.[1] ?? null;
}

function actionName(text: string) {
  return text.match(/([A-Za-z_$][\w$]*)\s*\(/)?.[1] ?? text.trim();
}

function collectCallsAndState(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
  framework: FrontendFramework,
) {
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    const owner = ownerAt(state, filePath, call.getStartLineNumber());
    const endpoint = endpointFromCall(call);
    if (endpoint) {
      addEdge(
        state,
        owner,
        apiNode(
          state,
          filePath,
          framework,
          endpoint.method,
          endpoint.endpoint,
          call.getStartLineNumber(),
        ),
        "calls",
        { path: filePath, line: call.getStartLineNumber() },
      );
    }

    const expressionText = call.getExpression().getText();
    const simpleName = expressionText.split(".").at(-1) ?? expressionText;
    const directTarget = lookupName(state, filePath, simpleName);
    if (
      directTarget &&
      ["hook", "service", "api-client", "utility"].includes(directTarget.kind)
    ) {
      addEdge(state, owner, directTarget, "calls", {
        path: filePath,
        line: call.getStartLineNumber(),
      });
    }

    if (
      /^(?:useSelector|select)$/.test(simpleName) ||
      /\.select$/.test(expressionText)
    ) {
      const selector = actionName(call.getArguments()[0]?.getText() ?? "");
      addEdge(
        state,
        owner,
        lookupName(state, filePath, selector),
        "reads-state",
        { path: filePath, line: call.getStartLineNumber() },
        "medium",
      );
    }
    if (
      /^(?:dispatch|store\.dispatch)$/.test(expressionText) ||
      /\.dispatch$/.test(expressionText)
    ) {
      const dispatched = actionName(call.getArguments()[0]?.getText() ?? "");
      addEdge(
        state,
        owner,
        lookupName(state, filePath, dispatched),
        "dispatches",
        { path: filePath, line: call.getStartLineNumber() },
        "medium",
      );
    }
    if (/\.subscribe$/.test(expressionText)) {
      const root = identifierRoot(expressionText);
      addEdge(
        state,
        owner,
        root ? lookupName(state, filePath, root) : undefined,
        "subscribes",
        { path: filePath, line: call.getStartLineNumber() },
        "medium",
      );
    }
    if (directTarget?.kind === "store") {
      addEdge(
        state,
        owner,
        directTarget,
        "reads-state",
        { path: filePath, line: call.getStartLineNumber() },
        "medium",
      );
    }
  }
}

function collectGraphqlOperations(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
  framework: FrontendFramework,
) {
  for (const tagged of sourceFile.getDescendantsOfKind(
    SyntaxKind.TaggedTemplateExpression,
  )) {
    if (!/(?:^|\.)gql$/.test(tagged.getTag().getText())) continue;
    const operation = tagged
      .getTemplate()
      .getText()
      .match(/\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/)
      ?.slice(1);
    const operationKind = operation?.[0]?.toUpperCase() ?? "GRAPHQL";
    const operationName =
      operation?.[1] ?? `anonymous-${tagged.getStartLineNumber()}`;
    const owner = ownerAt(state, filePath, tagged.getStartLineNumber());
    addEdge(
      state,
      owner,
      apiNode(
        state,
        filePath,
        framework,
        operationKind,
        `graphql:${operationName}`,
        tagged.getStartLineNumber(),
      ),
      "calls",
      { path: filePath, line: tagged.getStartLineNumber() },
    );
  }
}

function collectInjection(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
) {
  for (const declaration of sourceFile.getClasses()) {
    const owner = declaration.getName()
      ? lookupName(state, filePath, declaration.getName() ?? "")
      : ownerAt(state, filePath, declaration.getStartLineNumber());
    for (const constructor of declaration.getConstructors()) {
      for (const parameter of constructor.getParameters()) {
        const typeName = parameter
          .getTypeNode()
          ?.getText()
          .split("<")[0]
          ?.trim();
        const parameterName = parameter.getName();
        const target = typeName
          ? lookupName(state, filePath, typeName)
          : lookupName(
              state,
              filePath,
              `${parameterName[0]?.toUpperCase() ?? ""}${parameterName.slice(1)}`,
            );
        if (target?.kind !== "service" && target?.kind !== "store") continue;
        addEdge(
          state,
          owner,
          target,
          "injects",
          { path: filePath, line: parameter.getStartLineNumber() },
          typeName ? "high" : "medium",
        );
      }
    }
  }
}

function jsxAttributeText(
  element: ReturnType<SourceFile["getDescendantsOfKind"]>[number],
  attributeName: string,
) {
  if (
    !MorphNode.isJsxOpeningElement(element) &&
    !MorphNode.isJsxSelfClosingElement(element)
  )
    return null;
  const attribute = element
    .getAttributes()
    .find(
      (candidate) =>
        MorphNode.isJsxAttribute(candidate) &&
        candidate.getNameNode().getText() === attributeName,
    );
  if (!attribute || !MorphNode.isJsxAttribute(attribute)) return null;
  return attribute.getInitializer()?.getText() ?? "";
}

function routePath(value: string) {
  const cleaned = cleanLiteral(value)
    .replace(/^\{\s*["']/, "")
    .replace(/["']\s*\}$/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function collectReactRoutes(
  state: BuildState,
  sourceFile: SourceFile,
  filePath: string,
  framework: FrontendFramework,
  text: string,
) {
  const elements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const element of elements) {
    if (jsxTagName(element) !== "Route") continue;
    const pathValue = jsxAttributeText(element, "path");
    if (!pathValue) continue;
    const route = routePath(pathValue);
    const elementValue =
      jsxAttributeText(element, "element") ??
      jsxAttributeText(element, "Component") ??
      "";
    const componentName = elementValue
      .match(/<\s*([A-Z][A-Za-z0-9]*)|\b([A-Z][A-Za-z0-9]*)\b/)
      ?.slice(1)
      .find(Boolean);
    const target = componentName
      ? lookupName(state, filePath, componentName)
      : undefined;
    const lazy = Boolean(
      componentName &&
      new RegExp(
        `(?:React\\.)?lazy\\s*\\([^)]*${componentName}|${componentName}\\s*=\\s*(?:React\\.)?lazy`,
      ).test(text),
    );
    const routeNode = addNode(state, {
      kind: "route",
      name: route,
      framework,
      filePath,
      startLine: element.getStartLineNumber(),
      endLine: element.getEndLineNumber(),
      metadata: {
        path: route,
        lazy,
        bundleSize: "not-measured",
        guards: [],
      },
      stableSuffix: `route:${route}`,
    });
    addEdge(
      state,
      routeNode,
      target,
      "routes-to",
      { path: filePath, line: element.getStartLineNumber() },
      target ? "high" : "low",
    );
  }
}

function collectAngularRoutes(
  state: BuildState,
  filePath: string,
  framework: FrontendFramework,
  text: string,
) {
  const routePattern =
    /path\s*:\s*["']([^"']*)["']([\s\S]{0,700}?)(component|loadComponent|loadChildren)\s*:\s*([^,}\n]+)/g;
  for (const match of text.matchAll(routePattern)) {
    const rawPath = match[1] ?? "";
    const route = rawPath ? `/${rawPath}`.replaceAll("//", "/") : "/";
    const block = match[2] ?? "";
    const loader = match[3] ?? "component";
    const targetText = match[4] ?? "";
    const componentName = targetText.match(
      /([A-Z][A-Za-z0-9]*(?:Component|Page|Module))/,
    )?.[1];
    const line = text.slice(0, match.index ?? 0).split("\n").length;
    const guards =
      block
        .match(/canActivate\s*:\s*\[([^\]]+)\]/)?.[1]
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    const routeNode = addNode(state, {
      kind: "route",
      name: route,
      framework,
      filePath,
      startLine: line,
      endLine: line,
      metadata: {
        path: route,
        lazy: loader !== "component",
        loader,
        bundleSize: "not-measured",
        guards,
      },
      stableSuffix: `route:${route}`,
    });
    addEdge(
      state,
      routeNode,
      componentName ? lookupName(state, filePath, componentName) : undefined,
      "routes-to",
      { path: filePath, line },
      componentName ? "medium" : "low",
    );
  }
}

function nextRoute(filePath: string) {
  const appMatch = filePath.match(/(?:^|\/)app\/(.*?)(?:\/)?page\.[jt]sx?$/);
  const pagesMatch = filePath.match(/(?:^|\/)pages\/(.*?)\.[jt]sx?$/);
  const raw = appMatch?.[1] ?? pagesMatch?.[1];
  if (raw === undefined) return null;
  const segments = raw
    .split("/")
    .filter(
      (segment) => segment && segment !== "index" && !/^\(.+\)$/.test(segment),
    )
    .map((segment) =>
      segment.replace(/^\[\.\.\.(.+)\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"),
    );
  return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

function collectNextRoute(
  state: BuildState,
  filePath: string,
  framework: FrontendFramework,
) {
  if (framework !== "nextjs") return;
  const route = nextRoute(filePath);
  if (!route) return;
  const page = (state.symbolsByFile.get(filePath) ?? []).find(
    (node) => node.kind === "page",
  );
  const routeNode = addNode(state, {
    kind: "route",
    name: route,
    framework,
    filePath,
    startLine: 1,
    endLine: 1,
    metadata: {
      path: route,
      lazy: true,
      bundleSize: "not-measured",
      guards: [],
      router: filePath.includes("/app/")
        ? "next-app-router"
        : "next-pages-router",
    },
    stableSuffix: `route:${route}`,
  });
  addEdge(state, routeNode, page, "routes-to", { path: filePath, line: 1 });
}

function finalizeGraph(
  state: BuildState,
  profile: ProjectProfile,
): ArchitectureGraph {
  const provisional: ArchitectureGraph = {
    ...state.graph,
    nodes: [...state.graph.nodes].sort((left, right) =>
      `${left.location.path}:${left.location.lineStart ?? 0}:${left.kind}:${left.name}`.localeCompare(
        `${right.location.path}:${right.location.lineStart ?? 0}:${right.kind}:${right.name}`,
      ),
    ),
    edges: [...state.graph.edges].sort((left, right) =>
      `${left.source}:${left.target}:${left.kind}`.localeCompare(
        `${right.source}:${right.target}:${right.kind}`,
      ),
    ),
  };
  const assessed = evaluateArchitectureHealth(
    provisional,
    state.documents,
    profile,
  );
  return ArchitectureGraphSchema.parse({
    ...provisional,
    issues: assessed.issues,
    health: assessed.health,
  });
}

export class FrontendIntelligenceEngine {
  async analyze(
    repositoryRoot: string,
    profile: ProjectProfile,
  ): Promise<ArchitectureGraph> {
    const paths = await fg("**/*.{ts,tsx,js,jsx}", {
      cwd: repositoryRoot,
      absolute: false,
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
      ignore: repositoryIgnorePatterns,
    });
    const selectedPaths = paths.sort().slice(0, MAX_SOURCE_FILES);
    const documents: SourceDocument[] = [];
    for (const relativePath of selectedPaths) {
      const absolutePath = path.join(repositoryRoot, relativePath);
      const stats = await stat(absolutePath);
      if (stats.size > MAX_SOURCE_FILE_BYTES) continue;
      const text = await readFile(absolutePath, "utf8").catch(() => null);
      if (text === null) continue;
      documents.push({
        path: normalized(relativePath),
        text,
        lineCount: text.split("\n").length,
      });
    }

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        target: ts.ScriptTarget.ES2023,
      },
    });
    const relativePath = new Map<string, string>();
    const sourceFiles: SourceFile[] = [];
    for (const document of documents) {
      const absolutePath = path.resolve(repositoryRoot, document.path);
      const sourceFile = project.createSourceFile(absolutePath, document.text, {
        overwrite: true,
      });
      relativePath.set(path.resolve(sourceFile.getFilePath()), document.path);
      sourceFiles.push(sourceFile);
    }

    const detectedFrameworks = new Set<FrontendFramework>();
    for (const document of documents) {
      detectedFrameworks.add(
        frameworkFor(document.path, document.text, profile),
      );
    }
    const state: BuildState = {
      graph: {
        schemaVersion: "frontend-architecture-v1",
        analyzerVersion: ANALYZER_VERSION,
        snapshotId: profile.snapshotId,
        frameworks: [...detectedFrameworks].sort(),
        files: documents.map((document) => ({
          path: document.path,
          language: languageFor(document.path),
          lineCount: document.lineCount,
          byteSize: Buffer.byteLength(document.text),
          contentHash: createHash("sha256").update(document.text).digest("hex"),
          test: testFile(document.path),
        })),
        nodes: [],
        edges: [],
        issues: [],
        health: [],
        coverage: {
          completed: [
            "typescript-ast",
            "imports",
            "rendering",
            "state-flow",
            "api-flow",
            "routes",
            "change-impact",
          ],
          skipped: [
            {
              check: "runtime-di-edges",
              reason: "Dynamic dependency injection requires runtime evidence",
            },
            {
              check: "bundle-size",
              reason: "Bundle size requires a user-authorized build artifact",
            },
          ],
          warnings:
            paths.length > MAX_SOURCE_FILES
              ? [
                  `Source coverage was capped at ${MAX_SOURCE_FILES.toLocaleString()} files`,
                ]
              : [],
        },
      },
      documents,
      sourceFiles,
      relativePath,
      moduleByFile: new Map(),
      symbolsByFile: new Map(),
      rangesByFile: new Map(),
      nodesByStableKey: new Map(),
      nameIndex: new Map(),
      importTargets: new Map(),
      edgeKeys: new Set(),
    };

    for (const sourceFile of sourceFiles) {
      const filePath = relativeFor(state, sourceFile);
      if (!filePath) continue;
      const document = documents.find((item) => item.path === filePath);
      if (!document) continue;
      const framework = frameworkFor(filePath, document.text, profile);
      collectDeclarations(state, sourceFile, filePath, framework, document);
    }
    for (const sourceFile of sourceFiles) {
      const filePath = relativeFor(state, sourceFile);
      if (!filePath) continue;
      collectImports(state, sourceFile, filePath);
    }
    for (const sourceFile of sourceFiles) {
      const filePath = relativeFor(state, sourceFile);
      if (!filePath) continue;
      const document = documents.find((item) => item.path === filePath);
      if (!document) continue;
      const framework = frameworkFor(filePath, document.text, profile);
      collectRendering(state, sourceFile, filePath);
      collectAngularRendering(state, sourceFile, filePath);
      collectCallsAndState(state, sourceFile, filePath, framework);
      collectGraphqlOperations(state, sourceFile, filePath, framework);
      collectInjection(state, sourceFile, filePath);
      collectReactRoutes(state, sourceFile, filePath, framework, document.text);
      collectAngularRoutes(state, filePath, framework, document.text);
      collectNextRoute(state, filePath, framework);
    }
    return finalizeGraph(state, profile);
  }
}
