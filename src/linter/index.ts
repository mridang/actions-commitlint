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
 * A flattened, simplified object representing the complete result of linting a single commit.
 */
export type SimplifiedLinterResult = {
  hash: string;
} & LintOutcome;

/**
 * Defines the contract for a formatter that writes a Results object to a GitHub Actions Summary.
 */
export interface Formatter {
  /**
   * Populates a Summary object with a formatted representation of the results.
   * @param results The results object to format.
   */
  format(results: Results): void;
}

export class Linter {
  private readonly commitsToLint: ReadonlyArray<CommitToLint>;
  private readonly configPathInput: string | null;
  private readonly helpUrlInput: string;
  private readonly projectBasePath: string;

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
