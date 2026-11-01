import { useId } from 'react';

/**
 * The StatEdge mark, as Tournament Manager draws it in its header, so that the two apps read as
 * one family. Decorative: the link around it carries the name.
 */
export function StatEdgeMark({ size = 36 }: { size?: number }) {
  // Unique gradient ids, in case the mark appears twice on one page.
  const id = useId().replace(/:/g, '');
  const outer = `${id}-outer`;
  const ring = `${id}-ring`;
  const inner = `${id}-inner`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={outer} cx="45%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#3a70d8" />
          <stop offset="100%" stopColor="#1a3272" />
        </radialGradient>
        <radialGradient id={ring} cx="45%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f89030" />
          <stop offset="100%" stopColor="#d96010" />
        </radialGradient>
        <radialGradient id={inner} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#3a70d8" />
          <stop offset="100%" stopColor="#162560" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${outer})`} />
      <circle cx="32" cy="32" r="27" fill="#fff" />
      <circle cx="32" cy="32" r="26" fill={`url(#${ring})`} />
      <circle cx="32" cy="32" r="21" fill="#2a1408" />
      <circle cx="32" cy="32" r="19.5" fill="#fff" />
      <circle cx="32" cy="32" r="18" fill={`url(#${inner})`} />
      <polygon points="32,15 23,36 41,36" fill="#f47820" />
      <polygon points="20,36 32,49 44,36 40,36 32,44 24,36" fill="#fff" />
    </svg>
  );
}
