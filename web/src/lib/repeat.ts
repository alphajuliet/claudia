export type Preset = "none" | "daily" | "weekdays" | "weekly" | "fortnightly" | "monthly" | "yearly" | "custom";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "none", label: "Doesn't repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Every weekday" },
  { id: "weekly", label: "Every week" },
  { id: "fortnightly", label: "Every fortnight" },
  { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" },
  { id: "custom", label: "Custom…" },
];

// Plain weekly needs no BYDAY: the server anchors on the due date, so it repeats on that weekday.
const RULES: Record<Exclude<Preset, "none" | "custom">, string> = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  fortnightly: "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

/** The RRULE for a preset, or null for none. Custom has no rule of its own: the caller supplies the text. */
export function ruleFor(preset: Preset): string | null {
  if (preset === "none") return null;
  if (preset === "custom") throw new Error("A custom repeat has no preset rule");
  return RULES[preset];
}

/** The preset a rule matches exactly (ignoring case), or custom. */
export function presetFor(rule: string | null): Preset {
  if (rule === null) return "none";
  const upper = rule.toUpperCase();
  const match = (Object.keys(RULES) as (keyof typeof RULES)[]).find((p) => RULES[p] === upper);
  return match ?? "custom";
}
