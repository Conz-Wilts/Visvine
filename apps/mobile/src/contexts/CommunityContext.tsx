import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Community } from '@visvine/types';
import api from '../services/api';
import { useAuth } from './AuthContext';

interface CommunityContextType {
  communities: Community[];
  currentCommunity: Community | null;
  isLoading: boolean;
  setCurrentCommunity: (community: Community | null) => void;
  refreshCommunities: () => Promise<void>;
}

const CommunityContext = createContext<CommunityContextType | undefined>(undefined);

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [currentCommunity, setCurrentCommunity] = useState<Community | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshCommunities = useCallback(async () => {
    if (!isAuthenticated) {
      setCommunities([]);
      setCurrentCommunity(null);
      return;
    }

    setIsLoading(true);
    const response = await api.getCommunities();

    if (response.data) {
      setCommunities(response.data);
      // Set first community as current if none selected
      if (!currentCommunity && response.data.length > 0) {
        setCurrentCommunity(response.data[0]);
      }
    }

    setIsLoading(false);
  }, [isAuthenticated, currentCommunity]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshCommunities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return (
    <CommunityContext.Provider
      value={{
        communities,
        currentCommunity,
        isLoading,
        setCurrentCommunity,
        refreshCommunities,
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

export default CommunityContext;