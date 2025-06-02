import { Linter } from '../../src/linter/index.js';
import type { LinterResult } from '../../src/types.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import { RuleConfigSeverity } from '@commitlint/types';
import { stringify as stringifyYaml } from 'yaml';

describe('Linter', () => {
  const testDirRoot = pathJoin(
    os.tmpdir(),
    'commitlint_linter_tests_nomock_v8',
  );
  let testDir: string;
  let testCounter = 0;
  const dummyHelpUrl = 'https://example.com/commit-help';
  const projectRootPath = process.cwd();

  beforeAll(() => {
    if (existsSync(testDirRoot)) {
      rmSync(testDirRoot, { recursive: true, force: true });
    }
    mkdirSync(testDirRoot, { recursive: true });
  });

  beforeEach(() => {
    testCounter++;
    const currentTestNameForDir = (
      expect.getState().currentTestName ||
      `test-linter-${Date.now()}-${testCounter}`
    ).replace(/[^\w.-]/g, '_');
    testDir = pathJoin(testDirRoot, currentTestNameForDir);

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createCommitlintrcJson = (
    configContent: object,
    filename: string = '.commitlintrc.json',
  ) => {
    const filePath = pathJoin(testDir, filename);
    writeFileSync(filePath, JSON.stringify(configContent, null, 2));
    return filePath;
  };

  const createCommitlintrcYaml = (
    configContent: object,
    filename: string = '.commitlintrc.yaml',
  ) => {
    const filePath = pathJoin(testDir, filename);
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
      it('should load a self-contained config and lint commits successfully', async () => {
        const configContent = {
          rules: {
            'type-enum': [
              RuleConfigSeverity.Error,
              'always',
              ['feat', 'fix', 'chore', 'test'],
            ],
            'subject-empty': [RuleConfigSeverity.Error, 'never'],
            'type-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
            'header-max-length': [RuleConfigSeverity.Error, 'always', 72],
          },
        };
        const specifiedConfigPath = createConfigFn(configContent, filename);

        const linter = new Linter(
          [
            { hash: 'abc1', message: 'feat: new amazing feature' },
            { hash: 'def2', message: 'fix: a small bug fix' },
          ],
          specifiedConfigPath,
          dummyHelpUrl,
          projectRootPath,
        );
        const result: LinterResult = await linter.lint();

        expect(result.lintedCommits.map((lc) => lc.lintResult)).toEqual([
          {
            valid: true,
            errors: [],
            warnings: [],
            input: 'feat: new amazing feature',
          },
          {
            valid: true,
            errors: [],
            warnings: [],
            input: 'fix: a small bug fix',
          },
        ]);
        expect(result.hasErrors()).toBe(false);
        expect(result.hasOnlyWarnings()).toBe(false);
      });

      it('should identify errors for invalid commits based on a self-contained config', async () => {
        const configContent = {
          rules: {
            'type-enum': [RuleConfigSeverity.Error, 'always', ['feat', 'fix']],
            'subject-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
            'subject-empty': [RuleConfigSeverity.Error, 'never'],
            'header-max-length': [RuleConfigSeverity.Error, 'always', 72],
          },
        };
        const specifiedConfigPath = createConfigFn(configContent, filename);

        const linter = new Linter(
          [
            {
              hash: 'abc1',
              message: 'feat: New Feature With Uppercase Subject',
            },
            { hash: 'def2', message: 'oops: unknown type' },
          ],
          specifiedConfigPath,
          dummyHelpUrl,
          projectRootPath,
        );
        const result: LinterResult = await linter.lint();

        expect(result.lintedCommits.map((lc) => lc.lintResult)).toEqual([
          {
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
        expect(result.hasErrors()).toBe(true);
        expect(result.hasOnlyWarnings()).toBe(false);
      });

      it('should handle a commit with only warnings correctly using a self-contained config', async () => {
        const configContent = {
          rules: {
            'body-max-line-length': [RuleConfigSeverity.Warning, 'always', 10],
            'type-empty': [RuleConfigSeverity.Error, 'never'],
            'subject-empty': [RuleConfigSeverity.Error, 'never'],
          },
        };
        const specifiedConfigPath = createConfigFn(configContent, filename);
        const linter = new Linter(
          [
            {
              hash: 'mno5',
              message:
                'fix: short\n\nThis body line is definitely longer than ten characters and should trigger a warning.',
            },
          ],
          specifiedConfigPath,
          dummyHelpUrl,
          projectRootPath,
        );
        const result: LinterResult = await linter.lint();

        expect(result.lintedCommits.map((lc) => lc.lintResult)).toEqual([
          {
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
        expect(result.hasErrors()).toBe(false);
        expect(result.hasOnlyWarnings()).toBe(true);
      });
    },
  );

  it('should use default config (@commitlint/config-conventional) if specified config is not found', async () => {
    const specifiedConfigPath = pathJoin(
      testDir,
      'nonexistent.commitlintrc.json',
    );
    const linter = new Linter(
      [
        { hash: 'ghi3', message: 'test: a simple commit' },
        { hash: 'jkl4', message: 'Test: an invalid commit by default rules' },
      ],
      specifiedConfigPath,
      dummyHelpUrl,
      projectRootPath,
    );
    const result: LinterResult = await linter.lint();

    expect(result.lintedCommits.map((lc) => lc.lintResult)).toEqual([
      {
        valid: true,
        errors: [],
        warnings: [],
        input: 'test: a simple commit',
      },
      {
        valid: false,
        errors: [
          {
            level: RuleConfigSeverity.Error,
            valid: false,
            name: 'type-case',
            message: 'type must be lower-case',
          },
          {
            level: RuleConfigSeverity.Error,
            valid: false,
            name: 'type-enum',
            message:
              'type must be one of [build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test]',
          },
        ],
        warnings: [],
        input: 'Test: an invalid commit by default rules',
      },
    ]);
    expect(result.hasErrors()).toBe(true);
    expect(result.hasOnlyWarnings()).toBe(false);
  });

  it('should return an empty-like result if no commits are provided', async () => {
    const linter = new Linter([], null, dummyHelpUrl, projectRootPath);
    const result: LinterResult = await linter.lint();

    expect(result.lintedCommits).toEqual([]);
    expect(result.formattedResults).toBe('');
    expect(result.hasErrors()).toBe(false);
    expect(result.hasOnlyWarnings()).toBe(false);
  });
});
