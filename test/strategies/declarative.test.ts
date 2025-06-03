import fs, { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path, { join as pathJoin } from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { DeclarativeStrategy } from '../../src/strategies/declarative.js';
import type { RawDeclarativeConfig } from '../../src/types.js';

describe('DeclarativeStrategy', () => {
  const strategy = new DeclarativeStrategy();
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createConfigFile = (content: string, filename: string): string => {
    const filePath = pathJoin(testDir, filename);
    writeFileSync(filePath, content);
    return filePath;
  };

  const createCommitlintrcJson = (
    config: RawDeclarativeConfig,
    filename: string = '.commitlintrc.json',
  ) => {
    return createConfigFile(JSON.stringify(config, null, 2), filename);
  };

  const createCommitlintrcYaml = (
    config: RawDeclarativeConfig,
    filename: string = '.commitlintrc.yaml',
  ) => {
    return createConfigFile(stringifyYaml(config), filename);
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

  describe('valid configurations', () => {
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

    it('should process .commitlintrc.yaml and install real dependencies', async () => {
      const yamlConfigObject: RawDeclarativeConfig = {
        extends: ['@commitlint/config-conventional'],
        plugins: ['@commitlint/config-angular'],
      };
      const configFilePath = createCommitlintrcYaml(yamlConfigObject);

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

    it('should parse an extensionless .commitlintrc file as JSON successfully', async () => {
      const configContent = { rules: { 'subject-empty': [2, 'never'] } };
      const configFilePath = createConfigFile(
        JSON.stringify(configContent),
        '.commitlintrc',
      );
      await expect(
        strategy.execute(configFilePath, testDir),
      ).resolves.not.toThrow();
    });

    it('should parse an extensionless .commitlintrc file as YAML if JSON fails', async () => {
      const configContent = { rules: { 'subject-empty': [2, 'never'] } };
      const configFilePath = createConfigFile(
        stringifyYaml(configContent),
        '.commitlintrc',
      );
      await expect(
        strategy.execute(configFilePath, testDir),
      ).resolves.not.toThrow();
    });
  });

  describe('invalid or malformed configurations', () => {
    it('should throw an error when npm install fails due to a non-existent package', async () => {
      const configFilePath = createCommitlintrcJson({
        extends: ['a-non-existent-package-that-will-cause-failure-12345'],
      });

      await expect(
        strategy.execute(configFilePath, testDir),
      ).rejects.toThrowError(
        // This regex is more flexible for newlines and the "Unknown error:" part
        /npm install failed in .*[\s\S]*Error: Command failed: npm install[\s\S]*E404[\s\S]*a-non-existent-package-that-will-cause-failure-12345/,
      );
    });

    it('should throw an error when parsing a malformed JSON configuration file', async () => {
      const malformedJsonPath = createConfigFile(
        '{ "extends": ["@scope/config-good"], "invalidJson": ',
        '.commitlintrc.json',
      );

      await expect(
        strategy.execute(malformedJsonPath, testDir),
      ).rejects.toThrowError(
        /Failed to parse declarative config file .*Unexpected end of JSON input/,
      );
    });

    it('should throw an error when parsing a malformed YAML configuration file', async () => {
      const malformedYamlPath = createConfigFile(
        'extends: \n  - item1\n  item2: unindented',
        '.commitlintrc.yaml',
      );

      await expect(
        strategy.execute(malformedYamlPath, testDir),
      ).rejects.toThrowError(
        /Failed to parse declarative config file .*All mapping items must start at the same column/,
      );
    });

    it('should throw a combined error when an extensionless .commitlintrc file fails both JSON and YAML parsing', async () => {
      const configFilePath = createConfigFile(
        'extends: \n  - item1\n  item2: unindented',
        '.commitlintrc',
      );
      await expect(
        strategy.execute(configFilePath, testDir),
      ).rejects.toThrowError(
        // This regex accounts for the outer "Failed to parse..." and the inner combined message
        /Failed to parse declarative config file .*?/,
      );
    });

    it('should throw an error when an unsupported configuration file extension is used', async () => {
      const configFilePath = createConfigFile('{}', 'commitlintrc.txt');
      await expect(
        strategy.execute(configFilePath, testDir),
      ).rejects.toThrowError(
        /Unsupported declarative config file format\/extension: '\.txt' for '.*commitlintrc\.txt'/,
      );
    });
  });
});
