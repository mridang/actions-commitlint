/* eslint-disable testing-library/no-debugging-utils */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { startGroup, endGroup, info, debug, error } from '@actions/core';
import type { Loader } from 'cosmiconfig';
import { defaultLoaders } from 'cosmiconfig';

/**
 * Creates a loader that extracts plugin dependencies from declarative configs
 * and generates a package.json file with versions if specified.
 *
 * Will throw if a package.json already exists in the directory.
 *
 * @param loader - The base loader to parse the configuration file.
 * @returns A loader that prepares a package.json for npm install.
 */
function declarativeLoader(loader: Loader): Loader {
  return async (filepath, content) => {
    const config = await loader(filepath, content);

    if (typeof config !== 'object' || config === null) {
      throw new Error('Expected declarative config object');
    } else {
      const cwd = dirname(filepath);

      const dependencies = ['plugins', 'extends']
        .flatMap((k) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (config as any)[k];

          if (typeof v === 'string') {
            return [v.trim()];
          } else {
            if (Array.isArray(v)) {
              return v
                .map((x) => {
                  return Array.isArray(x) ? x[0] : x;
                })
                .filter((x): x is string => typeof x === 'string')
                .map((x) => x.trim());
            } else {
              return [];
            }
          }
        })
        .map((pkg) => {
          debug(`Detected package "${pkg}"`);
          return pkg;
        })
        .reduce<Record<string, string>>((acc, entry) => {
          const at = entry.lastIndexOf('@');
          const name =
            at > 0 && entry.startsWith('@') ? entry.slice(0, at) : entry;

          if (!acc[name]) {
            if (at > 0 && entry.startsWith('@')) {
              acc[name] = entry.slice(at + 1);
            } else {
              acc[name] = '*';
            }
          }

          return acc;
        }, {});

      if (Object.entries(dependencies).length > 0) {
        const pkgPath = join(cwd, 'package.json');
        if (existsSync(pkgPath)) {
          throw new Error(`File package.json in ${cwd} already exists.`);
        } else {
          writeFileSync(
            pkgPath,
            JSON.stringify(
              { name: 'temp', devDependencies: dependencies },
              null,
              2,
            ),
          );
        }
      }

      return config;
    }
  };
}

/**
 * Creates a loader that runs `npm install` in the config file's directory.
 * If allowForce is true, it will use the --force flag.
 *
 * @param loader - The base loader to parse the configuration file.
 * @param allowForce - Whether to use `npm install --force`.
 * @returns A loader that installs dependencies using npm.
 */
function imperativeLoader(loader: Loader, allowForce: boolean): Loader {
  return async (filepath, content) => {
    debug(`Loading imperative config: ${filepath}`);
    const config = await loader(filepath, content);
    const cwd = dirname(filepath);

    startGroup('Installing dependencies');
    try {
      const command = allowForce
        ? 'npm install --force --no-audit --no-progress --no-fund --quiet'
        : 'npm install --no-audit --no-progress --no-fund --quiet';

      info(`Running command: ${command}`);
      execSync(command, {
        cwd,
        stdio: 'inherit',
      });

      execSync('npm ls --parseable', {
        cwd,
        encoding: 'utf8',
      })
        .split(/\r?\n/)
        .forEach((line) => debug(line));
    } catch (err) {
      if (err instanceof Error || typeof err === 'string') {
        error(err);
      }
      throw new Error();
    } finally {
      endGroup();
    }

    return config;
  };
}

/**
 * REFACTORED: Creates a loaders object for cosmiconfig, configured with the
 * allowForce flag.
 *
 * @param allowForce - If true, enables force-install and overwriting package.json.
 * @returns A cosmiconfig loaders object.
 */
export function createLoaders(allowForce = false) {
  const dLoader = (loader: Loader) => declarativeLoader(loader);
  const iLoader = (loader: Loader) => imperativeLoader(loader, allowForce);

  return {
    ...defaultLoaders,
    '.json': iLoader(dLoader(defaultLoaders['.json'])),
    '.yaml': iLoader(dLoader(defaultLoaders['.yaml'])),
    '.yml': iLoader(dLoader(defaultLoaders['.yml'])),
    noExt: iLoader(dLoader(defaultLoaders['.yaml'])),
    '.js': iLoader(defaultLoaders['.js']),
    '.cjs': iLoader(defaultLoaders['.cjs']),
    '.mjs': iLoader(defaultLoaders['.mjs']),
    '.ts': iLoader(defaultLoaders['.ts']),
  };
}
