import React from "react";

/**
 * One stroke-based icon set for the whole app.
 *
 * Replaces the emoji that used to stand in for icons (`▦`, `🧾`, `⚙`). Emoji
 * render differently on every platform, cannot inherit colour, and are the
 * single loudest signal that an interface was assembled rather than designed.
 *
 * Every icon is a 24×24 outline on the same 1.75 stroke, inherits `currentColor`,
 * and is sized by the `size` prop (default 20) so it can sit inline with text.
 */

export type IconName =
  | "home"
  | "receipt"
  | "store"
  | "settings"
  | "plus"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "chevronUp"
  | "check"
  | "close"
  | "search"
  | "filter"
  | "calendar"
  | "download"
  | "upload"
  | "edit"
  | "trash"
  | "mail"
  | "camera"
  | "chart"
  | "list"
  | "wallet"
  | "hammer"
  | "package"
  | "truck"
  | "alert"
  | "info"
  | "clock"
  | "logout"
  | "more"
  | "link"
  | "refresh"
  | "sparkle"
  | "arrowUp"
  | "arrowDown"
  | "eye"
  | "eyeOff";

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V4.5a1 1 0 0 1 1-1Z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
      <path d="M3.2 9.5 5 4.2A1 1 0 0 1 6 3.5h12a1 1 0 0 1 1 .7l1.8 5.3a3 3 0 0 1-5.6 1.5 3 3 0 0 1-5.4 0 3 3 0 0 1-5.6-1.5Z" />
      <path d="M9.5 21v-5.5h5V21" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  chevronUp: <path d="m19 15-7-7-7 7" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  filter: <path d="M3.5 5.5h17l-6.5 8V20l-4 1.5v-8Z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  download: <path d="M12 3.5v12m0 0 4.5-4.5M12 15.5 7.5 11M4 18.5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />,
  upload: <path d="M12 20.5v-12m0 0L7.5 13M12 8.5 16.5 13M4 5.5v-1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1" />,
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 6.5 7.4 20a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1l.9-13.5" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7.5 7.4 5.3a2 2 0 0 0 2.2 0l7.4-5.3" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2l1.4-2.1a1 1 0 0 1 .8-.4h5.6a1 1 0 0 1 .8.4L17 6.5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  list: <path d="M8 6.5h12M8 12h12M8 17.5h12M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01" />,
  wallet: (
    <>
      <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2" />
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
      <path d="M16.5 13.5h.01" />
    </>
  ),
  hammer: (
    <>
      <path d="m13.5 7.5-9 9a2.1 2.1 0 0 0 3 3l9-9" />
      <path d="M12 6 15 3l6 6-3 3-1.5-1.5-3-3L12 6Z" />
    </>
  ),
  package: (
    <>
      <path d="M20.5 8 12 3.5 3.5 8v8L12 20.5 20.5 16Z" />
      <path d="M3.5 8 12 12.5 20.5 8M12 12.5v8" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7z" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21 19.5H3Z" />
      <path d="M12 9.5v4M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.2 2" />
    </>
  ),
  logout: <path d="M14 7.5V5.5a1 1 0 0 0-1-1H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H13a1 1 0 0 0 1-1v-2M10 12h10m0 0-3.2-3.2M20 12l-3.2 3.2" />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="18.5" r="1.4" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  refresh: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />,
  sparkle: <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9ZM18.5 16l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" />,
  arrowUp: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  arrowDown: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.4 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.6-.7" />
      <path d="M10 10a3 3 0 0 0 4 4M3.5 3.5l17 17" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className = "",
  filled = false,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Fills the shape as well as stroking it — used for the active nav tab. */
  filled?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${filled ? "opacity-95" : ""} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
