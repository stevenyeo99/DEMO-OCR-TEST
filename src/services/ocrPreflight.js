"use strict";

const fs = require("fs/promises");
const path = require("path");
const { evaluateImageQuality } = require("./imageQuality");
const { convertPdfToImages, defaultPdfImageOptions } = require("./pdfToImages");

async function preflightImages(paths, options = {}) {
  const resolvedPaths = await expandPdfPaths(paths, options.pdfOptions);
  const results = [];

  for (const imagePath of resolvedPaths) {
    const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), imagePath);
    const buffer = await fs.readFile(absolutePath);
    const quality = await evaluateImageQuality(buffer, options.qualityOptions);
    results.push({
      path: absolutePath,
      ok: quality.ok,
      reasons: quality.reasons,
      warnings: quality.warnings,
      metrics: quality.metrics,
    });
  }

  const acceptedPaths = results.filter((item) => item.ok).map((item) => item.path);
  return {
    acceptedPaths,
    results,
  };
}

async function expandPdfPaths(paths, pdfOptions) {
  const expanded = [];
  const opts = { ...defaultPdfImageOptions, ...(pdfOptions || {}) };

  for (const inputPath of paths) {
    const ext = path.extname(inputPath || "").toLowerCase();
    if (ext === ".pdf") {
      const converted = await convertPdfToImages(inputPath, opts);
      expanded.push(...converted.images);
    } else {
      expanded.push(inputPath);
    }
  }

  return expanded;
}

module.exports = {
  preflightImages,
};
