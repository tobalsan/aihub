import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerConnector } from "./registry.js";
import { ConnectorDefinitionSchema } from "./types.js";

export async function discoverExternalConnectors(
  directoryPath: string
): Promise<void> {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const isDirectory =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (await stat(entryPath).then(
          (value) => value.isDirectory(),
          () => false
        )));

    if (!isDirectory) {
      continue;
    }

    const indexPath = path.join(entryPath, "index.js");

    try {
      await access(indexPath);
      const module = await import(pathToFileURL(indexPath).href);
      const result = ConnectorDefinitionSchema.safeParse(module.default);

      if (!result.success) {
        console.warn(
          `Invalid connector at ${entryPath}: ${result.error.issues
            .map((issue) => issue.message)
            .join(", ")}`
        );
        continue;
      }

      registerConnector(result.data);
    } catch (error) {
      console.warn(
        `Failed to load connector at ${entryPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
