import {
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImperativeStrategy } from '../../src/strategies/imperative.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ImperativeStrategy', () => {
  const testDir = pathJoin(__dirname, 'test_temp_imperative_nomock');
  const dummyConfigPath = pathJoin(testDir, 'commitlint.config.js');

  beforeEach(() => {
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

  it('should attempt to run npm install if package.json exists and complete without error for a minimal package.json', async () => {
    const strategy = new ImperativeStrategy();
    const packageJsonPath = pathJoin(testDir, 'package.json');
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: 'test-project-imperative',
        version: '1.0.0',
        description: 'Test package',
      }),
    );

    await expect(
      strategy.execute(dummyConfigPath, testDir),
    ).resolves.not.toThrow();
  });

  it('should throw an error if package.json does not exist', async () => {
    const strategy = new ImperativeStrategy();
    const packageJsonPath = pathJoin(testDir, 'package.json');

    if (existsSync(packageJsonPath)) {
      unlinkSync(packageJsonPath);
    }

    await expect(strategy.execute(dummyConfigPath, testDir)).rejects.toThrow(
      `Imperative strategy: package.json not found in '${testDir}' at '${packageJsonPath}'. A package.json is required for this strategy.`,
    );
  });

  it('should throw an error if npm install fails', async () => {
    const strategy = new ImperativeStrategy();
    const packageJsonPath = pathJoin(testDir, 'package.json');
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: 'failing-project',
        version: '1.0.0',
        dependencies: {
          'a-package-that-does-not-exist-and-will-fail-for-sure': '99.99.99',
        },
      }),
    );

    try {
      await strategy.execute(dummyConfigPath, testDir);
      throw new Error(
        'Expected strategy.execute to throw an error for failing npm install, but it did not.',
      );
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      const err = error as Error;
      expect(err.message).toContain('npm install failed');
      expect(err.message).toContain('E404');
      expect(err.message).toContain(
        'a-package-that-does-not-exist-and-will-fail-for-sure',
      );
    }
  });
});
