import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../../../test/utils/fs.js";
import {
  checksFromPackageJson,
  loadSettings,
  packagesFromReleasePlease,
  readDotEnv,
} from "./config.js";

const cleanups: (() => void)[] = [];
function repo(files: Record<string, string>) {
  const { dir, cleanup } = tempDir(files);
  cleanups.push(cleanup);
  return dir;
}
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("loadSettings", () => {
  it("works in a bare repo with nothing configured", () => {
    const settings = loadSettings(repo({}), {});

    expect(settings).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      model: undefined,
      base: "main",
      diffChars: 6000,
      packages: [],
      checks: [],
      prTemplate: null,
    });
  });

  it("learns packages, checks and the PR template from the repo", () => {
    const settings = loadSettings(
      repo({
        "release-please-config.json": JSON.stringify({
          packages: {
            ".": { component: "server", "exclude-paths": ["sdk"] },
            sdk: { "package-name": "@acme/sdk" },
          },
        }),
        "package.json": JSON.stringify({
          scripts: { test: "vitest", lint: "eslint .", build: "tsc" },
        }),
        "yarn.lock": "",
        ".github/pull_request_template.md": "## Summary\n",
      }),
      {},
    );

    expect(settings.packages).toEqual([
      { name: "server", path: ".", exclude: ["sdk"] },
      { name: "sdk", path: "sdk", exclude: undefined },
    ]);
    expect(settings.checks).toEqual([
      { name: "yarn lint", command: ["yarn", "lint"] },
      { name: "yarn test", command: ["yarn", "test"] },
    ]);
    expect(settings.prTemplate).toBe("## Summary\n");
  });

  it("prefers the environment, then .env, then .git-assist.json", () => {
    const dir = repo({
      ".git-assist.json": JSON.stringify({
        model: "from-file",
        base: "develop",
        diffChars: 3000,
        packages: { api: "services/api" },
      }),
      ".env": "GIT_ASSIST_MODEL=from-dotenv\nGIT_ASSIST_BASE=trunk\n",
    });

    const settings = loadSettings(dir, { GIT_ASSIST_MODEL: "from-env" });

    expect(settings.model).toBe("from-env");
    expect(settings.base).toBe("trunk");
    expect(settings.diffChars).toBe(3000);
    expect(settings.packages).toEqual([{ name: "api", path: "services/api" }]);
  });

  it("names the file when .git-assist.json is broken", () => {
    expect(() =>
      loadSettings(repo({ ".git-assist.json": "{ nope" }), {}),
    ).toThrow(/\.git-assist\.json is not valid JSON/);
  });
});

describe("readDotEnv", () => {
  it("takes only git-assist's own keys, never the project's secrets", () => {
    const dir = repo({
      ".env": [
        "GIT_ASSIST_MODEL=gemma",
        "LMSTUDIO_BASE_URL=http://box:1234/v1",
        "DATABASE_URL=postgres://secret",
        "OPENAI_API_KEY=sk-secret",
        "GIT_ASSIST_BASE=",
      ].join("\n"),
    });

    expect(readDotEnv(dir)).toEqual({
      GIT_ASSIST_MODEL: "gemma",
      LMSTUDIO_BASE_URL: "http://box:1234/v1",
    });
  });
});

describe("packagesFromReleasePlease", () => {
  it("names packages by component, else package name without its scope", () => {
    expect(
      packagesFromReleasePlease({
        packages: {
          "packages/contracts": { component: "contracts" },
          "packages/ui/": { "package-name": "@acme/ui" },
        },
      }),
    ).toEqual([
      { name: "contracts", path: "packages/contracts", exclude: undefined },
      { name: "ui", path: "packages/ui", exclude: undefined },
    ]);
  });
});

describe("checksFromPackageJson", () => {
  it("runs the repo's scripts with its own package manager", () => {
    const scripts = JSON.stringify({
      scripts: { typecheck: "tsc", test: "vitest" },
    });

    expect(
      checksFromPackageJson(
        repo({ "package.json": scripts, "pnpm-lock.yaml": "" }),
      ).map((c) => c.name),
    ).toEqual(["pnpm typecheck", "pnpm test"]);
    expect(
      checksFromPackageJson(repo({ "package.json": scripts })).map(
        (c) => c.name,
      ),
    ).toEqual(["npm run typecheck", "npm run test"]);
  });
});
