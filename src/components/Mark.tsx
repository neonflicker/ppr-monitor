/**
 * Notebook emblem: a ruled page with a red margin line and a green
 * vaccination check. Uses theme CSS variables so it follows the palette.
 */
export function Mark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="PPR monitoring notebook"
    >
      <rect
        x="7"
        y="4.5"
        width="34"
        height="39"
        rx="4.5"
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth="1.6"
      />
      <path
        d="M13.5 4.5v39"
        stroke="var(--margin-line)"
        strokeWidth="1.4"
      />
      <path
        d="M18 15h18M18 22h18M18 29h13"
        stroke="var(--rule-line)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M20.5 34.5l4.4 4.6 9.6-12.4"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
