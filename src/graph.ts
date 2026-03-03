import { NetlistNode, LayoutNode, Edge } from "./types";

/**
 * Build the graph: compute forward edges, detect fanout,
 * insert copy (W_Δ) nodes for wires that fan out to multiple consumers.
 */
export function buildGraph(nodes: NetlistNode[]): {
  layoutNodes: LayoutNode[];
  edges: Edge[];
} {
  const nodeMap = new Map<number, NetlistNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  // Count how many consumers each node has
  const fanoutCount = new Map<number, number>();
  for (const n of nodes) {
    for (const inp of n.inputs) {
      fanoutCount.set(inp, (fanoutCount.get(inp) || 0) + 1);
    }
  }

  // Start building layout nodes and edges
  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    ...n,
    layer: -1,
    x: 0,
  }));
  const edges: Edge[] = [];

  let nextId = Math.max(...nodes.map((n) => n.id)) + 1;

  // For nodes with fanout > 1, insert a tree of copy nodes
  // Each copy node has 1 input and 2 outputs (binary tree)
  const copyTrees = new Map<number, number[]>(); // sourceId -> leaf copy node IDs

  for (const [sourceId, count] of fanoutCount.entries()) {
    if (count <= 1) continue;

    // Build a binary tree of copy nodes
    // We need `count` leaves for `count` consumers
    let currentLeaves = [sourceId];

    while (currentLeaves.length < count) {
      const newLeaves: number[] = [];
      for (const leaf of currentLeaves) {
        if (newLeaves.length + (currentLeaves.length - currentLeaves.indexOf(leaf) - 1) + newLeaves.length >= count) {
          // Enough leaves already
          newLeaves.push(leaf);
          continue;
        }
        // Split this leaf into two via a copy node
        const copyId = nextId++;
        const copyNode: LayoutNode = {
          id: copyId,
          type: "and", // placeholder type, will be rendered as copy dot
          inputs: [leaf],
          layer: -1,
          x: 0,
          isCopyNode: true,
        };
        layoutNodes.push(copyNode);
        edges.push({ from: leaf, to: copyId });
        // The two children of this copy node become new leaves
        newLeaves.push(copyId);
        newLeaves.push(copyId);
        if (newLeaves.length >= count) break;
      }
      currentLeaves = newLeaves;
      if (currentLeaves.length >= count) break;
    }

    copyTrees.set(sourceId, currentLeaves.slice(0, count));
  }

  // Now rewire consumer edges through copy trees
  const copyLeafIndex = new Map<number, number>(); // sourceId -> next leaf index
  for (const [sourceId] of copyTrees) {
    copyLeafIndex.set(sourceId, 0);
  }

  for (const n of nodes) {
    for (const inp of n.inputs) {
      const leaves = copyTrees.get(inp);
      if (leaves) {
        const idx = copyLeafIndex.get(inp)!;
        edges.push({ from: leaves[idx], to: n.id });
        copyLeafIndex.set(inp, idx + 1);
      } else {
        edges.push({ from: inp, to: n.id });
      }
    }
  }

  return { layoutNodes, edges };
}

/**
 * Assign layers using longest-path from sources.
 * in/ref nodes → layer 0
 * Other nodes → max(input layers) + 1
 * out nodes → pushed to maxLayer + 1
 */
export function assignLayers(
  layoutNodes: LayoutNode[],
  edges: Edge[]
): void {
  const nodeMap = new Map<number, LayoutNode>();
  for (const n of layoutNodes) {
    nodeMap.set(n.id, n);
  }

  // Build adjacency: for each node, which nodes feed into it
  const incomingEdges = new Map<number, number[]>();
  for (const n of layoutNodes) {
    incomingEdges.set(n.id, []);
  }
  for (const e of edges) {
    incomingEdges.get(e.to)?.push(e.from);
  }

  // Topological sort using Kahn's algorithm
  const inDegree = new Map<number, number>();
  const outgoing = new Map<number, number[]>();
  for (const n of layoutNodes) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    outgoing.get(e.from)?.push(e.to);
  }

  // Assign layers via BFS
  const queue: number[] = [];
  for (const n of layoutNodes) {
    if (n.type === "in" || n.type === "ref") {
      n.layer = 0;
      queue.push(n.id);
    }
  }
  // Also add copy nodes whose only input is a layer-0 node
  // (handled naturally by the BFS below)

  const layerOf = new Map<number, number>();
  for (const id of queue) {
    layerOf.set(id, 0);
  }

  // Process in topological order
  let idx = 0;
  while (idx < queue.length) {
    const curId = queue[idx++];
    const curLayer = layerOf.get(curId)!;

    for (const nextId of outgoing.get(curId) || []) {
      const prevMax = layerOf.get(nextId) ?? -1;
      layerOf.set(nextId, Math.max(prevMax, curLayer + 1));

      const deg = inDegree.get(nextId)! - 1;
      inDegree.set(nextId, deg);
      if (deg === 0) {
        queue.push(nextId);
      }
    }
  }

  // Apply layers
  for (const n of layoutNodes) {
    if (layerOf.has(n.id)) {
      n.layer = layerOf.get(n.id)!;
    }
  }

  // Push all out nodes to maxLayer
  const maxGateLayer = Math.max(
    ...layoutNodes.filter((n) => n.type !== "out").map((n) => n.layer)
  );
  for (const n of layoutNodes) {
    if (n.type === "out") {
      n.layer = maxGateLayer + 1;
    }
  }
}

/**
 * Insert dummy nodes for edges that span more than one layer.
 */
export function insertDummyNodes(
  layoutNodes: LayoutNode[],
  edges: Edge[]
): { layoutNodes: LayoutNode[]; edges: Edge[] } {
  const nodeMap = new Map<number, LayoutNode>();
  for (const n of layoutNodes) {
    nodeMap.set(n.id, n);
  }

  let nextId = Math.max(...layoutNodes.map((n) => n.id)) + 1;
  const newNodes: LayoutNode[] = [];
  const newEdges: Edge[] = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (!fromNode || !toNode) continue;

    const span = toNode.layer - fromNode.layer;
    if (span <= 1) {
      newEdges.push(e);
      continue;
    }

    // Insert dummy nodes for each intermediate layer
    let prevId = e.from;
    for (let layer = fromNode.layer + 1; layer < toNode.layer; layer++) {
      const dummyId = nextId++;
      const dummy: LayoutNode = {
        id: dummyId,
        type: "xor", // placeholder
        inputs: [prevId],
        layer,
        x: 0,
        isDummy: true,
        dummyEdge: { from: e.from, to: e.to },
      };
      newNodes.push(dummy);
      nodeMap.set(dummyId, dummy);
      newEdges.push({ from: prevId, to: dummyId });
      prevId = dummyId;
    }
    newEdges.push({ from: prevId, to: e.to });
  }

  return {
    layoutNodes: [...layoutNodes, ...newNodes],
    edges: newEdges,
  };
}
