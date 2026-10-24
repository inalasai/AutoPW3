import type { SVGProps } from 'react';

/**
 * Inline SVG icons. They are decorative: always `aria-hidden`, and the control that holds one carries the text label.
 * Inline because `public/_headers` allows no external image or font sources beyond `self` and `data:`.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'aria-hidden' | 'd'>;

function Icon({ d, ...svgProps }: IconProps & { d: ReadonlyArray<string> }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...svgProps}
    >
      {d.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function make(d: ReadonlyArray<string>) {
  return function Glyph(props: IconProps) {
    return <Icon d={d} {...props} />;
  };
}

export const MenuIcon = make(['M4 6h16', 'M4 12h16', 'M4 18h16']);
export const CloseIcon = make(['M6 6l12 12', 'M18 6L6 18']);
export const CheckIcon = make(['M5 12.5l4.5 4.5L19 7.5']);
export const AlertIcon = make(['M12 4l9 16H3L12 4z', 'M12 10v4', 'M12 17.25v.01']);
export const InfoIcon = make(['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 8v.01']);
export const SunIcon = make([
  'M12 16a4 4 0 100-8 4 4 0 000 8z',
  'M12 3v2',
  'M12 19v2',
  'M3 12h2',
  'M19 12h2',
  'M5.6 5.6L7 7',
  'M17 17l1.4 1.4',
  'M5.6 18.4L7 17',
  'M17 7l1.4-1.4',
]);
export const BatteryIcon = make(['M3 8h16v8H3z', 'M21 11v2', 'M7 11v2', 'M11 11v2']);
export const GridIcon = make(['M12 3v18', 'M7 7h10', 'M5 12h14', 'M8 21l4-18 4 18']);
export const PulseIcon = make(['M3 12h4l2.5-6 4 12 2.5-6H21']);
export const ChartIcon = make(['M4 20V4', 'M4 20h16', 'M8 16v-4', 'M12 16V8', 'M16 16v-6']);
export const TagIcon = make(['M3 12V4h8l10 10-8 8L3 12z', 'M7.5 8.5v.01']);
export const BoltIcon = make(['M13 3L5 14h6l-1 7 8-11h-6l1-7z']);
export const SlidersIcon = make([
  'M4 7h10',
  'M18 7h2',
  'M4 17h2',
  'M10 17h10',
  'M16 5v4',
  'M8 15v4',
]);
export const ShieldIcon = make([
  'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z',
  'M9 12l2 2 4-4',
]);
export const GearIcon = make([
  'M12 15a3 3 0 100-6 3 3 0 000 6z',
  'M19.4 13a7.5 7.5 0 000-2l2-1.5-2-3.4-2.3 1a7.4 7.4 0 00-1.7-1L15 3.5h-4l-.4 2.6a7.4 7.4 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 000 2l-2 1.5 2 3.4 2.3-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.3 1 2-3.4-2-1.5z',
]);
export const SparkleIcon = make(['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z']);
