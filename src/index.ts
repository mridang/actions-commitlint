import { existsSync as fsExistsSync } from 'node:fs';
import {
  resolve as pathResolve,
  extname as pathExtname,
  basename as pathBasename,
} from 'node:path';
import {
  getInput,
  setOutput,
  setFailed,
  info,
  warning as coreWarning,
  startGroup,
  endGroup,
} from '@actions/core';
import { context as eventContext, getOctokit } from '@actions/github';
import { cosmiconfig } from 'cosmiconfig';
import type {
  ActualLintProblem,
  CommitToLint,
  LintedCommit,
  OutputResult,
  CosmiconfigSearchResult,
  ICommitlintStrategy,
  ICommitFetcher,
  OctokitInstance,
} from './types.js';
import { ConfigFileType } from './types.js';

import { DeclarativeStrategy } from './strategies/declarative.js';
import { ImperativeStrategy } from './strategies/imperative.js';
import { PullRequestCommitFetcher } from './fetchers/pull-request.js';
import { PushEventCommitFetcher } from './fetchers/push-event.js';
import { MergeGroupCommitFetcher } from './fetchers/merge-group.js';
import { Linter } from './linter/index.js';

const RESULTS_OUTPUT_ID = 'results';
const MERGE_GROUP_EVENT = 'merge_group';
const PULL_REQUEST_EVENT = 'pull_request';
const PULL_REQUEST_TARGET_EVENT = 'pull_request_target';
const PUSH_EVENT = 'push';
const PULL_REQUEST_EVENTS: string[] = [
  PULL_REQUEST_EVENT,
  PULL_REQUEST_TARGET_EVENT,
];
const { GITHUB_EVENT_NAME, GITHUB_WORKSPACE } = process.env;
const COSMICONFIG_MODULE_NAME = 'commitlint';

/**
 * Searches for a commitlint configuration file using `cosmiconfig`.
 *
 * @param searchFrom - The directory path to start the search from.
 * @returns A promise that resolves to a {@link CosmiconfigSearchResult} or
 * `null`.
 */
async function findCommitlintConfig(
  searchFrom: string,
): Promise<CosmiconfigSearchResult | null> {
  const explorer = cosmiconfig(COSMICONFIG_MODULE_NAME);
  try {
    const result = await explorer.search(searchFrom);
    if (result && !result.isEmpty) {
      info(`Found commitlint configuration at: ${result.filepath}`);
      return result as CosmiconfigSearchResult;
    }
    info('No commitlint configuration file found by cosmiconfig.');
    return null;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    coreWarning(
      `Error searching for commitlint configuration: ${errorMessage}`,
    );
    return null;
  }
}

/**
 * Determines the type of a configuration file.
 *
 * @param filepath - The absolute path to the configuration file.
 * @returns The {@link ConfigFileType}.
 */
function getConfigType(filepath: string): ConfigFileType {
  const extension = pathExtname(filepath).toLowerCase();
  switch (extension) {
    case '.json':
    case '.yaml':
    case '.yml':
      return ConfigFileType.Declarative;
    case '.js':
    case '.cjs':
    case '.mjs':
    case '.ts':
      return ConfigFileType.Imperative;
    default:
      if (pathBasename(filepath) === 'package.json') {
        return ConfigFileType.Declarative;
      }
      return ConfigFileType.Unknown;
  }
}

/**
 * Extracts the message string from a linting problem object.
 *
 * @param item - The lint problem object from commitlint.
 * @returns The human-readable message.
 */
function mapMessageValidation(item: ActualLintProblem): string {
  return item.message;
}

/**
 * Transforms a {@link LintedCommit} object into an {@link OutputResult}.
 *
 * @param lintedCommit - The commit object with its lint result.
 * @returns An {@link OutputResult} for GitHub Action output.
 */
function mapResultOutput({
  hash,
  lintResult: { valid, errors, warnings, input },
}: LintedCommit): OutputResult {
  return {
    hash,
    message: input,
    valid,
    errors: errors.map(mapMessageValidation),
    warnings: warnings.map(mapMessageValidation),
  };
}

/**
 * Retrieves the 'token' input for the action.
 * @returns The GitHub token.
 */
function getToken(): string {
  return getInput('token', { required: true });
}

/**
 * Retrieves the 'config-file' input path.
 * @returns The user-specified config file path or empty string.
 */
function getConfigFileInput(): string {
  return getInput('config-file');
}

/**
 * Retrieves the 'commit-depth' input.
 * @returns The commit depth as a number, or `null`.
 */
function getCommitDepth(): number | null {
  const commitDepthString = getInput('commit-depth');
  if (!commitDepthString?.trim()) return null;
  const depth = parseInt(commitDepthString, 10);
  return Number.isNaN(depth) ? null : Math.max(depth, 0);
}

/**
 * Retrieves the 'help-url' input.
 * @returns The help URL string.
 */
