import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getInput,
  info,
  setFailed,
  setOutput,
  warning as coreWarning,
} from '@actions/core';
import { context as eventContext, getOctokit } from '@actions/github';
import type { GitHub } from '@actions/github/lib/utils.js';
import lint from '@commitlint/lint';
import { format } from '@commitlint/format';
import load from '@commitlint/load';
import type {
  LintOptions,
  LintOutcome,
  PluginRecords,
  QualifiedRules,
} from '@commitlint/types';

// --- Derived Type Definitions ---
type ActualParserOptions = NonNullable<LintOptions['parserOpts']>;
type ActualLintProblem = LintOutcome['errors'][number];

// --- Explicit Expected Config Structure ---
/**
 * Defines the expected structure of the configuration object loaded by `load()`.
 * This interface includes properties commonly used by commitlint and accessed in this action.
 * Index signatures have been removed to align with the stricter QualifiedConfig type.
 */
interface ExpectedCommitlintConfig {
  parserPreset?: {
    name?: string;
    parserOpts?: ActualParserOptions;
    // Removed: [key: string]: unknown;
  };
  rules?: QualifiedRules;
  plugins?: PluginRecords;
  ignores?: ((commit: string) => boolean)[];
  defaultIgnores?: boolean;
  helpUrl?: string;
  // Removed: [key: string]: unknown;
}

// --- Type Definitions (Action Specific) ---
type OctokitInstance = InstanceType<typeof GitHub>;

interface CommitToLint {
  message: string;
  hash: string;
}

interface LintedCommit extends CommitToLint {
  lintResult: LintOutcome;
}

interface OutputResult {
  hash: string;
  message: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface PushEventCommit {
  message: string;
  id: string;
  sha?: string;

  [key: string]: unknown; // This is fine for loosely typed external data
}

interface MergeGroupPayload {
  head_sha: string;
  head_commit: {
    message: string;
    [key: string]: unknown; // This is fine for loosely typed external data
  };

  [key: string]: unknown; // This is fine for loosely typed external data
}

// --- Constants ---
const RESULTS_OUTPUT_ID = 'results';
const MERGE_GROUP_EVENT = 'merge_group';
const PULL_REQUEST_EVENT = 'pull_request';
const PULL_REQUEST_TARGET_EVENT = 'pull_request_target';
const PULL_REQUEST_EVENTS: string[] = [
  PULL_REQUEST_EVENT,
  PULL_REQUEST_TARGET_EVENT,
];
const FIRST_COMMIT_SHA = '0000000000000000000000000000000000000000';
const { GITHUB_EVENT_NAME, GITHUB_WORKSPACE } = process.env;

// --- Output Generation Functions ---
function mapMessageValidation(item: ActualLintProblem): string {
  return item.message;
}

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

function generateOutputs(lintedCommits: LintedCommit[]): void {
  const resultsOutput = lintedCommits.map(mapResultOutput);
  setOutput(RESULTS_OUTPUT_ID, resultsOutput);
}

// --- Input Getter Functions ---
function getToken(): string {
  return getInput('token', { required: true });
}

function getConfigPath(): string {
  const configFile = getInput('configFile');
  if (!GITHUB_WORKSPACE) {
    throw new Error('GITHUB_WORKSPACE environment variable is not set.');
  }
  return resolve(GITHUB_WORKSPACE, configFile);
}

function getCommitDepth(): number | null {
  const commitDepthString = getInput('commitDepth');
  if (!commitDepthString?.trim()) return null;
  const depth = parseInt(commitDepthString, 10);
  return Number.isNaN(depth) ? null : Math.max(depth, 0);
}

function getHelpURL(): string {
  return getInput('helpURL');
}

function getFailOnWarnings(): boolean {
  return getInput('failOnWarnings') === 'true';
}

function getFailOnErrors(): boolean {
  return getInput('failOnErrors') !== 'false';
}

// --- GitHub Event Commit Fetcher Functions ---
async function getPushEventCommits(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
): Promise<CommitToLint[]> {
  const { before, after, commits: payloadCommitsUnsafe } = eventContext.payload;
  const payloadCommits = payloadCommitsUnsafe as PushEventCommit[] | undefined;

  if (before === FIRST_COMMIT_SHA && payloadCommits?.length) {
    return payloadCommits.map((commit) => ({
      message: commit.message,
      hash: commit.id || commit.sha || 'unknown_sha',
    }));
  }

  if (
    typeof before === 'string' &&
    typeof after === 'string' &&
    before &&
    after
  ) {
    try {
      const { data: comparison } = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        head: after,
        base: before,
        per_page: 100,
      });
      return comparison.commits.map((commit) => ({
        message: commit.commit.message,
        hash: commit.sha,
      }));
    } catch (error) {
      coreWarning(`Failed to compare commits: ${(error as Error).message}`);
      return [];
    }
  }
  return [];
}

