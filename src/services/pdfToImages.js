"use strict";

const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");

const defaultPdfImageOptions = {
  dpi: 300,
  format: "png",
  outputDir: path.join("tmp", "pdf-images"),
};

async function convertPdfToImages(pdfPath, options = {}) {
  const opts = { ...defaultPdfImageOptions, ...options };
  const absolutePath = path.isAbsolute(pdfPath) ? pdfPath : path.join(process.cwd(), pdfPath);
  const outputDir = path.resolve(opts.outputDir || defaultPdfImageOptions.outputDir);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.access(absolutePath);

  const baseName = path.basename(absolutePath, path.extname(absolutePath));
  const prefix = `${baseName}-${Date.now()}`;
  const outputPrefix = path.join(outputDir, prefix);

  const args = [
    "-r",
    String(opts.dpi || defaultPdfImageOptions.dpi),
    `-${opts.format || defaultPdfImageOptions.format}`,
    absolutePath,
    outputPrefix,
  ];

  await runPdftoppm(args);

  const files = await fs.readdir(outputDir);
  const images = files
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(`.${opts.format || defaultPdfImageOptions.format}`))
    .sort((a, b) => extractPageNumber(a, prefix) - extractPageNumber(b, prefix))
    .map((name) => path.join(outputDir, name));

  return {
    sourcePath: absolutePath,
    outputDir,
    images,
  };
}

function extractPageNumber(filename, prefix) {
  const match = filename.match(new RegExp(`^${escapeRegex(prefix)}-(\\d+)\\.`));
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

function runPdftoppm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        return reject(new Error("pdftoppm not found; install poppler-utils (or poppler) to enable PDF conversion"));
      }
      return reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) return resolve();
      return reject(new Error(stderr.trim() || `pdftoppm failed with exit code ${code}`));
    });
  });
}

module.exports = {
  convertPdfToImages,
  defaultPdfImageOptions,
};
