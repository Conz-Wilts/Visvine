export function safeRelativePath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
