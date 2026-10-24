import { Link } from 'react-router';
import { Switch } from '../../components/ui/fields';
import { AccountControls } from '../../features/auth/AccountControls';
import { useEffects } from '../effects';
import type { AppRoute } from '../routes';
import { MobileNav } from './MobileNav';

/** The AutoPW3 mark: three arcs in the solar, battery and grid colours. Decorative. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-line)" strokeWidth="2" />
      <path
        d="M6 12a11 11 0 0 1 12-7"
        fill="none"
        stroke="var(--color-solar)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M26 12a11 11 0 0 1-1 11"
        fill="none"
        stroke="var(--color-battery)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M21 26a11 11 0 0 1-13-3"
        fill="none"
        stroke="var(--color-grid)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-control font-semibold tracking-tight">
      <BrandMark />
      <span className="text-lg">AutoPW3</span>
    </Link>
  );
}

export interface HeaderProps {
  demoMode: boolean;
  /** Navigation entries for the mobile menu (the sidebar gets the same list). */
  navItems: ReadonlyArray<AppRoute>;
}

/** Top bar: menu button (narrow screens), demo pill, brand, effects switch, account controls. */
export function Header({ demoMode, navItems }: HeaderProps) {
  const { effects, setEffects } = useEffects();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-space-900">
      <div className="mx-auto flex h-header w-full max-w-[96rem] items-center gap-3 px-4">
        <div className="lg:hidden">
          <MobileNav items={navItems} />
        </div>
        <Brand />
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          {demoMode ? (
            <span
              data-testid="demo-pill"
              className="rounded-pill border border-warning px-2 py-0.5 font-mono text-xs tracking-wider text-warning"
            >
              DEMO
            </span>
          ) : null}
          <Switch
            label="Effects"
            compactLabel
            description="Turn glow, blur and animation on or off"
            checked={effects === 'on'}
            onCheckedChange={(on) => {
              setEffects(on ? 'on' : 'off');
            }}
          />
          <AccountControls layout="bar" />
        </div>
      </div>
      <div className="flow-line" aria-hidden="true" />
    </header>
  );
}
