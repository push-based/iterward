# Looplock

This repository is an Nx workspace. It holds the following package:

- [`@push-based/looplock`](packages/looplock/README.md): a deterministic control plane for agentic engineering workflows.

## Develop

You need Node.js 22.18 or later. To build and test every package, install the workspace, and then run the targets through Nx:

```bash
npm install
npx nx run-many -t build test
```

## Release a version

Nx Release versions every package in `packages/` together. It derives the version from the conventional commits since the last `v*` tag, writes `CHANGELOG.md`, commits, tags, pushes, creates a GitHub release, and publishes to npm. A commit with `fix:` bumps the patch version, and a commit with `feat:` bumps the minor version. A breaking change, such as `feat!:`, bumps the major version. Before version 1.0.0, each bump moves down one level: a breaking change bumps the minor version, and `feat:` bumps the patch version.

The **Release** workflow in GitHub Actions runs the release from `main`. It needs an npm automation token in the `NPM_TOKEN` repository secret. To release a version, follow these steps:

1. In the repository on GitHub, click **Actions**, and then click **Release**.
1. Click **Run workflow**, and leave **Preview only** selected. The run prints the version, the changelog, and the package contents without changing anything.
1. Run the workflow again with **Preview only** cleared. The run publishes the version.

To release from your own machine instead, log in to npm with `npm login`, set the `GITHUB_TOKEN` environment variable, and run `npx nx release` on `main`. To preview the release, add `--dry-run`.

### Make the first release

No `v*` tag exists before the first release, so Nx can't find a starting point in the history. For the first release, enter `0.3.0` in **Version to release**, and select **First release**. Nx then tags the version that `packages/looplock/package.json` holds. Later releases start from that tag and need neither input.
