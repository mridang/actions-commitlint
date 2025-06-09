// noinspection ES6PreferShortImport
import { Linter } from '../../src/linter/index.js';
import { writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { RuleConfigSeverity } from '@commitlint/types';
import { stringify as stringifyYaml } from 'yaml';
import { Results } from '../../src/linter/result.js';
import { withTempDir } from '../helpers/with-temp-dir.js';

describe('Linter', () => {
  const comprehensiveConfig = {
    rules: {
      'type-enum': [RuleConfigSeverity.Error, 'always', ['feat', 'fix']],
      'subject-empty': [RuleConfigSeverity.Error, 'never'],
      'subject-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
      'body-max-line-length': [RuleConfigSeverity.Warning, 'always', 10],
    },
  };

  const createCommitlintrcJson = (
    dir: string,
    configContent: object,
    filename: string,
  ) => {
    const filePath = pathJoin(dir, filename);
    writeFileSync(filePath, JSON.stringify(configContent, null, 2));
    return filePath;
  };

  const createCommitlintrcYaml = (
    dir: string,
    configContent: object,
    filename: string = '.commitlintrc.yaml',
  ) => {
    const filePath = pathJoin(dir, filename);
    writeFileSync(filePath, stringifyYaml(configContent));
    return filePath;
  };

  const configTestCases = [
    {
      fileType: 'JSON',
      createConfigFn: createCommitlintrcJson,
      filename: '.commitlintrc.json',
    },
    {
      fileType: 'YAML',
      createConfigFn: createCommitlintrcYaml,
      filename: '.commitlintrc.yaml',
    },
    {
      fileType: 'JSON (no ext)',
      createConfigFn: createCommitlintrcJson,
      filename: '.commitlintrc',
    },
  ];

  describe.each(configTestCases)(
    'with $fileType config file',
    ({ createConfigFn, filename }) => {
      it(
        'should load the config and lint valid commits successfully',
        withTempDir(async ({ tmp: projectDir }) => {
          const specifiedConfigPath = createConfigFn(
            projectDir,
            comprehensiveConfig,
            filename,
          );
          const linter = new Linter(
            [
              { hash: 'abc1', message: 'feat: new amazing feature' },
              { hash: 'def2', message: 'fix: a small bug fix' },
            ],
            specifiedConfigPath,
            'https://example.com/commit-help',
            projectDir,
          );
          const result = await linter.lint();

          expect(result.items).toEqual([
            {
              hash: 'abc1',
              valid: true,
              errors: [],
              warnings: [],
              input: 'feat: new amazing feature',
            },
            {
              hash: 'def2',
              valid: true,
              errors: [],
              warnings: [],
              input: 'fix: a small bug fix',
            },
          ]);
          expect(result.hasErrors).toBe(false);
          expect(result.hasOnlyWarnings).toBe(false);
        }),
      );

      it(
        'should identify errors for invalid commits',
        withTempDir(async ({ tmp: projectDir }) => {
          const specifiedConfigPath = createConfigFn(
            projectDir,
            comprehensiveConfig,
            filename,
          );
          const linter = new Linter(
            [
              {
                hash: 'abc1',
                message: 'feat: New Feature With Uppercase Subject',
              },
              { hash: 'def2', message: 'oops: unknown type' },
            ],
            specifiedConfigPath,
            'https://example.com/commit-help',
            projectDir,
          );
          const result = await linter.lint();

          expect(result.items).toEqual([
            {
              hash: 'abc1',
              valid: false,
              errors: [
                {
                  level: RuleConfigSeverity.Error,
                  valid: false,
                  name: 'subject-case',
                  message: 'subject must be lower-case',
                },
              ],
              warnings: [],
              input: 'feat: New Feature With Uppercase Subject',
            },
            {
              hash: 'def2',
              valid: false,
              errors: [
                {
                  level: RuleConfigSeverity.Error,
                  valid: false,
                  name: 'type-enum',
                  message: 'type must be one of [feat, fix]',
                },
              ],
              warnings: [],
              input: 'oops: unknown type',
            },
          ]);
          expect(result.hasErrors).toBe(true);
          expect(result.hasOnlyWarnings).toBe(false);
        }),
      );

      it(
        'should handle a commit with only warnings correctly',
        withTempDir(async ({ tmp: projectDir }) => {
          const specifiedConfigPath = createConfigFn(
            projectDir,
            comprehensiveConfig,
            filename,
          );
          const linter = new Linter(
            [
              {
                hash: 'mno5',
                message:
                  'fix: short\n\nThis body line is definitely longer than ten characters and should trigger a warning.',
              },
            ],
            specifiedConfigPath,
            'https://example.com/commit-help',
            projectDir,
          );
          const result = await linter.lint();

          expect(result.items).toEqual([
            {
              hash: 'mno5',
              valid: true,
              errors: [],
              warnings: [
                {
                  level: RuleConfigSeverity.Warning,
                  valid: false,
                  name: 'body-max-line-length',
                  message: "body's lines must not be longer than 10 characters",
                },
              ],
              input:
                'fix: short\n\nThis body line is definitely longer than ten characters and should trigger a warning.',
            },
          ]);
          expect(result.hasErrors).toBe(false);
          expect(result.hasOnlyWarnings).toBe(true);
        }),
      );
    },
  );

  it(
    'should throw an error if a specified config file is not found',
    withTempDir(async ({ tmp: projectDir }) => {
      const specifiedConfigPath = pathJoin(
        projectDir,
        'nonexistent.commitlintrc.json',
      );
      const linter = new Linter([], specifiedConfigPath, '', projectDir);

      await expect(linter.lint()).rejects.toThrow(
        `Specified configuration file was not found at: ${specifiedConfigPath}`,
      );
    }),
  );

  it(
    'should return a valid Results object for an empty list of commits',
    withTempDir(async ({ tmp: projectDir }) => {
      const configPath = createCommitlintrcJson(
        projectDir,
        comprehensiveConfig,
        '.commitlintrc.json',
      );
      const linter = new Linter(
        [],
        configPath,
        'https://example.com/commit-help',
        projectDir,
      );
      const result = await linter.lint();

      expect(result).toBeInstanceOf(Results);
      expect(result.items).toEqual([]);
      expect(result.checkedCount).toBe(0);
      expect(result.hasErrors).toBe(false);
      expect(result.hasOnlyWarnings).toBe(false);
    }),
  );
});
