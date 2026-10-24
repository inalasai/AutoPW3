import { useEffect, useId, useState } from 'react';
import { useLocation } from 'react-router';
import { Link } from 'react-router';
import { IconButton, buttonClasses } from '../../components/ui/Button';
import { CloseIcon, MenuIcon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/overlays';
import type { AppRoute } from '../routes';
import { NavList } from './NavList';

/**
 * Navigation for narrow screens: a menu button that opens a left drawer.
 * Keyboard: Enter or Space opens it, focus moves into the drawer and stays there, Tab cycles, Escape or the
 * close button or choosing a link closes it, and focus returns to the menu button.
 */
export function MobileNav({
  items,
  signedIn,
}: {
  items: ReadonlyArray<AppRoute>;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { pathname } = useLocation();

  // Close when the route changes by any means (link, back button).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <IconButton
        label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <MenuIcon />
      </IconButton>
      <Modal
        open={open}
        placement="left"
        labelledBy={titleId}
        onClose={() => {
          setOpen(false);
        }}
      >
        <div className="flex items-center justify-between pb-3">
          <h2 id={titleId} className="text-base font-semibold">
            Menu
          </h2>
          <IconButton
            label="Close menu"
            onClick={() => {
              setOpen(false);
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <NavList
          label="Main menu"
          items={items}
          onNavigate={() => {
            setOpen(false);
          }}
        />
        {signedIn ? null : (
          <Link
            to="/login"
            className={buttonClasses('secondary', 'md', 'mt-4 w-full')}
            onClick={() => {
              setOpen(false);
            }}
          >
            Sign in
          </Link>
        )}
      </Modal>
    </>
  );
}
