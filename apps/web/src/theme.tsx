import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = Exclude<ThemePreference, 'system'>;

const STORAGE_KEY = 'bc-contracts-theme-choice';
const ThemeContext = createContext<{ preference: ThemePreference; resolved: ResolvedTheme; setPreference: (theme: ThemePreference) => void } | undefined>(undefined);

function storedPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = preference === 'system' ? system : preference;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystem(media.matches ? 'light' : 'dark');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(resolved);
    document.documentElement.dataset.themePreference = preference;
  }, [preference, resolved]);

  const value = useMemo(() => ({
    preference,
    resolved,
    setPreference: (next: ThemePreference) => {
      setPreferenceState(next);
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    },
  }), [preference, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider.');
  return context;
}
