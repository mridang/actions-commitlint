import { MergeGroupCommitFetcher } from './merge-group.js';
import { PullRequestCommitFetcher } from './pull-request.js';
import { PushEventCommitFetcher } from './push-event.js';
import { info } from '@actions/core';
import { ICommitFetcher } from '../types.js';

/**
 * Selects and returns the appropriate commit fetcher based on the event name.
 *
 * @param eventName - The name of the current GitHub event.
 * @returns An instance of {@link ICommitFetcher} or `null`.
 */
export default function getCommitFetcher(
  eventName: string | undefined,
): ICommitFetcher | null {
  if (eventName === 'merge_group') {
    return new MergeGroupCommitFetcher();
  }
  if (
    eventName &&
    ['pull_request', 'pull_request_target'].includes(eventName)
  ) {
    return new PullRequestCommitFetcher();
  }
  if (eventName === 'push') {
    return new PushEventCommitFetcher();
  }
  info(`No specific commit fetcher for event: ${eventName}.`);
  return null;
}
