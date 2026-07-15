'use client';
import { useState, useRef } from 'react';
import Modal from '@/components/ui/Modal';

export default function ResourceUploadDialog({
  communityId,
  onClose,
  onUploaded,
}: {
  communityId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const uploadRes = await fetch('/api/resources/upload', { method: 'POST', body: fd });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { fileUrl, fileSize, fileType, originalFilename, gcsPath } = await uploadRes.json();
      const createRes = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communityId, name: file.name, fileType, fileUrl, fileSize, metadata: { originalFilename, gcsPath } }),
      });
      if (!createRes.ok) throw new Error('Failed to create resource record');
      onUploaded();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      closeOnEscape={false}
      overlayClassName="items-center justify-center bg-black/40"
      maxWidth="max-w-md"
      panelClassName="bg-white rounded-xl shadow-xl p-6"
    >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Upload Resource</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
        >
          {uploading ? <p className="text-gray-500">Uploading...</p> : <p className="text-gray-500">Drag & drop a file here, or click to browse<br /><span className="text-xs text-gray-400">PDF, Excel, CSV, DOCX, or image</span></p>}
        </div>
        <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </Modal>
  );
}
