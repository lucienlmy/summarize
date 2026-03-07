import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readDaemonConfig: vi.fn(),
  writeDaemonConfig: vi.fn(),
  runDaemonServer: vi.fn(),
  resolveCliEntrypointPathForService: vi.fn(),
  installLaunchAgent: vi.fn(),
  isLaunchAgentLoaded: vi.fn(),
  readLaunchAgentProgramArguments: vi.fn(),
  restartLaunchAgent: vi.fn(),
  uninstallLaunchAgent: vi.fn(),
  installSystemdService: vi.fn(),
  isSystemdServiceEnabled: vi.fn(),
  readSystemdServiceExecStart: vi.fn(),
  restartSystemdService: vi.fn(),
  uninstallSystemdService: vi.fn(),
  installScheduledTask: vi.fn(),
  isScheduledTaskInstalled: vi.fn(),
  readScheduledTaskCommand: vi.fn(),
  restartScheduledTask: vi.fn(),
  uninstallScheduledTask: vi.fn(),
}));

vi.mock("../src/daemon/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/daemon/config.js")>();
  return {
    ...actual,
    readDaemonConfig: mocks.readDaemonConfig,
    writeDaemonConfig: mocks.writeDaemonConfig,
  };
});

vi.mock("../src/daemon/server.js", () => ({
  runDaemonServer: mocks.runDaemonServer,
}));

vi.mock("../src/daemon/cli-entrypoint.js", () => ({
  resolveCliEntrypointPathForService: mocks.resolveCliEntrypointPathForService,
}));

vi.mock("../src/daemon/launchd.js", () => ({
  installLaunchAgent: mocks.installLaunchAgent,
  isLaunchAgentLoaded: mocks.isLaunchAgentLoaded,
  readLaunchAgentProgramArguments: mocks.readLaunchAgentProgramArguments,
  restartLaunchAgent: mocks.restartLaunchAgent,
  uninstallLaunchAgent: mocks.uninstallLaunchAgent,
  resolveDaemonLogPaths: () => ({
    daemonOutLog: "/tmp/daemon.out.log",
    daemonErrLog: "/tmp/daemon.err.log",
  }),
}));

vi.mock("../src/daemon/systemd.js", () => ({
  installSystemdService: mocks.installSystemdService,
  isSystemdServiceEnabled: mocks.isSystemdServiceEnabled,
  readSystemdServiceExecStart: mocks.readSystemdServiceExecStart,
  restartSystemdService: mocks.restartSystemdService,
  uninstallSystemdService: mocks.uninstallSystemdService,
}));

vi.mock("../src/daemon/schtasks.js", () => ({
  installScheduledTask: mocks.installScheduledTask,
  isScheduledTaskInstalled: mocks.isScheduledTaskInstalled,
  readScheduledTaskCommand: mocks.readScheduledTaskCommand,
  restartScheduledTask: mocks.restartScheduledTask,
  uninstallScheduledTask: mocks.uninstallScheduledTask,
}));

import { handleDaemonRequest } from "../src/daemon/cli.js";

describe("daemon cli", () => {
  const originalPath = process.env.PATH;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PATH = "/usr/bin:/bin";
    process.env.OPENAI_API_KEY = "from-process";
    process.env.HOME = "/tmp/original-home";
    mocks.resolveCliEntrypointPathForService.mockResolvedValue("/usr/local/bin/summarize-cli.js");
    mocks.readLaunchAgentProgramArguments.mockResolvedValue(null);
    mocks.readSystemdServiceExecStart.mockResolvedValue(null);
    mocks.readScheduledTaskCommand.mockResolvedValue(null);
    mocks.installLaunchAgent.mockResolvedValue(undefined);
    mocks.installSystemdService.mockResolvedValue(undefined);
    mocks.installScheduledTask.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("applies daemon snapshot env to process.env for child processes on run (#99)", async () => {
    mocks.readDaemonConfig.mockResolvedValueOnce({
      token: "test-token",
      port: 8787,
      env: {
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        OPENAI_API_KEY: "from-snapshot",
      },
    });
    mocks.runDaemonServer.mockResolvedValueOnce(undefined);

    const envForRun = {
      HOME: "/Users/peter",
      PATH: "/usr/bin:/bin",
      OPENAI_API_KEY: "from-run",
    };

    const handled = await handleDaemonRequest({
      normalizedArgv: ["daemon", "run"],
      envForRun,
      fetchImpl: fetch,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    expect(handled).toBe(true);
    expect(mocks.readDaemonConfig).toHaveBeenCalledWith({ env: envForRun });
    expect(mocks.runDaemonServer).toHaveBeenCalledWith({
      env: {
        HOME: "/Users/peter",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        OPENAI_API_KEY: "from-snapshot",
      },
      fetchImpl: fetch,
      config: {
        token: "test-token",
        port: 8787,
        env: {
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          OPENAI_API_KEY: "from-snapshot",
        },
      },
    });

    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(process.env.OPENAI_API_KEY).toBe("from-snapshot");
    expect(process.env.HOME).toBe("/tmp/original-home");
  });

  it("appends a new daemon token on install instead of replacing existing tokens", async () => {
    mocks.readDaemonConfig.mockResolvedValueOnce({
      version: 2,
      token: "existing-token-1234",
      tokens: ["existing-token-1234"],
      port: 8787,
      env: {},
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.writeDaemonConfig.mockResolvedValueOnce("/tmp/.summarize/daemon.json");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health"))
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.endsWith("/v1/ping"))
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const handled = await handleDaemonRequest({
      normalizedArgv: ["daemon", "install", "--token", "new-token-123456"],
      envForRun: { HOME: "/Users/peter" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    expect(handled).toBe(true);
    expect(mocks.writeDaemonConfig).toHaveBeenCalledWith({
      env: { HOME: "/Users/peter" },
      config: expect.objectContaining({
        token: "existing-token-1234",
        tokens: ["existing-token-1234", "new-token-123456"],
      }),
    });
  });
});
