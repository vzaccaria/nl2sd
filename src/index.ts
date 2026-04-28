#!/usr/bin/env node

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { Command } from "commander";
import { LayoutNode, Edge } from "./types";
import { parseNetlist } from "./parser";
import { buildGraph, assignLayers, insertDummyNodes } from "./graph";
import { layoutGraph } from "./layout";
import { generateTikz } from "./tikz";
import { generateAscii } from "./ascii";

function wrapTikzStandalone(tikz: string): string {
  return `\\documentclass[border=5pt]{standalone}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta}
\\begin{document}
${tikz}
\\end{document}
`;
}

function escapeLatexText(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[&%$#_{}~^]/g, (m) => "\\" + m);
}

function combineTikzPanels(
  panels: string[],
  labels: string[],
  gap: string
): string {
  if (panels.length === 1) return panels[0];

  const separator = `@{\\hspace{${gap}}}`;
  const columnSpec = `@{}${Array(panels.length).fill("c").join(separator)}@{}`;
  // Force each tikzpicture's baseline to its bounding-box NORTH so the
  // tabular row aligns panels at their top edges instead of at tikz origin.
  const topAlignedPanels = panels.map((p) =>
    p.replace(
      /\\begin\{tikzpicture\}\[/,
      "\\begin{tikzpicture}[baseline={(current bounding box.north)},"
    )
  );
  const rows = [`\\begin{tabular}{${columnSpec}}`, topAlignedPanels.join(" & ")];

  if (labels.length > 0) {
    const paddedLabels = panels.map((_, i) => labels[i] || "");
    rows.push("\\\\[0.35em]");
    rows.push(
      paddedLabels
        .map((label) => label ? `{\\footnotesize ${escapeLatexText(label)}}` : "")
        .join(" & ")
    );
  }

  rows.push("\\end{tabular}");
  return rows.join("\n");
}

function panelLetter(index: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  if (index < alphabet.length) return alphabet[index];
  return `${index + 1}`;
}

function panelLabels(count: number, labelsCsv?: string): string[] {
  if (count <= 1) return [];

  const labels = labelsCsv
    ? labelsCsv.split(",").map((s) => s.trim())
    : [];

  return Array.from({ length: count }, (_, i) => {
    const prefix = `(${panelLetter(i)})`;
    return labels[i] ? `${prefix} ${labels[i]}` : prefix;
  });
}

function compilePdf(texContent: string, outputPath: string): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nl2sd-"));
  const texFile = path.join(tmpDir, "diagram.tex");
  const pdfFile = path.join(tmpDir, "diagram.pdf");

  try {
    fs.writeFileSync(texFile, texContent);
    execSync(
      `pdflatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}"`,
      { stdio: "pipe" }
    );
    fs.copyFileSync(pdfFile, outputPath);
    console.error(`PDF written to ${outputPath}`);
  } finally {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.rmdirSync(tmpDir);
  }
}

function compilePng(
  texContent: string,
  outputPath: string,
  dpi: number
): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nl2sd-"));
  const texFile = path.join(tmpDir, "diagram.tex");
  const pdfFile = path.join(tmpDir, "diagram.pdf");
  const ppmPrefix = path.join(tmpDir, "diagram");

  try {
    fs.writeFileSync(texFile, texContent);
    execSync(
      `pdflatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}"`,
      { stdio: "pipe" }
    );

    try {
      execSync(
        `pdftoppm -png -r ${dpi} -singlefile "${pdfFile}" "${ppmPrefix}"`,
        { stdio: "pipe" }
      );
      fs.copyFileSync(`${ppmPrefix}.png`, outputPath);
    } catch {
      execSync(
        `convert -density ${dpi} "${pdfFile}" -quality 100 "${outputPath}"`,
        { stdio: "pipe" }
      );
    }
    console.error(`PNG (${dpi} DPI) written to ${outputPath}`);
  } finally {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.rmdirSync(tmpDir);
  }
}

