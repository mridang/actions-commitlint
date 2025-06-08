import {
  getInput,
  info,
  setFailed as actionFailed,
  startGroup,
  endGroup,
  warning,
} from '@actions/core';
import { cosmiconfig } from 'cosmiconfig';
import type { CommitToLint, ICommitFetcher } from './types.js';

import { Linter } from './linter/index.js';
import { createLoaders } from './loaders.js';
import { Context } from '@actions/github/lib/context.js';
import getCommitFetcher from './fetchers/index.js';

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
 * Retrieves the GitHub token from the action's 'github-token' input.
 *
 * @returns The GitHub token.
 * @throws {Error} if the 'github-token' input is empty.
 */
function getGithubToken(): string {
  const token = getInput('github-token', { required: true }).trim();
  if (token) {
    return token;
  } else {
    throw new Error('The "github-token" input must not be empty.');
  }
}

/**
 * Retrieves the working directory from the action's 'working-directory' input.
 *
 * @returns The specified working directory or the current process's
 * working directory if the input is empty.
 */
function getWorkingDirectory(): string {
  const dir = getInput('working-directory').trim();
  if (dir) {
    return dir;
  } else {
    return process.cwd();
  }
}

/**
 * Retrieves the boolean value for the 'allow-force-install' input.
 *
 * @returns `true` if 'allow-force-install' is 'true' or empty, `false` if 'false'.
 * @throws {Error} if the 'allow-force-install' input is an invalid value.
 */
function getAllowForceInstall(): boolean {
  const raw = getInput('allow-force-install').trim().toLowerCase();
  if (raw === 'true') {
    return true;
  } else if (raw === 'false' || raw === '') {
    return false;
  } else {
    throw new Error(
      'Invalid value for "allow-force-install". Use "true" or "false".',
    );
  }
}

/**
 * Retrieves the boolean value for the 'fail-on-warnings' input.
 * This input defaults to `false` if not provided.
 *
 * @returns {boolean} Returns `true` if the input is 'true', and `false` if empty or 'false'.
 * @throws {Error} If the input is not 'true', 'false', or empty.
 */
function getFailOnWarnings(): boolean {
  const raw = getInput('fail-on-warnings').trim().toLowerCase();
  if (raw === 'true') {
    return true;
  } else if (raw === 'false' || raw === '') {
    return false;
  } else {
    throw new Error(
      `Invalid value for "fail-on-warnings". Expected 'true' or 'false', but received '${raw}'.`,
    );
  }
}

/**
 * Retrieves the boolean value for the 'fail-on-errors' input.
 * This input defaults to `true` if not provided.
 *
 * @returns {boolean} Returns `false` if the input is 'false', and `true` if empty or 'true'.
 * @throws {Error} If the input is not 'true', 'false', or empty.
 */
function getFailOnErrors(): boolean {
  const raw = getInput('fail-on-errors').trim().toLowerCase();
  if (raw === 'false') {
    return false;
  } else if (raw === 'true' || raw === '') {
    return true;
  } else {
    throw new Error(
      `Invalid value for "fail-on-errors". Expected 'true' or 'false', but received '${raw}'.`,
    );
  }
}

/**
 * Retrieves the 'help-url' input.
 * @returns The help URL string.
 */
function getHelpURL(): string {
  return getInput('help-url');
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

  if (result.hasErrors()) {
    if (failOnErrs) {
      setFailed(`Commit linter failed:\n\n${result.formattedResults}`);
    } else {
      warning(`Commit messages have errors, but 'fail-on-errors' is false.`);
      info("Action passed despite errors since 'fail-on-errors' is false.");
    }
  } else if (result.hasOnlyWarnings()) {
    const warningsMessage = `Commit messages have warnings (but no errors):\n\n${result.formattedResults}`;
    if (failOnWarns) {
      setFailed(`Commit linter failed:\n\n${warningsMessage}`);
    } else {
      warning(warningsMessage);
    }
  } else {
    if (
      result.formattedResults.trim().length > 0 &&
      result.lintedCommits.some(
        (commit) => commit.lintResult.warnings.length > 0,
      )
    ) {
      info(
        `Linting complete. Some warnings were found but did not cause failure`,
      );
    } else if (
      result.formattedResults.trim().length === 0 &&
      result.lintedCommits.every(
        (c) => c.lintResult.valid && c.lintResult.warnings.length === 0,
      )
    ) {
      info('All commit messages are lint free!');
    } else {
      info(`Linting complete`);
    }
  }
}

/**
 * Sets the action's failure status with a given message.
 * In a JEST test environment, it throws an error instead of calling
 * `actionFailed`.
 *
 * @param message - The error message or Error object.
 */
function setFailed(message: string | Error): void {
  if (process.env.JEST_WORKER_ID) {
    if (message instanceof Error) {
      throw message;
    } else {
      throw new Error(message);
    }
  } else {
    actionFailed(message);
  }
}

/**
 * The main entry point for the action.
 * @param ghCtx The GitHub context, defaults to a new Context().
 * @param commitFetcherFactory An optional factory function that returns a
 * commit fetcher. Used for testing. Defaults to the real implementation.
 */
export async function run(
  ghCtx = new Context(),
  commitFetcherFactory: (event: string) => ICommitFetcher | null = (
    event: string,
  ) => getCommitFetcher(event),
): Promise<string | void> {
  try {
    const helpUrl = getHelpURL();
    const commitDepth = getCommitDepth();
    const githubToken = getGithubToken();
    const workingDirectory = getWorkingDirectory();

    const explorer = cosmiconfig('commitlint', {
      loaders: createLoaders(getAllowForceInstall()),
    });

    const result = await explorer.search(workingDirectory);

    if (result === null) {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error('No configuration file found.');
    } else if (
      typeof result.config !== 'object' ||
      result.config === null ||
      !result.filepath
    ) {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error('Invalid commit-lint configuration.');
    } else if (result.isEmpty) {
      // noinspection ExceptionCaughtLocallyJS
      throw new Error(`Configuration file "${result.filepath}" is empty.`);
    } else {
      info(`Fetching commits for event: ${ghCtx.eventName}`);
      const commitFetcher = commitFetcherFactory(ghCtx.eventName);
      if (commitFetcher) {
        const eventCommits = await commitFetcher.fetchCommits(
          githubToken,
          ghCtx.repo.owner,
          ghCtx.repo.repo,
          ghCtx.payload,
        );
        const commitsToLint =
          commitDepth && eventCommits.length > commitDepth
            ? eventCommits.slice(0, commitDepth)
            : eventCommits;

        if (commitsToLint.length > 0) {
          startGroup('Running commit-lint');
          await runLintingProcess(
            commitsToLint,
            result.filepath,
            helpUrl,
            workingDirectory,
          );
          endGroup();
        } else {
          setFailed('No commits found to lint.');
        }
      } else {
        setFailed(`No suitable commit fetcher found for event.`);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      setFailed(err);
    } else {
      setFailed(err as unknown as string);
    }
  }
}
