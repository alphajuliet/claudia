/** The app icon: the six-spoked ❉ in white on its `--logo` tile. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 512 512" fill="#fff" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="var(--logo)" />
      <circle cx="256" cy="256" r="24" />
      <path d="M262 256 272 98H240L250 256Z" />
      <circle cx="256" cy="98" r="44" />
      <path d="M259 261.2 400.8 190.9 384.8 163.1 253 250.8Z" />
      <circle cx="392.8" cy="177" r="44" />
      <path d="M253 261.2 384.8 348.9 400.8 321.1 259 250.8Z" />
      <circle cx="392.8" cy="335" r="44" />
      <path d="M250 256 240 414H272L262 256Z" />
      <circle cx="256" cy="414" r="44" />
      <path d="M253 250.8 111.2 321.1 127.2 348.9 259 261.2Z" />
      <circle cx="119.2" cy="335" r="44" />
      <path d="M259 250.8 127.2 163.1 111.2 190.9 253 261.2Z" />
      <circle cx="119.2" cy="177" r="44" />
    </svg>
  );
}

/** Three lines, for the Menu button. */
export function MenuIcon() {
  return (
    <svg className="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  );
}
