import type {
  OctokitInstance,
  CommitToLint,
  ICommitFetcher,
  PullRequestEventPayloadSubset,
} from '../types.js';
import { warning } from '@actions/core';

/**
 * Implements {@link ICommitFetcher} to retrieve commits associated with a
 * GitHub pull request event. It primarily uses the `pullNumber` argument.
 */
export class PullRequestCommitFetcher
  implements ICommitFetcher<PullRequestEventPayloadSubset>
{
  /**
   * Fetches all commits for a given pull request.
   *
   * @param octokit - An initialized Octokit instance.
   * @param owner - The owner of the repository where the pull request exists.
   * @param repo - The name of the repository.
   * @param _eventPayloadSubset - A subset of the GitHub `PullRequestEvent`
   * payload. Currently not directly used as `pullNumber` is prioritized.
   * @param _eventName - The name of the GitHub event (not directly used).
   * @param pullNumber - The number identifying the pull request. Must be
   * provided for this fetcher.
   * @returns A promise that resolves to an array of {@link CommitToLint}
   * objects.
   */
  public async fetchCommits(
    octokit: OctokitInstance,
    owner: string,
    repo: string,
    _eventPayloadSubset: PullRequestEventPayloadSubset,
    _eventName?: string,
    pullNumber?: number,
  ): Promise<CommitToLint[]> {
    if (!pullNumber) {
      warning(
        'Pull request number is required for PullRequestCommitFetcher but was not provided.',
      );
      return [];
    }

    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    return commits.map(
      (commit: { commit: { message: string }; sha: string }) => ({
        message: commit.commit.message,
        hash: commit.sha,
      }),
    );
  }
}
