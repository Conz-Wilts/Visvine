import MarketingShell from "@/components/marketing/MarketingShell";
import { isDevAuthEnabled } from "@/lib/dev-auth";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MarketingShell devAuthEnabled={isDevAuthEnabled()}>
      {children}
    </MarketingShell>
  );
}
