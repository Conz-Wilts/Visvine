'use client';
export default function PDFViewer({ fileUrl }: { fileUrl: string }) {
  return (
    <div className="flex flex-col h-full">
      <iframe src={fileUrl} className="flex-1 w-full border-0" title="PDF Preview" />
      <div className="p-2 text-center text-xs text-fg-muted">
        <a href={fileUrl} download className="underline">Download file</a>
      </div>
    </div>
  );
}
