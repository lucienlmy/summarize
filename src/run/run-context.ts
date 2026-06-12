import type { CliProvider } from "../config.js";
import { resolveConfigState } from "./run-config.js";
import { resolveEnvState } from "./run-env.js";

export function resolveRunContextState({
  env,
  envForRun,
  programOpts,
  languageExplicitlySet,
  videoModeExplicitlySet,
  embeddedVideoExplicitlySet,
  cliFlagPresent,
  cliProviderArg,
}: {
  env: Record<string, string | undefined>;
  envForRun: Record<string, string | undefined>;
  programOpts: Record<string, unknown>;
  languageExplicitlySet: boolean;
  videoModeExplicitlySet: boolean;
  embeddedVideoExplicitlySet: boolean;
  cliFlagPresent: boolean;
  cliProviderArg: CliProvider | null;
}) {
  const configState = resolveConfigState({
    envForRun,
    programOpts,
    languageExplicitlySet,
    videoModeExplicitlySet,
    embeddedVideoExplicitlySet,
    cliFlagPresent,
    cliProviderArg,
  });
  const envState = resolveEnvState({
    env,
    envForRun,
    configForCli: configState.configForCli,
  });
  return { ...configState, ...envState };
}
