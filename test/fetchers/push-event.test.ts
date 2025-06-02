import nock from 'nock';
import { getOctokit } from '@actions/github';
import axios from 'axios';
import { PushEventCommitFetcher } from '../../src/fetchers/push-event.js';
import type {
  CommitToLint,
  OctokitInstance,
  ActualPushEventCommit,
  PushEventPayloadSubset,
} from '../../src/types.js';
import { buildAxiosFetch } from './utils/nockios.js';

const GITHUB_API_URL_FOR_TESTS = 'https://api.github.com';
const FIRST_COMMIT_SHA_PUSH = '0000000000000000000000000000000000000000';

const createMinimalActualPushEventCommit = (
  id: string,
  message: string,
): ActualPushEventCommit => ({
  id,
  tree_id: `tree-${id}`,
  distinct: true,
  message,
  timestamp: new Date().toISOString(),
  url: `https://github.com/test-owner/test-repo/commit/${id}`,
  author: {
    name: 'Test Author',
    email: 'author@example.com',
    username: 'testauthor',
  },
  committer: {
    name: 'Test Committer',
    email: 'committer@example.com',
    username: 'testcommitter',
  },
  added: [],
  removed: [],
  modified: [],
});

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('PushEventCommitFetcher', () => {
  const owner = 'test-owner';
  const repo = 'test-repo';
  let octokit: OctokitInstance;
  const fetcher = new PushEventCommitFetcher();

  beforeEach(() => {
    octokit = getOctokit('fake-token', {
      baseUrl: GITHUB_API_URL_FOR_TESTS,
      request: {
        fetch: buildAxiosFetch(axios.create({})),
      },
    });
  });

  it('should fetch commits from payload for an initial push (expecting API call if fetcher logic changes)', async () => {
    const afterShaForNewBranch = 'afterShaNewBranch';
    const eventPayloadSubset: PushEventPayloadSubset = {
      before: FIRST_COMMIT_SHA_PUSH,
      after: afterShaForNewBranch,
      commits: [
        createMinimalActualPushEventCommit(
          'commit1',
          'Initial commit on new branch',
        ),
        createMinimalActualPushEventCommit(
          'commit2',
          'Second commit on new branch',
        ),
      ],
    };

    const apiMockResponse = {
      commits: [
        { sha: 'commit1', commit: { message: 'Initial commit on new branch' } },
        { sha: 'commit2', commit: { message: 'Second commit on new branch' } },
      ],
    };

    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(
        `/repos/${owner}/${repo}/compare/${FIRST_COMMIT_SHA_PUSH}...${afterShaForNewBranch}`,
      )
      .query(true)
      .reply(200, apiMockResponse);

    const expectedCommits: CommitToLint[] = [
      { hash: 'commit1', message: 'Initial commit on new branch' },
      { hash: 'commit2', message: 'Second commit on new branch' },
    ];

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      eventPayloadSubset,
    );
    expect(commits).toEqual(expectedCommits);
    expect(nock.isDone()).toBe(true);
  });

  it('should fetch commits using compareCommits for a subsequent push', async () => {
    const beforeSha = 'beforeSha123';
    const afterSha = 'afterSha456';
    const eventPayloadSubset: PushEventPayloadSubset = {
      before: beforeSha,
      after: afterSha,
      commits: [],
    };

    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/compare/${beforeSha}...${afterSha}`)
      .query(true)
      .reply(200, {
        commits: [
          { sha: 'compareCommit1', commit: { message: 'Update A' } },
          { sha: 'compareCommit2', commit: { message: 'Fix B' } },
        ],
      });

    const expectedCommits: CommitToLint[] = [
      { hash: 'compareCommit1', message: 'Update A' },
      { hash: 'compareCommit2', message: 'Fix B' },
    ];

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      eventPayloadSubset,
    );
    expect(commits).toEqual(expectedCommits);
    expect(nock.isDone()).toBe(true);
  });

  it('should return an empty array if compareCommits returns no commits', async () => {
    const beforeSha = 'beforeSha789';
    const afterSha = 'afterSha101';
    const eventPayloadSubset: PushEventPayloadSubset = {
      before: beforeSha,
      after: afterSha,
      commits: [],
    };

    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/compare/${beforeSha}...${afterSha}`)
      .query(true)
      .reply(200, { commits: [] });

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      eventPayloadSubset,
    );
    expect(commits).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  it('should throw error if compareCommits fails', async () => {
    const beforeSha = 'beforeShaFail';
    const afterSha = 'afterShaFail';
    const eventPayloadSubset: PushEventPayloadSubset = {
      before: beforeSha,
      after: afterSha,
      commits: [
        createMinimalActualPushEventCommit(
          'payloadFallback1',
          'Fallback commit 1',
        ),
      ],
    };

    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/compare/${beforeSha}...${afterSha}`)
      .query(true)
      .reply(500, { message: 'Server Error' });

    await expect(
      fetcher.fetchCommits(octokit, owner, repo, eventPayloadSubset),
    ).rejects.toThrowError(/Failed to compare commits via API/);
    expect(nock.isDone()).toBe(true);
  });

  it('should use payload commits if before and after SHAs are identical', async () => {
    const sameSha = 'sameSha123';
    const eventPayloadSubset: PushEventPayloadSubset = {
      before: sameSha,
      after: sameSha,
      commits: [
        createMinimalActualPushEventCommit(
          'forcePushCommit',
          'Force pushed commit',
        ),
      ],
    };
    const expectedCommits: CommitToLint[] = [
      { hash: 'forcePushCommit', message: 'Force pushed commit' },
    ];

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      eventPayloadSubset,
    );
    expect(commits).toEqual(expectedCommits);
    expect(nock.pendingMocks().length).toBe(0);
  });

  it('should return empty array if API conditions not met and no payload commits', async () => {
    const identicalShaPayloadSubset: PushEventPayloadSubset = {
      before: 'identicalSha',
      after: 'identicalSha',
      commits: [],
    };

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      identicalShaPayloadSubset,
    );
    expect(commits).toEqual([]);
    expect(nock.pendingMocks().length).toBe(0);
  });
});
