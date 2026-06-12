import type { ReplArtifactAction } from "./repl-artifacts";

export type SandboxFile = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
};

export type SandboxResult = {
  logs: string[];
  files: SandboxFile[];
  error?: string;
};

export type SandboxHandlers = {
  onBrowserJs: (payload: { fnSource: string; args: unknown[] }) => Promise<unknown>;
  onNavigate: (payload: { url: string; newTab?: boolean }) => Promise<unknown>;
  onArtifacts: (payload: ReplArtifactAction) => Promise<unknown>;
};
