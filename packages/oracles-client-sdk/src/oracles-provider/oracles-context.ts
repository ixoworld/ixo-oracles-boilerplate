import { createContext, useContext } from 'react';
import { type IOraclesContextValue } from './types';

export const OraclesContext = createContext<IOraclesContextValue | null>(null);

export function useOraclesContext(): IOraclesContextValue {
  const context = useContext(OraclesContext);
  if (!context) {
    throw new Error('useOraclesContext must be used within an OraclesProvider');
  }
  return context;
}
