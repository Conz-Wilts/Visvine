import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Thrown inside the serializable guard transaction to abort a role change /
 * removal that would strip the community's last admin. Callers map it to a
 * 409 `last_admin_protected` response.
 */
export class LastAdminError extends Error {}

type GuardArgs = {
  communityId: string;
  /** The membership rows being demoted/removed by the caller's mutation. */
  userIds: string[];
  /**
   * Whether to enforce the last-admin invariant. Demotions to `admin` (i.e. a
   * no-op for admin headcount) pass `false` so the guard is skipped, matching
   * the bulk route's `data.role !== "admin"` condition.
   */
  guard: boolean;
};

/**
 * Runs `mutate` inside a Serializable transaction, first enforcing that the
 * community keeps at least one admin.
 *
 * Last-admin protection and the mutation must be atomic: two concurrent
 * demotes can otherwise each pass the guard against the same snapshot and
 * together strip every admin. Serializable isolation turns that into a
 * serialization failure rather than a lost invariant.
 *
 * The guard counts the community's current admins and how many of `userIds`
 * are admins being demoted/removed; if that would drop the admin count below
 * one it throws {@link LastAdminError}. When `guard` is false the check is
 * skipped (e.g. a promotion/change that leaves admins untouched).
 */
export async function guardLastAdminThenMutate<T>(
  { communityId, userIds, guard }: GuardArgs,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      if (guard) {
        const adminCount = await tx.userCommunity.count({
          where: { communityId, role: "admin" },
        });
        const adminsBeingRemoved = await tx.userCommunity.count({
          where: { communityId, userId: { in: userIds }, role: "admin" },
        });
        if (adminCount - adminsBeingRemoved < 1) throw new LastAdminError();
      }
      return mutate(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
