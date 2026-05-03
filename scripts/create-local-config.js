#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

const UI_PORT_RANGE = {
  start: 3001,
  end: 3100,
};
const GATEWAY_PORT_RANGE = {
  start: 4001,
  end: 4100,
};
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const templatePath = path.join(scriptDir, "config-template.json");
const agentsSourceDir = path.join(scriptDir, "agents");
const outputDir = path.join(repoRoot, ".aihub");
const outputPath = path.join(outputDir, "aihub.json");
const agentsOutputDir = path.join(outputDir, "agents");

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port);
  });
}

async function findAvailablePort(range) {
  const ports = [];
  for (let port = range.start; port <= range.end; port += 1) {
    ports.push(port);
  }

  const results = await Promise.all(ports.map((port) => checkPort(port)));
  const index = results.findIndex(Boolean);

  if (index === -1) {
    throw new Error(
      `No available port found between ${range.start} and ${range.end}.`,
    );
  }

  return ports[index];
}

async function main() {
  const [template, gatewayPort, uiPort] = await Promise.all([
    readFile(templatePath, "utf8"),
    findAvailablePort(GATEWAY_PORT_RANGE),
    findAvailablePort(UI_PORT_RANGE),
  ]);
  const projectsRoot = path.join(repoRoot, ".aihub", "projects");
  const content = template
    .replaceAll("__GATEWAY_PORT__", String(gatewayPort))
    .replaceAll("__UI_PORT__", String(uiPort))
    .replaceAll("__PROJECTS_ROOT__", JSON.stringify(projectsRoot));

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content);
  await cp(agentsSourceDir, agentsOutputDir, { recursive: true });

  stdout.write(
    `Wrote ${path.relative(repoRoot, outputPath)} with gateway ${gatewayPort} and ui ${uiPort}\n`,
  );
  stdout.write(
    `Copied agents to ${path.relative(repoRoot, agentsOutputDir)}\n`,
  );
}

await main();
