import nock from 'nock';
import { getOctokit } from '@actions/github';
import axios from 'axios';
import { PullRequestCommitFetcher } from '../../src/fetchers/pull-request.js';
import type {
  CommitToLint,
  OctokitInstance,
  PullRequestEventPayloadSubset,
} from '../../src/types.js';
import { buildAxiosFetch } from './utils/nockios.js';

const GITHUB_API_URL_FOR_TESTS = 'https://api.github.com';

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('PullRequestCommitFetcher', () => {
  const owner = 'test-owner';
  const repo = 'test-repo';
  const pullNumber = 123;
  let octokit: OctokitInstance;
  const fetcher = new PullRequestCommitFetcher();

  beforeEach(() => {
    octokit = getOctokit('fake-token', {
      baseUrl: GITHUB_API_URL_FOR_TESTS,
      request: {
        fetch: buildAxiosFetch(axios.create({})),
      },
    });
  });

  it('should fetch and map commits correctly when API returns data', async () => {
    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits`)
      .query(true)
      .reply(200, [
        {
          sha: 'sha123',
          commit: { message: 'feat: Implement feature X' },
          html_url: 'url1',
        },
        {
          sha: 'sha456',
          commit: { message: 'fix: Correct bug Y' },
          html_url: 'url2',
        },
      ]);

    const expectedCommits: CommitToLint[] = [
      { hash: 'sha123', message: 'feat: Implement feature X' },
      { hash: 'sha456', message: 'fix: Correct bug Y' },
    ];

    const dummyPayloadSubset: PullRequestEventPayloadSubset = {
      action: 'opened',
      number: pullNumber,
    };

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      dummyPayloadSubset,
      undefined,
      pullNumber,
    );

    expect(commits).toEqual(expectedCommits);
    expect(nock.isDone()).toBe(true);
  });

  it('should return an empty array if the API returns no commits', async () => {
    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits`)
      .query(true)
      .reply(200, []);

    const dummyPayloadSubset: PullRequestEventPayloadSubset = {
      action: 'opened',
      number: pullNumber,
    };

    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      dummyPayloadSubset,
      undefined,
      pullNumber,
    );

    expect(commits).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  it('should return an empty array if pullNumber is not provided', async () => {
    const dummyPayloadSubset: PullRequestEventPayloadSubset = {
      action: 'opened',
      number: 0,
    };
    const commits = await fetcher.fetchCommits(
      octokit,
      owner,
      repo,
      dummyPayloadSubset,
      undefined,
      undefined,
    );

    expect(commits).toEqual([]);
    expect(nock.pendingMocks().length).toBe(0);
  });

  it('should throw an error if the GitHub API call fails', async () => {
    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits`)
      .query(true)
      .reply(500, { message: 'Internal Server Error' });

    const dummyPayloadSubset: PullRequestEventPayloadSubset = {
      action: 'opened',
      number: pullNumber,
    };

    await expect(
      fetcher.fetchCommits(
        octokit,
        owner,
        repo,
        dummyPayloadSubset,
        undefined,
        pullNumber,
      ),
    ).rejects.toThrow();

    expect(nock.isDone()).toBe(true);
  });

  it('should throw an error if API returns non-array data for commits', async () => {
    nock(GITHUB_API_URL_FOR_TESTS)
      .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
      .get(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits`)
      .query(true)
      .reply(200, { not_an_array: 'unexpected_data' });

    const dummyPayloadSubset: PullRequestEventPayloadSubset = {
      action: 'opened',
      number: pullNumber,
    };

    await expect(
      fetcher.fetchCommits(
        octokit,
        owner,
        repo,
        dummyPayloadSubset,
        undefined,
        pullNumber,
      ),
    ).rejects.toThrow();

    expect(nock.isDone()).toBe(true);
  });
});
