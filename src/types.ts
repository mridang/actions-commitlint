/* istanbul ignore file */
import type {
  LintOptions,
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
 * Derived type for ParserOptions.
 */
export type ActualParserOptions = NonNullable<LintOptions['parserOpts']>;

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
