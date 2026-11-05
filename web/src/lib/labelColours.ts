import { LABEL_COLOURS, type Label, type LabelColour } from "@claudia/shared";

/** The palette in picker order, with names for people. The shades for light and dark are in styles.css (`.chip[data-color]`). */
export const PALETTE: { id: LabelColour; name: string }[] = LABEL_COLOURS.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));

/** Each label's colour, keyed by lower-case name (tasks carry label names), leaving out grey ones. */
export function colourMap(labels: Label[]): Map<string, LabelColour> {
  const map = new Map<string, LabelColour>();
  for (const l of labels) if (l.color) map.set(l.name.toLowerCase(), l.color);
  return map;
}
