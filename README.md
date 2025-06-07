# Semantic Release GitHub Action

This GitHub Action automates the process of running **semantic-release**. It
ensures that your project is versioned correctly, generates changelogs,
and publishes releases based on your commit messages.

## Why

Linting commit messages is crucial for maintaining a clean and understandable Git history, but integrating `commitlint` into CI workflows, especially for diverse project types, can present some challenges. This action aims to simplify that process.

### Overcoming Shallow Checkout Limitations

Traditional `commitlint` setups, often run via `npx commitlint --from HEAD~N` or similar, require access to the Git history to determine the range of commits to lint. In CI environments, repositories are frequently cloned with a shallow depth (e.g., `actions/checkout@v4` with `fetch-depth: 1`) to save time and resources. This shallow history prevents `commitlint` from accessing the necessary commit range, causing it to fail or lint an incorrect set of commits.

This GitHub Action bypasses that limitation. Instead of relying on the local Git history, it intelligently uses the GitHub API (based on the event type like `push`, `pull_request`, or `merge_group`) to fetch only the metadata of the relevant commits that need to be linted. This means:

- You can continue to use shallow checkouts in your CI workflows, keeping them fast.
- The action accurately lints the correct range of commits pertinent to the event (e.g., new commits in a PR, commits in a push).

### Simplified Dependency Management for Declarative Configs

When using `commitlint` with declarative configuration formats like `.commitlintrc.json` or `.commitlintrc.yaml`, any shared configurations (e.g., `extends: ['@commitlint/config-conventional']`) or plugins listed are npm packages that need to be installed in the environment where `commitlint` runs.

- **For Node.js Projects**: Developers typically add these `commitlint` sharesable configs and plugins to their project's `package.json`. When `actions/setup-node` is used with caching, these dependencies are often available.
- **For Non-Node.js Projects (or projects without these explicit deps)**: Setting up the environment to install these commitlint-specific dependencies can be cumbersome. Manually creating a `package.json` just to list and install `commitlint`'s `extends` and `plugins` can feel like an anti-pattern if the project itself isn't Node.js based or doesn't otherwise need a `package.json`.

This action **automates the dependency management** for you:

- If it detects a declarative configuration file (like `.json` or `.yaml`), it will parse the `extends` and `plugins` arrays.
- It then programmatically creates a minimal `package.json` (or updates an existing one in the workspace) to include these packages as dependencies.
- Finally, it runs `npm install` to ensure all necessary configurations and plugins are available before linting occurs.
- This process is also **faster on subsequent runs** because the dynamically managed `package.json` and the installed `node_modules` (containing commitlint dependencies) can be effectively cached using `actions/cache` or the built-in caching of `actions/setup-node`.

This automation removes the need for manual setup steps in your workflow, making it easier and more efficient to enforce commit message conventions across any type of repository.

## Installation

N/A

## Usage

To use this plugin, add it to your semantic-release configuration file (e.g.,
`.releaserc.js`, `release.config.js`, or in your `package.json`).

The plugin should typically be placed _before_ the `@semantic-release/npm` or
`@semantic-release/github` plugins in the `plugins` array, as it needs to run
its checks in the `verifyConditions` and `analyzeCommits` steps.

**Example Configuration (`.releaserc.js`):**

```javascript
module.exports = {
  branches: ['main', 'next'],
  plugins: [
    '@semantic-release/commit-analyzer', // Must come first to determine release type
    [
      '@mridang/actions-commitlint',
      {
        repo: 'owner/repo',
        // Optional: GitHub token for private repos or to avoid rate limiting
        // Defaults to process.env.GITHUB_TOKEN || process.env.GH_TOKEN
        // githubToken: process.env.UPSTREAM_GITHUB_TOKEN
      },
    ],
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    '@semantic-release/npm', // If publishing to npm
    '@semantic-release/github', // For creating GitHub releases and comments
    '@semantic-release/git', // To commit package.json, CHANGELOG.md, etc.
  ],
};
```

## Known Issues

None

## Useful links

- [**Commitlint Documentation**](https://commitlint.js.org/): The official
  documentation for `commitlint`, including rules and configuration options.
- [**Conventional Commits**](https://www.conventionalcommits.org/): The commit
  message convention that `commitlint` often enforces (e.g., via
  `@commitlint/config-conventional`).

## Contributing

If you have suggestions for how this app could be improved, or
want to report a bug, open an issue - we'd love all and any
contributions.

## License

Apache License 2.0 © 2024 Mridang Agarwalla
