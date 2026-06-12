import { execFile } from "node:child_process";
import { CommanderError, type Command } from "commander";
import type { ExecFileFn } from "../markitdown.js";
import {
  handleDaemonCliRequest,
  handleHelpRequest,
  handleRefreshFreeRequest,
} from "./cli-preflight.js";
import { attachRichHelp, buildProgram } from "./help.js";
import { createPerfTrace } from "./perf-trace.js";
import { createRunnerPlan } from "./runner-plan.js";
import {
  applyWidthOverride,
  handleCacheUtilityFlags,
  handleVersionFlag,
  prepareRunEnvironment,
  resolvePromptOverride,
} from "./runner-setup.js";
import { handleSlidesCliRequest } from "./slides-cli.js";
import { handleStatusCliRequest } from "./status-cli.js";
import { handleTranscriberCliRequest } from "./transcriber-cli.js";

type RunEnv = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  execFile?: ExecFileFn;
  stdin?: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
};

export async function runCli(
  argv: string[],
  { env: inputEnv, fetch, execFile: execFileOverride, stdin, stdout, stderr }: RunEnv,
): Promise<void> {
  (globalThis as unknown as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
  const perfTrace = createPerfTrace({ env: inputEnv, stderr });
  const runStdout = perfTrace?.wrapStdout(stdout) ?? stdout;

  try {
    const { normalizedArgv, envForRun } = prepareRunEnvironment(argv, inputEnv);
    perfTrace?.mark("cli:environment");
    const env = envForRun;

    if (
      await handleImmediateCliRequests({
        normalizedArgv,
        envForRun,
        fetchImpl: fetch,
        stdout: runStdout,
        stderr,
      })
    ) {
      return;
    }
    perfTrace?.mark("cli:preflight");
    const execFileImpl = execFileOverride ?? execFile;
    const program = buildCliProgram({ normalizedArgv, envForRun, stdout: runStdout, stderr });
    if (!program) return;
    perfTrace?.mark("cli:parsed");

    if (
      handleVersionFlag({
        versionRequested: Boolean(program.opts().version),
        stdout: runStdout,
        importMetaUrl: import.meta.url,
      })
    ) {
      return;
    }

    applyWidthOverride({ width: program.opts().width, env });

    let promptOverride = await resolvePromptOverride({
      prompt: program.opts().prompt,
      promptFile: program.opts().promptFile,
    });

    if (
      await handleCacheUtilityFlags({
        normalizedArgv,
        envForRun,
        stdout: runStdout,
      })
    ) {
      return;
    }
    const plan = await createRunnerPlan({
      normalizedArgv,
      program,
      env,
      envForRun,
      fetchImpl: fetch,
      execFileImpl,
      stdin,
      stdout: runStdout,
      stderr,
      promptOverride,
      perfTrace,
    });
    perfTrace?.mark("cli:planned");

    try {
      await plan.execute();
    } finally {
      plan.cacheState.store?.close();
    }
  } finally {
    perfTrace?.finish();
  }
}

async function handleImmediateCliRequests(options: {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}) {
  const { normalizedArgv, envForRun, fetchImpl, stdout, stderr } = options;
  if (handleHelpRequest({ normalizedArgv, envForRun, stdout, stderr })) {
    return true;
  }
  if (await handleRefreshFreeRequest({ normalizedArgv, envForRun, fetchImpl, stdout, stderr })) {
    return true;
  }
  if (await handleStatusCliRequest({ normalizedArgv, envForRun, fetchImpl, stdout })) {
    return true;
  }
  if (await handleDaemonCliRequest({ normalizedArgv, envForRun, fetchImpl, stdout, stderr })) {
    return true;
  }
  if (await handleSlidesCliRequest({ normalizedArgv, envForRun, fetchImpl, stdout, stderr })) {
    return true;
  }
  if (await handleTranscriberCliRequest({ normalizedArgv, envForRun, stdout, stderr })) {
    return true;
  }
  return false;
}

function buildCliProgram(options: {
  normalizedArgv: string[];
  envForRun: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}): Command | null {
  const { normalizedArgv, envForRun, stdout, stderr } = options;
  const program = buildProgram();
  program.configureOutput({
    writeOut(str) {
      stdout.write(str);
    },
    writeErr(str) {
      stderr.write(str);
    },
  });
  program.exitOverride();
  attachRichHelp(program, envForRun, stdout);

  try {
    program.parse(normalizedArgv, { from: "user" });
    return program;
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return null;
    }
    throw error;
  }
}
