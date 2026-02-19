#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { program, createProjectCommentHandler } from "@aihub/cli";

export { program, createProjectCommentHandler };

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  program.parseAsync(process.argv);
}
