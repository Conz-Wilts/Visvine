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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">
            We found a profile for you
          </h1>
          <p className="text-sm text-gray-500">
            Someone has already added you to a community. Claim your profile to
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
            <p className="text-lg font-semibold text-gray-900 truncate">
              {profile.name}
            </p>
            {profile.headline && (
              <p className="text-sm text-gray-500 truncate">
                {profile.headline}
              </p>
            )}
            <p className="text-sm text-gray-400 truncate">{profile.email}</p>
          </div>
        </div>

        {/* Community membership summary */}
        {profile.communityCount > 0 && (
          <div className="mx-8 mb-6 rounded-lg bg-blue-50 px-4 py-3">
            <p className="text-sm text-blue-800">
              Already a member of{" "}
              <span className="font-semibold">{profile.communityCount}</span>{" "}
              {profile.communityCount === 1 ? "community" : "communities"}
              {profile.communityNames.length > 0 && (
                <>
                  :{" "}
                  <span className="font-medium">
                    {profile.communityNames.slice(0, 3).join(", ")}
                    {profile.communityNames.length > 3 &&
                      ` and ${profile.communityNames.length - 3} more`}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        <div className="px-8 pb-6">
          <p className="text-sm font-medium text-gray-700 mb-4">Is this you?</p>
          <ClaimActions token={token} callbackUrl={destination} />
        </div>

        {/* Footer note */}
        <div className="px-8 pb-8">
          <p className="text-xs text-gray-400 text-center">
            Claiming this profile will give you full control over your public
            information. Community admins will retain their private notes about
            you.
          </p>
        </div>
      </div>
    </div>
  );
}
