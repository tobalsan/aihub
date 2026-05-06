import * as fs from "node:fs/promises";

export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    // Intentionally swallowed: stat failure means path doesn't exist or isn't a directory
    return false;
  }
}