async function getPullRequestEventCommits(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<CommitToLint[]> {
  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return commits.map((commit) => ({
    message: commit.commit.message,
    hash: commit.sha,
  }));
}

async function getMergeGroupEventCommits(): Promise<CommitToLint[]> {
  const mergeGroup = eventContext.payload.merge_group as
    | MergeGroupPayload
    | undefined;
  if (mergeGroup?.head_commit?.message && mergeGroup?.head_sha) {
    return [
      {
        message: mergeGroup.head_commit.message,
        hash: mergeGroup.head_sha,
      },
    ];
  }
  coreWarning(
    'Merge group payload did not contain expected head_commit information.',
  );
  return [];
}

async function getEventCommits(
  octokit: OctokitInstance,
  currentEventName: string | undefined,
): Promise<CommitToLint[]> {
  const { owner, repo, number: issueNumber } = eventContext.issue;

  if (currentEventName === MERGE_GROUP_EVENT) {
    return getMergeGroupEventCommits();
  }
  if (
    currentEventName &&
    PULL_REQUEST_EVENTS.includes(currentEventName) &&
    issueNumber
  ) {
    return getPullRequestEventCommits(octokit, owner, repo, issueNumber);
  }
  if (currentEventName === 'push' && eventContext.payload.commits) {
    return getPushEventCommits(octokit, owner, repo);
  }
  info(`No specific commit retrieval logic for event: ${currentEventName}.`);
  return [];
}

// --- Commitlint Specific Helper Functions ---

/**
 * Extracts linting options from a loaded commitlint configuration.
 * @param loadedUserConfig - The configuration object, asserted to {@link ExpectedCommitlintConfig}.
 * @returns An {@link LintOptions} object for use with `@commitlint/lint`.
 */
function getOptsFromConfig(
  loadedUserConfig: ExpectedCommitlintConfig,
): LintOptions {
  const parserOptsValue = loadedUserConfig.parserPreset?.parserOpts;

  return {
    parserOpts: parserOptsValue ?? {},
    plugins: loadedUserConfig.plugins ?? {},
    ignores: loadedUserConfig.ignores ?? [],
    defaultIgnores: loadedUserConfig.defaultIgnores ?? true,
    helpUrl: loadedUserConfig.helpUrl,
  };
}

/**
 * Formats the linting results into a human-readable string.
 * @param lintedCommits - An array of {@link LintedCommit}.
 * @param loadedUserConfig - The loaded commitlint configuration, asserted to {@link ExpectedCommitlintConfig}.
 * @param configuredHelpUrl - A specific help URL from action input.
 * @returns A formatted string representing the lint results.
 */
function formatLintResults(
  lintedCommits: LintedCommit[],
  loadedUserConfig: ExpectedCommitlintConfig,
  configuredHelpUrl: string,
): string {
  return format(
    { results: lintedCommits.map((commit) => commit.lintResult) },
    {
      color: true,
      helpUrl: configuredHelpUrl || loadedUserConfig.helpUrl,
    },
  );
}

// --- Logic for Handling Lint Results ---
function hasOnlyWarnings(lintedCommits: LintedCommit[]): boolean {
  return (
    lintedCommits.length > 0 &&
    lintedCommits.every(({ lintResult }) => lintResult.valid) &&
    lintedCommits.some(({ lintResult }) => lintResult.warnings.length > 0)
  );
}

function setActionFailed(formattedResults: string): void {
  setFailed(`You have commit messages with errors:\n\n${formattedResults}`);
}

function handleOnlyWarnings(
  formattedResults: string,
  shouldFailOnWarnings: boolean,
): void {
  if (shouldFailOnWarnings) {
    setActionFailed(
      `Failing due to warnings (failOnWarnings is true):\n\n${formattedResults}`,
    );
  } else {
    info(
      `You have commit messages with warnings (but no errors):\n\n${formattedResults}`,
    );
  }
}

// --- Main Action Logic ---
async function runLintingProcess(
  commitsToProcess: CommitToLint[],
): Promise<void> {
  const pathConfig = getConfigPath();
  const depthCommit = getCommitDepth();
  const helpUrlInput = getHelpURL();
  const failOnWarns = getFailOnWarnings();
  const failOnErrs = getFailOnErrors();

  const finalCommitsToLint = depthCommit
    ? commitsToProcess.slice(0, depthCommit)
    : commitsToProcess;

  if (finalCommitsToLint.length === 0) {
    info('No commits to lint.');
    return;
  }

  if (pathConfig?.endsWith('.js')) {
    throw new Error(
      "JavaScript configuration files must use '.mjs' or '.cjs' extension.",
    );
  }

  const loadedConfigFromLoad = existsSync(pathConfig)
    ? await load({}, { file: pathConfig })
    : await load({ extends: ['@commitlint/config-conventional'] });

  const loadedUserConfig = loadedConfigFromLoad as ExpectedCommitlintConfig;

  const lintingOpts = getOptsFromConfig(loadedUserConfig);

  const lintedCommits: LintedCommit[] = await Promise.all(
    finalCommitsToLint.map(async (commit) => ({
      ...commit,
      lintResult: await lint(
        commit.message,
        loadedUserConfig.rules,
        lintingOpts,
      ),
    })),
  );

  const formattedResults = formatLintResults(
    lintedCommits,
    loadedUserConfig,
    helpUrlInput,
  );
  generateOutputs(lintedCommits);

  const onlyWarningsPresent = hasOnlyWarnings(lintedCommits);
  const hasErrors = lintedCommits.some(
    (commit) => !commit.lintResult.valid && commit.lintResult.errors.length > 0,
  );

  if (onlyWarningsPresent) {
    handleOnlyWarnings(formattedResults, failOnWarns);
  } else if (hasErrors) {
    if (failOnErrs) {
      setActionFailed(formattedResults);
    } else {
      info(
        `Commit messages have errors, but 'failOnErrors' is false. Passing with a warning. ✅\n\n${formattedResults}`,
      );
    }
  } else if (
    formattedResults.trim() !== '' &&
    !hasErrors &&
    !onlyWarningsPresent
  ) {
    info(`Linting results:\n\n${formattedResults}`);
    info('Linting passed with some messages. 🎉');
  } else {
    info('All commit messages are lint free! 🎉');
  }
}

function createErrorHandler(message: string): (error: Error | unknown) => void {
  return (error: Error | unknown): void => {
    if (error instanceof Error) {
      setFailed(`${message}\nError: ${error.message}\nStack: ${error.stack}`);
    } else {
      setFailed(`${message}\nAn unknown error occurred: ${String(error)}`);
    }
  };
}

async function run(): Promise<void> {
  try {
    const token = getToken();
    const octokit = getOctokit(token);
    info(`Fetching commits for event: ${GITHUB_EVENT_NAME || 'unknown'}...`);
    const eventCommits = await getEventCommits(octokit, GITHUB_EVENT_NAME);
    await runLintingProcess(eventCommits);
  } catch (error) {
    createErrorHandler('Error running commitlint action')(error);
  }
}

run();
