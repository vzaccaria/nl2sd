import { LayoutNode, Edge } from "./types";

/**
 * Assign x-coordinates within each layer to minimize edge crossings.
 * Uses the barycenter heuristic with multiple sweeps.
 * Layer 0 (inputs/refs) and the last layer (outputs) keep their original order.
 */
export function layoutGraph(
  layoutNodes: LayoutNode[],
  edges: Edge[]
): void {
  // Group nodes by layer
  const layers = new Map<number, LayoutNode[]>();
  for (const n of layoutNodes) {
    if (!layers.has(n.layer)) {
      layers.set(n.layer, []);
    }
    layers.get(n.layer)!.push(n);
  }

  const maxLayer = Math.max(...layers.keys());

  // Build adjacency maps
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  for (const n of layoutNodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.from)?.push(e.to);
    incoming.get(e.to)?.push(e.from);
  }

  // Initial ordering: place nodes in order of original ID within each layer
  for (const [, nodesInLayer] of layers) {
    nodesInLayer.sort((a, b) => a.id - b.id);
    nodesInLayer.forEach((n, i) => {
      n.x = i;
    });
  }

  // Barycenter heuristic: sweep down then up, multiple times
  // Keep layer 0 (inputs/refs) and last layer (outputs) fixed
  const NUM_SWEEPS = 30;

  for (let sweep = 0; sweep < NUM_SWEEPS; sweep++) {
    // Down sweep: fix layer 0, optimize layers 1..maxLayer-1
    for (let layer = 1; layer < maxLayer; layer++) {
      const nodesInLayer = layers.get(layer);
      if (!nodesInLayer) continue;
      assignBarycenterPositions(nodesInLayer, incoming, layoutNodes);
    }
    // Also optimize the output layer based on incoming
    {
      const outLayer = layers.get(maxLayer);
      if (outLayer) {
        assignBarycenterPositions(outLayer, incoming, layoutNodes);
      }
    }
    // Up sweep: fix layer 0, optimize layers maxLayer-1..1
    for (let layer = maxLayer - 1; layer >= 1; layer--) {
      const nodesInLayer = layers.get(layer);
      if (!nodesInLayer) continue;
      assignBarycenterPositions(nodesInLayer, outgoing, layoutNodes);
    }
  }

  // Final: assign integer x positions by sorting within each layer
  for (const [layerIdx, nodesInLayer] of layers) {
    if (layerIdx === 0) {
      // Keep original ID order for inputs
      nodesInLayer.sort((a, b) => a.id - b.id);
    } else {
      nodesInLayer.sort((a, b) => a.x - b.x);
    }
    nodesInLayer.forEach((n, i) => {
      n.x = i;
    });
  }
}

function assignBarycenterPositions(
  nodesInLayer: LayoutNode[],
  adjacency: Map<number, number[]>,
  allNodes: LayoutNode[]
): void {
  const nodeMap = new Map<number, LayoutNode>();
  for (const n of allNodes) {
    nodeMap.set(n.id, n);
  }

  const barycenters = new Map<number, number>();
  for (const n of nodesInLayer) {
    const neighbors = adjacency.get(n.id) || [];
    if (neighbors.length === 0) {
      barycenters.set(n.id, n.x);
      continue;
    }
    let sum = 0;
    let count = 0;
    for (const nid of neighbors) {
      const neighbor = nodeMap.get(nid);
      if (neighbor) {
        sum += neighbor.x;
        count++;
      }
    }
    barycenters.set(n.id, count > 0 ? sum / count : n.x);
  }

  // Sort by barycenter, break ties by original ID for stability
  nodesInLayer.sort((a, b) => {
    const ba = barycenters.get(a.id) ?? 0;
    const bb = barycenters.get(b.id) ?? 0;
    if (Math.abs(ba - bb) < 1e-9) return a.id - b.id;
    return ba - bb;
  });

  nodesInLayer.forEach((n, i) => {
    n.x = i;
  });
}
