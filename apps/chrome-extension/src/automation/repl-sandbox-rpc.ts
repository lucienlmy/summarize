import type { SandboxHandlers } from "./repl-sandbox-contracts";

export async function dispatchSandboxRpc(
  action: string | undefined,
  payload: unknown,
  handlers: SandboxHandlers,
): Promise<unknown> {
  switch (action) {
    case "browserjs":
      return handlers.onBrowserJs(payload as { fnSource: string; args: unknown[] });
    case "navigate":
      return handlers.onNavigate(payload as { url: string; newTab?: boolean });
    case "listArtifacts":
      return handlers.onArtifacts({ action: "list" });
    case "getArtifact":
      return handlers.onArtifacts({
        action: "get",
        ...(payload as { fileName?: string; asBase64?: boolean }),
      });
    case "createOrUpdateArtifact":
      return handlers.onArtifacts({
        action: "upsert",
        ...(payload as { fileName?: string; content?: unknown; mimeType?: string }),
      });
    case "deleteArtifact":
      return handlers.onArtifacts({
        action: "delete",
        ...(payload as { fileName?: string }),
      });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
