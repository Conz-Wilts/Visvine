'use client';
import { useState, useEffect } from 'react';

export function useAdminRole(communityId: string | null) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!communityId) { setIsAdmin(false); return; }
    let cancelled = false;
    fetch(`/api/communities/${communityId}/admin-check`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setIsAdmin(d.isAdmin === true); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [communityId]);

  return { isAdmin };
}
