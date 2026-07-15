import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { FieldDefinition } from "@/lib/schemas/crm";
import { parseCsvRows } from "@/lib/crm/csv";

type ImportOutcome =
  | "created"
  | "matched_shadow"
  | "matched_active"
  | "already_member";

export interface ImportRowResult {
  row: number;
  email: string;
  outcome?: ImportOutcome;
  error?: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  matched_shadow: number;
  matched_active: number;
  already_member: number;
  errors: number;
}

/** Parses a CSV string into lowercased headers + keyed data rows. */
export function parseCSV(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  return parseCsvRows(csv);
}

/**
 * Processes a parsed CSV for a community. For each row:
 * - Validates email + name
 * - Upserts user (shadow if new, skip public_meta if active)
 * - Upserts community membership with private_meta from CSV
 * - Deduplicates emails within the batch
 */
export async function processImport(
  communityId: string,
  actorId: string,
  csvRows: Record<string, string>[],
  privateFields: FieldDefinition[]
): Promise<{ results: ImportRowResult[]; summary: ImportSummary }> {
  const privateKeys = new Set(privateFields.map((f) => f.key));
  const seenEmails = new Set<string>();
  const results: ImportRowResult[] = [];

  const summary: ImportSummary = {
    total: csvRows.length,
    created: 0,
    matched_shadow: 0,
    matched_active: 0,
    already_member: 0,
    errors: 0,
  };

  for (let i = 0; i < csvRows.length; i++) {
    const rowNum = i + 2; // 1-indexed, skip header row
    const row = csvRows[i];
    const email = row["email"]?.trim().toLowerCase();
    const name = row["name"]?.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.push({ row: rowNum, email: email ?? "", error: "Invalid or missing email" });
      summary.errors++;
      continue;
    }

    if (!name) {
      results.push({ row: rowNum, email, error: "Missing required field: name" });
      summary.errors++;
      continue;
    }

    if (seenEmails.has(email)) {
      results.push({ row: rowNum, email, error: "Duplicate email in this import file" });
      summary.errors++;
      continue;
    }
    seenEmails.add(email);

    // Build publicMeta from CSV public fields
    const publicMetaFromCsv: Record<string, string> = { name };
    if (row["headline"]) publicMetaFromCsv["headline"] = row["headline"].trim();
    if (row["bio"]) publicMetaFromCsv["bio"] = row["bio"].trim();
    if (row["location"]) publicMetaFromCsv["location"] = row["location"].trim();

    // Build privateMeta from CSV private fields
    const privateMeta: Record<string, string> = {};
    for (const key of privateKeys) {
      if (row[key] !== undefined && row[key] !== "") {
        privateMeta[key] = row[key].trim();
      }
    }

    try {
      let outcome: ImportOutcome;

      const existing = await prisma.user.findUnique({ where: { email } });

      if (!existing) {
        // Create shadow user
        const newUser = await prisma.user.create({
          data: {
            email,
            name,
            isActive: false,
            publicMeta: publicMetaFromCsv as Prisma.InputJsonObject,
          },
        });

        await prisma.userCommunity.create({
          data: {
            userId: newUser.id,
            communityId,
            addedBy: actorId,
            privateMeta: privateMeta as Prisma.InputJsonObject,
          },
        });

        outcome = "created";
        summary.created++;
      } else if (!existing.isActive) {
        // Shadow profile — merge public_meta (existing wins, CSV fills gaps)
        const existingMeta = (existing.publicMeta as Record<string, unknown>) ?? {};
        const mergedMeta: Record<string, unknown> = { ...publicMetaFromCsv, ...existingMeta };

        await prisma.user.update({
          where: { id: existing.id },
          data: { publicMeta: mergedMeta as Prisma.InputJsonObject },
        });

        // Upsert community membership
        const existingMembership = await prisma.userCommunity.findUnique({
          where: { userId_communityId: { userId: existing.id, communityId } },
        });

        if (existingMembership) {
          // Merge private_meta (existing wins)
          const mergedPrivate = {
            ...privateMeta,
            ...(existingMembership.privateMeta as Record<string, unknown>),
          };
          await prisma.userCommunity.update({
            where: { userId_communityId: { userId: existing.id, communityId } },
            data: { privateMeta: mergedPrivate as Prisma.InputJsonObject },
          });
          outcome = "already_member";
          summary.already_member++;
        } else {
          await prisma.userCommunity.create({
            data: {
              userId: existing.id,
              communityId,
              addedBy: actorId,
              privateMeta: privateMeta as Prisma.InputJsonObject,
            },
          });
          outcome = "matched_shadow";
          summary.matched_shadow++;
        }
      } else {
        // Active user — never touch their public data
        const existingMembership = await prisma.userCommunity.findUnique({
          where: { userId_communityId: { userId: existing.id, communityId } },
        });

        if (existingMembership) {
          // Merge private_meta only (existing wins)
          const mergedPrivate = {
            ...privateMeta,
            ...(existingMembership.privateMeta as Record<string, unknown>),
          };
          await prisma.userCommunity.update({
            where: { userId_communityId: { userId: existing.id, communityId } },
            data: { privateMeta: mergedPrivate as Prisma.InputJsonObject },
          });
          outcome = "already_member";
          summary.already_member++;
        } else {
          await prisma.userCommunity.create({
            data: {
              userId: existing.id,
              communityId,
              addedBy: actorId,
              privateMeta: privateMeta as Prisma.InputJsonObject,
            },
          });
          outcome = "matched_active";
          summary.matched_active++;
        }
      }

      results.push({ row: rowNum, email, outcome });
    } catch (err) {
      results.push({ row: rowNum, email, error: String(err) });
      summary.errors++;
    }
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorId,
      communityId,
      action: "csv_import",
      diff: { summary } as unknown as Prisma.InputJsonObject,
    },
  });

  return { results, summary };
}
