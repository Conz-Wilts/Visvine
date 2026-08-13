'use client';
import { useState, useEffect } from 'react';

export function useAdminRole(spaceId: string | null) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!spaceId) { setIsAdmin(false); return; }
    let cancelled = false;
    fetch(`/api/communities/${spaceId}/admin-check`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setIsAdmin(d.isAdmin === true); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [spaceId]);

  return { isAdmin };
}
