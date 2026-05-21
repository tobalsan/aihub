type ImpersonationEntry = {
  targetUserId: string;
  startedAt: Date;
};

const entries = new Map<string, ImpersonationEntry>();

export function startImpersonation(sessionId: string, targetUserId: string): void {
  entries.set(sessionId, { targetUserId, startedAt: new Date() });
}

export function endImpersonation(sessionId: string): void {
  entries.delete(sessionId);
}

export function getImpersonation(sessionId: string): ImpersonationEntry | null {
  return entries.get(sessionId) ?? null;
}

export function logImpersonationEvent(input: {
  action: "start" | "exit";
  adminId: string;
  targetId: string;
}): void {
  console.info(
    `[impersonate] admin=${input.adminId} target=${input.targetId} action=${input.action} ts=${new Date().toISOString()}`
  );
}
