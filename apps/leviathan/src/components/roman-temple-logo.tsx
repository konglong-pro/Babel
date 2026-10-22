interface RomanTempleLogoProps {
  className?: string;
}

export function RomanTempleLogo({ className }: RomanTempleLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 18h38L24 6 5 18Z" />
      <circle cx="24" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 22h34M9 25h30" />
      <path d="M10 25h5m-4 3h3v10h-3V28Zm8-3h5m-4 3h3v10h-3V28Zm8-3h5m-4 3h3v10h-3V28Zm8-3h5m-4 3h3v10h-3V28Z" />
      <path d="M9 38h30M7 42h34M5 46h38" />
    </svg>
  );
}
