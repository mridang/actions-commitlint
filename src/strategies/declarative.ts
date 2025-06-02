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
   * This method determines the file type based on its extension or common naming conventions
   * (e.g., `.commitlintrc` is typically JSON) and parses it accordingly.
   * Supported formats are JSON and YAML.
   *
   * @param filepath - The absolute path to the declarative configuration file.
   * @returns A promise that resolves to the parsed {@link RawDeclarativeConfig}.
   * @throws If the file cannot be read, if the file format is unsupported,
   * or if parsing fails due to malformed content.
   */
  private async _parseDeclarativeConfigFile(
    filepath: string,
  ): Promise<RawDeclarativeConfig> {
    const extension = path.extname(filepath).toLowerCase();
    const filename = path.basename(filepath);
    const fileContent = await fsPromises.readFile(filepath, 'utf8');

    let parsedConfig: RawDeclarativeConfig;

    switch (extension) {
      case '.json':
        info(`Parsing '${filename}' as JSON.`);
        parsedConfig = JSON.parse(fileContent) as RawDeclarativeConfig;
        break;
      case '.yaml':
      case '.yml':
        info(`Parsing '${filename}' as YAML.`);
        parsedConfig = parseYaml(fileContent) as RawDeclarativeConfig;
        break;
      case '':
        info(
          `Attempting to parse extensionless file '${filename}' as JSON (common convention).`,
        );
        try {
          parsedConfig = JSON.parse(fileContent) as RawDeclarativeConfig;
        } catch (jsonError: unknown) {
          const jErrorMsg =
            jsonError instanceof Error ? jsonError.message : String(jsonError);
          warning(
            `Failed to parse extensionless file '${filename}' as JSON: ${jErrorMsg}.`,
          );
          throw new Error(
            `Unsupported or malformed extensionless configuration file '${filename}'. Attempted JSON parsing failed: ${jErrorMsg}`,
          );
        }
        break;
      default:
        throw new Error(
          `Unsupported declarative configuration file format or extension: '${extension}' for path ${filepath}`,
        );
    }
    return parsedConfig;
  }

  /**
   * Extracts package names from the 'extends' and 'plugins' fields of a raw declarative config.
   * These package names are typically npm package identifiers.
   *
   * @param config - The {@link RawDeclarativeConfig} object, usually parsed from a config file.
   * @returns An array of unique package names identified for potential installation.
   * Returns an empty array if no relevant 'extends' or 'plugins' are found.
   */
  private _extractDependenciesFromDeclarativeConfig(
    config: RawDeclarativeConfig,
  ): string[] {
    const packages: Set<string> = new Set();

    if (config.extends) {
      const extendsValue = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      extendsValue.forEach((ext) => {
        if (typeof ext === 'string' && ext.trim() !== '') {
          packages.add(ext);
        }
      });
    }

    if (config.plugins && Array.isArray(config.plugins)) {
      config.plugins.forEach((plugin) => {
        if (typeof plugin === 'string' && plugin.trim() !== '') {
          packages.add(plugin);
        } else if (
          Array.isArray(plugin) &&
          typeof plugin[0] === 'string' &&
          plugin[0].trim() !== ''
        ) {
          packages.add(plugin[0]);
        }
      });
    }
    return Array.from(packages);
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
