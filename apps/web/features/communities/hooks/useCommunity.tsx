'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Community, UserCommunityPreferences } from '@/lib/types';

interface CommunityContextValue {
  communities: Community[];
  currentCommunity: Community | null;
  joinedCommunities: Community[];
  setCurrentCommunity: (communityId: string) => void;
  joinCommunity: (communityId: string) => void;
  leaveCommunity: (communityId: string) => void;
  refreshCommunity: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const CommunityContext = createContext<CommunityContextValue | undefined>(undefined);

const STORAGE_KEY = 'nb_community_prefs';

// Default preferences - no default community, user chooses which to join
const DEFAULT_PREFS: UserCommunityPreferences = {
  joinedCommunities: [],
  currentCommunity: null,
};

export function CommunityProvider({ children }: { children: ReactNode }) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [preferences, setPreferences] = useState<UserCommunityPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Function to load communities from database
  const loadCommunities = async () => {
    try {
      // Add cache-busting timestamp to force fresh data
      const timestamp = new Date().getTime();
      const response = await fetch(`/api/data/communities?t=${timestamp}`);
      
      if (!response.ok) {
        throw new Error('Failed to load communities');
      }

      const data = await response.json();
      setCommunities(data.communities || []);
      setError(null);
    } catch (err) {
      console.error('Error loading communities:', err);
      setError(err instanceof Error ? err.message : 'Failed to load communities');
    }
  };

  // Load communities on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCommunities();
      setLoading(false);
    };
    init();
  }, []);

  // Load user preferences from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setPreferences(parsed);
      } else {
        // First time - save default preferences
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PREFS));
      }
    } catch (err) {
      console.error('Error loading preferences:', err);
    }
  }, []);

  // Save preferences to localStorage whenever they change
  const savePreferences = (newPrefs: UserCommunityPreferences) => {
    setPreferences(newPrefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
  };

  const setCurrentCommunity = (communityId: string) => {
    savePreferences({
      ...preferences,
      currentCommunity: communityId,
    });
  };

  const joinCommunity = (communityId: string) => {
    if (!preferences.joinedCommunities.includes(communityId)) {
      savePreferences({
        ...preferences,
        joinedCommunities: [...preferences.joinedCommunities, communityId],
      });
    }
  };

  const leaveCommunity = (communityId: string) => {
    const newJoined = preferences.joinedCommunities.filter(id => id !== communityId);
    savePreferences({
      ...preferences,
      joinedCommunities: newJoined,
      currentCommunity: preferences.currentCommunity === communityId 
        ? (newJoined[0] || null) 
        : preferences.currentCommunity,
    });
  };

  const refreshCommunity = async () => {
    await loadCommunities();
  };

  const currentCommunity = communities.find(c => c.id === preferences.currentCommunity) || null;
  const joinedCommunities = communities
    .filter(c => preferences.joinedCommunities.includes(c.id))
    .sort((a, b) => a.name.localeCompare(b.name)); // Alphabetical sorting

  return (
    <CommunityContext.Provider
      value={{
        communities,
        currentCommunity,
        joinedCommunities,
        setCurrentCommunity,
        joinCommunity,
        leaveCommunity,
        refreshCommunity,
        loading,
        error,
      }}
    >
      {children}
    </CommunityContext.Provider>
  );
}

export function useCommunity() {
  const context = useContext(CommunityContext);
  if (!context) {
    throw new Error('useCommunity must be used within CommunityProvider');
  }
  return context;
}




