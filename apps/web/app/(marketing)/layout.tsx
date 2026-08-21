import { headers } from "next/headers";
import MarketingShell from "@/features/marketing/components/MarketingShell";
import { isDevAuthEnabled } from "@/lib/dev-auth";

/** The desktop shell tags its user agent (`desktopUserAgent` in apps/desktop). */
const DESKTOP_UA = /\bVisvineDesktop\//;

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const desktop = DESKTOP_UA.test((await headers()).get("user-agent") ?? "");
  return (
    <MarketingShell devAuthEnabled={isDevAuthEnabled()} desktop={desktop}>
      {children}
    </MarketingShell>
  );
}
