import { NavLink } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { strings } from '../lib/strings';
import styles from './shell.module.css';

const ITEMS: { to: string; label: string; icon: IconName; adminOnly?: boolean }[] = [
  { to: '/', label: strings.nav.home, icon: 'home' },
  { to: '/athletes', label: strings.nav.athletes, icon: 'athletes' },
  { to: '/guide', label: strings.nav.guide, icon: 'guide' },
  { to: '/settings', label: strings.nav.settings, icon: 'settings', adminOnly: true },
];

/** Home, Athletes, Guide and (for administrators) Settings. */
export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav className={styles.bottomNav} aria-label={strings.nav.label}>
      <ul>
        {ITEMS.filter((item) => isAdmin || !item.adminOnly).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? styles.active : undefined)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
