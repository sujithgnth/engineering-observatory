import type { ReactNode } from "react";

declare const RouterModule: {
  forRoot(routes: unknown[]): unknown;
};
declare const ReportPage: () => ReactNode;

const routes = [{ path: "report", component: ReportPage }];
RouterModule.forRoot(routes);

export function RiskyReport({ value }: { value: number }) {
  const label =
    value > 20
      ? value > 40
        ? value > 60
          ? value > 80
            ? "critical"
            : "high"
          : "medium"
        : "low"
      : value > 18
        ? "18"
        : value > 16
          ? "16"
          : value > 14
            ? "14"
            : value > 12
              ? "12"
              : value > 10
                ? "10"
                : value > 8
                  ? "8"
                  : value > 6
                    ? "6"
                    : value > 4
                      ? "4"
                      : value > 2
                        ? "2"
                        : "base";

  return <ReportPage config={{ label, value }} />;
}
