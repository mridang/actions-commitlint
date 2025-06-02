/* eslint-disable testing-library/no-debugging-utils */
import type {
  OctokitInstance,
  CommitToLint,
  ICommitFetcher,
  ActualPushEventCommit,
  PushEventPayloadSubset,
} from '../types.js';
import { debug, error as coreError } from '@actions/core';

/**
 * Implements {@link ICommitFetcher} to retrieve commits associated with a
 * GitHub push event.
 * For pushes with distinct 'before' and 'after' SHAs, it uses the
 * `compareCommits` API. If this API call fails, an error is thrown.
 * If the conditions for an API call are not met (e.g., initial push,
 * force push to the same ref), it will use the `commits` array from the
 * event payload subset if available.
 */
export class PushEventCommitFetcher
  implements ICommitFetcher<PushEventPayloadSubset>
{
  /**
   * Fetches commits from a push event.
   *
   * It attempts to use the GitHub `compareCommits` API if distinct 'before'
   * and 'after' SHAs are present in the `eventPayloadSubset`. If this API call
   * is attempted and fails, an error will be thrown.
   * If the API call is not applicable, it will use the `commits` array from
   * the `eventPayloadSubset`.
   *
   * @param octokit - An initialized Octokit instance.
   * @param owner - The owner of the repository.
   * @param repo - The name of the repository.
   * @param eventPayloadSubset - A subset of the GitHub `PushEvent` payload,
   * containing `before`, `after`, and `commits`.
   * @returns A promise that resolves to an array of {@link CommitToLint}
   * objects.
   * @throws If the `compareCommits` API call is attempted and fails.
   */
  public async fetchCommits(
    octokit: OctokitInstance,
    owner: string,
    repo: string,
    eventPayloadSubset: PushEventPayloadSubset,
  ): Promise<CommitToLint[]> {
    const { before, after, commits: payloadCommits } = eventPayloadSubset;
    debug(`Push event: before SHA: ${before}, after SHA: ${after}`);

    if (before && after && before !== after) {
      debug(
        `Attempting to fetch commits via compare API between ${before} and ${after}.`,
      );
      try {
        const { data: comparison } = await octokit.rest.repos.compareCommits({
          owner,
          repo,
          head: after,
          base: before,
          per_page: 100,
        });
        debug(`API comparison found ${comparison.commits.length} commits.`);
        return comparison.commits.map((commit) => ({
          message: commit.commit.message,
          hash: commit.sha,
        }));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const detailedError = `Failed to compare commits via API for ${before}...${after}: ${errorMessage}`;
        coreError(detailedError);
        throw new Error(detailedError);
      }
    }

    if (payloadCommits?.length) {
      debug(
        `Using ${payloadCommits.length} commits from payload (API call not applicable or not attempted).`,
      );
      return (payloadCommits as ActualPushEventCommit[]).map((commit) => ({
        message: commit.message,
        hash: commit.id || 'unknown_sha',
      }));
    }

    debug('No commits found for push event from API or payload.');
    return [];
  }
}
