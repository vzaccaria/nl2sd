import { LayoutNode, Edge } from "./types";

const COL_WIDTH = 10; // chars per node column
const ROW_HEIGHT = 5; // rows per layer
const SPLAY = 2;      // chars between adjacent arrival/departure points

// 45° visivo: terminal chars are ~2× taller than wide.
// To look 45° on screen: advance 1 px-col every 2 px-rows.
const DIAG_SLOPE = 2; // py per px for visual 45°

// Braille encoding
const BRAILLE_BASE = 0x2800;
const DOT_BIT: number[][] = [
  [0, 3],
  [1, 4],
  [2, 5],
  [6, 7],
];

export function generateAscii(
  layoutNodes: LayoutNode[],
  edges: Edge[]
): string {
  const nodeMap = new Map<number, LayoutNode>();
  for (const n of layoutNodes) nodeMap.set(n.id, n);

  const layers = new Map<number, LayoutNode[]>();
  for (const n of layoutNodes) {
    if (!layers.has(n.layer)) layers.set(n.layer, []);
    layers.get(n.layer)!.push(n);
  }
  const maxLayer = Math.max(...layers.keys());

  let maxNodesInLayer = 0;
  for (const [, nl] of layers)
    if (nl.length > maxNodesInLayer) maxNodesInLayer = nl.length;

  const nodeCol = new Map<number, number>();
  const nodeRow = new Map<number, number>();
  for (const n of layoutNodes) {
    const nl = layers.get(n.layer)!;
    const offset = Math.floor((maxNodesInLayer - nl.length) / 2);
    nodeCol.set(n.id, (offset + n.x) * COL_WIDTH + Math.floor(COL_WIDTH / 2));
    nodeRow.set(n.id, n.layer * ROW_HEIGHT);
  }

  const gridWidth = maxNodesInLayer * COL_WIDTH + 2;
  const gridHeight = (maxLayer + 1) * ROW_HEIGHT + 1;

  const textGrid: (string | null)[][] = [];
  for (let r = 0; r < gridHeight; r++)
    textGrid.push(new Array(gridWidth).fill(null));

  const pxW = gridWidth * 2;
  const pxH = gridHeight * 4;
  const pixels: Uint8Array[] = [];
  for (let r = 0; r < pxH; r++)
    pixels.push(new Uint8Array(pxW));

  function placeStr(row: number, col: number, s: string): void {
    const start = col - Math.floor(s.length / 2);
    for (let i = 0; i < s.length; i++) {
      const c = start + i;
      if (c >= 0 && c < gridWidth && row >= 0 && row < gridHeight)
        textGrid[row][c] = s[i];
    }
  }

  function setPixel(px: number, py: number): void {
    if (px >= 0 && px < pxW && py >= 0 && py < pxH)
      pixels[py][px] = 1;
  }

  function drawLine(x0: number, y0: number, x1: number, y1: number): void {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      setPixel(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  function drawVert(px: number, py0: number, py1: number): void {
    for (let y = Math.min(py0, py1); y <= Math.max(py0, py1); y++)
      setPixel(px, y);
  }

  // --- Render nodes ---
  for (const n of layoutNodes) {
    const col = nodeCol.get(n.id)!;
    const row = nodeRow.get(n.id)!;
    if (n.isDummy) continue;
    if (n.isCopyNode) { placeStr(row, col, "●"); continue; }
    const isDead = n.annotations?.includes("dead");
    const isProbe = n.annotations?.includes("probe");
    switch (n.type) {
      case "in": {
        const l = n.comment || n.port || `i${n.id}`;
        placeStr(row, col, isDead ? `~${l}~` : isProbe ? `[P]${l}` : l); break;
      }
      case "out": {
        const l = n.comment || n.port || `o${n.id}`;
        placeStr(row, col, isDead ? `~${l}~` : isProbe ? `[P]${l}` : l); break;
      }
      case "ref": placeStr(row, col, `(${n.comment || `r${n.id}`})`); break;
      case "reg": placeStr(row, col, `[${n.port || `R${n.id}`}]`); break;
      case "and": placeStr(row, col, isDead ? "~&~" : isProbe ? "[P]&" : "&"); break;
      case "xor": placeStr(row, col, isDead ? "~^~" : isProbe ? "[P]^" : "^"); break;
      case "xnor": placeStr(row, col, isDead ? "~=^~" : isProbe ? "[P]=^" : "=^"); break;
      case "nand": placeStr(row, col, isDead ? "~!&~" : isProbe ? "[P]!&" : "!&"); break;
      case "nor": placeStr(row, col, isDead ? "~!|~" : isProbe ? "[P]!|" : "!|"); break;
      case "not": placeStr(row, col, isDead ? "~!~" : isProbe ? "[P]!" : "!"); break;
    }
  }

  // --- Edge ordering for splay ---
  const outgoingByNode = new Map<number, Edge[]>();
  const incomingByNode = new Map<number, Edge[]>();
  for (const n of layoutNodes) {
    outgoingByNode.set(n.id, []);
    incomingByNode.set(n.id, []);
  }
  for (const e of edges) {
    const fn = nodeMap.get(e.from), tn = nodeMap.get(e.to);
    if (!fn || !tn) continue;
    if (!fn.isDummy) outgoingByNode.get(e.from)!.push(e);
    if (!tn.isDummy) incomingByNode.get(e.to)!.push(e);
  }
  for (const [, el] of outgoingByNode)
    el.sort((a, b) => nodeCol.get(a.to)! - nodeCol.get(b.to)!);
  for (const [, el] of incomingByNode)
    el.sort((a, b) => nodeCol.get(a.from)! - nodeCol.get(b.from)!);

  function getDepCol(e: Edge): number {
    const fn = nodeMap.get(e.from)!;
    if (fn.isDummy) return nodeCol.get(e.from)!;
    const out = outgoingByNode.get(e.from)!;
    const idx = out.indexOf(e);
    return nodeCol.get(e.from)! + Math.round((idx - (out.length - 1) / 2) * SPLAY);
  }

  function getArrCol(e: Edge): number {
    const tn = nodeMap.get(e.to)!;
    if (tn.isDummy) return nodeCol.get(e.to)!;
    const inc = incomingByNode.get(e.to)!;
    const idx = inc.indexOf(e);
    return nodeCol.get(e.to)! + Math.round((idx - (inc.length - 1) / 2) * SPLAY);
  }

  // Node types with 45° diagonal arrivals (converging V)
  const DIAG_ARRIVAL = new Set(["and", "xor", "xnor", "nand", "nor", "not", "reg"]);

  // Minimum vertical stem in pixels (1 char-row)
  const MIN_STEM = 4;

  // --- Draw edges ---
  // Routing rules — each edge has a departure style and an arrival style:
  //   Departure: copy → 45° diagonal | everything else → vertical
  //   Arrival:   gate/reg → 45° diagonal | everything else → vertical
  //
  // When 45° doesn't fit, we keep a minimum vertical stem and the diagonal
  // uses whatever angle is needed to cover the remaining distance.

  for (const e of edges) {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (!fromNode || !toNode) continue;

    const dc = getDepCol(e);
    const ac = getArrCol(e);
    const pyTop = (nodeRow.get(e.from)! + 1) * 4;
    const pyBot = nodeRow.get(e.to)! * 4 - 1;
    if (pyTop > pyBot) continue;

    const depPx = dc * 2 + 1;
    const arrPx = ac * 2 + 1;
    const totalV = pyBot - pyTop;

    if (depPx === arrPx) {
      drawVert(depPx, pyTop, pyBot);
      continue;
    }

    const hdist = Math.abs(arrPx - depPx);
    const dirH = arrPx > depPx ? 1 : -1;

    // Determine departure/arrival styles
    const diagDep = fromNode.isCopyNode === true;
    const diagArr = !toNode.isDummy && !toNode.isCopyNode && DIAG_ARRIVAL.has(toNode.type);

    // Ideal 45° vertical span for a given horizontal distance
    const ideal45 = (h: number) => h * DIAG_SLOPE;

    if (diagDep && diagArr) {
      // Copy → gate: 45° out + vertical + 45° in
      const hTop = Math.ceil(hdist / 2);
      const hBot = hdist - hTop;
      const vIdealTop = ideal45(hTop);
      const vIdealBot = ideal45(hBot);

      if (vIdealTop + vIdealBot <= totalV) {
        // Perfect 45° for both
        const midPx = depPx + dirH * hTop;
        drawLine(depPx, pyTop, midPx, pyTop + vIdealTop);
        drawVert(midPx, pyTop + vIdealTop, pyBot - vIdealBot);
        drawLine(midPx, pyBot - vIdealBot, arrPx, pyBot);
      } else {
        // Split available space proportionally
        const ratio = totalV / (vIdealTop + vIdealBot);
        const vTop = Math.round(vIdealTop * ratio);
        const midPx = depPx + dirH * hTop;
        drawLine(depPx, pyTop, midPx, pyTop + vTop);
        drawLine(midPx, pyTop + vTop, arrPx, pyBot);
      }
    } else if (diagDep) {
      // Copy → non-gate: 45° departure, then vertical
      const vDiag = ideal45(hdist);
      if (vDiag <= totalV) {
        drawLine(depPx, pyTop, arrPx, pyTop + vDiag);
        drawVert(arrPx, pyTop + vDiag, pyBot);
      } else {
        // Diagonal fills all available space (steeper than 45°)
        drawLine(depPx, pyTop, arrPx, pyBot);
      }
    } else if (diagArr) {
      // Non-copy → gate: vertical stem, then 45° arrival
      const vDiag = ideal45(hdist);
      if (vDiag <= totalV - MIN_STEM) {
        // Perfect 45° arrival with vertical stem above
        drawVert(depPx, pyTop, pyBot - vDiag);
        drawLine(depPx, pyBot - vDiag, arrPx, pyBot);
      } else {
        // Not enough room for 45°: keep min stem, diagonal the rest
        const stemEnd = pyTop + MIN_STEM;
        drawVert(depPx, pyTop, stemEnd);
        drawLine(depPx, stemEnd, arrPx, pyBot);
      }
    } else {
      // Default: vertical stem, then diagonal to target
      const vDiag = ideal45(hdist);
      if (vDiag <= totalV - MIN_STEM) {
        drawVert(depPx, pyTop, pyBot - vDiag);
        drawLine(depPx, pyBot - vDiag, arrPx, pyBot);
      } else {
        // Keep min stem, diagonal the rest
        const stemEnd = pyTop + MIN_STEM;
        drawVert(depPx, pyTop, stemEnd);
        drawLine(depPx, stemEnd, arrPx, pyBot);
      }
    }
  }

  // --- Composite: text + Braille ---
  const lines: string[] = [];
  for (let r = 0; r < gridHeight; r++) {
    let line = "";
    for (let c = 0; c < gridWidth; c++) {
      const text = textGrid[r][c];
      if (text !== null) { line += text; continue; }
      let dots = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const py = r * 4 + dy, px = c * 2 + dx;
          if (py < pxH && px < pxW && pixels[py][px])
            dots |= (1 << DOT_BIT[dy][dx]);
        }
      line += dots === 0 ? " " : String.fromCodePoint(BRAILLE_BASE + dots);
    }
    lines.push(line.replace(/\s+$/, ""));
  }

  return lines.join("\n").replace(/\n+$/, "") + "\n";
}
