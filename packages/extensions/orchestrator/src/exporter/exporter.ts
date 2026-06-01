import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { LinearClient } from "../linear/client.js";

export async function exportLinear(input: { client: LinearClient; teamKey: string; outDir: string }): Promise<{ exported: number; skipped: number; durationMs: number }> {
  const start = Date.now();
  const data = await input.client.graphql<any>(`query Export($teamKey: String!) { issues(filter: { team: { key: { eq: $teamKey } } }) { nodes { identifier title description url state { name } labels { nodes { name } } project { name } parent { id } assignee { name } createdAt updatedAt comments { nodes { body createdAt user { name } } } } } }`, { teamKey: input.teamKey });
  await fs.mkdir(input.outDir, { recursive: true });
  let exported = 0;
  for (const issue of data.issues.nodes) {
    const fm = { identifier: issue.identifier, title: issue.title, url: issue.url, state: issue.state?.name, labels: issue.labels?.nodes?.map((l: any) => l.name) ?? [], project: issue.project?.name, parent: issue.parent?.id, assignee: issue.assignee?.name, createdAt: issue.createdAt, updatedAt: issue.updatedAt };
    const comments = (issue.comments?.nodes ?? []).map((c: any) => `\n## Comment — ${c.createdAt} — ${c.user?.name ?? "unknown"}\n\n${c.body ?? ""}`).join("\n");
    const content = `---\n${yaml.dump(fm)}---\n\n${issue.description ?? ""}\n${comments}\n`;
    const file = path.join(input.outDir, `${issue.identifier}.md`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, file);
    exported++;
  }
  return { exported, skipped: 0, durationMs: Date.now() - start };
}
