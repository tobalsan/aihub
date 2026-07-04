import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureTeamMembersTable, ensureTeamsTable } from "./db.js";
import { createMembershipStore, type MembershipStore } from "./membership.js";
import { createTeamStore, type TeamStore } from "./teams.js";

let db: Database.Database;
let membership: MembershipStore;
let teams: TeamStore;

function seedUser(id: string): void {
  db.prepare("INSERT INTO user (id) VALUES (?)").run(id);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
  ensureTeamsTable(db);
  ensureTeamMembersTable(db);
  seedUser("admin-1");
  seedUser("user-1");
  seedUser("user-2");
  membership = createMembershipStore(db);
  teams = createTeamStore(db, membership);
});

afterEach(() => {
  db.close();
});

describe("membership store", () => {
  it("adds a member and lists both directions", () => {
    const team = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    membership.addMember(team.id, "user-1", "admin-1");

    expect(membership.listUsersForTeam(team.id)).toEqual(["user-1"]);
    expect(membership.listTeamsForUser("user-1")).toEqual([team.id]);
    expect(membership.isMember(team.id, "user-1")).toBe(true);
  });

  it("removes a member", () => {
    const team = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    membership.addMember(team.id, "user-1", "admin-1");
    membership.removeMember(team.id, "user-1");

    expect(membership.listUsersForTeam(team.id)).toEqual([]);
    expect(membership.listTeamsForUser("user-1")).toEqual([]);
    expect(membership.isMember(team.id, "user-1")).toBe(false);
  });

  it("is idempotent on add (no duplicate rows, no error)", () => {
    const team = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    membership.addMember(team.id, "user-1", "admin-1");
    expect(() =>
      membership.addMember(team.id, "user-1", "user-2")
    ).not.toThrow();

    expect(membership.listUsersForTeam(team.id)).toEqual(["user-1"]);
    // The original addedBy is preserved on a re-add.
    const row = db
      .prepare("SELECT addedBy FROM team_members WHERE teamId = ? AND userId = ?")
      .get(team.id, "user-1") as { addedBy: string };
    expect(row.addedBy).toBe("admin-1");
  });

  it("removing a non-member is a no-op", () => {
    const team = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    expect(() => membership.removeMember(team.id, "user-1")).not.toThrow();
    expect(membership.listUsersForTeam(team.id)).toEqual([]);
  });

  it("supports a user belonging to many teams", () => {
    const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    const beta = teams.createTeam({ name: "Beta", createdBy: "admin-1" });
    membership.addMember(alpha.id, "user-1", "admin-1");
    membership.addMember(beta.id, "user-1", "admin-1");

    expect(new Set(membership.listTeamsForUser("user-1"))).toEqual(
      new Set([alpha.id, beta.id])
    );
    expect(membership.listUsersForTeam(alpha.id)).toEqual(["user-1"]);
    expect(membership.listUsersForTeam(beta.id)).toEqual(["user-1"]);
  });

  it("supports a team holding many users", () => {
    const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    membership.addMember(alpha.id, "user-1", "admin-1");
    membership.addMember(alpha.id, "user-2", "admin-1");

    expect(membership.listUsersForTeam(alpha.id)).toEqual(["user-1", "user-2"]);
  });

  it("cascade-deletes memberships when a team is removed", () => {
    const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    membership.addMember(alpha.id, "user-1", "admin-1");
    teams.deleteTeam(alpha.id);

    expect(membership.listTeamsForUser("user-1")).toEqual([]);
  });

  describe("usersOnlyInTeam (teamless-set source)", () => {
    it("returns users whose only team is the target", () => {
      const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
      membership.addMember(alpha.id, "user-1", "admin-1");

      expect(membership.usersOnlyInTeam(alpha.id)).toEqual(["user-1"]);
    });

    it("excludes users who still belong to another team", () => {
      const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
      const beta = teams.createTeam({ name: "Beta", createdBy: "admin-1" });
      membership.addMember(alpha.id, "user-1", "admin-1");
      membership.addMember(beta.id, "user-1", "admin-1");

      // user-1 stays in beta, so deleting alpha would not orphan them.
      expect(membership.usersOnlyInTeam(alpha.id)).toEqual([]);
    });
  });

  it("deleteTeam populates teamlessUsers from real membership", () => {
    const alpha = teams.createTeam({ name: "Alpha", createdBy: "admin-1" });
    const beta = teams.createTeam({ name: "Beta", createdBy: "admin-1" });
    // user-1 only in alpha -> teamless when alpha is deleted.
    membership.addMember(alpha.id, "user-1", "admin-1");
    // user-2 in both -> not teamless.
    membership.addMember(alpha.id, "user-2", "admin-1");
    membership.addMember(beta.id, "user-2", "admin-1");

    const result = teams.deleteTeam(alpha.id);
    expect(result).toEqual({
      deleted: true,
      teamlessUsers: ["user-1"],
      teamlessAgents: [],
    });
  });
});
