import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertCrmPermission, PermissionError } from "@/lib/crm/permissions";
import { CrmGrid } from "@/features/crm/CrmGrid";
import { FieldDefinition } from "@/lib/schemas/crm";
import { PageTitle } from "@/components/ui";
import prisma from "@/lib/prisma";

interface DirectoryPageProps {
  params: Promise<{ communityId: string }>;
}

export default async function DirectoryPage({ params }: DirectoryPageProps) {
  const { communityId } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=/${communityId}/directory`);
  }

  // Check view_crm permission — only admins can see this page
  let currentUserRole = "member";
  try {
    const membership = await assertCrmPermission(
      session.userId,
      session.email,
      communityId,
      "view_crm"
    );
    currentUserRole = membership?.role ?? "admin"; // null = super-admin
  } catch (e) {
    if (e instanceof PermissionError) {
      redirect(`/directory`); // redirect regular members to the public directory
    }
    throw e;
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true, crmSettings: true },
  });

  if (!community) notFound();

  const settings = (community.crmSettings as { fields?: FieldDefinition[] }) ?? {};
  const privateFields: FieldDefinition[] = settings.fields ?? [];

  return (
    <main className="p-4 sm:p-6 max-w-screen-2xl mx-auto">
      <PageTitle
        title={`${community.name} — Member Directory`}
        subtitle="Manage and view all members. Private CRM fields are visible only to admins."
        className="mb-4 pt-0 sm:mb-6"
      />

      <CrmGrid
        communityId={communityId}
        privateFields={privateFields}
        currentUserRole={currentUserRole}
      />
    </main>
  );
}
