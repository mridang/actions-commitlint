import { MergeGroupCommitFetcher } from './merge-group.js';
import { PullRequestCommitFetcher } from './pull-request.js';
import { PushEventCommitFetcher } from './push-event.js';
import { info } from '@actions/core';
import { ICommitFetcher } from '../types.js';

const MERGE_GROUP_EVENT = 'merge_group';
const PULL_REQUEST_EVENT = 'pull_request';
const PULL_REQUEST_TARGET_EVENT = 'pull_request_target';
const PUSH_EVENT = 'push';
const PULL_REQUEST_EVENTS: string[] = [
  PULL_REQUEST_EVENT,
  PULL_REQUEST_TARGET_EVENT,
];

/**
 * Selects and returns the appropriate commit fetcher based on the event name.
 *
 * @param eventName - The name of the current GitHub event.
 * @returns An instance of {@link ICommitFetcher} or `null`.
 */
export default function getCommitFetcher(
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
