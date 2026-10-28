import { readPreference, writePreference } from './storage';

// Light, dark or the phone's setting. Applied to <html data-theme> before the first render.

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
const KEY = 'stride.theme';

export function loadTheme(): Theme {
  const saved = readPreference(KEY);
  return THEMES.find((t) => t === saved) ?? 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  writePreference(KEY, theme === 'system' ? null : theme);
}
