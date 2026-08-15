import type {
  Finding,
  ProjectProfile,
} from "@engineering-observatory/shared-types";

export type AnalyzerContext = {
  repositoryRoot: string;
  profile: ProjectProfile;
};

export type AnalyzerResult = {
  analyzerId: string;
  analyzerVersion: string;
  findings: Finding[];
  completedRules: string[];
  skippedRules: Array<{ ruleId: string; reason: string }>;
  warnings: string[];
};

export interface Analyzer {
  readonly id: string;
  readonly version: string;
  isApplicable(profile: ProjectProfile): boolean;
  analyze(context: AnalyzerContext): Promise<AnalyzerResult>;
}
