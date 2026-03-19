import { LayoutNode, Edge } from "./types";

const LAYER_SEP = 1.2; // vertical distance between layers
const NODE_SEP = 1.0; // horizontal distance between nodes
const STEM = 0.3; // length of vertical stem departing a node

export function generateTikz(
  layoutNodes: LayoutNode[],
  edges: Edge[]
): string {
  const nodeMap = new Map<number, LayoutNode>();
  for (const n of layoutNodes) {
    nodeMap.set(n.id, n);
  }

  const layers = new Map<number, LayoutNode[]>();
  for (const n of layoutNodes) {
    if (!layers.has(n.layer)) layers.set(n.layer, []);
    layers.get(n.layer)!.push(n);
  }

  // Precompute actual (x,y) positions
  const posX = new Map<number, number>();
  const posY = new Map<number, number>();
  for (const n of layoutNodes) {
    const xPos = (n.x - (layers.get(n.layer)!.length - 1) / 2) * NODE_SEP;
    const yPos = -n.layer * LAYER_SEP;
    posX.set(n.id, xPos);
    posY.set(n.id, yPos);
  }

  const lines: string[] = [];

  lines.push("\\begin{tikzpicture}[");
  lines.push("  >=stealth,");
  lines.push("  every node/.style={outer sep=0pt},");
  lines.push("  xor gate/.style={circle, fill=white, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  and gate/.style={circle, fill=gray!70, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  nand gate/.style={circle, fill=gray!70, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  xnor gate/.style={circle, fill=white, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  nor gate/.style={circle, fill=gray!40, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  not gate/.style={circle, fill=white, draw=black, inner sep=0pt, minimum size=5pt},");
  lines.push("  ref node/.style={circle, fill=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  reg node/.style={rectangle, fill=white, draw=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  copy node/.style={circle, fill=black, inner sep=0pt, minimum size=6pt},");
  lines.push("  dummy node/.style={inner sep=0pt, minimum size=0pt, coordinate},");
  lines.push("  io label/.style={font=\\footnotesize},");
  lines.push("  probe marker/.style={draw=blue!80, line width=0.8pt},");
  lines.push("  dead node/.style={draw=gray!50, dashed, fill=gray!10, text=gray!50},");
  lines.push("  dead edge/.style={draw=gray!40, dashed},");
  lines.push("  dead label/.style={font=\\footnotesize, text=gray!50},");
  lines.push("  fresh marker/.style={fill=blue!30, draw=blue!70},");
  lines.push("  highlight marker/.style={fill=yellow!40, draw=orange!60},");
  lines.push("]");
  lines.push("");

  // Place nodes
  for (const n of layoutNodes) {
    const xPos = posX.get(n.id)!;
    const yPos = posY.get(n.id)!;
    const pos = `(${xPos.toFixed(2)}, ${yPos.toFixed(2)})`;

    if (n.isDummy) {
      lines.push(`  \\coordinate (n${n.id}) at ${pos};`);
      continue;
    }

    if (n.isCopyNode) {
      lines.push(`  \\node[copy node] (n${n.id}) at ${pos} {};`);
      continue;
    }

    let style = nodeStyle(n.type);
    const isDead = hasAnnotation(n, "dead");
    const isFresh = hasAnnotation(n, "fresh");
    const isHighlight = hasAnnotation(n, "highlight");

    if (isFresh) {
      // Fresh randoms render as black filled circles (like ref nodes)
      style = "ref node";
      lines.push(`  \\node[${style}] (n${n.id}) at ${pos} {};`);
    } else if (n.type === "in" || n.type === "out") {
      if (isDead) {
        style = "dead label";
      } else if (isHighlight) {
        style = "io label, fill=yellow!40, rounded corners, inner sep=2pt";
      }
      const label = n.comment || n.port || `${n.type}${n.id}`;
      lines.push(`  \\node[${style}] (n${n.id}) at ${pos} {${formatLabel(label)}};`);
    } else {
      if (isDead) {
        style = "dead node";
      } else if (isHighlight) {
        const base = nodeStyle(n.type);
        style = `${base}, highlight marker`;
      }
      lines.push(`  \\node[${style}] (n${n.id}) at ${pos} {};`);
    }

    if (hasAnnotation(n, "probe")) {
      lines.push(`  \\draw[probe marker] (n${n.id}) circle (5pt);`);
    }
  }

  lines.push("");
  lines.push("  % Edges");

  // Precompute ordered outgoing/incoming edges for non-dummy nodes
  // so we can splay stems horizontally to avoid overlap.
  // outgoingByNode: all edges departing from a non-dummy source
  // incomingByNode: all edges arriving at a non-dummy target
  const outgoingByNode = new Map<number, Edge[]>();
  const incomingByNode = new Map<number, Edge[]>();
  for (const n of layoutNodes) {
    outgoingByNode.set(n.id, []);
    incomingByNode.set(n.id, []);
  }
  for (const e of edges) {
    const fn = nodeMap.get(e.from);
    const tn = nodeMap.get(e.to);
    if (!fn || !tn) continue;
    if (!fn.isDummy) outgoingByNode.get(e.from)!.push(e);
    if (!tn.isDummy) incomingByNode.get(e.to)!.push(e);
  }
  // Sort by partner position so stems don't cross
  for (const [, el] of outgoingByNode) {
    el.sort((a, b) => posX.get(a.to)! - posX.get(b.to)!);
  }
  for (const [, el] of incomingByNode) {
    el.sort((a, b) => posX.get(a.from)! - posX.get(b.from)!);
  }

  const ARR_SPREAD = 90; // angular spread for arrival (upper semicircle)
  const DEP_SPREAD = 90; // angular spread for departure (lower semicircle)

  // Compute angular anchor on the node boundary.
  // Arrival anchors spread across 135°..45° (upper semicircle, left to right).
  // Departure anchors spread across 225°..315° (lower semicircle, left to right).
  function arrivalAngle(idx: number, n: number): number {
    if (n <= 1) return 90;
    return Math.round(90 + ARR_SPREAD / 2 - idx * ARR_SPREAD / (n - 1));
  }
  function departureAngle(idx: number, n: number): number {
    if (n <= 1) return 270;
    return Math.round(270 - DEP_SPREAD / 2 + idx * DEP_SPREAD / (n - 1));
  }

  // Draw edges with context-aware routing:
  //  - dummy→dummy: straight through
  //  - non-dummy source: angular departure anchor + stem
  //  - non-dummy target: angular arrival anchor + stem
  for (const e of edges) {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (!fromNode || !toNode) continue;

    const srcIsDummy = fromNode.isDummy === true;
    const dstIsDummy = toNode.isDummy === true;

    // Determine if this edge should use dead style.
    // For dummy nodes, check the original edge endpoints.
    function resolveDeadStatus(n: LayoutNode): boolean {
      if (hasAnnotation(n, "dead")) return true;
      if (n.isDummy && n.dummyEdge) {
        const orig = nodeMap.get(n.dummyEdge.from);
        const dest = nodeMap.get(n.dummyEdge.to);
        if ((orig && hasAnnotation(orig, "dead")) || (dest && hasAnnotation(dest, "dead"))) return true;
      }
      return false;
    }
    const edgeDead = resolveDeadStatus(fromNode) || resolveDeadStatus(toNode);
    const drawCmd = edgeDead ? "\\draw[dead edge]" : "\\draw";

    // dummy → dummy: straight through
    if (srcIsDummy && dstIsDummy) {
      lines.push(`  ${drawCmd} (n${e.from}.south) -- (n${e.to}.north);`);
      continue;
    }

    // Compute departure angular anchor (for non-dummy sources)
    let depAnchor = `(n${e.from}.south)`;
    let depStem = `++(0, -${STEM})`;
    if (!srcIsDummy) {
      const outEdges = outgoingByNode.get(e.from)!;
      const outIdx = outEdges.indexOf(e);
      const outN = outEdges.length;
      const angle = departureAngle(outIdx, outN);
      depAnchor = `(n${e.from}.${angle})`;
      depStem = `([shift={(${angle}:${STEM}cm)}]n${e.from}.${angle})`;
    }

    // Compute arrival angular anchor (for non-dummy targets)
    let arrAnchor = `(n${e.to}.north)`;
    let arrStem = `([yshift=${STEM}cm]n${e.to}.north)`;
    if (!dstIsDummy) {
      const inEdges = incomingByNode.get(e.to)!;
      const inIdx = inEdges.indexOf(e);
      const inN = inEdges.length;
      const angle = arrivalAngle(inIdx, inN);
      arrAnchor = `(n${e.to}.${angle})`;
      arrStem = `([shift={(${angle}:${STEM}cm)}]n${e.to}.${angle})`;
    }

    if (!srcIsDummy && !dstIsDummy) {
      // non-dummy → non-dummy: angular departure + diagonal + angular arrival
      lines.push(
        `  ${drawCmd} ${depAnchor} -- ${depStem} -- ${arrStem} -- ${arrAnchor};`
      );
    } else if (!srcIsDummy) {
      // non-dummy → dummy: angular departure, then to dummy
      lines.push(
        `  ${drawCmd} ${depAnchor} -- ${depStem} -- (n${e.to}.north);`
      );
    } else {
      // dummy → non-dummy: from dummy, angular arrival into target
      lines.push(
        `  ${drawCmd} (n${e.from}.south) -- ${arrStem} -- ${arrAnchor};`
      );
    }
  }

  lines.push("");
  lines.push("\\end{tikzpicture}");

  return lines.join("\n");
}

