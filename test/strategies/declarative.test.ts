import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { DeclarativeStrategy } from '../../src/strategies/declarative.js';
import type { RawDeclarativeConfig } from '../../src/types.js';

describe('DeclarativeStrategy', () => {
  const testDirRoot = pathJoin(
    os.tmpdir(),
    'commitlint_action_tests_declarative',
  );
  let testDir: string;
  let testCounter = 0;

  const strategy = new DeclarativeStrategy();

  beforeEach(() => {
    testCounter++;
    const safeTestName = (
      expect.getState().currentTestName || `test-${Date.now()}-${testCounter}`
    ).replace(/[^\w.-]/g, '_');
    testDir = pathJoin(testDirRoot, safeTestName);

    if (existsSync(testDirRoot) && testCounter === 1) {
      rmSync(testDirRoot, { recursive: true, force: true });
    }
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

  const createCommitlintrcJson = (config: RawDeclarativeConfig) => {
    const filePath = pathJoin(testDir, '.commitlintrc.json');
    writeFileSync(filePath, JSON.stringify(config, null, 2));
    return filePath;
  };

  const createCommitlintrcYamlFromObject = (config: RawDeclarativeConfig) => {
    const filePath = pathJoin(testDir, '.commitlintrc.yaml');
    writeFileSync(filePath, stringifyYaml(config));
    return filePath;
  };

  const createPackageJson = (content: object) => {
    const filePath = pathJoin(testDir, 'package.json');
    writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  };

  const readPackageJson = () => {
    const filePath = pathJoin(testDir, 'package.json');
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  };

  it('should process .commitlintrc.json, create package.json, and add real dependencies', async () => {
    const configFilePath = createCommitlintrcJson({
      extends: ['@commitlint/config-conventional'],
      plugins: ['@commitlint/config-angular'],
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();

    expect(readPackageJson()?.dependencies).toEqual({
      '@commitlint/config-conventional': '*',
      '@commitlint/config-angular': '*',
    });
  });

  it('should handle .commitlintrc.json with no external dependencies', async () => {
    const configFilePath = createCommitlintrcJson({
      rules: { 'body-leading-blank': [2, 'always'] },
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();

    expect(readPackageJson()).toBeNull();
  });

  it('should process .commitlintrc.yaml generated from object and install real dependencies', async () => {
    const yamlConfigObject: RawDeclarativeConfig = {
      extends: ['@commitlint/config-conventional'],
      plugins: ['@commitlint/config-angular'],
    };
    const configFilePath = createCommitlintrcYamlFromObject(yamlConfigObject);

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();

    expect(readPackageJson()?.dependencies).toEqual({
      '@commitlint/config-conventional': '*',
      '@commitlint/config-angular': '*',
    });
  });

  it('should merge real dependencies into an existing package.json', async () => {
    createPackageJson({
      name: 'existing-project',
      version: '1.0.0',
      description: 'An existing project',
      private: true,
      dependencies: { 'is-positive': '3.1.0' },
    });
    const configFilePath = createCommitlintrcJson({
      extends: ['@commitlint/config-conventional'],
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();

    expect(readPackageJson()).toEqual({
      name: 'existing-project',
      version: '1.0.0',
      description: 'An existing project',
      private: true,
      dependencies: {
        'is-positive': '3.1.0',
        '@commitlint/config-conventional': '*',
      },
    });
  });

  it('should throw an error if npm install fails due to bad dependency', async () => {
    const configFilePath = createCommitlintrcJson({
      extends: ['a-non-existent-package-that-will-cause-failure-12345'],
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).rejects.toThrowError(/npm install failed/);
    try {
      await strategy.execute(configFilePath, testDir);
    } catch (error: unknown) {
      expect((error as Error).message).toContain('E404');
      expect((error as Error).message).toContain(
        'a-non-existent-package-that-will-cause-failure-12345',
      );
    }
  });

  it('should throw an error for a malformed JSON config file', async () => {
    const malformedJsonPath = pathJoin(testDir, '.commitlintrc.json');
    writeFileSync(
      malformedJsonPath,
      '{ "extends": ["@scope/config-good"], "invalidJson": ',
    );

    await expect(
      strategy.execute(malformedJsonPath, testDir),
    ).rejects.toThrowError(
      /Failed to parse declarative config file .*Unexpected end of JSON input/,
    );
  });

  it('should throw an error for a malformed YAML config file', async () => {
    const malformedYamlPath = pathJoin(testDir, '.commitlintrc.yaml');
    writeFileSync(
      malformedYamlPath,
      'extends: \n  - item1\n  item2: unindented',
    );

    await expect(
      strategy.execute(malformedYamlPath, testDir),
    ).rejects.toThrowError(
      /Failed to parse declarative config file .*All mapping items must start at the same column/,
    );
  });

  it('should correctly extract and install real dependencies from mixed string and array extends and plugins', async () => {
    const configFilePath = createCommitlintrcJson({
      extends: [
        '@commitlint/config-conventional',
        '@commitlint/config-angular',
      ],
      plugins: ['@commitlint/config-validator', ['is-positive', {}]],
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();
    expect(readPackageJson()?.dependencies).toEqual({
      '@commitlint/config-conventional': '*',
      '@commitlint/config-angular': '*',
      '@commitlint/config-validator': '*',
      'is-positive': '*',
    });
  });

  it('should handle empty extends or plugins arrays gracefully', async () => {
    const configFilePath = createCommitlintrcJson({
      extends: [],
      plugins: [],
      rules: { 'type-empty': [2, 'never'] },
    });
    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();
    expect(readPackageJson()).toBeNull();
  });

  it('should use existing dependency version if package.json already lists it', async () => {
    createPackageJson({
      name: 'project-with-pinned-dep',
      version: '1.0.0',
      description: 'Test',
      private: true,
      dependencies: { '@commitlint/config-conventional': '17.0.0' },
    });
    const configFilePath = createCommitlintrcJson({
      extends: [
        '@commitlint/config-conventional',
        '@commitlint/config-angular',
      ],
    });

    await expect(
      strategy.execute(configFilePath, testDir),
    ).resolves.not.toThrow();

    expect(readPackageJson()?.dependencies).toEqual({
      '@commitlint/config-conventional': '17.0.0',
      '@commitlint/config-angular': '*',
    });
  });
});
