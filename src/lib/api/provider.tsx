'use client';

import { createContext, useContext } from 'react';
import type { APIClient } from './types';
import { localAPIClient } from './local';
import { remoteAPIClient } from './remote';

function resolveDefaultClient(): APIClient {
  const mode = process.env.NEXT_PUBLIC_API_MODE?.toLowerCase() ?? 'remote';
  return mode === 'local' ? localAPIClient : remoteAPIClient;
}

const defaultClient = resolveDefaultClient();
const APIContext = createContext<APIClient>(defaultClient);

interface APIProviderProps {
  client?: APIClient;
  children: React.ReactNode;
}

export function APIProvider({ client, children }: APIProviderProps) {
  return (
    <APIContext.Provider value={client ?? defaultClient}>
      {children}
    </APIContext.Provider>
  );
}

export function useAPI(): APIClient {
  return useContext(APIContext);
}
