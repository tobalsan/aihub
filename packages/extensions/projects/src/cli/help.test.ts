import { describe, expect, it } from "vitest";
import { createProjectsCommand } from "./index.js";

function getCommandHelp(name: string): string {
  const command = createProjectsCommand().commands.find(
    (candidate) => candidate.name() === name
  );
  if (!command) throw new Error(`Command not found: ${name}`);
  return command.helpInformation();
}

describe("projects CLI help", () => {
  it("does not advertise deprecated agent management command", () => {
    const help = createProjectsCommand().helpInformation();

    expect(help).not.toContain("agent");
  });

  it("does not advertise deprecated create metadata flags", () => {
    const help = getCommandHelp("create");

    expect(help).toContain("--title <title>");
    expect(help).toContain("--specs <content>");
    expect(help).toContain("--status <status>");
    expect(help).toContain("--area <area>");
    expect(help).not.toContain("--domain");
    expect(help).not.toContain("--owner");
    expect(help).not.toContain("--execution-mode");
    expect(help).not.toContain("--appetite");
  });
});
