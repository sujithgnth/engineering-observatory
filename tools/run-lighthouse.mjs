import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const reportDirectory = path.join(workspaceRoot, "artifacts/lighthouse/latest");
const thresholds = JSON.parse(
  await readFile(
    path.join(workspaceRoot, "quality/lighthouse-thresholds.json"),
    "utf8",
  ),
);
const configuredUrl = process.env["LIGHTHOUSE_URL"];
const targetUrl = configuredUrl ?? "http://127.0.0.1:4173/";
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
let preview;

await rm(reportDirectory, { recursive: true, force: true });
await mkdir(reportDirectory, { recursive: true });

try {
  if (!configuredUrl) {
    await run(executable, ["nx", "run", "frontend:build", "--skip-nx-cache"]);
    preview = spawn(
      executable,
      [
        "vite",
        "preview",
        "--config",
        "apps/frontend/vite.config.ts",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      { cwd: workspaceRoot, stdio: "ignore" },
    );
    await waitForUrl(targetUrl, preview);
  }

  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const outputBase = path.join(reportDirectory, `run-${index}`);
    const chromeFlags = process.env["CI"]
      ? "--headless=new --disable-gpu --no-sandbox"
      : "--headless=new --disable-gpu";
    await run(executable, [
      "lighthouse",
      targetUrl,
      "--quiet",
      "--preset=desktop",
      "--only-categories=performance,accessibility,best-practices,seo",
      "--output=json",
      "--output=html",
      `--output-path=${outputBase}`,
      `--chrome-flags=${chromeFlags}`,
    ]);
    const report = JSON.parse(
      await readFile(`${outputBase}.report.json`, "utf8"),
    );
    runs.push(extractRun(report));
  }

  const summary = buildSummary(runs, targetUrl, thresholds);
  await writeFile(
    path.join(reportDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.table(
    Object.entries(summary.categories).map(([name, result]) => ({
      measurement: name,
      median: result.median,
      threshold: `>= ${result.minimum}`,
      passed: result.passed,
    })),
  );
  console.table(
    Object.entries(summary.metrics).map(([name, result]) => ({
      measurement: name,
      median: result.median,
      threshold: `<= ${result.maximum}`,
      passed: result.passed,
    })),
  );

  const failures = [
    ...Object.entries(summary.categories),
    ...Object.entries(summary.metrics),
  ].filter(([, result]) => !result.passed);
  if (failures.length > 0) {
    throw new Error(
      `Lighthouse quality gate failed: ${failures.map(([name]) => name).join(", ")}`,
    );
  }
  console.log(`Lighthouse evidence written to ${reportDirectory}`);
} finally {
  preview?.kill("SIGTERM");
}

function extractRun(report) {
  const categories = Object.fromEntries(
    ["performance", "accessibility", "best-practices", "seo"].map((name) => [
      name,
      Math.round((report.categories[name]?.score ?? 0) * 100),
    ]),
  );
  const metrics = Object.fromEntries(
    [
      "first-contentful-paint",
      "largest-contentful-paint",
      "total-blocking-time",
      "cumulative-layout-shift",
      "total-byte-weight",
    ].map((name) => [name, report.audits[name]?.numericValue ?? null]),
  );
  return { categories, metrics, fetchedAt: report.fetchTime };
}

function buildSummary(runs, url, configuredThresholds) {
  return {
    schemaVersion: 1,
    tool: "lighthouse",
    mode: "desktop simulated lab measurement",
    target: url,
    runCount: runs.length,
    generatedAt: new Date().toISOString(),
    categories: Object.fromEntries(
      Object.entries(configuredThresholds.categories).map(([name, minimum]) => {
        const observed = runs.map((run) => run.categories[name]);
        const measuredMedian = median(observed);
        return [
          name,
          {
            median: measuredMedian,
            minimum,
            passed: measuredMedian >= minimum,
            runs: observed,
          },
        ];
      }),
    ),
    metrics: Object.fromEntries(
      Object.entries(configuredThresholds.metrics).map(([name, maximum]) => {
        const observed = runs
          .map((run) => run.metrics[name])
          .filter((value) => typeof value === "number");
        const measuredMedian = median(observed);
        return [
          name,
          {
            median: measuredMedian,
            maximum,
            passed: measuredMedian <= maximum,
            runs: observed,
          },
        ];
      }),
    ),
    limitations: [
      "Lab measurements are machine- and environment-dependent.",
      "These results do not represent Chrome UX Report field data.",
      "The default target is the trusted local production build, not an uploaded repository.",
    ],
  };
}

function median(values) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
        ),
      );
    });
  });
}

async function waitForUrl(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite preview exited before ${url} was ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
