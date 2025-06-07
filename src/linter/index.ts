/* eslint-disable testing-library/no-debugging-utils */
import { existsSync as fsExistsSync } from 'node:fs';
import { info, debug, warning as coreWarning } from '@actions/core';
import lintLib from '@commitlint/lint';
import { format as formatResult } from '@commitlint/format';
import loadConfig from '@commitlint/load';
import type { LintOptions, QualifiedRules } from '@commitlint/types';
import type {
  CommitToLint,
  LintedCommit,
  LinterResult,
  LoadedCommitlintConfig,
  ActualParserOptions,
} from '../types.js';

/**
 * The Linter class is responsible for loading commitlint configurations,
 * linting a list of commit messages against those configurations,
 * and formatting the results.
 */
export class Linter {
  private readonly commitsToLint: ReadonlyArray<CommitToLint>;
  private readonly configPathInput: string | null;
  private readonly helpUrlInput: string;
  private readonly projectBasePath: string;

  /**
   * Constructs a new Linter instance.
   *
   * @param commitsToLint - An array of {@link CommitToLint} objects to be
   * processed.
   * @param configPathInput - The user-specified absolute path to a commitlint
   * configuration file. If null or empty, defaults will be used by
   * `@commitlint/load`.
   * @param helpUrlInput - A URL to be included in formatted error messages,
   * guiding users to commit conventions.
   * @param projectBasePath - The root path of the project where `node_modules`
   * (containing shared configs like @commitlint/config-conventional) reside.
   * This is typically `process.cwd()` when tests are run from project root.
   */
  constructor(
    commitsToLint: ReadonlyArray<CommitToLint>,
    configPathInput: string | null,
    helpUrlInput: string,
    projectBasePath: string,
  ) {
    this.commitsToLint = commitsToLint;
    this.configPathInput = configPathInput;
    this.helpUrlInput = helpUrlInput;
    this.projectBasePath = projectBasePath;
  }

  /**
   * Extracts linting options from a loaded commitlint configuration.
   *
   * @param loadedConfig - The {@link LoadedCommitlintConfig} object.
   * @returns An {@link LintOptions} object for use with `@commitlint/lint`.
   */
  private getOptsFromConfig(loadedConfig: LoadedCommitlintConfig): LintOptions {
    const parserOptsValue = loadedConfig.parserPreset?.parserOpts as
      | ActualParserOptions
      | undefined;
    return {
      parserOpts: parserOptsValue ?? {},
      plugins: loadedConfig.plugins ?? {},
      ignores: loadedConfig.ignores ?? [],
      defaultIgnores: loadedConfig.defaultIgnores ?? true,
      helpUrl: loadedConfig.helpUrl,
    };
  }

  /**
   * Formats the linting results into a human-readable string.
   *
   * @param lintedCommitsArray - An array of {@link LintedCommit} objects.
   * @param loadedCfg - The loaded commitlint configuration.
   * @returns A formatted string representing the lint results.
   */
  private formatLintOutput(
    lintedCommitsArray: LintedCommit[],
    loadedCfg: LoadedCommitlintConfig,
  ): string {
    return formatResult(
      { results: lintedCommitsArray.map((commit) => commit.lintResult) },
      {
        color: true,
        helpUrl: this.helpUrlInput || loadedCfg.helpUrl,
      },
    );
  }

  /**
   * Loads the commitlint configuration.
   * If `configPathInput` is provided and the file exists, that file is loaded.
   * The `cwd` for `@commitlint/load` is set to `this.projectBasePath` to ensure
   * correct resolution of `extends` from `node_modules`.
   * Otherwise, `@commitlint/load` attempts to find a configuration file in
   * `this.projectBasePath` or loads `@commitlint/config-conventional`.
   *
   * @returns A promise that resolves to the {@link LoadedCommitlintConfig}.
   */
  private async loadEffectiveConfig(): Promise<LoadedCommitlintConfig> {
    let rawLoadedConfig;
    const loadOptions = { cwd: this.projectBasePath };

    if (this.configPathInput && fsExistsSync(this.configPathInput)) {
      info(`Loading commitlint configuration from: ${this.configPathInput}`);
      rawLoadedConfig = await loadConfig(
        {},
        { ...loadOptions, file: this.configPathInput },
      );
    } else {
      if (this.configPathInput) {
        coreWarning(
          `Specified config file '${this.configPathInput}' not found. Attempting to load default or auto-detected configuration from project root: ${this.projectBasePath}.`,
        );
      }
      info(
        `Attempting to load default @commitlint/config-conventional or auto-detected configuration from project root: ${this.projectBasePath}.`,
      );
      rawLoadedConfig = await loadConfig(
        { extends: ['@commitlint/config-conventional'] },
        loadOptions,
      );
    }
    return rawLoadedConfig as unknown as LoadedCommitlintConfig;
  }

  /**
   * Performs the core linting process on the provided commits.
   *
   * @returns A promise that resolves to a {@link LinterResult} object.
   */
  public async lint(): Promise<LinterResult> {
    if (this.commitsToLint.length === 0) {
      coreWarning('Linter: No commits provided to lint.');
      const emptyConfig = {
        extends: [],
        formatter: '@commitlint/format',
        rules: {},
        plugins: {},
        helpUrl: '',
        prompt: {},
      } as LoadedCommitlintConfig;
      return {
        lintedCommits: [],
        formattedResults: '',
        loadedConfig: emptyConfig,
        hasOnlyWarnings: () => false,
        hasErrors: () => false,
      };
    }

    const loadedConfig = await this.loadEffectiveConfig();
    const lintingOpts = this.getOptsFromConfig(loadedConfig);

    const lintedCommitsPromises = this.commitsToLint.map(async (commit) => ({
      ...commit,
      lintResult: await lintLib(
        commit.message,
        loadedConfig.rules as QualifiedRules,
        lintingOpts,
      ),
    }));
    const resolvedLintedCommits = await Promise.all(lintedCommitsPromises);

    const formattedResults = this.formatLintOutput(
      resolvedLintedCommits,
      loadedConfig,
    );

    return {
      lintedCommits: resolvedLintedCommits,
      formattedResults,
      loadedConfig,
      hasOnlyWarnings(): boolean {
        return (
          resolvedLintedCommits.length > 0 &&
          resolvedLintedCommits.every(({ lintResult }) => lintResult.valid) &&
          resolvedLintedCommits.some(
            ({ lintResult }) => lintResult.warnings.length > 0,
          )
        );
      },
      hasErrors(): boolean {
        return resolvedLintedCommits.some(
          ({ lintResult }) => !lintResult.valid && lintResult.errors.length > 0,
        );
      },
    };
  }
}
