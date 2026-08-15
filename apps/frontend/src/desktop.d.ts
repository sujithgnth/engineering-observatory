import type { SourceCreated } from "./api";

type DesktopRepositorySelection = {
  id: string;
  name: string;
};

type DesktopGithubStatus = {
  configured: boolean;
  source: "secure-store" | "environment" | "none";
  encryptionAvailable: boolean;
};

type DesktopRuntimeInfo = {
  apiOrigin: string;
  platform: string;
  version: string;
};

declare global {
  interface Window {
    engineeringObservatory?: {
      chooseRepository(): Promise<DesktopRepositorySelection | null>;
      uploadRepository(
        selectionId: string,
        displayName: string,
      ): Promise<SourceCreated>;
      githubStatus(): Promise<DesktopGithubStatus>;
      configureGithubToken(token: string): Promise<DesktopGithubStatus>;
      clearGithubToken(): Promise<DesktopGithubStatus>;
      runtimeInfo(): Promise<DesktopRuntimeInfo>;
    };
  }
}

export {};
