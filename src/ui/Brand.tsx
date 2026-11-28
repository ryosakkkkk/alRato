/**
 * The alRato mark: a camera viewfinder framing an alpha, the first letter of the name.
 * The same geometry is drawn in public/favicon.svg, which the icon script renders for the PWA.
 */
const VIEWFINDER = ['M10 21v-6q0-5 5-5h6', 'M43 10h6q5 0 5 5v6', 'M54 43v6q0 5-5 5h-6', 'M21 54h-6q-5 0-5-5v-6'];
const ALPHA = 'M38 26v16M38 34c0-4-3-6-7-6-4.500 0-7 3-7 7.500s2.500 7.500 7 7.500c3.500 0 7-2 7-5.500';

export function BrandMark({ size = 32, draw = false, label }: { size?: number; draw?: boolean; label?: string }) {
  // One pure colour, like the rest of the interface.
  const stroke = '#8b5cf6';
  return (
    <svg
      className={draw ? 'brand-mark brand-draw' : 'brand-mark'}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g fill="none" stroke={stroke} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
        {VIEWFINDER.map((d, i) => (
          <path key={d} d={d} pathLength={1} style={{ animationDelay: `${i * 0.08}s` }} />
        ))}
        <path d={ALPHA} pathLength={1} style={{ animationDelay: '0.32s' }} />
      </g>
    </svg>
  );
}
