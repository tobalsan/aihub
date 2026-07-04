import type { AccessResolver } from "./access.js";
import type { ForkStore } from "./forks.js";

/**
 * The pool-catalog resolver deep module. It isolates the branchy per-card
 * presentation logic of `AgentCatalog` from the backend access work: for a
 * given pool agent and the current user it resolves the fork state and the one
 * action the card should offer. Visibility is global (every card is always
 * listed) — only the action is gated here.
 *
 * The three action states (mirroring the ALG-346 acceptance criteria):
 *   - `chat`           — a fork exists and the user may chat it (a member of
 *                        the fork's team, or staff). Renders the Chat action.
 *   - `assign_to_team` — no fork exists yet AND the user is staff. Renders the
 *                        "Assign to team" flow so an admin can fork+assign.
 *   - `none`           — visible but not chattable: the fork is teamless, or
 *                        the user shares no team with it, or no fork exists and
 *                        the user is not staff. Renders no action.
 *
 * Staff (admin / superadmin) always get a usable `chat` for any existing fork
 * regardless of team membership; the staff bypass is layered here because this
 * module (unlike the pure `AccessResolver`) is handed the caller's role.
 */
export type PoolCatalogAction = "chat" | "assign_to_team" | "none";

export type PoolCatalogEntry = {
  /** The source pool agent id (the catalog card key). */
  poolId: string;
  /** True once the pool agent has been forked (regardless of team link). */
  forked: boolean;
  /**
   * The fork's agent id to chat, present only when `action === "chat"`. This is
   * the id the Chat action must route to (a fork is chatted, never the raw pool
   * definition).
   */
  chatAgentId: string | null;
  /** The single action the card should offer for this user. */
  action: PoolCatalogAction;
};

export type PoolCatalogResolver = {
  /** Resolve the action state for one pool agent and the current user. */
  resolvePoolAction(poolId: string, user: CatalogUser): PoolCatalogEntry;
  /** Resolve the action state for many pool agents at once (stable order). */
  resolvePoolActions(
    poolIds: string[],
    user: CatalogUser
  ): PoolCatalogEntry[];
};

/** The minimal current-user shape the resolver needs. */
export type CatalogUser = {
  id: string;
  /** True for admin/superadmin — grants the staff bypass. */
  isStaff: boolean;
};

export type PoolCatalogResolverDeps = {
  forks: ForkStore;
  access: AccessResolver;
};

export function createPoolCatalogResolver(
  deps: PoolCatalogResolverDeps
): PoolCatalogResolver {
  const { forks, access } = deps;

  function resolvePoolAction(
    poolId: string,
    user: CatalogUser
  ): PoolCatalogEntry {
    const fork = forks.getForkByPool(poolId);

    if (!fork) {
      // No fork yet. Staff can start the fork+assign flow; everyone else sees a
      // visible-but-inert card.
      return {
        poolId,
        forked: false,
        chatAgentId: null,
        action: user.isStaff ? "assign_to_team" : "none",
      };
    }

    // A fork exists. Staff always chat it; other users chat it only when they
    // share the fork's (non-null) team. A teamless fork is chattable by nobody
    // but staff. Reuse the pure access resolver so the membership rule stays in
    // one place.
    const chattable =
      user.isStaff || access.canUserChatAgent(user.id, fork.forkAgentId);

    if (chattable) {
      return {
        poolId,
        forked: true,
        chatAgentId: fork.forkAgentId,
        action: "chat",
      };
    }

    return { poolId, forked: true, chatAgentId: null, action: "none" };
  }

  function resolvePoolActions(
    poolIds: string[],
    user: CatalogUser
  ): PoolCatalogEntry[] {
    return poolIds.map((poolId) => resolvePoolAction(poolId, user));
  }

  return { resolvePoolAction, resolvePoolActions };
}
