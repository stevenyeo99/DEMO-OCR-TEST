"use strict";

const path = require("path");
const sharp = require("sharp");
const fs = require("fs/promises");

const defaultOptions = {
  maxWidth: 2000, // keep large enough for handwriting while limiting oversized scans
  format: "png",
  grayscale: false, // leave color unless explicitly requested
  normalize: false,
  median: false,
  contrast: 1.08, // ~+8% contrast
  sharpen: true, // slight sharpen only
  threshold: false,
  thresholdValue: 150,
  zoom: 1.08, // gentle upscaling after preprocessing
  save: true,
  outputDir: path.join("tmp", "processed"),
};

async function preprocessImage(imagePath, options = {}) {
  const opts = { ...defaultOptions, ...options };
  const input = sharp(imagePath, { failOn: "none" }).rotate(); // auto-orient

  if (opts.maxWidth) {
    input.resize({ width: opts.maxWidth, withoutEnlargement: true });
  }

  if (opts.grayscale) {
    input.grayscale();
  }

  if (opts.median) {
    input.median(1);
  }

  if (opts.contrast && opts.contrast !== 1) {
    const factor = opts.contrast;
    const offset = -128 * (factor - 1); // keep mid-tones centered
    input.linear(factor, offset);
  }

  if (opts.normalize) {
    input.normalize();
  }

  if (opts.threshold) {
    input.threshold(opts.thresholdValue || defaultOptions.thresholdValue);
  }

  if (opts.sharpen) {
    input.sharpen(0.8, 1, 0.5); // mild sharpen
  }

  const format = (opts.format || defaultOptions.format || "png").toLowerCase();
  let pipeline = input;
  switch (format) {
    case "jpeg":
    case "jpg":
      pipeline = input.jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
      break;
    case "webp":
      pipeline = input.webp({ quality: 95 });
      break;
    default:
      pipeline = input.png({ compressionLevel: 2, adaptiveFiltering: true });
  }

  let buffer = await pipeline.toBuffer();

  if (opts.zoom && opts.zoom > 1) {
    const meta = await sharp(buffer).metadata();
    const targetWidth = Math.max(1, Math.round((meta.width || 1) * opts.zoom));
    const width = opts.maxWidth ? Math.min(targetWidth, opts.maxWidth) : targetWidth;
    try {
      buffer = await sharp(buffer, { failOn: "none" })
        .resize({ width, fit: "inside", withoutEnlargement: false })
        .toBuffer();
    } catch {
      // keep original buffer if zoom fails
    }
  }

  const savedPath = await maybeSave(buffer, imagePath, opts);
  return {
    buffer,
    mime: mimeFromFormat(format),
    path: path.resolve(imagePath),
    options: opts,
    savedPath,
  };
}

function mimeFromFormat(format) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

async function maybeSave(buffer, originalPath, opts) {
  if (!opts.save) return null;
  const dir = path.resolve(opts.outputDir || defaultOptions.outputDir);
  await fs.mkdir(dir, { recursive: true });

  const base = path.basename(originalPath, path.extname(originalPath));
  const targetName = `${base}-pp.${(opts.format || defaultOptions.format || "png").toLowerCase()}`;
  const targetPath = path.join(dir, targetName);
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

module.exports = {
  preprocessImage,
  defaultOptions,
};
