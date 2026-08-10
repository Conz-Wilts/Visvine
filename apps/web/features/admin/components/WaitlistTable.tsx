import { formatBlogDate } from "@/lib/blog/dates";

interface WaitlistEntry {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  linkedin: string | null;
  createdAt: Date;
}

interface WaitlistTableProps {
  entries: WaitlistEntry[];
}

/**
 * Read-only table of waitlist sign-ups for the admin console.
 * Server component — receives Prisma rows (Date intact) and renders directly.
 */
export default function WaitlistTable({ entries }: WaitlistTableProps) {
  if (entries.length === 0) {
    return (
      <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
        No one on the waitlist yet.
      </p>
    );
  }

  return (
    <div className="mt-12">
      <p className="mb-4 text-sm text-neutral-500">
        {entries.length} {entries.length === 1 ? "person" : "people"} on the waitlist
      </p>
      <div className="overflow-x-auto border-t border-neutral-200">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="py-3 pr-4 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Name
              </th>
              <th className="py-3 pr-4 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Email
              </th>
              <th className="py-3 pr-4 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                LinkedIn
              </th>
              <th className="py-3 text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">
                Joined
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="py-4 pr-4 align-top text-sm font-medium text-black">
                  {entry.firstName} {entry.lastName}
                </td>
                <td className="py-4 pr-4 align-top text-sm text-neutral-700">
                  <a
                    href={`mailto:${entry.email}`}
                    className="underline decoration-neutral-300 underline-offset-2 transition hover:decoration-black"
                  >
                    {entry.email}
                  </a>
                </td>
                <td className="py-4 pr-4 align-top text-sm text-neutral-700">
                  {entry.linkedin ? (
                    <a
                      href={entry.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-neutral-300 underline-offset-2 transition hover:decoration-black"
                    >
                      Profile →
                    </a>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="py-4 align-top text-sm text-neutral-500">
                  {formatBlogDate(entry.createdAt, "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
