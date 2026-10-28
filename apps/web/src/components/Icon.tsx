// Small inline icons (24 px grid, stroke drawn in currentColor). Decorative: the text label next
// to each icon is the accessible name.

const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5',
  athletes:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5m2.5 9c0-2.6-1.5-4.8-3.5-5.7',
  guide:
    'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 15A2.5 2.5 0 0 0 6.5 23H20v-5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L14.2 2h-4l-.4 2.7a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4l.4 2.7h4l.4-2.7a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6Z',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9c0-4.4 3.6-8 8-8s8 3.6 8 8',
  cloud: 'M7 18h10.5a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.6 1.6A3.8 3.8 0 0 0 7 18Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  alert:
    'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  offline:
    'M3 3l18 18M8.5 8.6A6 6 0 0 0 6.5 10.6 3.8 3.8 0 0 0 7 18h10.5m2.3-1.4A4.5 4.5 0 0 0 18.1 9a6 6 0 0 0-7.2-4.7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
