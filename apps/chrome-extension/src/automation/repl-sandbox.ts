import type { SandboxFile, SandboxHandlers, SandboxResult } from "./repl-sandbox-contracts";
import { buildSandboxHtml } from "./repl-sandbox-document";
import { dispatchSandboxRpc } from "./repl-sandbox-rpc";

type SandboxMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  action?: string;
  payload?: unknown;
  ok?: boolean;
  error?: string;
  logs?: string[];
  files?: SandboxFile[];
};

function postSandboxMessage(iframe: HTMLIFrameElement, message: Record<string, unknown>): void {
  iframe.contentWindow?.postMessage(message, "*");
}

export function runSandboxedRepl(
  code: string,
  handlers: SandboxHandlers,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  iframe.srcdoc = buildSandboxHtml();

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    function cleanup(): void {
      signal?.removeEventListener("abort", abortHandler);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    }

    function finish(result: SandboxResult): void {
      cleanup();
      resolve(result);
    }

    function abortHandler(): void {
      finish({ logs: [], files: [], error: "Execution aborted" });
    }

    function sendExecute(): void {
      postSandboxMessage(iframe, {
        source: "summarize-repl",
        type: "execute",
        requestId,
        code,
      });
    }

    function onMessage(event: MessageEvent): void {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as SandboxMessage;
      if (data?.source !== "summarize-repl") return;

      if (data.type === "rpc" && data.requestId) {
        const rpcRequestId = data.requestId;
        void dispatchSandboxRpc(data.action, data.payload, handlers)
          .then((result) => {
            postSandboxMessage(iframe, {
              source: "summarize-repl",
              type: "rpc-result",
              requestId: rpcRequestId,
              ok: true,
              result,
            });
          })
          .catch((error: unknown) => {
            postSandboxMessage(iframe, {
              source: "summarize-repl",
              type: "rpc-result",
              requestId: rpcRequestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      if (data.type === "result" && data.requestId === requestId) {
        finish({
          logs: data.logs ?? [],
          files: data.files ?? [],
          error: data.ok ? undefined : data.error || "Execution failed",
        });
      }
    }

    window.addEventListener("message", onMessage);
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });

    iframe.addEventListener("load", sendExecute, { once: true });
    document.body.appendChild(iframe);
  });
}
