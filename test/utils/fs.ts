import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A throwaway directory with these files (path → content), for code that reads
 * a project's layout. Call `cleanup` when done, e.g. in afterEach.
 */
export function tempDir(files: Record<string, string> = {}): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "test-"));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
