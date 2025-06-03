import { existsSync as fsExistsSync, promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { info, warning } from '@actions/core';
import { parse as parseYaml } from 'yaml';
import type { ICommitlintStrategy, RawDeclarativeConfig } from '../types.js';
import { AbstractStrategy } from './base.js';

/**
 * Implements the strategy for handling declarative commitlint configurations.
 * It parses standalone configuration files (JSON or YAML, including common
 * extensionless names like .commitlintrc), extracts dependencies
 * (from `extends` and `plugins`), updates or creates a `package.json` file
 * in the working directory to include these dependencies, and then runs `npm install`.
 */
export class DeclarativeStrategy
  extends AbstractStrategy
  implements ICommitlintStrategy
{
  /**
   * Reads and parses a standalone declarative configuration file.
   * This method determines the file type based on its extension. For common
   * extensionless names (e.g., `.commitlintrc`), it first attempts to parse
   * as JSON, then falls back to YAML if JSON parsing fails.
   * Supported formats are JSON and YAML.
   *
   * @param filepath - The absolute path to the declarative configuration file.
   * @returns A promise that resolves to the parsed {@link RawDeclarativeConfig}.
   * @throws If the file cannot be read, if the file format is unsupported
   * after trying fallbacks for extensionless files, or if parsing fails due to
   * malformed content.
   */
  private async _parseDeclarativeConfigFile(
    filepath: string,
  ): Promise<RawDeclarativeConfig> {
    const extension = path.extname(filepath).toLowerCase();
    const filename = path.basename(filepath);
    const fileContent = await fsPromises.readFile(filepath, 'utf8');

    switch (extension) {
      case '.json':
        info(`Parsing '${filename}' as JSON.`);
        return JSON.parse(fileContent) as RawDeclarativeConfig;
      case '.yaml':
      case '.yml':
        info(`Parsing '${filename}' as YAML.`);
        return parseYaml(fileContent) as RawDeclarativeConfig;
      case '':
        info(`Attempting JSON parse for extensionless file '${filename}'.`);
        try {
          return JSON.parse(fileContent) as RawDeclarativeConfig;
        } catch (jsonError: unknown) {
          const jErrorMsg =
            jsonError instanceof Error ? jsonError.message : String(jsonError);
          warning(`JSON parse failed for '${filename}': ${jErrorMsg}.`);
          info(`Attempting YAML parse for '${filename}' as fallback.`);
          try {
            const yamlParsedConfig = parseYaml(
              fileContent,
            ) as RawDeclarativeConfig;
            info(`Successfully parsed '${filename}' as YAML.`);
            return yamlParsedConfig;
          } catch (yamlError: unknown) {
            const yErrorMsg =
              yamlError instanceof Error
                ? yamlError.message
                : String(yamlError);
            throw new Error(
              `File '${filename}': JSON parse failed (Error: ${jErrorMsg}), YAML parse also failed (Error: ${yErrorMsg}). Unsupported format or malformed.`,
            );
          }
        }
      default:
        throw new Error(
          `Unsupported declarative config file format/extension: '${extension}' for '${filepath}'.`,
        );
    }
  }

  /**
   * Extracts package names from the 'extends' and 'plugins' fields of a raw
   * declarative configuration using a functional approach. These package names
   * are typically npm package identifiers.
   *
   * It handles cases where `extends` is a string or an array, and where
   * `plugins` is an array of strings or `[name, options]` tuples.
   * Invalid entries (null, undefined, empty strings) are filtered out.
   *
   * @example
   * const strategy = new DeclarativeStrategy(); // Needs instantiation context
   * // Example 1: Both extends and plugins
   * const config1 = {
   * extends: "@commitlint/config-conventional",
   * plugins: ["plugin-foo", ["plugin-bar", { "opt": true }]]
   * };
   * strategy._extractDependenciesFromDeclarativeConfig(config1);
   * // Returns: ["@commitlint/config-conventional", "plugin-foo", "plugin-bar"]
   *
   * // Example 2: Only extends (array)
   * const config2 = { extends: ["config-A", "config-B"] };
   * strategy._extractDependenciesFromDeclarativeConfig(config2);
   * // Returns: ["config-A", "config-B"]
   *
   * // Example 3: Only plugins (with invalid entries)
   * const config3 = { plugins: ["plugin-X", ["", {}], null, "plugin-Y"] };
   * strategy._extractDependenciesFromDeclarativeConfig(config3);
   * // Returns: ["plugin-X", "plugin-Y"]
   *
   * @param config - The {@link RawDeclarativeConfig} object, usually parsed
   * from a config file.
   * @returns An array of unique, trimmed package names identified for
   * potential installation. Returns an empty array if no relevant 'extends'
   * or 'plugins' are found, or if they contain no valid package names.
   */
  private _extractDependenciesFromDeclarativeConfig(
    config: RawDeclarativeConfig,
  ): string[] {
    const extendsArray = Array.isArray(config.extends)
      ? config.extends
      : config.extends
        ? [config.extends]
        : [];

    const validExtends = extendsArray
      .filter(
        (ext): ext is string => typeof ext === 'string' && ext.trim() !== '',
      )
      .map((ext) => ext.trim());

    const validPlugins = (config.plugins ?? [])
      .map((plugin) => {
        if (typeof plugin === 'string') {
          return plugin.trim();
        }
        if (Array.isArray(plugin) && typeof plugin[0] === 'string') {
          return plugin[0].trim();
        }
        return null;
      })
      .filter((name): name is string => name !== null && name !== '');

    const allPackages = [...validExtends, ...validPlugins];
    return Array.from(new Set(allPackages));
  }

  /**
   * Executes the declarative strategy:
   * 1. Parses the specified declarative configuration file.
   * 2. Extracts 'extends' and 'plugins' dependencies.
   * 3. If dependencies are found, creates or updates a `package.json` in the `workingDirectory`.
   * 4. Adds extracted dependencies to `package.json`.
   * 5. Runs `npm install` in the `workingDirectory`.
   *
   * @param configFilePath - The absolute path to the standalone declarative configuration file
   * (e.g., `.commitlintrc.json`, `.commitlintrc.yaml`, `.commitlintrc`).
   * @param workingDirectory - The directory where `package.json` will be managed and `npm install` executed.
   * @returns A promise that resolves when the setup is complete.
   * @throws If there's an error parsing the config, managing `package.json`, or running `npm install`.
   */
  public async execute(
    configFilePath: string,
    workingDirectory: string,
  ): Promise<void> {
    info(`Executing DeclarativeStrategy for config: ${configFilePath}`);

    let rawConfig: RawDeclarativeConfig;
    try {
      rawConfig = await this._parseDeclarativeConfigFile(configFilePath);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to parse declarative config file ${configFilePath}: ${errorMessage}`,
      );
    }

    const dependenciesToInstall =
      this._extractDependenciesFromDeclarativeConfig(rawConfig);

    if (dependenciesToInstall.length === 0) {
      info(
        'No external dependencies (extends/plugins) found in declarative config. Skipping package.json management and specific npm install for these.',
      );
      return;
    }

    info(
      `Extracted dependencies for installation: ${dependenciesToInstall.join(', ')}`,
    );

    const packageJsonPath = path.resolve(workingDirectory, 'package.json');
    let packageJsonData: {
      name: string;
      version: string;
      description: string;
      private: boolean;
      dependencies: { [key: string]: string };
      [key: string]: unknown;
    } = {
      name: 'commitlint-action-dynamic-deps',
      version: '1.0.0',
      description:
        'Dynamically managed dependencies for commitlint GitHub Action',
      private: true,
      dependencies: {},
    };

    try {
      if (fsExistsSync(packageJsonPath)) {
        info(
          `Found existing package.json at ${packageJsonPath}. Reading and updating.`,
        );
        const existingContent = await fsPromises.readFile(
          packageJsonPath,
          'utf8',
        );
        const parsedExistingContent = JSON.parse(existingContent);
        packageJsonData = { ...packageJsonData, ...parsedExistingContent };
        if (!packageJsonData.dependencies) {
          packageJsonData.dependencies = {};
        }
      } else {
        info(
          `No package.json found at ${packageJsonPath}. Creating a new one.`,
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      warning(
        `Error reading or parsing existing package.json at ${packageJsonPath}: ${errorMessage}. A new one will be created/used with default values.`,
      );
      packageJsonData = {
        name: 'commitlint-action-dynamic-deps',
        version: '1.0.0',
        description:
          'Dynamically managed dependencies for commitlint GitHub Action',
        private: true,
        dependencies: {},
      };
    }

    dependenciesToInstall.forEach((dep) => {
      if (!dep.startsWith('.') && !path.isAbsolute(dep)) {
        packageJsonData.dependencies[dep] =
          packageJsonData.dependencies[dep] || '*';
      } else {
        info(
          `Skipping local path '${dep}' from inclusion in package.json dependencies.`,
        );
      }
    });

    try {
      await fsPromises.writeFile(
        packageJsonPath,
        JSON.stringify(packageJsonData, null, 2),
      );
      info(`Successfully wrote/updated ${packageJsonPath}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to write package.json at ${packageJsonPath}: ${errorMessage}`,
      );
    }

    super.runNpmInstall(workingDirectory);
  }
}
