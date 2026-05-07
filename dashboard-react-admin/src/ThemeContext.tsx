/**
 * Holds the currently-selected named-theme. Persists the choice in
 * localStorage so it survives reloads. Independent of react-admin's
 * built-in light/dark toggle (which operates within a pair).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_THEME_NAME } from './themes';

interface ThemeNameValue {
  themeName: string;
  setThemeName: (name: string) => void;
}

const STORAGE_KEY = 'digit-tests-themeName';

const ThemeNameContext = createContext<ThemeNameValue | null>(null);

export function ThemeNameProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_NAME;
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_NAME;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, themeName); } catch {/* ignore */ }
  }, [themeName]);

  return (
    <ThemeNameContext.Provider value={{ themeName, setThemeName: setThemeNameState }}>
      {children}
    </ThemeNameContext.Provider>
  );
}

export function useThemeName(): ThemeNameValue {
  const ctx = useContext(ThemeNameContext);
  if (!ctx) throw new Error('useThemeName must be used inside <ThemeNameProvider>');
  return ctx;
}
