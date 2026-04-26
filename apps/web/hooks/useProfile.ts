'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FullProfile, WorkExperience, Education, Certification, ProfileLanguage } from '@/lib/profileTypes';
import { useProfileCache } from '@/lib/contexts/ProfileContext';

// Module-level prefetch cache — populated by prefetchProfile(), read by useProfile
const prefetchCache = new Map<string, Promise<FullProfile>>();

export function prefetchProfile(personId: string): void {
  if (prefetchCache.has(personId)) return;
  const promise = fetch(`/api/profile/${encodeURIComponent(personId)}`)
    .then(res => { if (!res.ok) throw new Error('Profile not found'); return res.json() as Promise<FullProfile>; })
    .catch((err) => { prefetchCache.delete(personId); throw err; });
  prefetchCache.set(personId, promise);
}

export function useProfile(personId: string | null) {
  const { getCached, setCache, patchCache } = useProfileCache();

  const [profile, setProfile] = useState<FullProfile | null>(
    () => (personId ? getCached(personId) : null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local state → cache AFTER render (safe — not during render)
  useEffect(() => {
    if (profile && personId) setCache(personId, profile);
  }, [profile, personId, setCache]);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      // Use prefetch result if available (populated on hover)
      const prefetched = prefetchCache.get(personId);
      const data = prefetched
        ? await prefetched
        : await fetch(`/api/profile/${encodeURIComponent(personId)}`).then(res => {
            if (!res.ok) throw new Error('Profile not found');
            return res.json();
          });
      prefetchCache.delete(personId);
      setProfile(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    if (!personId) return;
    const cached = getCached(personId);
    if (cached) {
      setProfile(cached);
      // Skip network fetch if cache exists — it was populated by a recent load
      // The cache is invalidated on mutations via patchCache/setCache
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  // ── Basic info ──────────────────────────────────────────────────────────────

  const updateBasicInfo = useCallback(async (patch: Partial<FullProfile>) => {
    if (!personId) return;
    // Optimistic: update cache immediately so sidebar + cards reflect the change
    patchCache(personId, patch);
    setProfile(prev => prev ? { ...prev, ...patch } : prev);

    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Update failed');
    const updated = await res.json();
    setProfile(prev => prev ? { ...prev, ...updated } : updated);
  }, [personId, patchCache]);

  // ── Work experience ─────────────────────────────────────────────────────────

  const addExperience = useCallback(async (data: Omit<WorkExperience, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/experience`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to add experience');
    const row: WorkExperience = await res.json();
    setProfile(prev => prev ? { ...prev, workExperience: [row, ...prev.workExperience] } : prev);
  }, [personId]);

  const updateExperience = useCallback(async (id: string, data: Partial<WorkExperience>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/experience/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update experience');
    const row: WorkExperience = await res.json();
    setProfile(prev => prev ? { ...prev, workExperience: prev.workExperience.map(e => e.id === id ? row : e) } : prev);
  }, [personId]);

  const deleteExperience = useCallback(async (id: string) => {
    if (!personId) return;
    await fetch(`/api/profile/${encodeURIComponent(personId)}/experience/${id}`, { method: 'DELETE' });
    setProfile(prev => prev ? { ...prev, workExperience: prev.workExperience.filter(e => e.id !== id) } : prev);
  }, [personId]);

  // ── Education ───────────────────────────────────────────────────────────────

  const addEducation = useCallback(async (data: Omit<Education, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/education`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to add education');
    const row: Education = await res.json();
    setProfile(prev => prev ? { ...prev, education: [row, ...prev.education] } : prev);
  }, [personId]);

  const updateEducation = useCallback(async (id: string, data: Partial<Education>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/education/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update education');
    const row: Education = await res.json();
    setProfile(prev => prev ? { ...prev, education: prev.education.map(e => e.id === id ? row : e) } : prev);
  }, [personId]);

  const deleteEducation = useCallback(async (id: string) => {
    if (!personId) return;
    await fetch(`/api/profile/${encodeURIComponent(personId)}/education/${id}`, { method: 'DELETE' });
    setProfile(prev => prev ? { ...prev, education: prev.education.filter(e => e.id !== id) } : prev);
  }, [personId]);

  // ── Certifications ──────────────────────────────────────────────────────────

  const addCertification = useCallback(async (data: Omit<Certification, 'id' | 'personId' | 'sortOrder' | 'createdAt' | 'updatedAt'>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/certifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to add certification');
    const row: Certification = await res.json();
    setProfile(prev => prev ? { ...prev, certifications: [row, ...prev.certifications] } : prev);
  }, [personId]);

  const updateCertification = useCallback(async (id: string, data: Partial<Certification>) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/certifications/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update certification');
    const row: Certification = await res.json();
    setProfile(prev => prev ? { ...prev, certifications: prev.certifications.map(c => c.id === id ? row : c) } : prev);
  }, [personId]);

  const deleteCertification = useCallback(async (id: string) => {
    if (!personId) return;
    await fetch(`/api/profile/${encodeURIComponent(personId)}/certifications/${id}`, { method: 'DELETE' });
    setProfile(prev => prev ? { ...prev, certifications: prev.certifications.filter(c => c.id !== id) } : prev);
  }, [personId]);

  // ── Languages ───────────────────────────────────────────────────────────────

  const addLanguage = useCallback(async (data: { language: string; proficiency: string }) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/languages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to add language');
    const row: ProfileLanguage = await res.json();
    setProfile(prev => prev ? { ...prev, languages: [...prev.languages, row] } : prev);
  }, [personId]);

  const updateLanguage = useCallback(async (id: string, data: { language?: string; proficiency?: string }) => {
    if (!personId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}/languages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update language');
    const row: ProfileLanguage = await res.json();
    setProfile(prev => prev ? { ...prev, languages: prev.languages.map(l => l.id === id ? row : l) } : prev);
  }, [personId]);

  const deleteLanguage = useCallback(async (id: string) => {
    if (!personId) return;
    await fetch(`/api/profile/${encodeURIComponent(personId)}/languages/${id}`, { method: 'DELETE' });
    setProfile(prev => prev ? { ...prev, languages: prev.languages.filter(l => l.id !== id) } : prev);
  }, [personId]);

  return {
    profile, loading, error, reload: load,
    updateBasicInfo,
    addExperience, updateExperience, deleteExperience,
    addEducation, updateEducation, deleteEducation,
    addCertification, updateCertification, deleteCertification,
    addLanguage, updateLanguage, deleteLanguage,
  };
}
