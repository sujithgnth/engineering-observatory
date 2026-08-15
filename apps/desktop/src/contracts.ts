export type DesktopRepositorySelection = {
  id: string;
  name: string;
};

export type DesktopGithubStatus = {
  configured: boolean;
  source: "secure-store" | "environment" | "none";
  encryptionAvailable: boolean;
};

export type DesktopRuntimeInfo = {
  apiOrigin: string;
  platform: NodeJS.Platform;
  version: string;
};

export type DesktopBridge = {
  chooseRepository(): Promise<DesktopRepositorySelection | null>;
  uploadRepository(selectionId: string, displayName: string): Promise<unknown>;
  githubStatus(): Promise<DesktopGithubStatus>;
  configureGithubToken(token: string): Promise<DesktopGithubStatus>;
  clearGithubToken(): Promise<DesktopGithubStatus>;
  runtimeInfo(): Promise<DesktopRuntimeInfo>;
};
