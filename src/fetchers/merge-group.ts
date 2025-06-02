/* eslint-disable testing-library/no-debugging-utils */
import type {
  CommitToLint,
  ICommitFetcher,
  MergeGroupEventPayloadSubset,
  OctokitInstance,
} from '../types.js';
import { warning, debug } from '@actions/core';

/**
 * Implements {@link ICommitFetcher} to retrieve the head commit from a GitHub
 * `merge_group` event. It expects a subset of the `MergeGroupEvent` payload.
 */
export class MergeGroupCommitFetcher
  implements ICommitFetcher<MergeGroupEventPayloadSubset>
{
  /**
   * Fetches the head commit from a `merge_group` event payload subset.
   *
   * @param _octokit - An initialized Octokit instance (not directly used).
   * @param _owner - The owner of the repository.
   * @param _repo - The name of the repository.
   * @param eventPayloadSubset - A subset of the GitHub `MergeGroupEvent`
   * payload, containing the `merge_group` object with `head_sha` and
   * `head_commit`.
   * @returns A promise that resolves to an array containing a single
   * {@link CommitToLint} object for the head commit, or an empty array if the
   * required information is not present in the payload subset.
   */
  public async fetchCommits(
    _octokit: OctokitInstance,
    _owner: string,
    _repo: string,
    eventPayloadSubset: MergeGroupEventPayloadSubset,
  ): Promise<CommitToLint[]> {
    const mergeGroup = eventPayloadSubset.merge_group;
    debug(
      `Merge group event payload subset merge_group object: ${JSON.stringify(mergeGroup)}`,
    );

    if (mergeGroup?.head_commit?.message && mergeGroup?.head_sha) {
      debug(`Found head commit for merge group: SHA ${mergeGroup.head_sha}`);
      return [
        {
          message: mergeGroup.head_commit.message,
          hash: mergeGroup.head_sha,
        },
      ];
    }

    warning(
      'Merge group payload subset did not contain expected head_commit information (merge_group.head_commit.message and merge_group.head_sha).',
    );
    return [];
  }
}
