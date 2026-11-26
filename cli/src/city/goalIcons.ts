// One line icon per Atlas goal for the "Your next plays" goal and play cards: 24px grid, stroke 1.8,
// round caps and joins (the left menu's set), drawn on a soft coloured tile. Inline SVG, no fonts.

/** A tile tone: a soft tint behind the icon and a darker ink for its stroke, set in style.ts. */
export type GoalTone = "green" | "blue" | "violet" | "amber" | "rose" | "teal";

/** Each goal's icon paths (24x24) and tile tone. Every goal has its own icon. */
export const GOAL_ICONS: Record<string, { d: string; tone: GoalTone }> = {
  "Buying signals": { tone: "green", d: '<path d="M5.6 18.4a9 9 0 0 1 0-12.8"/><path d="M8.6 15.4a4.8 4.8 0 0 1 0-6.8"/><circle cx="12" cy="12" r="1.6"/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/>' },
  "Competitor displacement": { tone: "rose", d: '<path d="M4 8h14"/><path d="M14.5 4.5 18 8l-3.5 3.5"/><path d="M20 16H6"/><path d="M9.5 12.5 6 16l3.5 3.5"/>' },
  "Market sizing and ICP": { tone: "blue", d: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2"/>' },
  "Buying committees": { tone: "violet", d: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="16.8" cy="9.6" r="2.4"/><path d="M15.6 14.3a4.4 4.4 0 0 1 5 4.4"/>' },
  "Pipeline and deal execution": { tone: "green", d: '<path d="M3.5 5h17l-6.5 7.5v6.5l-4-2v-4.5z"/>' },
  "Inbound and product-led growth": { tone: "teal", d: '<path d="M12 3.5v8.5"/><path d="M8.5 8.5 12 12l3.5-3.5"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>' },
  "Outbound research": { tone: "blue", d: '<path d="M20.5 3.5 10.5 13.5"/><path d="M20.5 3.5 14 20.5l-3.5-7-7-3.5z"/>' },
  "CRM and data quality": { tone: "teal", d: '<ellipse cx="12" cy="6" rx="7.5" ry="2.7"/><path d="M4.5 6v12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7V6"/><path d="M4.5 12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7"/>' },
  "Partnerships": { tone: "violet", d: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
  "SEO and AI search": { tone: "amber", d: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M10.5 7.6l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>' },
  "Paid media": { tone: "rose", d: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4.2 4.2 0 0 1 0 6"/><path d="M19.2 6.5a7.8 7.8 0 0 1 0 11"/>' },
  "Expansion and renewals": { tone: "green", d: '<path d="M4 19.5h16"/><path d="m4.5 15 4.5-4.5 3.5 3L19 7"/><path d="M14.5 7H19v4.5"/>' },
  "Local market opportunities": { tone: "rose", d: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>' },
  "Commerce and distribution": { tone: "amber", d: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>' },
  "Technical adoption": { tone: "blue", d: '<path d="M8.5 7 3.5 12l5 5"/><path d="m15.5 7 5 5-5 5"/><path d="m13.5 4.5-3 15"/>' },
  "Events and communities": { tone: "violet", d: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/><path d="M8 14.5h.01M12 14.5h.01M16 14.5h.01"/>' },
  "Market expansion": { tone: "teal", d: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.5 3.5 5.4 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.4-3.5-8.5s1.1-6 3.5-8.5z"/>' },
  "GTM operations": { tone: "blue", d: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>' },
  "Positioning and research": { tone: "amber", d: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>' },
  "Data spend and reliability": { tone: "green", d: '<path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.5"/>' },
};

/** The icon's SVG markup for one goal, or "" for an unknown goal. Stroke follows the tile's ink. */
export function goalSvg(goal: string): string {
  const g = GOAL_ICONS[goal];
  return g ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g.d}</svg>` : "";
}

/** The icon on its soft tile, as a span for a card head. */
export function goalTile(goal: string): string {
  const g = GOAL_ICONS[goal];
  return g ? `<span class="zatl-i zgi-${g.tone}">${goalSvg(goal)}</span>` : "";
}
