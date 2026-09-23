import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api/route';
import { logger } from '@/lib/logger';
import { verifyUploadToken, type UploadTokenPayload } from '@/lib/resources/uploadToken';
import { receiveFile } from '@/lib/resources/receive';
import { MAX_RESOURCE_BYTES, type UploadedFile } from '@/lib/resources/service';

// Extraction + embedding run inline, as on the Drive's own upload route.
export const maxDuration = 300;

/**
 * The upload token's door (lib/resources/uploadToken.ts). No session: the token
 * in the path names who is uploading and where, and `receiveFile` re-asks that
 * person's standing in that space now, so a token outliving a membership
 * uploads nothing.
 *
 * PUT  — the raw bytes, from an AI client's code sandbox (`request_upload`'s
 *        curl line). The name rides `X-File-Name` (or `?name=`).
 * POST — multipart `file` fields, from the /drop/<token> page.
 */

type Params = { params: Promise<{ token: string }> };

async function uploader(token: string): Promise<{ payload: UploadTokenPayload; email: string | null } | null> {
  const payload = await verifyUploadToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { email: true } });
  if (!user) return null;
  return { payload, email: user.email };
}

function answer(file: UploadedFile) {
  return {
    resource_id: file.id,
    name: file.name,
    file_type: file.fileType,
    size_bytes: file.fileSize,
    node_id: file.nodeId,
  };
}

function failure(err: unknown, event: string): NextResponse {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
  logger.error(event, { err });
  return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
}

const expired = () =>
  NextResponse.json({ error: 'This upload link has expired — ask for a new one' }, { status: 403 });

export async function PUT(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const who = await uploader(token);
  if (!who) return expired();

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESOURCE_BYTES) {
    return NextResponse.json(
      { error: `File must be less than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  const rawName = req.headers.get('x-file-name') ?? req.nextUrl.searchParams.get('name');
  let name: string | null = null;
  try {
    name = rawName ? decodeURIComponent(rawName) : null;
  } catch {
    name = rawName;
  }

  try {
    const file = await receiveFile({
      userId: who.payload.userId,
      email: who.email,
      spaceId: who.payload.spaceId,
      folderId: who.payload.folderId,
      name,
      mimeType: req.headers.get('content-type'),
      bytes,
    });
    return NextResponse.json(answer(file), { status: 201 });
  } catch (err) {
    return failure(err, 'uploads.put.failed');
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const who = await uploader(token);
  if (!who) return expired();

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll('file') ?? []).filter((v): v is File => typeof v !== 'string');
  if (files.length === 0) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const uploaded = [];
  try {
    for (const f of files) {
      if (f.size > MAX_RESOURCE_BYTES) {
        throw new ApiError(413, `${f.name} is larger than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB`);
      }
      const file = await receiveFile({
        userId: who.payload.userId,
        email: who.email,
        spaceId: who.payload.spaceId,
        folderId: who.payload.folderId,
        name: f.name,
        mimeType: f.type,
        bytes: Buffer.from(await f.arrayBuffer()),
      });
      uploaded.push(answer(file));
    }
    return NextResponse.json({ files: uploaded }, { status: 201 });
  } catch (err) {
    return failure(err, 'uploads.post.failed');
  }
}
