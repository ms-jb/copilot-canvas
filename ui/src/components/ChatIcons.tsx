import type { ReactNode } from "react";

// Small stroke icons for the conversation UI. Decorative: callers provide the accessible name.

export function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SendIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);

export const StopIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
  </Icon>
);

export const ArrowDownIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </Icon>
);

export const CopyIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Icon>
);

export const CheckIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </Icon>
);

export const ChevronLeftIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
);

export const ChevronRightIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 18l6-6-6-6" />
  </Icon>
);
