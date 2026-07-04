import type Database from "better-sqlite3";

export type TeamMember = {
  teamId: string;
  userId: string;
  addedBy: string;
  addedAt: string;
};

/**
 * The membership deep module. Owns the many-to-many user↔team relationship:
 * a user may belong to many teams and a team may hold many users. `addMember`
 * is idempotent — adding a user who is already a member is a no-op that does
 * not error or change `addedBy`/`addedAt`.
 */
export type MembershipStore = {
  addMember(teamId: string, userId: string, addedBy: string): void;
  removeMember(teamId: string, userId: string): void;
  isMember(teamId: string, userId: string): boolean;
  /** Team ids the given user belongs to. */
  listTeamsForUser(userId: string): string[];
  /** User ids that belong to the given team. */
  listUsersForTeam(teamId: string): string[];
  /**
   * Of the given user ids, those whose only remaining team is `teamId` — i.e.
   * the users who would be left teamless if `teamId` were deleted. Used to
   * populate the delete-team confirmation warning.
   */
  usersOnlyInTeam(teamId: string): string[];
};

export function createMembershipStore(db: Database.Database): MembershipStore {
  // ON CONFLICT DO NOTHING keeps add idempotent: a duplicate (teamId, userId)
  // is silently ignored rather than raising a UNIQUE/PK violation.
  const insertStatement = db.prepare(`
    INSERT INTO team_members (teamId, userId, addedBy)
    VALUES (?, ?, ?)
    ON CONFLICT (teamId, userId) DO NOTHING
  `);
  const removeStatement = db.prepare(
    "DELETE FROM team_members WHERE teamId = ? AND userId = ?"
  );
  const isMemberStatement = db.prepare(
    "SELECT 1 FROM team_members WHERE teamId = ? AND userId = ?"
  );
  const teamsForUserStatement = db.prepare(
    "SELECT teamId FROM team_members WHERE userId = ? ORDER BY teamId"
  );
  const usersForTeamStatement = db.prepare(
    "SELECT userId FROM team_members WHERE teamId = ? ORDER BY userId"
  );
  // Users in `teamId` whose total team count is exactly 1 — they belong to no
  // other team, so deleting this team would leave them teamless.
  const usersOnlyInTeamStatement = db.prepare(`
    SELECT member.userId AS userId
    FROM team_members AS member
    WHERE member.teamId = ?
      AND (
        SELECT COUNT(*) FROM team_members AS other
        WHERE other.userId = member.userId
      ) = 1
    ORDER BY member.userId
  `);

  return {
    addMember(teamId, userId, addedBy) {
      insertStatement.run(teamId, userId, addedBy);
    },
    removeMember(teamId, userId) {
      removeStatement.run(teamId, userId);
    },
    isMember(teamId, userId) {
      return isMemberStatement.get(teamId, userId) !== undefined;
    },
    listTeamsForUser(userId) {
      return (
        teamsForUserStatement.all(userId) as Array<{ teamId: string }>
      ).map((row) => row.teamId);
    },
    listUsersForTeam(teamId) {
      return (
        usersForTeamStatement.all(teamId) as Array<{ userId: string }>
      ).map((row) => row.userId);
    },
    usersOnlyInTeam(teamId) {
      return (
        usersOnlyInTeamStatement.all(teamId) as Array<{ userId: string }>
      ).map((row) => row.userId);
    },
  };
}