function pipeline(inputFile: string): { layoutNodes: LayoutNode[]; edges: Edge[] } {
  const content = fs.readFileSync(inputFile, "utf-8");
  const nodes = parseNetlist(content);
  let { layoutNodes, edges } = buildGraph(nodes);
  assignLayers(layoutNodes, edges);
  ({ layoutNodes, edges } = insertDummyNodes(layoutNodes, edges));
  layoutGraph(layoutNodes, edges);
  return { layoutNodes, edges };
}

const program = new Command();

program
  .name("nl2sd")
  .description("Convert netlist (.nl) files to signal-flow TikZ diagrams")
  .argument("<files...>", "path(s) to .nl netlist file(s)")
  .option("--pdf", "generate PDF output (requires pdflatex)")
  .option("--png", "generate high-quality PNG output (requires pdflatex + pdftoppm)")
  .option("--ascii", "generate ASCII diagram to stdout")
  .option("--dpi <number>", "PNG resolution in DPI", "300")
  .option("--probe-color <latex-color>", "default color for @probe markers", "red")
  .option("--panel-labels <csv>", "comma-separated labels for multi-file side-by-side panels")
  .option("--panel-gap <latex-length>", "horizontal gap between multi-file panels", "1.2cm")
  .option("-o, --output <file>", "output file path (default: derived from input name)")
  .action((files: string[], opts: { pdf?: boolean; png?: boolean; ascii?: boolean; dpi: string; output?: string; probeColor?: string; panelLabels?: string; panelGap: string }) => {
    const diagrams = files.map((file) => ({ file, ...pipeline(file) }));
    const firstFile = files[0];
    const baseName = path.basename(firstFile, path.extname(firstFile));
    const dir = path.dirname(firstFile);
    const dpi = parseInt(opts.dpi, 10);
    const probeColor = opts.probeColor || "red";
    const labels = panelLabels(files.length, opts.panelLabels);
    // Cross-panel output alignment: pick the deepest output y across all
    // diagrams, so each panel's regular outs render on the same row.
    const LAYER_SEP = 1.2;
    let outYOverride: number | undefined;
    if (diagrams.length > 1) {
      let maxLayer = 0;
      for (const d of diagrams) {
        for (const n of d.layoutNodes) {
          if (n.type === "out" && !n.annotations?.includes("erase") && n.layer > maxLayer) {
            maxLayer = n.layer;
          }
        }
      }
      outYOverride = -maxLayer * LAYER_SEP;
    }
    const tikzOpts = { defaultProbeColor: probeColor, outYOverride };

    if (opts.ascii) {
      const ascii = diagrams
        .map((diagram) => generateAscii(diagram.layoutNodes, diagram.edges))
        .join("\n\n---\n\n");
      if (opts.output) {
        fs.writeFileSync(opts.output, ascii);
        console.error(`ASCII diagram written to ${opts.output}`);
      } else {
        console.log(ascii);
      }
    } else if (opts.pdf) {
      const panels = diagrams.map((diagram) =>
        generateTikz(diagram.layoutNodes, diagram.edges, tikzOpts)
      );
      const outName = files.length === 1 ? `${baseName}.pdf` : `${baseName}-panels.pdf`;
      const out = opts.output || path.join(dir, outName);
      compilePdf(wrapTikzStandalone(combineTikzPanels(panels, labels, opts.panelGap)), out);
    } else if (opts.png) {
      const panels = diagrams.map((diagram) =>
        generateTikz(diagram.layoutNodes, diagram.edges, tikzOpts)
      );
      const outName = files.length === 1 ? `${baseName}.png` : `${baseName}-panels.png`;
      const out = opts.output || path.join(dir, outName);
      compilePng(wrapTikzStandalone(combineTikzPanels(panels, labels, opts.panelGap)), out, dpi);
    } else {
      const panels = diagrams.map((diagram) =>
        generateTikz(diagram.layoutNodes, diagram.edges, tikzOpts)
      );
      const tikz = combineTikzPanels(panels, labels, opts.panelGap);
      if (opts.output) {
        fs.writeFileSync(opts.output, tikz);
        console.error(`TikZ written to ${opts.output}`);
      } else {
        console.log(tikz);
      }
    }
  });

program.parse();
