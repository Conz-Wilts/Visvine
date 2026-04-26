// Server component — can export route segment config
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

import AuthLayoutClient from './AuthLayoutClient';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayoutClient>{children}</AuthLayoutClient>;
}
