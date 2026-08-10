import { NextResponse } from 'next/server';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getSession();
  if (!session || !isSuperAdmin(session.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const columns = await prisma.$queryRaw<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }[]>`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const foreignKeys = await prisma.$queryRaw<{
    constraint_name: string;
    source_table: string;
    source_column: string;
    target_table: string;
    target_column: string;
  }[]>`
    SELECT
      tc.constraint_name,
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `;

  const tableNames = tables.map((t) => t.table_name);
  const rowCounts: Record<string, number> = {};
  for (const tableName of tableNames) {
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) AS count FROM "${tableName}"`
    );
    rowCounts[tableName] = Number(result[0]?.count ?? 0);
  }

  return NextResponse.json({ tables: tableNames, columns, foreignKeys, rowCounts });
}
