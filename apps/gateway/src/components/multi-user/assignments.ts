import type Database from "better-sqlite3";

export type AgentAssignment = {
  userId: string;
  agentId: string;
  assignedBy: string;
  assignedAt: string;
};

export type AgentAssignmentStore = {
  getAssignmentsForUser(userId: string): string[];
  getAssignmentsForAgent(agentId: string): string[];
  getAllAssignments(): AgentAssignment[];
  setAssignmentsForAgent(
    agentId: string,
    userIds: string[],
    assignedBy: string
  ): void;
  removeAssignment(userId: string, agentId: string): void;
};

export function createAgentAssignmentStore(
  db: Database.Database
): AgentAssignmentStore {
  const getAssignmentsForUserStatement = db.prepare(
    "SELECT agentId FROM agent_assignments WHERE userId = ? ORDER BY agentId"
  );
  const getAssignmentsForAgentStatement = db.prepare(
    "SELECT userId FROM agent_assignments WHERE agentId = ? ORDER BY userId"
  );
  const getAllAssignmentsStatement = db.prepare(`
    SELECT userId, agentId, assignedBy, assignedAt
    FROM agent_assignments
    ORDER BY agentId, userId
  `);
  const deleteAssignmentsForAgentStatement = db.prepare(
    "DELETE FROM agent_assignments WHERE agentId = ?"
  );
  const insertAssignmentStatement = db.prepare(`
    INSERT INTO agent_assignments (userId, agentId, assignedBy)
    VALUES (?, ?, ?)
  `);
  const removeAssignmentStatement = db.prepare(
    "DELETE FROM agent_assignments WHERE userId = ? AND agentId = ?"
  );

  const setAssignmentsForAgentTransaction = db.transaction(
    (agentId: string, userIds: string[], assignedBy: string) => {
      deleteAssignmentsForAgentStatement.run(agentId);
      for (const userId of [...new Set(userIds)]) {
        insertAssignmentStatement.run(userId, agentId, assignedBy);
      }
    }
  );

  return {
    getAssignmentsForUser(userId) {
      return (
        getAssignmentsForUserStatement.all(userId) as Array<{ agentId: string }>
      ).map((row) => row.agentId);
    },
    getAssignmentsForAgent(agentId) {
      return (
        getAssignmentsForAgentStatement.all(agentId) as Array<{
          userId: string;
        }>
      ).map((row) => row.userId);
    },
    getAllAssignments() {
      return getAllAssignmentsStatement.all() as AgentAssignment[];
    },
    setAssignmentsForAgent(agentId, userIds, assignedBy) {
      setAssignmentsForAgentTransaction(agentId, userIds, assignedBy);
    },
    removeAssignment(userId, agentId) {
      removeAssignmentStatement.run(userId, agentId);
    },
  };
}
