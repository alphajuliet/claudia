import { useMemo, type ReactNode } from "react";
import type { LabelColour } from "@claudia/shared";
import { useLabels } from "../data/queries";
import { colourMap } from "../lib/labelColours";

/** Looks up a label's colour by name (any case): undefined for the default grey, or before the labels load. */
export function useLabelColour(): (name: string) => LabelColour | undefined {
  const labels = useLabels().data;
  const map = useMemo(() => colourMap(labels ?? []), [labels]);
  return (name) => map.get(name.toLowerCase());
}

/** A label as a chip in its colour. `children` come after the name (such as a remove button). */
export function LabelChip({ name, color, as: Tag = "span", className, children }: {
  name: string;
  color: LabelColour | undefined | null;
  as?: "span" | "li";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tag className={["chip", className].filter(Boolean).join(" ")} data-color={color ?? undefined}>
      {name}
      {children}
    </Tag>
  );
}
