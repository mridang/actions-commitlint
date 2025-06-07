import type {
  CommitToLint,
  ICommitFetcher,
  OctokitInstance,
  PullRequestEventPayloadSubset,
} from '../types.js';
import { warning } from '@actions/core';
import { getOctokit } from '@actions/github';

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
   * @param token - The GitHub token for API authentication.
   * @param owner - The owner of the repository where the pull request exists.
   * @param repo - The name of the repository.
   * @param payload - A subset of the GitHub `PullRequestEvent` payload.
   * @returns A promise that resolves to an array of {@link CommitToLint}
   * objects.
   */
  public async fetchCommits(
    token: string | OctokitInstance,
    owner: string,
    repo: string,
    payload: PullRequestEventPayloadSubset,
  ): Promise<CommitToLint[]> {
    const octokit = typeof token === 'string' ? getOctokit(token) : token;
    if (!payload.number) {
      warning(
        'Pull request number is required for PullRequestCommitFetcher but was not provided.',
      );
      return [];
    }

    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: payload.number,
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
