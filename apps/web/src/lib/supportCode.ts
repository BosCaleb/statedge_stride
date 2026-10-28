// A short code a coach can copy and send to StatEdge when something breaks. It carries the build
// and the time only, never details of the error or of the person.

export function supportCode(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${import.meta.env.VITE_BUILD_VERSION ?? 'dev'}-${stamp}-${random}`;
}
