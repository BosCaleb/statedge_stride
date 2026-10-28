// localStorage that never throws (private modes and full quotas). For small preferences only:
// personal data goes to IndexedDB through the query persister and the outbox.

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; the default applies next time.
  }
}
