import nock from 'nock';
import { getOctokit } from '@actions/github';
import axios from 'axios';
import { MergeGroupCommitFetcher } from '../../src/fetchers/merge-group.js';
import type {
  ActualMergeGroupPayload,
  CommitToLint,
  MergeGroupEventPayloadSubset,
  OctokitInstance,
} from '../../src/types.js';
import { buildAxiosFetch } from './utils/nockios.js';

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('MergeGroupCommitFetcher', () => {
  let octokit: OctokitInstance;
  const fetcher = new MergeGroupCommitFetcher();

  /**
   * Creates a type-compliant MergeGroupEventPayloadSubset.
   * If headSha and message are provided, a valid merge_group object is included.
   * Otherwise, merge_group will be undefined in the returned subset.
   */
  const createTestMergeGroupPayloadSubset = (
    headSha?: string,
    message?: string,
  ): MergeGroupEventPayloadSubset => {
    if (headSha && message) {
      return {
        merge_group: {
          head_sha: headSha,
          head_commit: {
            id: 'test-commit-id',
            tree_id: 'test-tree-id',
            message: message,
            timestamp: new Date().toISOString(),
            author: { name: 'Test Author', email: 'author@example.com' },
            committer: {
              name: 'Test Committer',
              email: 'committer@example.com',
            },
          },
          id: 1,
          head_ref: 'refs/heads/feature-branch',
          base_ref: 'refs/heads/main',
          base_sha: 'basesha123',
        } as ActualMergeGroupPayload,
      };
    }
    return { merge_group: undefined };
  };

  beforeEach(() => {
    octokit = getOctokit('fake-token', {
      baseUrl: 'https://api.github.com',
      request: {
        fetch: buildAxiosFetch(axios.create({})),
      },
    });
  });

  it('should fetch the head commit from a valid merge_group payload subset', async () => {
    const eventPayloadSubset = createTestMergeGroupPayloadSubset(
      'mergegroupheadsha123',
      'feat: Merge feature branch into main via merge queue',
    );

    const expectedCommits: CommitToLint[] = [
      {
        hash: 'mergegroupheadsha123',
        message: 'feat: Merge feature branch into main via merge queue',
      },
    ];

    const commits = await fetcher.fetchCommits(
      octokit,
      'test-owner',
      'test-repo',
      eventPayloadSubset,
    );
    expect(commits).toEqual(expectedCommits);
    expect(nock.pendingMocks().length).toBe(0);
  });

  it('should return an empty array if merge_group key is effectively missing in payload subset', async () => {
    const eventPayloadSubset: MergeGroupEventPayloadSubset = {};

    const commits = await fetcher.fetchCommits(
      octokit,
      'test-owner',
      'test-repo',
      eventPayloadSubset,
    );
    expect(commits).toEqual([]);
    expect(nock.pendingMocks().length).toBe(0);
  });

  it('should return an empty array if merge_group property is undefined in payload subset', async () => {
    const eventPayloadSubset: MergeGroupEventPayloadSubset =
      createTestMergeGroupPayloadSubset(undefined, undefined);

    const commits = await fetcher.fetchCommits(
      octokit,
      'test-owner',
      'test-repo',
      eventPayloadSubset,
    );
    expect(commits).toEqual([]);
    expect(nock.pendingMocks().length).toBe(0);
  });
});