function getHelpURL(): string {
  return getInput('help-url');
}

/**
 * Retrieves the 'fail-on-warnings' input.
 * @returns `true` if the action should fail on warnings.
 */
function getFailOnWarnings(): boolean {
  return getInput('fail-on-warnings') === 'true';
}

/**
 * Retrieves the 'fail-on-errors' input.
 * @returns `false` if the action should not fail on errors.
 */
function getFailOnErrors(): boolean {
  return getInput('fail-on-errors') !== 'false';
}

/**
 * Selects and returns the appropriate commit fetcher based on the event name.
 *
 * @param eventName - The name of the current GitHub event.
 * @returns An instance of {@link ICommitFetcher} or `null`.
 */
function getCommitFetcher(
  eventName: string | undefined,
): ICommitFetcher | null {
  if (eventName === MERGE_GROUP_EVENT) {
    return new MergeGroupCommitFetcher();
  }
  if (eventName && PULL_REQUEST_EVENTS.includes(eventName)) {
    return new PullRequestCommitFetcher();
  }
  if (eventName === PUSH_EVENT) {
    return new PushEventCommitFetcher();
  }
  info(`No specific commit fetcher for event: ${eventName}.`);
  return null;
}

/**
 * Prepares the environment by installing dependencies based on config.
 *
 * @param workspacePath - The GITHUB_WORKSPACE path.
 * @param userSpecifiedConfigFile - Path to config file from input.
 * @returns The path to the resolved config file, or `null` for defaults.
 * @throws If an invalid config type is encountered.
 */
async function prepareEnvironmentAndGetConfigPath(
  workspacePath: string,
  userSpecifiedConfigFile: string,
): Promise<string | null> {
  let resolvedConfigPath: string | null = null;
  let configFileType: ConfigFileType = ConfigFileType.Unknown;
  let strategy: ICommitlintStrategy | null = null;

  if (userSpecifiedConfigFile) {
    const absoluteUserPath = pathResolve(
      workspacePath,
      userSpecifiedConfigFile,
    );
    if (fsExistsSync(absoluteUserPath)) {
      resolvedConfigPath = absoluteUserPath;
      configFileType = getConfigType(resolvedConfigPath);
      info(
        `Using user-specified configuration file: ${resolvedConfigPath} (Type: ${configFileType})`,
      );
    } else {
      coreWarning(
        `User-specified configuration file not found: ${absoluteUserPath}. Attempting to find one automatically.`,
      );
    }
  }

  if (!resolvedConfigPath) {
    const searchResult: CosmiconfigSearchResult | null =
      await findCommitlintConfig(workspacePath);
    if (searchResult?.filepath) {
      resolvedConfigPath = searchResult.filepath;
      configFileType = getConfigType(resolvedConfigPath);
      info(
        `Automatically found configuration file: ${resolvedConfigPath} (Type: ${configFileType})`,
      );
    }
  }

  if (!resolvedConfigPath) {
    info(
      'No commitlint configuration file specified or found. Linting will proceed with default @commitlint/config-conventional settings. No specific dependency installation strategy will be run.',
    );
    return null;
  }

  if (
    pathBasename(resolvedConfigPath) === 'package.json' &&
    configFileType === ConfigFileType.Declarative
  ) {
    info(
      `Configuration found in 'package.json'. Using ImperativeStrategy (npm install on existing package.json).`,
    );
    strategy = new ImperativeStrategy();
  } else {
    switch (configFileType) {
      case ConfigFileType.Declarative:
        strategy = new DeclarativeStrategy();
        break;
      case ConfigFileType.Imperative:
        strategy = new ImperativeStrategy();
        break;
      case ConfigFileType.Unknown:
        throw new Error(
          `Could not determine a valid configuration type for ${resolvedConfigPath}. Please ensure it's a recognized commitlint config format (JSON, YAML, JS) or a package.json with a 'commitlint' key.`,
        );
    }
  }

  if (strategy) {
    startGroup(
      `Preparing dependencies for config: ${resolvedConfigPath} (Strategy: ${strategy.constructor.name})`,
    );
    await strategy.execute(resolvedConfigPath, workspacePath);
    endGroup();
  }
  return resolvedConfigPath;
}

/**
 * Orchestrates the core commit linting process using the Linter class.
 *
 * @param commitsToProcess - Array of {@link CommitToLint} to be linted.
 * @param effectiveConfigPath - Path to the config file, or `null` for defaults.
 * @param helpUrl - Custom help URL from action input.
 * @param workspace - The GitHub workspace path.
 */
