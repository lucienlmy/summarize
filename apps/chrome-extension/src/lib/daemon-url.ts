import { loadSettings } from "./settings";

/**
 * Single source of truth for the local Summarize daemon origin.
 *
 * The daemon listens on 127.0.0.1 and its port is user-configurable via
 * settings (`daemonPort`, default 8787). Never hardcode the origin: build it
 * from the configured port so a non-default daemon port keeps the extension
 * working.
 */

/** Build the daemon origin (scheme + host + port) for an explicit port. */
export function daemonOrigin(port: string): string {
  return `http://127.0.0.1:${port}`;
}

/** Resolve the daemon origin from stored settings (defaults to port 8787). */
export async function getDaemonOrigin(): Promise<string> {
  const { daemonPort } = await loadSettings();
  return daemonOrigin(daemonPort);
}
