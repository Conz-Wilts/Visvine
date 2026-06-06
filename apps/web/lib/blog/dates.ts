export function formatBlogDate(d: Date | null, fallback = ""): string {
  if (!d) return fallback;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
