import prisma from '@/lib/prisma';
import { verifyUploadToken } from '@/lib/resources/uploadToken';
import { DropZone } from './DropZone';

/**
 * Where a person drops a file an AI chat asked for (`request_upload`). No
 * session: the token in the URL is the credential, so this works on the phone
 * the chat is on. The page names the space the files land in and nothing else.
 */
export default async function DropPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await verifyUploadToken(token);
  const space = payload
    ? await prisma.space.findUnique({ where: { id: payload.spaceId }, select: { name: true } })
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-4">
      <div className="w-full max-w-md rounded-xl bg-surface-1 p-8 shadow-float">
        {space ? (
          <>
            <h1 className="mb-6 text-xl font-semibold text-text-primary">{space.name}</h1>
            <DropZone token={token} />
          </>
        ) : (
          <p className="text-sm text-text-muted">This upload link has expired. Ask for a new one.</p>
        )}
      </div>
    </div>
  );
}
