import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import nock from 'nock';
import { jest } from '@jest/globals';
// noinspection ES6PreferShortImport
import { runx } from '../src/index.js';

const GITHUB_API_URL_FOR_TESTS = 'https://api.github.com';

describe('Commitlint Action Integration Tests (No Mocks/Spies)', () => {
  const testDirRoot = pathJoin(
    os.tmpdir(),
    'commitlint_action_integration_tests_v3',
  );
  let testDir: string;
  // eslint-disable-next-line no-undef
  let originalEnv: NodeJS.ProcessEnv;

  const owner = 'test-owner';
  const repo = 'test-repo';

  const setupTestEnvironment = (
    configFileName: string,
    configFileContent: object | string,
    createPackageJson: boolean = false,
  ) => {
    writeFileSync(
      pathJoin(testDir, configFileName),
      typeof configFileContent === 'string'
        ? configFileContent
        : JSON.stringify(configFileContent, null, 2),
    );
    if (createPackageJson) {
      writeFileSync(
        pathJoin(testDir, 'package.json'),
        JSON.stringify({
          name: `test-project-integration-${Date.now()}`,
          version: '1.0.0',
          private: true,
        }),
      );
    }
  };

  const setActionInputs = (inputs: Record<string, string | undefined>) => {
    for (const key in inputs) {
      const upperKey = key.toUpperCase().replace(/-/g, '_');
      if (inputs[key] !== undefined) {
        process.env[`INPUT_${upperKey}`] = inputs[key];
      } else {
        delete process.env[`INPUT_${upperKey}`];
      }
    }
  };

  const setupGithubContextAndEnv = (
    eventName: string,
    payload: object,
    ref: string = 'refs/heads/main',
    sha: string = 'test-sha',
  ) => {
    process.env.GITHUB_EVENT_NAME = eventName;
    process.env.GITHUB_EVENT_PATH = pathJoin(testDir, 'event.json');
    writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify(payload));
    process.env.GITHUB_REPOSITORY = `${owner}/${repo}`;
    process.env.GITHUB_REF = ref;
    process.env.GITHUB_SHA = sha;
    process.env.GITHUB_WORKSPACE = testDir;
    process.env.GITHUB_API_URL = GITHUB_API_URL_FOR_TESTS;
  };

  beforeAll(() => {
    nock.disableNetConnect();
    if (existsSync(testDirRoot)) {
      rmSync(testDirRoot, { recursive: true, force: true });
    }
    mkdirSync(testDirRoot, { recursive: true });
  });

  beforeEach(() => {
    const uniqueDirName = `integration-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    testDir = pathJoin(testDirRoot, uniqueDirName);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    nock.cleanAll();
    process.env = originalEnv;
    jest.resetModules();

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    nock.enableNetConnect();
    if (existsSync(testDirRoot)) {
      rmSync(testDirRoot, { recursive: true, force: true });
    }
  });

  const testMatrix = [
    {
      description: 'Declarative config, valid commit, failOnErrors=true',
      configFileName: '.commitlintrc.json',
      configFileContent: { rules: { 'type-enum': [2, 'always', ['feat']] } },
      createPkgJson: true,
      inputs: {
        token: 'fake-token',
        configFile: '.commitlintrc.json',
        'fail-on-errors': 'true',
        'fail-on-warnings': 'false',
      },
      event: {
        name: 'push',
        payload: { before: 'before123', after: 'after456', commits: [] },
      },
      apiCommits: [{ hash: 'valid1', message: 'feat: a valid commit' }],
      expectRunToThrow: false,
    },
    {
      description: 'Declarative config, invalid commit, failOnErrors=true',
      configFileName: '.commitlintrc.json',
      configFileContent: { rules: { 'type-enum': [2, 'always', ['fix']] } },
      createPkgJson: true,
      inputs: {
        token: 'fake-token',
        configFile: '.commitlintrc.json',
        'fail-on-errors': 'true',
        'fail-on-warnings': 'false',
      },
      event: {
        name: 'push',
        payload: { before: 'beforeErr', after: 'afterErr', commits: [] },
      },
      apiCommits: [{ hash: 'err1', message: 'feat: an invalid type' }],
      expectRunToThrow: true,
    },
    {
      description: 'Imperative config, valid commit, failOnErrors=true',
      configFileName: 'commitlint.config.js',
      configFileContent:
        "module.exports = { rules: { 'type-enum': [2, 'always', ['feat']] } };",
      createPkgJson: true,
      inputs: {
        token: 'fake-token',
        configFile: 'commitlint.config.js',
        'fail-on-errors': 'true',
        'fail-on-warnings': 'false',
      },
      event: {
        name: 'push',
        payload: {
          before: 'beforeImpValid',
          after: 'afterImpValid',
          commits: [],
        },
      },
      apiCommits: [
        { hash: 'impValid1', message: 'feat: a valid imperative commit' },
      ],
      expectRunToThrow: false,
    },
    {
      description: 'Imperative config, invalid commit, failOnErrors=false',
      configFileName: 'commitlint.config.js',
      configFileContent:
        "module.exports = { rules: { 'subject-empty': [2, 'never'] } };",
      createPkgJson: true,
      inputs: {
        token: 'fake-token',
        configFile: 'commitlint.config.js',
        'fail-on-errors': 'false',
        'fail-on-warnings': 'false',
      },
      event: {
        name: 'push',
        payload: {
          before: 'beforeImpErrNoFail',
          after: 'afterImpErrNoFail',
          commits: [],
        },
      },
      apiCommits: [{ hash: 'impErr2', message: 'fix:' }],
      expectRunToThrow: false,
    },
  ];

  test.each(testMatrix)(
    '$description',
    async ({
      configFileName,
      configFileContent,
      createPkgJson,
      inputs,
      event,
      apiCommits,
      expectRunToThrow,
    }) => {
      setupTestEnvironment(configFileName, configFileContent, createPkgJson);
      setActionInputs(inputs);
      setupGithubContextAndEnv(
        event.name,
        event.payload as object,
        owner,
        repo,
      );

      if (
        event.name === 'push' &&
        apiCommits.length > 0 &&
        (event.payload as { before?: string }).before &&
        (event.payload as { after?: string }).after
      ) {
        nock(GITHUB_API_URL_FOR_TESTS)
          .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
          .get(
            `/repos/${owner}/${repo}/compare/${(event.payload as { before: string }).before}...${(event.payload as { after: string }).after}`,
          )
          .query(true)
          .reply(200, {
            commits: apiCommits.map((c) => ({
              sha: c.hash,
              commit: { message: c.message },
            })),
          });
      }

      if (expectRunToThrow) {
        try {
          await runx();
        } catch (e: unknown) {
          expect((e as Error).message).toContain('Commit linter failed');
        }
      } else {
        await expect(runx()).resolves.not.toThrow();
      }
    },
    90000,
  );
});
