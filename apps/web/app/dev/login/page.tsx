import { notFound } from "next/navigation";
import { isDevAuthEnabled } from "@/lib/dev-auth";
import { safeRelativePath } from "@/lib/redirects";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  if (!isDevAuthEnabled()) notFound();

  const { callbackUrl: rawCallback } = await searchParams;
  const callbackUrl = safeRelativePath(rawCallback);
  const loginAsQuery =
    callbackUrl === "/" ? "" : `?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@local.dev" } },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { email: "asc" },
  });

  // UserAlias carries no FK to User (the repo keeps relations off the large
  // User model), so the aliases come back in a second query.
  const held = await prisma.userAlias.findMany({
    where: { userId: { in: users.map((u) => u.id) } },
    select: { userId: true, aliasName: true },
  });
  const aliasNames = new Map<string, string[]>();
  for (const h of held) {
    aliasNames.set(h.userId, [...(aliasNames.get(h.userId) ?? []), h.aliasName]);
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Dev login</h1>
      <p style={styles.note}>
        Local-only. Available because <code>ENABLE_DEV_AUTH=true</code> and{" "}
        <code>NODE_ENV=development</code>. Click a user to log straight in.
      </p>
      {users.length === 0 ? (
        <p style={styles.empty}>
          No seeded users found. Run <code>pnpm db:seed</code> first.
        </p>
      ) : (
        <ul style={styles.list}>
          {users.map((u) => {
            const aliases = aliasNames.get(u.id) ?? [];
            return (
              <li key={u.id} style={styles.item}>
                <div style={styles.row}>
                  <form
                    action={`/api/dev/login-as/${u.id}${loginAsQuery}`}
                    method="POST"
                    style={styles.loginForm}
                  >
                    <button type="submit" style={styles.button}>
                      <span style={styles.name}>{u.name}</span>
                      <span style={styles.meta}>
                        {u.email} · {aliases.length ? aliases.join(", ") : "no aliases"}
                      </span>
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

const styles = {
  main: {
    maxWidth: 560,
    margin: "48px auto",
    padding: "0 24px",
    fontFamily: "system-ui, sans-serif",
  },
  h1: { fontSize: 24, fontWeight: 600, marginBottom: 8 },
  note: { color: "#666", marginBottom: 24, lineHeight: 1.5 },
  empty: { color: "#888" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: { marginBottom: 8 },
  row: { display: "flex", gap: 8, alignItems: "stretch" },
  loginForm: { flex: 1 },
  button: {
    width: "100%",
    height: "100%",
    textAlign: "left" as const,
    padding: "12px 16px",
    border: "1px solid #ddd",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  name: { fontWeight: 600, fontSize: 15 },
  meta: { fontSize: 13, color: "#666" },
};