async function runLintingProcess(
  commitsToProcess: CommitToLint[],
  effectiveConfigPath: string | null,
  helpUrl: string,
  workspace: string,
): Promise<void> {
  const failOnWarns = getFailOnWarnings();
  const failOnErrs = getFailOnErrors();

  const linter = new Linter(
    commitsToProcess,
    effectiveConfigPath,
    helpUrl,
    workspace,
  );
  const result = await linter.lint();

  const resultsOutputForAction = result.lintedCommits.map(mapResultOutput);
  setOutput(RESULTS_OUTPUT_ID, resultsOutputForAction);

  if (result.hasErrors()) {
    if (failOnErrs) {
      setFailed(`Commit linter failed:\n\n${result.formattedResults}`);
    } else {
      coreWarning(
        `Commit messages have errors, but 'failOnErrors' is false. Passing with a warning. Results:\n\n${result.formattedResults}`,
      );
      info(
        'Action passed despite errors due to failOnErrors=false setting. ✅',
      );
    }
  } else if (result.hasOnlyWarnings()) {
    const warningsMessage = `Commit messages have warnings (but no errors):\n\n${result.formattedResults}`;
    if (failOnWarns) {
      setFailed(`Commit linter failed:\n\n${warningsMessage}`);
    } else {
      coreWarning(warningsMessage);
    }
  } else {
    if (
      result.formattedResults.trim().length > 0 &&
      result.lintedCommits.some(
        (commit) => commit.lintResult.warnings.length > 0,
      )
    ) {
      info(
        `Linting complete. Some warnings were found but did not cause failure:\n\n${result.formattedResults}`,
      );
    } else if (
      result.formattedResults.trim().length === 0 &&
      result.lintedCommits.every(
        (c) => c.lintResult.valid && c.lintResult.warnings.length === 0,
      )
    ) {
      info('All commit messages are lint free! 🎉');
    } else {
      info(`Linting complete. Results:\n\n${result.formattedResults}`);
    }
  }
}

/**
 * Creates an error handler for critical, unhandled errors.
 *
 * @param message - Context message for the error.
 * @returns A function to handle the error and fail the action.
 */
function createCriticalErrorHandler(
  message: string,
): (error: Error | unknown) => void {
  return (error: Error | unknown): void => {
    const baseFailureMessage = 'Commit linter failed:\n\n';
    if (error instanceof Error) {
      setFailed(
        `${baseFailureMessage}${message}\nError: ${error.message}\nStack: ${error.stack ?? 'N/A'}`,
      );
    } else {
      setFailed(
        `${baseFailureMessage}${message}\nAn unknown error occurred: ${String(error)}`,
      );
    }
  };
}

/**
 * Main entry point for the GitHub Action.
 * @param octokitInstance - Optional Octokit instance for testing. If not
 * provided, a new one will be created.
 */
export async function runx(octokitInstance?: OctokitInstance): Promise<void> {
  try {
    const token = getToken();
    const octokit = octokitInstance || getOctokit(token);
    const workspace = GITHUB_WORKSPACE;

    if (!workspace) {
      throw new Error(
        'GITHUB_WORKSPACE is not defined. This action must run in a workspace context.',
      );
    }

    const userConfigFile = getConfigFileInput();
    const helpUrl = getHelpURL();
    const commitDepth = getCommitDepth();

    startGroup('Environment Preparation & Configuration Loading');
    const effectiveConfigPath = await prepareEnvironmentAndGetConfigPath(
      workspace,
      userConfigFile,
    );
    endGroup();

    startGroup('Fetching Commits');
    info(`Fetching commits for event: ${GITHUB_EVENT_NAME || 'unknown'}...`);

    const { owner, repo, number: issueNumber } = eventContext.issue;
    const commitFetcher = getCommitFetcher(GITHUB_EVENT_NAME);
    let eventCommits: CommitToLint[] = [];

    if (commitFetcher) {
      eventCommits = await commitFetcher.fetchCommits(
        octokit,
        owner,
        repo,
        eventContext.payload,
        GITHUB_EVENT_NAME,
        issueNumber,
      );
    } else {
      coreWarning(
        `No suitable commit fetcher found for event: ${GITHUB_EVENT_NAME}. No commits will be linted.`,
      );
    }
    endGroup();

    const commitsToLint =
      commitDepth && eventCommits.length > commitDepth
        ? eventCommits.slice(0, commitDepth)
        : eventCommits;

    if (commitsToLint.length > 0) {
      startGroup('Linting Commits');
      await runLintingProcess(
        commitsToLint,
        effectiveConfigPath,
        helpUrl,
        workspace,
      );
      endGroup();
    } else {
      coreWarning('No commits found to lint.');
    }
  } catch (error: unknown) {
    createCriticalErrorHandler('Critical error in commitlint action execution')(
      error,
    );
  }
}

if (process.env.JEST_WORKER_ID === undefined) {
  runx().catch((error: unknown) => {
    if (error instanceof Error) {
      setFailed(
        `Unhandled top-level error in action: ${error.message}\n${error.stack ?? 'N/A'}`,
      );
    } else {
      setFailed(
        `Unhandled unknown top-level error in action: ${String(error)}`,
      );
    }
  });
}
