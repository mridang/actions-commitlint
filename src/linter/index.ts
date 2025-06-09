/* eslint-disable testing-library/no-debugging-utils */
import { existsSync as fsExistsSync } from 'node:fs';
import { info } from '@actions/core';
import lintLib from '@commitlint/lint';
import loadConfig from '@commitlint/load';
import type {
  LintOptions,
  LintOutcome,
  QualifiedRules,
} from '@commitlint/types';
import type {
  CommitToLint,
  LoadedCommitlintConfig,
  ActualParserOptions,
} from '../types.js';
import { Results } from './result.js';

/**
 * A flattened, simplified object representing the complete result of linting a
 * single commit.
 */
export type SimplifiedLinterResult = {
  hash: string;
} & LintOutcome;

/**
 * Defines the contract for a formatter that writes a Results object to a
 * GitHub Actions Summary.
 */
export interface Formatter {
  /**
   * Populates a Summary object with a formatted representation of the results.
   * @param results The results object to format.
   */
  format(results: Results): void;
}

/**
 * Orchestrates the commit linting process. This class is responsible for
 * loading commitlint configurations, linting a list of commit messages
 * against those rules, and packaging the outcome into a structured `Results`
 * object for further processing or display.
 */
export class Linter {
  /**
   * An immutable array of commit objects to be processed by the linter.
   * @private
   */
  private readonly commitsToLint: ReadonlyArray<CommitToLint>;

  /**
   * An optional, user-provided path to a commitlint configuration file.
   * @private
   */
  private readonly configPathInput: string | null;

  /**
   * A custom help URL to be used in formatted output, overriding the config.
   * @private
   */
  private readonly helpUrlInput: string;

  /**
   * The base directory from which to resolve configurations and plugins.
   * @private
   */
  private readonly projectBasePath: string;

  /**
   * Constructs a new Linter instance.
   *
   * @param commitsToLint An array of commit objects, each containing a hash
   * and a message string, that are to be processed.
   * @param configPathInput An optional, explicit path to a commitlint
   * configuration file. If null, auto-detection will be used.
   * @param helpUrlInput A custom URL to be displayed in formatted output,
   * overriding any helpUrl from the loaded configuration.
   * @param projectBasePath The root path of the project. This is used as the
   * current working directory for loading configurations and resolving
   * shareable presets (e.g., from `node_modules`).
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
   * Loads the effective commitlint configuration. If an explicit config path
   * is provided and exists, it will be loaded. Otherwise, this method
   * attempts to auto-detect a configuration file (e.g., `.commitlintrc.js`)
   * from the project's base path. It defaults to
   * `@commitlint/config-conventional` if no other config is found.
   *
   * @returns A promise that resolves to the loaded and parsed commitlint
   * configuration object.
   * @throws An error if `configPathInput` is specified but the file does
   * not exist at that path.
   * @private
   */
  private async loadEffectiveConfig(): Promise<LoadedCommitlintConfig> {
    const loadOptions = { cwd: this.projectBasePath };

    if (this.configPathInput) {
      if (fsExistsSync(this.configPathInput)) {
        info(`Loading commitlint configuration from: ${this.configPathInput}`);
        return (await loadConfig(
          {},
          { ...loadOptions, file: this.configPathInput },
        )) as LoadedCommitlintConfig;
      } else {
        throw new Error(
          `Specified configuration file was not found at: ${this.configPathInput}`,
        );
      }
    }

    info(
      `No configuration path provided. Attempting to auto-detect configuration from project root: ${this.projectBasePath}.`,
    );
    return (await loadConfig(
      { extends: ['@commitlint/config-conventional'] },
      loadOptions,
    )) as LoadedCommitlintConfig;
  }

  /**
   * Executes the end-to-end linting process. This method first loads the
   * configuration, then lints each provided commit message against the resolved
   * rules, and finally returns a structured `Results` object.
   *
   * @returns A promise that resolves to a `Results` instance containing the
   * detailed outcome of the linting for all processed commits.
   */
  public async lint(): Promise<Results> {
    const loadedConfig = await this.loadEffectiveConfig();

    const parserOptsValue = loadedConfig.parserPreset?.parserOpts as
      | ActualParserOptions
      | undefined;
    const lintingOpts: LintOptions = {
      parserOpts: parserOptsValue ?? {},
      plugins: loadedConfig.plugins ?? {},
      ignores: loadedConfig.ignores ?? [],
      defaultIgnores: loadedConfig.defaultIgnores ?? true,
      helpUrl: this.helpUrlInput || loadedConfig.helpUrl,
    };

    const lintingPromises = this.commitsToLint.map(async (commit) => {
      const lintResult = await lintLib(
        commit.message,
        loadedConfig.rules as QualifiedRules,
        lintingOpts,
      );
      return {
        ...lintResult,
        hash: commit.hash,
      };
    });

    const results = await Promise.all(lintingPromises);
    const finalHelpUrl = this.helpUrlInput || loadedConfig.helpUrl || '';

    return new Results(results, finalHelpUrl);
  }
}
