/* eslint-disable testing-library/no-debugging-utils */
import { debug, info } from '@actions/core';
import { existsSync as fsExistsSync } from 'node:fs';
import * as path from 'node:path';
import type { ICommitlintStrategy } from '../types.js';
import { AbstractStrategy } from './base.js';

/**
 * Implements the strategy for handling imperative (JavaScript-based)
 * commitlint configurations. This strategy assumes that necessary dependencies
 * are managed by the user's project `package.json` and simply runs
 * `npm install` to ensure they are available.
 */
export class ImperativeStrategy
  extends AbstractStrategy
  implements ICommitlintStrategy
{
  /**
   * Executes the imperative strategy.
   *
   * This method requires a `package.json` file to be present in the
   * `workingDirectory`. If the `package.json` is found, it proceeds to run
   * `npm install` synchronously using the inherited `runNpmInstallSync` method
   * from the `AbstractStrategy`. The `configFilePath` is logged for context
   * but not directly used for dependency resolution by this strategy.
   *
   * @param configFilePath - The absolute path to the imperative configuration
   * file (e.g., .js, .mjs, .cjs).
   * @param workingDirectory - The directory where `npm install` will be
   * executed.
   * @returns A promise that resolves when `npm install` completes. Note that
   * the core `npm install` operation is synchronous within this method.
   * @throws If `package.json` is not found in the `workingDirectory`.
   * @throws If the inherited `runNpmInstallSync` method (which calls
   * `npm install`) itself fails.
   */
  public async execute(
    configFilePath: string,
    workingDirectory: string,
  ): Promise<void> {
    info(`Executing imperative strategy for config: ${configFilePath}`);
    debug(`Attempting to run 'npm install' in ${workingDirectory}.`);

    const packageJsonPath = path.resolve(workingDirectory, 'package.json');

    if (!fsExistsSync(packageJsonPath)) {
      throw new Error(
        `Imperative strategy: package.json not found in '${workingDirectory}' at '${packageJsonPath}'. A package.json is required for this strategy.`,
      );
    } else {
      debug(
        `Found package.json at ${packageJsonPath}. Proceeding with npm install.`,
      );
    }

    super.runNpmInstall(workingDirectory);
  }
}
