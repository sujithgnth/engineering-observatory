import { Client } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

const expectedTools = [
  "list_repositories",
  "list_analyses",
  "get_analysis_summary",
  "list_findings",
  "get_architecture_overview",
  "get_change_impact",
];

const client = new Client({ name: "observatory-smoke", version: "1.0.0" });
const command =
  process.env.OBSERVATORY_MCP_SMOKE_COMMAND?.trim() || process.execPath;
const args = process.env.OBSERVATORY_MCP_SMOKE_ARGS
  ? JSON.parse(process.env.OBSERVATORY_MCP_SMOKE_ARGS)
  : ["dist/apps/mcp-server/main.js"];
if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
  throw new Error("OBSERVATORY_MCP_SMOKE_ARGS must be a JSON string array");
}
const transport = new StdioClientTransport({
  command,
  args,
  ...(process.env.OBSERVATORY_MCP_SMOKE_ELECTRON === "1"
    ? {
        env: {
          ...getDefaultEnvironment(),
          ELECTRON_RUN_AS_NODE: "1",
        },
      }
    : {}),
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected MCP tools: ${JSON.stringify(names)}`);
  }
  if (
    !tools.every(
      (tool) =>
        tool.annotations?.readOnlyHint === true &&
        tool.annotations?.destructiveHint === false &&
        tool.annotations?.openWorldHint === false,
    )
  ) {
    throw new Error("Every MCP tool must declare the read-only boundary");
  }
  if (process.env.OBSERVATORY_MCP_SMOKE_CALL === "1") {
    const response = await client.callTool({
      name: "list_repositories",
      arguments: { limit: 1 },
    });
    if (response.isError || !response.structuredContent) {
      throw new Error("The MCP server could not read the live Observatory API");
    }
    process.stdout.write(
      `MCP_LIVE_READ_READY ${JSON.stringify(response.structuredContent)}\n`,
    );
  }
  process.stdout.write(`MCP_SMOKE_READY ${JSON.stringify(names)}\n`);
} finally {
  await client.close();
}
