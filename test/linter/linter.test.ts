// noinspection ES6PreferShortImport
import { Linter } from '../../src/linter/index.js';
import fs, { existsSync, rmSync, writeFileSync } from 'node:fs';
import path, { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import { RuleConfigSeverity } from '@commitlint/types';
import { stringify as stringifyYaml } from 'yaml';
import { Results } from '../../src/linter/result.js';

describe('Linter', () => {
  let testDir: string;
  const projectRootPath = process.cwd();

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
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
            'type-enum': [RuleConfigSeverity.Error, 'always', ['feat', 'fix']],
            'subject-empty': [RuleConfigSeverity.Error, 'never'],
          },
        };
        const specifiedConfigPath = createConfigFn(configContent, filename);

        const linter = new Linter(
          [
            { hash: 'abc1', message: 'feat: new amazing feature' },
            { hash: 'def2', message: 'fix: a small bug fix' },
          ],
          specifiedConfigPath,
          'https://example.com/commit-help',
          projectRootPath,
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
      });

      it('should identify errors for invalid commits based on a self-contained config', async () => {
        const configContent = {
          rules: {
            'type-enum': [RuleConfigSeverity.Error, 'always', ['feat', 'fix']],
            'subject-case': [RuleConfigSeverity.Error, 'always', 'lower-case'],
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
          'https://example.com/commit-help',
          projectRootPath,
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
      });

      it('should handle a commit with only warnings correctly using a self-contained config', async () => {
        const configContent = {
          rules: {
            'body-max-line-length': [RuleConfigSeverity.Warning, 'always', 10],
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
          'https://example.com/commit-help',
          projectRootPath,
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
      });
    },
  );

  it('should throw an error if a specified config file is not found', async () => {
    const specifiedConfigPath = pathJoin(
      testDir,
      'nonexistent.commitlintrc.json',
    );
    const linter = new Linter([], specifiedConfigPath, '', projectRootPath);

    await expect(linter.lint()).rejects.toThrow(
      `Specified configuration file was not found at: ${specifiedConfigPath}`,
    );
  });

  it('should return a valid Results object for an empty list of commits', async () => {
    // Create a valid config file so the linter doesn't throw an error for that.
    const configPath = createCommitlintrcJson({ rules: {} });
    const linter = new Linter(
      [],
      configPath,
      'https://example.com/commit-help',
      projectRootPath,
    );
    const result = await linter.lint();

    expect(result).toBeInstanceOf(Results);
    expect(result.items).toEqual([]);
    expect(result.checkedCount).toBe(0);
    expect(result.hasErrors).toBe(false);
    expect(result.hasOnlyWarnings).toBe(false);
  });
});
