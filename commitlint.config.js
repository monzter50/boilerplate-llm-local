// Commit messages feed release-please: their type decides the version bump and
// the changelog section. Keep `types` and `scopes` in sync with
// .github/workflows/pr-title.yml, which checks PR titles the same way.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "docs",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // Optional, but when given it must name a package (see CONTRIBUTING.md).
    "scope-enum": [
      2,
      "always",
      ["server", "sdk", "contracts", "web", "deps", "release"],
    ],
    // "feat: Add x" and "feat: add x" are both fine, as in the PR title check.
    "subject-case": [0],
    // Warn, don't block: release-please never reads the body, and URLs or
    // pasted error messages are legitimately longer than 100 characters.
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
  },
};
