import { describe, test, expect } from '@jest/globals';
import getCommitFetcher from '../../src/fetchers/index.js';
import { MergeGroupCommitFetcher } from '../../src/fetchers/merge-group.js';
import { PullRequestCommitFetcher } from '../../src/fetchers/pull-request.js';
import { PushEventCommitFetcher } from '../../src/fetchers/push-event.js';

describe('getCommitFetcher', () => {
  const testCases = [
    {
      eventName: 'push',
      expectedClass: PushEventCommitFetcher,
      description:
        'should return a new PushEventCommitFetcher instance for push events',
    },
    {
      eventName: 'pull_request',
      expectedClass: PullRequestCommitFetcher,
      description:
        'should return a new PullRequestCommitFetcher instance for pull_request events',
    },
    {
      eventName: 'pull_request_target',
      expectedClass: PullRequestCommitFetcher,
      description:
        'should return a new PullRequestCommitFetcher instance for pull_request_target events',
    },
    {
      eventName: 'merge_group',
      expectedClass: MergeGroupCommitFetcher,
      description:
        'should return a new MergeGroupCommitFetcher instance for merge_group events',
    },
    {
      eventName: 'workflow_dispatch',
      expectedClass: null,
      description:
        'should return null for an unsupported event like workflow_dispatch',
    },
    {
      eventName: undefined,
      expectedClass: null,
      description: 'should return null for an undefined event name',
    },
    {
      eventName: '',
      expectedClass: null,
      description: 'should return null for an empty string event name',
    },
  ];

  test.each(testCases)('$description', ({ eventName, expectedClass }) => {
    const fetcher = getCommitFetcher(eventName);

    if (expectedClass) {
      expect(fetcher).toBeInstanceOf(expectedClass);
    } else {
      expect(fetcher).toBeNull();
    }
  });
});
