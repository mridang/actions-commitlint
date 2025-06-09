import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// noinspection ES6PreferShortImport
import { run } from '../src/index.js';
import type { CommitToLint, ICommitFetcher } from '../src/types.js';
import { withTempDir } from './helpers/with-temp-dir.js';
import { withEnvVars } from './helpers/with-env-vars.js';
import { tmpdir } from 'node:os';

/**
 * A test helper to execute the main action script (`run`) within a
 * controlled environment. It simulates the GitHub Actions runtime by
 * preparing environment variables and mocking necessary features like
 * Job Summaries.
 *
 * @param inputs A record of key-value pairs representing the action's
 * inputs, equivalent to the `with` block in a workflow YAML file.
 * @param extraEnv A record of additional environment variables to set
 * during the action's execution, used to simulate workflow context
 * like `GITHUB_REF` or `GITHUB_EVENT_NAME`.
 * @param eventPayload
 * @param commitFetcherFactory
 * @returns A promise that resolves with the action's result or void.
 */
async function runAction(
  inputs: Record<string, string>,
  extraEnv: Record<string, string | undefined> = {},
  eventPayload: unknown,
  commitFetcherFactory: (event: string) => ICommitFetcher | null,
): Promise<string | void> {
  const summaryDir = mkdtempSync(join(tmpdir(), 'test-'));
  const summaryPath = join(summaryDir, 'summary.md');
  writeFileSync(summaryPath, '');

  const eventDir = mkdtempSync(join(tmpdir(), 'test-'));
  const eventPath = join(eventDir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(eventPayload));

  const wrapped = withEnvVars(
    {
      ...extraEnv,
      ...Object.fromEntries(
        Object.entries(inputs).map(([key, value]) => [
          `INPUT_${key.replace(/ /g, '_').toUpperCase()}`,
          value,
        ]),
      ),
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_EVENT_PATH: eventPath,
    },
    () => run(undefined, commitFetcherFactory),
  );
  return await wrapped();
}

describe('Commitlint Action Integration Tests', () => {
  const testMatrix = [
    {
      description: 'Declarative config, valid commit, should pass',
      configFileName: '.commitlintrc.json',
      configFileContent: {
        extends: ['@commitlint/config-conventional'],
        rules: { 'type-enum': [2, 'always', ['feat']] },
      },
      createPkgJson: false,
      inputs: { 'fail-on-errors': 'true' },
      event: { name: 'push', payload: {} },
      commits: [{ sha: 'valid1', message: 'feat: a valid commit' }],
      expectToThrow: false,
    },
    {
      description: 'Declarative config, invalid commit, should fail',
      configFileName: '.commitlintrc.json',
      configFileContent: {
        extends: ['@commitlint/config-conventional'],
        plugins: ['@mridang/commitlint-plugin-conditionals'],
        rules: { 'type-enum': [2, 'always', ['fix']] },
      },
      createPkgJson: false,
      inputs: { 'fail-on-errors': 'true' },
      event: { name: 'push', payload: {} },
      commits: [{ sha: 'err1', message: 'feat: an invalid type' }],
      expectToThrow: true,
      expectedErrorMessage: 'Found 1 commit messages with errors',
    },
    {
      description: 'Imperative config, valid commit, should pass',
      configFileName: 'commitlint.config.js',
      configFileContent:
        "module.exports = { rules: { 'type-enum': [2, 'always', ['feat']] } };",
      createPkgJson: true,
      inputs: { 'fail-on-errors': 'true' },
      event: { name: 'push', payload: {} },
      commits: [
        { sha: 'impValid1', message: 'feat: a valid imperative commit' },
      ],
      expectToThrow: false,
    },
    {
      description:
        'Imperative config, invalid commit but failOnErrors=false, should pass',
      configFileName: 'commitlint.config.js',
      configFileContent:
        "module.exports = { rules: { 'subject-empty': [2, 'never'] } };",
      createPkgJson: true,
      inputs: { 'fail-on-errors': 'false' },
      event: { name: 'push', payload: {} },
      commits: [{ sha: 'impErr2', message: 'fix:' }],
      expectToThrow: false,
    },
  ];

  test.each(testMatrix)('$description', (params) => {
    return withTempDir(async ({ tmp }) => {
      writeFileSync(
        join(tmp, params.configFileName),
        typeof params.configFileContent === 'string'
          ? params.configFileContent
          : JSON.stringify(params.configFileContent, null, 2),
      );

      if (params.createPkgJson) {
        writeFileSync(
          join(tmp, 'package.json'),
          JSON.stringify({ name: 'test-project', private: true }),
        );
      }

      const action = () =>
        runAction(
          {
            'github-token': 'fake-token',
            ...params.inputs,
            'working-directory': tmp,
          },
          {
            GITHUB_WORKSPACE: tmp,
            GITHUB_EVENT_NAME: params.event.name,
            GITHUB_REPOSITORY: 'test-owner/test-repo',
          },
          params.event.payload,
          (): ICommitFetcher | null => {
            return {
              fetchCommits: async (): Promise<CommitToLint[]> => {
                const transformedCommits = params.commits.map((commit) => ({
                  hash: commit.sha,
                  message: commit.message,
                }));

                return Promise.resolve(transformedCommits);
              },
            };
          },
        );

      if (params.expectToThrow) {
        await expect(action()).rejects.toThrow(params.expectedErrorMessage);
      } else {
        await expect(action()).resolves.not.toThrow();
      }
    })();
  });
});
