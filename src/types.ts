export type GateType =
  | "in"
  | "out"
  | "ref"
  | "reg"
  | "and"
  | "xor"
  | "xnor"
  | "nand"
  | "nor"
  | "not";

export interface NetlistNode {
  id: number;
  type: GateType;
  inputs: number[];
  port?: string;
  comment?: string;
  inner?: string;
  annotations?: string[];
}

export interface LayoutNode extends NetlistNode {
  layer: number;
  x: number;
  isCopyNode?: boolean;
  isDummy?: boolean;
  /** For dummy nodes, the original edge this dummy belongs to */
  dummyEdge?: { from: number; to: number };
}

export interface Edge {
  from: number;
  to: number;
}
