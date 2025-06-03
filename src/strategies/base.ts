/* eslint-disable testing-library/no-debugging-utils */
import { debug, error as coreError, info } from '@actions/core';
import { execSync } from 'node:child_process';
import type { ICommitlintStrategy } from '../types.js';

/**
 * Abstract base class for different commitlint configuration strategies.
 * It implements the `ICommitlintStrategy` interface and provides common
 * utility methods like `runNpmInstallSync` for subclasses.
 */
export abstract class AbstractStrategy implements ICommitlintStrategy {
  /**
   * Abstract method to be implemented by concrete strategies.
   * Executes the specific strategy to prepare the environment for commitlint.
   * @param configFilePath - The absolute path to the configuration file.
   * @param workingDirectory - The directory where operations should occur.
   * @returns A promise that resolves when the strategy execution is complete.
   * @throws If the strategy encounters an unrecoverable error.
   */
  public abstract execute(
    configFilePath: string,
    workingDirectory: string,
  ): Promise<void>;

  /**
   * Runs `npm install` in the specified directory.
   * This method is protected and intended for use by subclasses.
   * @param workingDirectory - The directory to run the `npm install` command in.
   * @throws If the npm command fails.
   */
  protected runNpmInstall(workingDirectory: string): void {
    const command = 'npm install --quiet --no-audit --no-fund';
    info(`Executing: ${command} in ${workingDirectory}`);

    try {
      const output = execSync(command, {
        cwd: workingDirectory,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      info('npm install standard output:');
      output.split('\n').forEach((line) => {
        if (line.trim()) {
          debug(line.trim());
        }
      });
      info('npm install completed successfully.');
    } catch (error: unknown) {
      let errorMessage = `npm install failed in ${workingDirectory}.`;
      let stderrOutput = '';
      let stdoutOutput = '';

      if (error instanceof Error && 'status' in error) {
        const execError = error as Error & {
          status?: number | null;
          stdout?: Buffer | string;
          stderr?: Buffer | string;
        };
        errorMessage += `\nExit Code: ${execError.status ?? 'unknown'}`;
        errorMessage += `\nError Message: ${execError.message}`;

        if (execError.stderr) {
          stderrOutput = execError.stderr.toString();
          errorMessage += `\nStderr: ${stderrOutput}`;
          if (stderrOutput.trim()) {
            coreError(`npm install stderr:\n${stderrOutput}`);
          }
        }
        if (execError.stdout) {
          stdoutOutput = execError.stdout.toString();
          if (stdoutOutput.trim()) {
            info(`npm install stdout (on error):\n${stdoutOutput}`);
            errorMessage += `\nStdout: ${stdoutOutput}`;
          }
        }
      } else if (error instanceof Error) {
        errorMessage += `\nError: ${error.message}`;
      } else {
        errorMessage += `\nUnknown error: ${String(error)}`;
      }
      throw new Error(errorMessage);
    }
  }
}
