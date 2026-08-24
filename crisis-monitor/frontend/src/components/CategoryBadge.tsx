import type { CSSProperties, ReactNode } from "react";

type Category = "general" | "public_health" | "civil_unrest" | "infrastructure" | "natural_disaster" | "cyber";

interface Meta {
  label: string;
  color: string;
  icon: ReactNode;
}

const META: Record<Category, Meta> = {
  general: {
    label: "General",
    color: "var(--info)",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.7 12h16.6M12 3.5c2.6 2.3 4 5.3 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.3-4-8.5s1.4-6.2 4-8.5Z" />
      </>
    ),
  },
  public_health: {
    label: "Public health",
    color: "var(--positive)",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v9M7.5 12h9" />
      </>
    ),
  },
  civil_unrest: {
    label: "Civil unrest",
    color: "var(--critical)",
    icon: (
      <>
        <path d="M12 3.5 21 19.5H3L12 3.5Z" />
        <path d="M12 9.7v4.6M12 17.1v.2" />
      </>
    ),
  },
  infrastructure: {
    label: "Infrastructure",
    color: "var(--elevated)",
    icon: (
      <>
        <path d="M5 20V8l7-4.5L19 8v12" />
        <path d="M9 20v-6h6v6M9 12h.01M15 12h.01M9 9h.01M15 9h.01" />
      </>
    ),
  },
  natural_disaster: {
    label: "Natural disaster",
    color: "#4dd0ff",
    icon: (
      <>
        <path d="M7.3 16.3a4 4 0 0 1-.3-7.9 5.5 5.5 0 0 1 10.6-1.7 4.4 4.4 0 0 1-.6 9.6H7.3Z" />
        <path d="M9 19.3 8 22M13 19.3l-1 2.7M17 19.3l-1 2.7" />
      </>
    ),
  },
  cyber: {
    label: "Cyber",
    color: "var(--signal)",
    icon: (
      <>
        <path d="M12 3.4 19.4 6.3V12c0 5-3.2 7.9-7.4 8.9-4.2-1-7.4-3.9-7.4-8.9V6.3L12 3.4Z" />
        <path d="M9.2 12.2l1.9 1.9 3.5-3.9" />
      </>
    ),
  },
};

export function categoryMeta(category: string): Meta {
  return META[category as Category] ?? META.general;
}

interface Props {
  category: string;
  size?: number;
}

/** Small colored icon tile for a monitoring query's category — used on the query
 *  list cards and the dashboard header, replacing the raw boolean_query text that
 *  used to be shown there. */
export default function CategoryBadge({ category, size = 30 }: Props) {
  const meta = categoryMeta(category);
  const tileStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: size >= 26 ? 8 : 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
    border: `1px solid color-mix(in srgb, ${meta.color} 38%, transparent)`,
    flexShrink: 0,
  };
  return (
    <div style={tileStyle} title={meta.label} aria-label={meta.label}>
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        stroke={meta.color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {meta.icon}
      </svg>
    </div>
  );
}
