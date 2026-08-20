import { redirect } from "next/navigation";
import Image from "next/image";
import { getShadowProfilePreview } from "@/lib/crm/claimService";
import PersonSilhouette from "@/components/ui/PersonSilhouette";
import { ClaimActions } from "./ClaimActions";

interface ClaimPageProps {
  searchParams: Promise<{ token?: string; callbackUrl?: string }>;
}

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const { token, callbackUrl } = await searchParams;

  if (!token) {
    redirect("/signin");
  }

  const profile = await getShadowProfilePreview(token);

  if (!profile) {
    // Token expired, invalid, or nonce already consumed
    redirect("/signin?error=claim_expired");
  }

  const destination = callbackUrl ?? "/directory";

  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-1 rounded-xl shadow-float overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-1">
            We found a profile for you
          </h1>
          <p className="text-sm text-text-muted">
            Someone has already added you to a space. Claim your profile to
            take control.
          </p>
        </div>

        {/* Profile preview */}
        <div className="px-8 pb-6 flex items-center gap-4">
          {profile.avatarUrl ? (
            <Image
              src={profile.avatarUrl}
              alt={profile.name}
              width={64}
              height={64}
              className="rounded-xl object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
              <PersonSilhouette />
            </div>
          )}

          <div className="min-w-0">
            <p className="text-lg font-semibold text-text-primary truncate">
              {profile.name}
            </p>
            {profile.headline && (
              <p className="text-sm text-text-muted truncate">
                {profile.headline}
              </p>
            )}
            <p className="text-sm text-text-muted truncate">{profile.email}</p>
          </div>
        </div>

        {/* Space membership summary */}
        {profile.spaceCount > 0 && (
          <div className="mx-8 mb-6">
            <p className="text-sm text-text-secondary">
              Already a member of{" "}
              <span className="font-semibold">{profile.spaceCount}</span>{" "}
              {profile.spaceCount === 1 ? "space" : "spaces"}
              {profile.spaceNames.length > 0 && (
                <>
                  :{" "}
                  <span className="font-medium">
                    {profile.spaceNames.slice(0, 3).join(", ")}
                    {profile.spaceNames.length > 3 &&
                      ` and ${profile.spaceNames.length - 3} more`}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        <div className="px-8 pb-6">
          <p className="text-sm font-medium text-text-secondary mb-4">Is this you?</p>
          <ClaimActions token={token} callbackUrl={destination} />
        </div>

        {/* Footer note */}
        <div className="px-8 pb-8">
          <p className="text-xs text-text-muted text-center">
            Claiming this profile will give you full control over your public
            information. Space admins will retain their private notes about
            you.
          </p>
        </div>
      </div>
    </div>
  );
}
