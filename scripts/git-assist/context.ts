/** The packages release-please versions, named by their commit scope. */
export const PACKAGES = ["server", "contracts", "sdk", "web"] as const;
export type PackageName = (typeof PACKAGES)[number];

/**
 * Which packages a change touches, with the same rules as
 * release-please-config.json: the server is everything outside sdk/, web/ and
 * packages/. Decided from paths in code, never by the model.
 */
export function packagesTouched(paths: string[]): PackageName[] {
  const touched = new Set<PackageName>();
  for (const path of paths) {
    if (path.startsWith("packages/contracts/")) touched.add("contracts");
    else if (path.startsWith("sdk/")) touched.add("sdk");
    else if (path.startsWith("web/")) touched.add("web");
    else if (!path.startsWith("packages/")) touched.add("server");
  }
  return PACKAGES.filter((name) => touched.has(name));
}

/** The scope to suggest: one package, or none when the change spans several. */
export function scopeHint(paths: string[]): PackageName | undefined {
  const touched = packagesTouched(paths);
  return touched.length === 1 ? touched[0] : undefined;
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
