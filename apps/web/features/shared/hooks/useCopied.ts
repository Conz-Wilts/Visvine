'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/lib/utils';

/**
 * The "Copy → Copied" flash every share/copy button does. `copied` stays true
 * for `ms` after a successful copy; `copy` resolves to whether it succeeded so
 * a caller can surface its own failure notice.
 */
export function useCopied(ms = 1500): [copied: boolean, copy: (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), ms);
    }
    return ok;
  }, [ms]);
  return [copied, copy];
}
