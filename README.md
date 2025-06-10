# Commit Lint GitHub Action

A GitHub Action that runs [`commitlint`](https://commitlint.js.org/) to enforce [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) standards. This action validates commit messages, ensuring a clear and consistent project history for automated tooling.

## Features

- **Automated Linting**: Automatically checks your commit messages against configurable rules, ensuring they meet your project's standards.
- **API-Driven Analysis**: Leverages the GitHub API for efficient commit message analysis, reducing reliance on deep Git history checkouts.
- **Automated Plugin Installation**: Automatically installs `commitlint` configurations and any necessary parsers.
- **Flexible Configuration**: Supports various [`commitlint` configuration file formats](https://commitlint.js.org/reference/configuration.html) and uses [Cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) to allow you to specify a working directory.
- **Detailed Output**: Provides clear logs, detailed feedback, and convenient [GitHub Job Summaries](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary) that list commits with warnings and errors.

### Why?

- **Reusability**: This action is designed to be highly reusable across multiple projects, simplifying your CI/CD setup for conventional commits.
- **Fast Execution**: The action optimizes for speed by caching dependencies, leading to quicker execution times for your release workflow.
- **Simplified for Polyglot Repositories**: Abstracts away the Node.js ecosystem, enabling `commitlint` usage in non-Node.js projects without requiring a `package.json` or various JavaScript/TypeScript configuration files within your repository.

## Usage

To use this action, add it to your workflow file (e.g., `.github/workflows/commitlint.yml`).

```yaml
name: Commit Lint

on:
  pull_request: # Triggers on default pull_request types (opened, synchronize, reopened)
  push:
    branches:
      - main # or your default branch
      - develop

permissions:
  contents: read # Required to read the repository's contents and commits for all jobs in this workflow.

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 1 # A shallow clone with fetch-depth: 1 is enough as this action uses the GitHub API for analysis.

      - name: Commit Lint
        uses: mridang/action-commit-lint@v1 # Replace it with your action's actual path
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          commit-depth: '50' # Optional: Lint the last 50 commits
          allow-force-install: 'false' # Optional: Set to 'true' if you need to force npm installs
          fail-on-warnings: 'false' # Optional: Set to 'true' to fail on warnings
          fail-on-errors: 'true' # Optional: Set to 'false' to pass with errors as warnings
          help-url: 'https://your-project.com/commit-guidelines' # Optional: Your URL for commit guidelines
          config-file: '.commitlintrc.js' # Optional: Path to your config file
          working-directory: '.' # Optional: Default is '.'
```

This workflow is configured to trigger commit linting on `pull_request` events and pushes to branches like `main` (or `develop`). It automatically validates all relevant commit messages against your defined standards, providing immediate feedback. This ensures your project's commit history remains clean and consistent from the moment changes are introduced.

## Inputs

* **`github-token`** (required): Your GitHub token, used to authenticate API requests for fetching commit information. It's best to use `secrets.GITHUB_TOKEN` or a Personal Access Token (PAT) with the necessary permissions.
* **`commit-depth`** (optional): The maximum number of commits to lint from the push event. If you leave this empty, the action will lint all commits associated with the event.
* **`allow-force-install`** (optional, default: `'false'`): Set this to `'true'` to let the action overwrite an existing `package.json` file and force `npm` to install dependencies with `--force`. This can help fix conflicting peer dependencies, but use it with caution as it might lead to a broken installation.
* **`fail-on-warnings`** (optional, default: `'false'`): If `'true'`, the action will fail if any linting **warnings** are found. By default, warnings won't cause the action to fail.
* **`fail-on-errors`** (optional, default: `'true'`): If `'false'`, the action will pass with a warning message even if linting **errors** are found. By default, errors will cause the action to fail.
* **`help-url`** (optional): A URL that'll show up in linting error messages, guiding users to your project's specific commit message guidelines.

## Outputs

None

### Configuration

This action uses `cosmiconfig` to find your `commitlint` configuration. It supports the following file formats:

* `.commitlintrc`
* `.commitlintrc.json`
* `.commitlintrc.yaml`
* `.commitlintrc.yml`
* `.commitlintrc.js`
* `.commitlintrc.cjs`
* `.commitlintrc.mjs`
* `.commitlintrc.ts`
* `.commitlintrc.cts`
* `commitlint.config.js`
* `commitlint.config.cjs`
* `commitlint.config.mjs`
* `commitlint.config.ts`
* `commitlint.config.cts`
- `package.json` (under the `commitlint` key)

### In Node.js (or related) projects

For JavaScript/TypeScript projects, you typically use an imperative configuration file like `commitlint.config.mjs` or `commitlint.config.js`. When using such a file, all `commitlint` plugins must be declared as development dependencies in your project's `package.json` file.

**Example `commitlint.config.mjs`:**

```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'build', 'ci', 'perf', 'revert'],
    ],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
```

The action will automatically run `npm install` in your working directory to ensure all these declared dependencies are available for `commitlint` to function correctly.

### In non-Node projects

For projects not based on Node.js, we recommend using a declarative configuration file such as `.commitlintrc.json`, `.commitlintrc.yaml`, or `.commitlintrc.yml`. With these formats, you can declare your `commitlint` plugins directly within the configuration file, and the action will automatically install the necessary dependencies without requiring a `package.json` or any extra setup steps on your part.

**Example `.commitlintrc.json`:**

```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "header-max-length": [2, "always", 100],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "test", "chore", "build", "ci", "perf", "revert"]
    ],
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"]
  }
}
```

The action will detect the plugins listed in these declarative files, create a temporary `package.json` for them, and install them on the fly, making it very convenient for polyglot repositories.

## Known Issues

* This action is designed to work specifically with `push` events, `pull_request` events, and `merge_group` events. Other event types are not currently supported.

## Useful links

* **[Commitlint](https://commitlint.js.org/):** The linter for commit messages that this action runs.
* **[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):** A specification for adding human and machine-readable meaning to commit messages.
* **[Cosmiconfig](https://github.com/cosmiconfig/cosmiconfig):** The universal configuration loader used by this action to find `commitlint` configurations.

## Contributing

If you have suggestions for how this app could be improved, or
want to report a bug, open an issue—we'd love all and any
contributions.

## License

Apache License 2.0 © 2025 Mridang Agarwalla
