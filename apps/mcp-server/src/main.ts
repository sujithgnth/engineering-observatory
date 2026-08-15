import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { HttpObservatoryReader, resolveApiBaseUrl } from "./api-client";
import { createObservatoryMcpServer } from "./server";

async function main() {
  const apiBaseUrl = await resolveApiBaseUrl();
  const handle = serveStdio(
    () => createObservatoryMcpServer(new HttpObservatoryReader(apiBaseUrl)),
    {
      onerror: (error) =>
        console.error(`Engineering Observatory MCP error: ${error.message}`),
    },
  );
  console.error(`Engineering Observatory MCP connected to ${apiBaseUrl}`);
  const close = () => void handle.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main().catch((error: unknown) => {
  console.error(
    `Engineering Observatory MCP failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
