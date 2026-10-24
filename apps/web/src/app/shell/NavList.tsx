import { NavLink } from 'react-router';
import { cx } from '../../lib/cx';
import type { AppRoute } from '../routes';

export interface NavListProps {
  /** Accessible name of the navigation landmark. Two landmarks on one page need different names. */
  label: string;
  items: ReadonlyArray<AppRoute>;
  /** Called after a link is activated (the mobile menu closes itself). */
  onNavigate?: () => void;
}

/** Primary navigation links. The active page gets `aria-current="page"` from `NavLink`. */
export function NavList({ label, items, onNavigate }: NavListProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const ItemIcon = item.nav?.icon;
          return (
            <li key={item.id}>
              <NavLink
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    'flex h-10 items-center gap-3 rounded-control border-l-2 px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-select bg-line text-ink'
                      : 'border-transparent text-ink-muted hover:bg-line hover:text-ink',
                  )
                }
              >
                {ItemIcon !== undefined ? <ItemIcon /> : null}
                <span>{item.nav?.label ?? item.title}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
