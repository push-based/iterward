# Looplock

This repository is an Nx workspace. It holds the following package:

- [`@push-based/looplock`](packages/looplock/README.md): a deterministic control plane for agentic engineering workflows.

## Develop

You need Node.js 22.18 or later. To build and test every package, install the workspace, and then run the targets through Nx:

```bash
npm install
npx nx run-many -t build test
```

## Write commit messages

Releases derive versions from the commit messages, so every commit follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). A `commit-msg` hook runs commitlint on each commit and refuses a message that doesn't follow the convention. `npm install` installs the hook.

The commit type sets the version bump and the changelog section, as the following table shows:

| Commit type | Version bump | Changelog section |
|---|---|---|
| `fix:` | Patch | Fixes |
| `feat:` | Minor | Features |
| `feat!:`, or any type with a `BREAKING CHANGE:` footer | Major | Breaking Changes |
| `docs:` | None | Documentation Changes |
| `perf:`, `refactor:`, `build:` | None | Their own section |
| `chore:` | None | Not listed |

Before version 1.0.0, each bump moves down one level: a breaking change bumps the minor version, and `feat:` bumps the patch version.

## Release a version

The release pipeline follows the one in [RxAngular](https://github.com/rx-angular/rx-angular). Nx Release versions each package in `packages/` on its own, from the commits since that package's last tag. A tag has the form `PROJECT@VERSION`, such as `looplock@0.3.1`.

Two manual GitHub Actions workflows run a release from `main`:

- **Release** bumps the versions, writes each package's `CHANGELOG.md`, commits, tags, pushes, and creates a GitHub release for each package. It runs as the release bot GitHub App.
- **Publish** builds each package and publishes every version that npm doesn't have yet. npm trusts the workflow as a trusted publisher, so the workflow needs no npm token.

To release a version, follow these steps:

1. In the repository on GitHub, click **Actions**, and then click **Release**.
1. Click **Run workflow**, select the `main` branch, and then click **Run workflow**. The run pushes a release commit and a tag for each released package.
1. After the Release run finishes, click **Publish**, and then run that workflow from `main` the same way. The run publishes the versions to npm.

To preview a release, run `npx nx release --skip-publish --dry-run` on an up-to-date `main`. The preview prints each version and changelog entry without changing anything.

### Set up the pipeline

The workflows need a one-time setup by a GitHub organization owner and an owner of the `@push-based` scope on npm. To set up the pipeline, follow these steps:

1. Create a GitHub App in the `push-based` organization with read and write access to **Contents**, and install the App on this repository. If `main` has branch protection, let the App bypass it, so the App can push the release commit.
1. In the repository settings, add the App's client ID as the `GH_APP_CLIENT_ID` variable, and add a private key of the App as the `GH_APP_PRIVATE_KEY` secret.
1. Make the first release from your machine, as described in the next section.
1. On npmjs.com, open the settings of `@push-based/looplock`, and add a GitHub Actions trusted publisher with the organization `push-based`, the repository `looplock`, and the workflow `publish.yml`.

### Make the first release

No `looplock@*` tag exists before the first release, and npm configures a trusted publisher in the settings of a package that exists. So the first release runs from a maintainer's machine. To make the first release, log in to npm, and then run the release on an up-to-date `main`:

```bash
npm login
GH_TOKEN=$(gh auth token) npx nx release 0.4.0 --first-release
```

The command releases the version that `packages/looplock/package.json` holds, and asks before it publishes to npm. Later releases start from the `looplock@0.4.0` tag and run through the workflows.
