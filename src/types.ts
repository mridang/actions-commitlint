import type {
  LintOptions,
  LintOutcome,
  QualifiedRules,
  PluginRecords,
  ParserPreset,
  UserPromptConfig,
} from '@commitlint/types';
import type { GitHub } from '@actions/github/lib/utils.js';
import type {
  PushEvent,
  MergeGroupEvent,
  PullRequestEvent,
} from '@octokit/webhooks-types';

/**
 * Represents an Octokit instance, used for interacting with the GitHub API.
 */
export type OctokitInstance = InstanceType<typeof GitHub>;

/**
 * Represents a commit with its message and hash, intended for linting.
 */
export interface CommitToLint {
  message: string;
  hash: string;
}

/**
 * Represents a commit after it has been linted, including the linting outcome.
 */
export interface LintedCommit extends CommitToLint {
  lintResult: LintOutcome;
}

/**
 * Type alias for the structure of individual commit objects within the
 * `commits` array of a GitHub push event payload, using official types.
 */
export type ActualPushEventCommit = PushEvent['commits'][number];

/**
 * Type alias for the structure of the `merge_group` object within a GitHub
 * merge_group event payload, using official types.
 */
export type ActualMergeGroupPayload = MergeGroupEvent['merge_group'];

/**
 * Defines the subset of the PushEvent payload relevant to the
 * PushEventCommitFetcher.
 */
export type PushEventPayloadSubset = Pick<
  PushEvent,
  'before' | 'after' | 'commits'
>;

/**
 * Defines the subset of the MergeGroupEvent payload relevant to the
 * MergeGroupCommitFetcher.
 */
export type MergeGroupEventPayloadSubset = {
  merge_group?: Pick<ActualMergeGroupPayload, 'head_sha' | 'head_commit'>;
};

/**
 * Defines the subset of the PullRequestEvent payload.
 */
export type PullRequestEventPayloadSubset = Pick<
  PullRequestEvent,
  'action' | 'number'
>;

/**
 * Interface for commit fetching strategies. Each fetcher will implement an
 * execute method to retrieve commits based on the GitHub event context.
 *
 * @template TEventPayloadSubset - The expected subset type of the GitHub event
 * payload relevant to the specific fetcher implementation.
 */
export interface ICommitFetcher<TEventPayloadSubset = unknown> {
  /**
   * Fetches the relevant commits to be linted based on the GitHub event.
   *
   * @param token - The GitHub token for API authentication.
   * @param owner - The owner of the repository where the event occurred.
   * @param repo - The name of the repository.
   * @param eventPayloadSubset - A subset of the GitHub webhook event payload,
   * containing only the fields relevant to this fetcher.
   * @param issueNumber - The issue or pull request number if applicable to the
   * event (e.g., for pull request events). Optional.
   * @returns A promise that resolves to an array of {@link CommitToLint}
   * objects representing the commits to be linted.
   */
  fetchCommits(
    token: string,
    owner: string,
    repo: string,
    eventPayloadSubset: TEventPayloadSubset,
    issueNumber?: number,
  ): Promise<CommitToLint[]>;
}

/**
 * Interface for configuration handling strategies.
 */
export interface ICommitlintStrategy {
  /**
   * Executes the strategy to prepare the environment for commitlint.
   * @param configFilePath - The absolute path to the configuration file.
   * @param workingDirectory - The directory where operations should occur.
   * @returns A promise that resolves when the strategy execution is complete.
   */
  execute(configFilePath: string, workingDirectory: string): Promise<void>;
}

/**
 * Derived type for ParserOptions.
 */
export type ActualParserOptions = NonNullable<LintOptions['parserOpts']>;

/**
 * Derived type for LintProblem.
 */
export type ActualLintProblem = LintOutcome['errors'][number];

/**
 * Defines the structure of the configuration object after being processed by
 * `@commitlint/load`. This type aligns with `QualifiedConfig` from
 * `@commitlint/types`, which is the actual return type of the `load` function.
 */
export interface LoadedCommitlintConfig {
  extends: string[];
  formatter: string;
  rules: QualifiedRules;
  parserPreset?: ParserPreset;
  ignores?: ((commit: string) => boolean)[];
  defaultIgnores?: boolean;
  plugins: PluginRecords;
  helpUrl: string;
  prompt: UserPromptConfig;
}

/**
 * Represents the raw content of a declarative configuration file.
 */
export interface RawDeclarativeConfig {
  extends?: string | string[];
  plugins?: (string | [string, unknown?])[];
  [key: string]: unknown;
}

/**
 * Defines the structure of the output for a single linted commit.
 */
export interface OutputResult {
  hash: string;
  message: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Result from cosmiconfig search.
 */
export interface CosmiconfigSearchResult {
  config: unknown;
  filepath: string;
  isEmpty?: boolean;
}

/**
 * Describes the type of configuration file.
 */
export enum ConfigFileType {
  Declarative = 'declarative',
  Imperative = 'imperative',
  Unknown = 'unknown',
}

/**
 * Represents the result of the linting process performed by the Linter class.
 * It encapsulates the linted commits, the formatted output string, and
 * provides helper methods to query the overall status of the linting.
 */
export interface LinterResult {
  /** An array of all commits that were processed, including their lint outcomes. */
  readonly lintedCommits: LintedCommit[];
  /** A formatted string representing all linting errors and warnings. */
  readonly formattedResults: string;
  /** The loaded commitlint configuration that was used for linting. */
  readonly loadedConfig: LoadedCommitlintConfig;

  /**
   * Checks if any linted commits exist and if all of them are valid (no errors)
   * but at least one commit has one or more warnings.
   * @returns `true` if there are commits with only warnings, `false` otherwise.
   */
  hasOnlyWarnings(): boolean;

  /**
   * Checks if there are any linting errors across all processed commits.
   * An error means a commit message is not valid according to the rules.
   * @returns `true` if at least one commit has linting errors, `false`
   * otherwise.
   */
  hasErrors(): boolean;
}
