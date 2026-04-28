import { GateType, NetlistNode } from "./types";

const BINARY_OPS = new Set<GateType>(["and", "xor", "xnor", "nand", "nor"]);
const UNARY_OPS = new Set<GateType>(["not"]);
const ANNO_RE = /@(probe(?:[:=][A-Za-z0-9!._-]+)?|dead|fresh|highlight|erase)\b/g;

function normaliseAnnotation(raw: string): string {
  // Accept both @probe:red and @probe=red, normalise to probe:red.
  if (raw.startsWith("probe=")) {
    return `probe:${raw.substring("probe=".length)}`;
  }
  return raw;
}

export function parseNetlist(content: string): NetlistNode[] {
  const nodes: NetlistNode[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split comment
    const commentIdx = trimmed.indexOf("#");
    const codePart =
      commentIdx >= 0 ? trimmed.substring(0, commentIdx).trim() : trimmed;
    let comment =
      commentIdx >= 0 ? trimmed.substring(commentIdx + 1).trim() : undefined;

    // Extract @annotations from comment
    let annotations: string[] | undefined;
    if (comment) {
      const matches = comment.match(ANNO_RE);
      if (matches) {
        annotations = matches.map((m) => normaliseAnnotation(m.substring(1)));
        comment = comment.replace(ANNO_RE, "").trim() || undefined;
      }
    }

    const tokens = codePart.split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) continue;

    const op = tokens[0] as GateType;

    if (op === "in") {
      // in <wire_id> <port>
      const id = parseInt(tokens[1], 10);
      const port = tokens[2];
      nodes.push({ id, type: "in", inputs: [], port, comment, annotations });
    } else if (op === "out") {
      // out <source_id> <port>
      const sourceId = parseInt(tokens[1], 10);
      const port = tokens[2];
      const id = nodes.length; // out nodes get sequential IDs
      nodes.push({
        id,
        type: "out",
        inputs: [sourceId],
        port,
        comment,
        annotations,
      });
    } else if (op === "ref") {
      // ref <wire_id>
      const id = parseInt(tokens[1], 10);
      nodes.push({ id, type: "ref", inputs: [], comment, annotations });
    } else if (op === "reg") {
      // reg <source_id> [port]
      const sourceId = parseInt(tokens[1], 10);
      const port = tokens[2];
      const id = nodes.length;
      nodes.push({
        id,
        type: "reg",
        inputs: [sourceId],
        port,
        comment,
        annotations,
      });
    } else if (BINARY_OPS.has(op)) {
      // and/xor/xnor/nand/nor <src1> <src2>
      const src1 = parseInt(tokens[1], 10);
      const src2 = parseInt(tokens[2], 10);
      const id = nodes.length;
      nodes.push({ id, type: op, inputs: [src1, src2], comment, annotations });
    } else if (UNARY_OPS.has(op)) {
      // not <src>
      const src = parseInt(tokens[1], 10);
      const id = nodes.length;
      nodes.push({ id, type: op, inputs: [src], comment, annotations });
    }
  }

  return nodes;
}
