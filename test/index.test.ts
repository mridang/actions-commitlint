import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import nock from 'nock';
import { jest } from '@jest/globals';
// noinspection ES6PreferShortImport
import { run } from '../src/index.js';

describe('Commitlint Action Integration Tests (No Mocks/Spies)', () => {
  const testDirRoot = pathJoin(
    os.tmpdir(),
    'commitlint_action_integration_tests_v3',
  );
  let testDir: string;
  // eslint-disable-next-line no-undef
  let originalEnv: NodeJS.ProcessEnv;

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
      const upperKey = key.toUpperCase();
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
    process.env.GITHUB_REPOSITORY = `test-owner/test-repo`;
    process.env.GITHUB_REF = ref;
    process.env.GITHUB_SHA = sha;
    process.env.GITHUB_WORKSPACE = testDir;
    process.env.GITHUB_API_URL = 'https://api.github.com';
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
        'config-file': '.commitlintrc.json',
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
        'config-file': '.commitlintrc.json',
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
        'config-file': 'commitlint.config.js',
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
        'config-file': 'commitlint.config.js',
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
        'test-owner',
        'test-repo',
      );

      if (
        event.name === 'push' &&
        apiCommits.length > 0 &&
        (event.payload as { before?: string }).before &&
        (event.payload as { after?: string }).after
      ) {
        nock('https://api.github.com')
          .matchHeader('accept', /application\/vnd\.github\.v3\+json/i)
          .get(
            `/repos/test-owner/test-repo/compare/${(event.payload as { before: string }).before}...${
              (
                event.payload as {
                  after: string;
                }
              ).after
            }`,
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
          await run();
        } catch (e: unknown) {
          expect((e as Error).message).toContain('Commit linter failed');
        }
      } else {
        await expect(run()).resolves.not.toThrow();
      }
    },
    90000,
  );
});
