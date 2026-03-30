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
\\begin{document}
${tikz}
\\end{document}
`;
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
  .argument("<file>", "path to .nl netlist file")
  .option("--pdf", "generate PDF output (requires pdflatex)")
  .option("--png", "generate high-quality PNG output (requires pdflatex + pdftoppm)")
  .option("--ascii", "generate ASCII diagram to stdout")
  .option("--dpi <number>", "PNG resolution in DPI", "300")
  .option("-o, --output <file>", "output file path (default: derived from input name)")
  .action((file: string, opts: { pdf?: boolean; png?: boolean; ascii?: boolean; dpi: string; output?: string }) => {
    const { layoutNodes, edges } = pipeline(file);
    const baseName = path.basename(file, path.extname(file));
    const dir = path.dirname(file);
    const dpi = parseInt(opts.dpi, 10);

    if (opts.ascii) {
      const ascii = generateAscii(layoutNodes, edges);
      if (opts.output) {
        fs.writeFileSync(opts.output, ascii);
        console.error(`ASCII diagram written to ${opts.output}`);
      } else {
        console.log(ascii);
      }
    } else if (opts.pdf) {
      const tikz = generateTikz(layoutNodes, edges);
      const out = opts.output || path.join(dir, `${baseName}.pdf`);
      compilePdf(wrapTikzStandalone(tikz), out);
    } else if (opts.png) {
      const tikz = generateTikz(layoutNodes, edges);
      const out = opts.output || path.join(dir, `${baseName}.png`);
      compilePng(wrapTikzStandalone(tikz), out, dpi);
    } else {
      const tikz = generateTikz(layoutNodes, edges);
      if (opts.output) {
        fs.writeFileSync(opts.output, tikz);
        console.error(`TikZ written to ${opts.output}`);
      } else {
        console.log(tikz);
      }
    }
  });

program.parse();
