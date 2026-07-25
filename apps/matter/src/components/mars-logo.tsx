export function MarsLogo() {
  return (
    <svg
      className="mars-logo"
      viewBox="0 0 112 96"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        className="mars-logo__halo mars-logo__halo--soft"
        cx="56"
        cy="48"
        rx="51"
        ry="24"
        transform="rotate(-14 56 48)"
      />
      <ellipse
        className="mars-logo__halo mars-logo__halo--sharp"
        cx="56"
        cy="48"
        rx="48"
        ry="21"
        transform="rotate(-14 56 48)"
      />
      <ellipse
        className="mars-logo__ring mars-logo__ring--rear"
        cx="56"
        cy="48"
        rx="46"
        ry="19"
        transform="rotate(-14 56 48)"
      />
      <circle className="mars-logo__planet" cx="56" cy="48" r="25" />
      <path
        className="mars-logo__terrain"
        d="M34 42c6-2 10-7 13-12 4 4 8 5 13 3 4-1 8 0 12 4M31 51c7-2 14 0 20 4 6 4 13 5 24 2M44 68c4-6 8-8 14-8 5 0 10 2 14 5"
      />
      <circle className="mars-logo__crater mars-logo__crater--large" cx="65" cy="44" r="5.5" />
      <circle className="mars-logo__crater" cx="46" cy="49" r="3.2" />
      <circle className="mars-logo__crater" cx="56" cy="65" r="2.3" />
      <path
        className="mars-logo__ring-front-underlay"
        d="M10 48c14 24 77 24 92 0"
        transform="rotate(-14 56 48)"
      />
      <path
        className="mars-logo__ring mars-logo__ring--front"
        d="M10 48c14 24 77 24 92 0"
        transform="rotate(-14 56 48)"
      />
      <path
        className="mars-logo__accent"
        d="M92 29l6-4m-4 10 8-1"
      />
    </svg>
  );
}
