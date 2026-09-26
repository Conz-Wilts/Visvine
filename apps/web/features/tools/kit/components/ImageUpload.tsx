import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useVisvine } from '../hooks';
import { ResourceImage } from './ResourceImage';

export interface ImageUploadProps {
  /** The resource id it holds now, or null. */
  value: string | null;
  /** The new resource id once the file is in the Drive. */
  onChange: (resourceId: string) => void;
  /** Names the picture for a screen reader, and gives the fallback its initials. */
  label: string;
  /** A folder under resources/ that permissions.resources.write names; the first one when omitted. */
  folder?: string;
  shape?: 'square' | 'circle';
  size?: number;
  className?: string;
}

/**
 * A picture the viewer adds — a company's logo, a person's photo. Press it,
 * pick an image, and it goes into the space's Drive as them; the Tool keeps
 * the id it hands back. The Tool declares the folder in
 * permissions.resources.write, and must also read it.
 */
export function ImageUpload({ value, onChange, label, folder, shape = 'square', size = 64, className }: ImageUploadProps) {
  const visvine = useVisvine();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const added = await visvine.resources.upload({ name: file.name, dataUrl, ...(folder ? { folder } : {}) });
      onChange(added.id);
    } catch (e) {
      void visvine.ui.toast(e instanceof Error ? e.message : 'Could not add the image', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <button
      type="button"
      aria-label={value ? `Change ${label}` : `Add ${label}`}
      onClick={() => input.current?.click()}
      disabled={busy}
      className={clsx('relative shrink-0 overflow-hidden transition-opacity hover:opacity-80 disabled:opacity-50', shape === 'circle' ? 'rounded-full' : 'rounded-lg', className)}
      style={{ width: size, height: size }}
    >
      <ResourceImage id={value} alt={label} shape={shape} size={size} />
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </button>
  );
}
