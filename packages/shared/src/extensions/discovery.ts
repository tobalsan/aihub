import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Extension } from "../types.js";
import { ExtensionDefinitionSchema } from "../types.js";

export type DiscoveredExtension = {
  id: string;
  extension: Extension;
  path: string;
};

export async function discoverExternalExtensions(
  directoryPath: string
): Promise<DiscoveredExtension[]> {
  const discovered: DiscoveredExtension[] = [];
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return discovered;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const isDirectory =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (await stat(entryPath).then(
          (s) => s.isDirectory(),
          () => false
        )));

    if (!isDirectory) continue;

    const indexPath = path.join(entryPath, "index.js");
    try {
      await access(indexPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      console.warn(
        `Failed to load extension at ${entryPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }

    try {
      const module = await import(pathToFileURL(indexPath).href);
      const raw = module.default ?? module;
      const result = ExtensionDefinitionSchema.safeParse(raw);

      if (!result.success) {
        console.warn(
          `Invalid extension at ${entryPath}: ${result.error.issues
            .map((i) => i.message)
            .join(", ")}`
        );
        continue;
      }

      const extension = raw as Extension;
      discovered.push({ id: extension.id, extension, path: entryPath });
    } catch (error) {
      console.warn(
        `Failed to load extension at ${entryPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return discovered;
}
