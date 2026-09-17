function SheepSilhouette() {
  return (
    <>
      <path d="M41 23c7-10 20-12 30-5 10-6 23-1 25 9 10 0 17 7 15 16-2 9-12 14-23 11-8 8-22 7-29 0-12 3-23-4-24-14-7-3-10-10-6-17 4-7 13-9 22-5Z" />
      <path d="M36 31c-8-6-18-3-21 5-3 9 3 18 13 19 10 1 17-6 16-15-1-5-3-7-8-9Z" />
      <path d="M19 33l-9-4 3 10M34 51l-4 16M57 52v16M85 52v16M102 47l10 3-8 5" />
      <circle cx="26" cy="39" r="1.8" />
    </>
  );
}

export function CloneSheepLogo() {
  return (
    <svg
      className="clone-sheep-logo"
      viewBox="0 0 124 74"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id="bio-sheep-stripes"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <rect width="3.1" height="6" fill="white" />
        </pattern>
        <mask id="bio-sheep-stripe-mask">
          <rect width="124" height="74" fill="url(#bio-sheep-stripes)" />
        </mask>
      </defs>
      <g className="clone-sheep-logo__echo" transform="translate(7 -5)">
        <SheepSilhouette />
      </g>
      <g className="clone-sheep-logo__body" mask="url(#bio-sheep-stripe-mask)">
        <SheepSilhouette />
      </g>
      <g className="clone-sheep-logo__contour">
        <SheepSilhouette />
      </g>
      <path
        className="clone-sheep-logo__signal"
        d="M7 65h7m3 0h3m4 0h13m4 0h2m4 0h8m5 0h3m5 0h16m4 0h4m5 0h11"
      />
    </svg>
  );
}
