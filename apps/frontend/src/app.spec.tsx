// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";

describe("App", () => {
  afterEach(() => vi.restoreAllMocks());

  it("presents the deterministic product boundary", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", {
        name: /understand a frontend before you change it/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every relationship links back to source evidence/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Deterministic core active/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /local folder/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: /github url/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No repository snapshots yet."),
    ).toBeInTheDocument();
  });
});
