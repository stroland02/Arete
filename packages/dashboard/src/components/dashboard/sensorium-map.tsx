"use client";

import type { Topology } from "@arete/topology";
import type { NodeSensors } from "@/lib/sensors";
import { CodeMap } from "./code-map";

interface SensoriumMapProps {
  topology: Topology;
  sensors: Record<string, NodeSensors>;
}

/**
 * The compact /overview embed of the code map. Kept as a thin wrapper so the
 * export name + props survive the v2 rewrite (existing imports and tests keep
 * working). Non-interactive by design: clicking any file or folder deep-links
 * into the full /map workspace via plain hrefs (renderable with no router
 * context). The full canvas — zoom/pan/search/filters + sidebar — lives there.
 */
export function SensoriumMap({ topology, sensors }: SensoriumMapProps) {
  return (
    <CodeMap
      topology={topology}
      sensors={sensors}
      hrefFor={(sel) =>
        sel.kind === "file"
          ? `/map?node=${encodeURIComponent(sel.id)}`
          : `/map?folder=${encodeURIComponent(sel.id)}`
      }
    />
  );
}
