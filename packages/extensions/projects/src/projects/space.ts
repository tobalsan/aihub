export {
  buildSpaceDefaults,
  isSpaceWriteLeaseEnabled,
  normalizeStringList,
  parseSpaceFile,
  SpaceStateStore,
} from "./space-state.js";

export type {
  IntegrationEntry,
  IntegrationStatus,
  ProjectSpace,
  ProjectSpaceResult,
  SpaceCommitSummary,
  SpaceContribution,
  SpaceFile,
  SpaceQueueEntry,
  SpaceRebaseConflict,
  SpaceWriteLease,
  SpaceWriteLeaseResult,
} from "./space-state.js";

export { getGitHead, SpaceGitAdapter } from "./space-git.js";

export {
  acquireProjectSpaceWriteLease,
  cleanupSpaceWorktrees,
  clearProjectSpaceRebaseConflict,
  ensureProjectSpace,
  getProjectSpace,
  getProjectSpaceCommitLog,
  getProjectSpaceConflictContext,
  getProjectSpaceContribution,
  getProjectSpaceWriteLease,
  integrateProjectSpaceQueue,
  integrateSpaceEntries,
  mergeSpaceIntoBase,
  pruneProjectRepoWorktrees,
  rebaseSpaceOntoMain,
  recordWorkerDelivery,
  releaseProjectSpaceWriteLease,
  skipSpaceEntries,
  SpaceIntegrationPolicy,
} from "./space-policy.js";

export type {
  RecordWorkerDeliveryInput,
  SpaceCleanupSummary,
  SpaceMergeResult,
} from "./space-policy.js";

