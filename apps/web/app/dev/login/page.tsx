import { notFound } from "next/navigation";
import { isDevAuthEnabled } from "@/lib/dev-auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DevLoginPage() {
  if (!isDevAuthEnabled()) notFound();

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@local.dev" } },
    select: {
      id: true,
      name: true,
      email: true,
      userCommunities: { select: { role: true } },
    },
    orderBy: { email: "asc" },
  });

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Dev login</h1>
      <p style={styles.note}>
        Local-only. Pick a seeded user to sign in as. Available because{" "}
        <code>ENABLE_DEV_AUTH=true</code> and <code>NODE_ENV=development</code>.
      </p>
      {users.length === 0 ? (
        <p style={styles.empty}>
          No seeded users found. Run <code>pnpm db:seed</code> first.
        </p>
      ) : (
        <ul style={styles.list}>
          {users.map((u) => {
            const role = u.userCommunities[0]?.role ?? "member";
            return (
              <li key={u.id} style={styles.item}>
                <form action={`/api/dev/login-as/${u.id}`} method="POST">
                  <button type="submit" style={styles.button}>
                    <span style={styles.name}>{u.name}</span>
                    <span style={styles.meta}>
                      {u.email} · {role}
                    </span>
                  </button>
                </form>
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
  button: {
    width: "100%",
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
