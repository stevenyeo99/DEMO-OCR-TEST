"use strict";

const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const defaultCropOptions = {
  zoom: 1.12, // slight zoom after cropping
  maxSize: 2400, // keep within a reasonable upper bound
  save: true,
  outputDir: path.join("tmp", "crops"),
  suffixTop: "-top",
  suffixBottom: "-bottom",
};

async function cropTopBottom(buffer, mime, options = {}) {
  const opts = { ...defaultCropOptions, ...options };
  const base = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const topHeight = Math.max(1, Math.floor(height / 2));
  const bottomHeight = Math.max(1, height - topHeight);

  const top = await buildVariant(base, { width, height: topHeight, top: 0, left: 0 }, mime, opts, "top");
  const bottom = await buildVariant(
    base,
    { width, height: bottomHeight, top: topHeight, left: 0 },
    mime,
    opts,
    "bottom"
  );

  return { top, bottom };
}

async function buildVariant(baseImage, region, mime, opts, kind) {
  const zoomFactor = typeof opts.zoom === "number" && opts.zoom > 0 ? opts.zoom : defaultCropOptions.zoom;
  const extracted = baseImage.clone().extract(region);

  let resized = extracted;
  if (zoomFactor && zoomFactor !== 1) {
    const targetWidth = Math.round(region.width * zoomFactor);
    const targetHeight = Math.round(region.height * zoomFactor);
    resized = extracted.resize({
      width: opts.maxSize ? Math.min(targetWidth, opts.maxSize) : targetWidth,
      height: opts.maxSize ? Math.min(targetHeight, opts.maxSize) : targetHeight,
      fit: "inside",
      withoutEnlargement: false,
    });
  }

  const buffer = await resized.toBuffer();
  const savedPath = await maybeSave(buffer, mime, opts, kind);
  return { buffer, mime, savedPath };
}

async function maybeSave(buffer, mime, opts, kind) {
  if (!opts.save) return null;
  const dir = path.resolve(opts.outputDir || defaultCropOptions.outputDir);
  await fs.mkdir(dir, { recursive: true });

  const baseName = opts.sourcePath
    ? path.basename(opts.sourcePath, path.extname(opts.sourcePath))
    : `crop-${Date.now()}`;
  const suffix = kind === "bottom" ? opts.suffixBottom || defaultCropOptions.suffixBottom : opts.suffixTop || defaultCropOptions.suffixTop;
  const ext = extFromMime(mime);
  const targetName = `${baseName}${suffix}${ext}`;
  const targetPath = path.join(dir, targetName);
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

function extFromMime(mime) {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
    default:
      return ".png";
  }
}

module.exports = {
  cropTopBottom,
  defaultCropOptions,
};
