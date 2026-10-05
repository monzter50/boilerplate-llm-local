/**
 * A versioned package of the repo, named by the scope its commits use. The
 * root package is path "." and may exclude the folders of the others, as in
 * release-please's "exclude-paths".
 */
export type PackageDef = { name: string; path: string; exclude?: string[] };

const inside = (file: string, dir: string) =>
  file === dir || file.startsWith(`${dir}/`);

/**
 * Which packages a change touches. Each file belongs to the package with the
 * most specific path that contains it, so in a release-please monorepo
 * `packages/sdk/x.ts` is the sdk and `src/x.ts` is the root package. Decided
 * from paths in code, never by the model.
 */
export function packagesTouched(
  files: string[],
  packages: PackageDef[],
): string[] {
  const touched = new Set<string>();
  for (const file of files) {
    let best: PackageDef | undefined;
    for (const pkg of packages) {
      const matches =
        pkg.path === "."
          ? !(pkg.exclude ?? []).some((dir) => inside(file, dir))
          : inside(file, pkg.path);
      // "." has length 1, so any real folder is more specific.
      if (matches && (!best || pkg.path.length > best.path.length)) best = pkg;
    }
    if (best) touched.add(best.name);
  }
  // Declaration order, so the output is stable whatever order files come in.
  return packages.map((p) => p.name).filter((name) => touched.has(name));
}

/**
 * The scope to suggest: the one package touched, when it is a scope the
 * commit rules allow (or any is allowed). None when the change spans several.
 */
export function scopeHint(
  files: string[],
  packages: PackageDef[],
  allowedScopes: string[],
): string | undefined {
  const touched = packagesTouched(files, packages);
  const only = touched.length === 1 ? touched[0] : undefined;
  if (!only) return undefined;
  return allowedScopes.length === 0 || allowedScopes.includes(only)
    ? only
    : undefined;
}

export type DiffSummary = { text: string; truncated: boolean };

/**
 * Fits a unified diff into `budget` characters for a model with a small
 * context window. Every file keeps its header, so the model still sees what
 * changed where; the body of each file is cut to an equal share of the budget,
 * at a line boundary, with a note saying how much was left out.
 */
export function summarizeDiff(diff: string, budget: number): DiffSummary {
  if (diff.length <= budget) return { text: diff, truncated: false };

  const files = diff.split(/^(?=diff --git )/m).filter(Boolean);
  const share = Math.max(200, Math.floor(budget / files.length));

  const parts = files.map((file) => {
    if (file.length <= share) return file;
    const lines = file.split("\n");
    const kept: string[] = [];
    let size = 0;
    for (const line of lines) {
      if (size + line.length + 1 > share && kept.length > 0) break;
      kept.push(line);
      size += line.length + 1;
    }
    const dropped = lines.length - kept.length;
    return `${kept.join("\n")}\n[... ${dropped} more lines of this file left out]\n`;
  });

  return { text: parts.join(""), truncated: true };
}

/** Lockfiles and generated changelogs: noise to the model, listed but not shown. */
export const NOISE_PATHSPECS = [
  ":(exclude,glob)**/pnpm-lock.yaml",
  ":(exclude,glob)**/package-lock.json",
  ":(exclude,glob)**/yarn.lock",
  ":(exclude,glob)**/bun.lock",
  ":(exclude,glob)**/bun.lockb",
  ":(exclude,glob)**/CHANGELOG.md",
];