function hasAnnotation(n: LayoutNode, tag: string): boolean {
  return n.annotations?.includes(tag) === true;
}

function nodeStyle(type: string): string {
  switch (type) {
    case "in":
    case "out":
      return "io label";
    case "ref":
      return "ref node";
    case "reg":
      return "reg node";
    case "and":
      return "and gate";
    case "xor":
      return "xor gate";
    case "xnor":
      return "xnor gate";
    case "nand":
      return "nand gate";
    case "nor":
      return "nor gate";
    case "not":
      return "not gate";
    default:
      return "dummy node";
  }
}

function formatLabel(s: string): string {
  // Detect subscript patterns: e.g. a_0, out_12, x_{foo}
  const subMatch = s.match(/^([A-Za-z]+)_\{(.+)\}$/) || s.match(/^([A-Za-z]+)_(\w+)$/);
  if (subMatch) {
    return `$${subMatch[1]}_{${subMatch[2]}}$`;
  }
  // Detect bracket patterns: e.g. a[0], out[12]
  const bracketMatch = s.match(/^([A-Za-z]+)\[(\w+)\]$/);
  if (bracketMatch) {
    return `$${bracketMatch[1]}_{${bracketMatch[2]}}$`;
  }
  // Plain text: escape LaTeX specials
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[&%$#_{}~^]/g, (m) => "\\" + m);
}
