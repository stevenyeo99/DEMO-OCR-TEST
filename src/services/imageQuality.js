"use strict";

const sharp = require("sharp");

const defaultQualityOptions = {
  sizeTiers: {
    rejectBelow: 1000,
    warnBelow: 1500,
    excellentAt: 2500,
  },
  blurThreshold: 120, // variance of Laplacian; higher means stricter
  blurGuard: {
    minEdgePixelRatio: 0.01,
    minCoverage: 0.1,
  },
  brightness: {
    minMean: 60,
    maxMean: 200,
    maxDarkPercent: 0.25,
    maxBrightPercent: 0.2,
    darkThreshold: 30,
    brightThreshold: 225,
  },
  document: {
    enabled: true,
    edgeThreshold: 80,
    minCoverage: 0.55,
    maxCoverage: 0.995,
    minInsetRatio: 0.001,
    minOppositeInsetRatio: 0.08,
    minAspectRatio: 0.6,
    maxAspectRatio: 0.9,
    sideStrip: {
      enabled: false,
      bandRatio: 0.06,
      boundaryThreshold: 0.22,
      contentThreshold: 0.12,
      minBoundaryOffsetRatio: 0.12,
      minRightToLeftRatio: 0.9,
    },
    multiple: {
      enabled: true,
      centerBandRatio: 0.2,
      gutterMaxDensity: 0.012,
      minSideDensity: 0.05,
      componentStep: 4,
      minComponentPixelRatio: 0.004,
      minComponentBoxRatio: 0.2,
      minComponentCount: 2,
      minComponentWidthRatio: 0.25,
      minComponentHeightRatio: 0.5,
      minComponentCenterGapRatio: 0.35,
    },
  },
};

async function evaluateImageQuality(buffer, options = {}) {
  const opts = { ...defaultQualityOptions, ...options };
  const image = sharp(buffer, { failOn: "none" });
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const shortEdge = Math.min(width, height);

  const reasons = [];
  const warnings = [];
  const sizeTier = classifySizeTier(shortEdge, opts.sizeTiers);
  if (sizeTier.reason) {
    reasons.push(sizeTier.reason);
  }
  if (sizeTier.warning) {
    warnings.push(sizeTier.warning);
  }

  const blurScore = await calculateLaplacianVariance(image);

  const brightnessResult = await analyzeBrightness(image, opts.brightness);
  if (brightnessResult.reason) {
    warnings.push(brightnessResult.reason);
  }

  const documentResult = await analyzeDocumentFraming(image, opts.document);
  if (documentResult.reason) {
    reasons.push(documentResult.reason);
  }
  if (documentResult.warning) {
    warnings.push(documentResult.warning);
  }

  const blurGuard = opts.blurGuard || {};
  const edgePixelRatio = documentResult.metrics ? documentResult.metrics.edgePixelRatio : null;
  const coverageRatio = documentResult.metrics ? documentResult.metrics.coverageRatio : null;
  const blurCheckAllowed =
    !(typeof blurGuard.minEdgePixelRatio === "number" &&
      typeof edgePixelRatio === "number" &&
      edgePixelRatio < blurGuard.minEdgePixelRatio) &&
    !(typeof blurGuard.minCoverage === "number" &&
      typeof coverageRatio === "number" &&
      coverageRatio < blurGuard.minCoverage);

  if (blurCheckAllowed && typeof opts.blurThreshold === "number" && blurScore < opts.blurThreshold) {
    reasons.push(`blur_score_below_threshold:${blurScore.toFixed(2)}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    metrics: {
      width,
      height,
      shortEdge,
      sizeTier: sizeTier.tier,
      blurScore,
      brightness: brightnessResult.metrics,
      document: documentResult.metrics,
    },
  };
}

async function calculateLaplacianVariance(image) {
  const { data, info } = await image
    .clone()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 0;
  const height = info.height || 0;
  if (width < 3 || height < 3) {
    return 0;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const rowAbove = (y - 1) * width;
    const rowBelow = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = row + x;
      const center = data[idx];
      const lap =
        -4 * center +
        data[row + x - 1] +
        data[row + x + 1] +
        data[rowAbove + x] +
        data[rowBelow + x];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function classifySizeTier(shortEdge, tiers = {}) {
  const opts = { ...defaultQualityOptions.sizeTiers, ...(tiers || {}) };
  if (!shortEdge || shortEdge <= 0) {
    return { tier: "unknown", reason: "size_unavailable", warning: null };
  }

  if (shortEdge < opts.rejectBelow) {
    return { tier: "reject", reason: `size_too_small:${shortEdge}`, warning: null };
  }
  if (shortEdge < opts.warnBelow) {
    return { tier: "warn", reason: null, warning: `size_low:${shortEdge}` };
  }
  if (shortEdge >= opts.excellentAt) {
    return { tier: "excellent", reason: null, warning: null };
  }
  return { tier: "pass", reason: null, warning: null };
}

async function analyzeBrightness(image, options) {
  if (options === false) {
    return { reason: null, metrics: null };
  }

  const opts = { ...defaultQualityOptions.brightness, ...(options || {}) };
  const { data, info } = await image
    .clone()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const total = info.width * info.height;
  if (!total) {
    return { reason: "brightness_unavailable", metrics: null };
  }

  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    sum += value;
    if (value <= opts.darkThreshold) dark += 1;
    if (value >= opts.brightThreshold) bright += 1;
  }

  const mean = sum / total;
  const darkPercent = dark / total;
  const brightPercent = bright / total;

  let reason = null;
  if (typeof opts.minMean === "number" && mean < opts.minMean) {
    reason = `brightness_mean_low:${mean.toFixed(2)}`;
  } else if (typeof opts.maxMean === "number" && mean > opts.maxMean) {
    reason = `brightness_mean_high:${mean.toFixed(2)}`;
  } else if (typeof opts.maxDarkPercent === "number" && darkPercent > opts.maxDarkPercent) {
    reason = `brightness_too_dark_pixels:${darkPercent.toFixed(3)}`;
  } else if (typeof opts.maxBrightPercent === "number" && brightPercent > opts.maxBrightPercent) {
    reason = `brightness_too_bright_pixels:${brightPercent.toFixed(3)}`;
  }

  return {
    reason,
    metrics: {
      mean,
      darkPercent,
      brightPercent,
    },
  };
}

async function analyzeDocumentFraming(image, options) {
  if (!options || options.enabled === false) {
    return { reason: null, metrics: null };
  }

  const opts = { ...defaultQualityOptions.document, ...options };
  const { data, info } = await image
    .clone()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 0;
  const height = info.height || 0;
  if (width < 3 || height < 3) {
    return { reason: "document_unavailable", metrics: null };
  }

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let edgeCount = 0;
  const edgeMask = new Uint8Array(width * height);
  const columnCounts = new Array(width).fill(0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        -data[idx - width - 1] -
        2 * data[idx - 1] -
        data[idx + width - 1] +
        data[idx - width + 1] +
        2 * data[idx + 1] +
        data[idx + width + 1];
      const gy =
        -data[idx - width - 1] -
        2 * data[idx - width] -
        data[idx - width + 1] +
        data[idx + width - 1] +
        2 * data[idx + width] +
        data[idx + width + 1];
      const magnitude = Math.abs(gx) + Math.abs(gy);
      if (magnitude >= opts.edgeThreshold) {
        edgeCount += 1;
        edgeMask[idx] = 1;
        columnCounts[x] += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (edgeCount === 0) {
    return { reason: "document_edges_not_found", metrics: null };
  }

  const multipleResult = detectMultipleDocuments(edgeMask, columnCounts, width, height, opts.multiple);
  if (multipleResult.reason) {
    return {
      reason: multipleResult.reason,
      metrics: {
        coverageRatio: null,
        insetRatio: null,
        edgePixelRatio: edgeCount / (width * height),
        cropped: null,
        multiple: multipleResult.metrics,
      },
    };
  }

  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const coverageRatio = (bboxWidth * bboxHeight) / (width * height);
  const leftInset = minX / width;
  const topInset = minY / height;
  const rightInset = (width - 1 - maxX) / width;
  const bottomInset = (height - 1 - maxY) / height;
  const insetRatio = Math.min(leftInset, topInset, rightInset, bottomInset);
  const maxInset = Math.max(leftInset, topInset, rightInset, bottomInset);
  const edgePixelRatio = edgeCount / (width * height);
  const aspectRatio = bboxWidth / bboxHeight;

  let reason = null;
  let warning = null;
  if (coverageRatio < opts.minCoverage) {
    warning = `document_coverage_low:${coverageRatio.toFixed(3)}`;
  } else if (
    typeof opts.minAspectRatio === "number" &&
    typeof opts.maxAspectRatio === "number" &&
    (aspectRatio < opts.minAspectRatio || aspectRatio > opts.maxAspectRatio)
  ) {
    reason = `document_aspect_ratio_out_of_range:${aspectRatio.toFixed(3)}`;
  }

  const sideStripResult = detectSideStrip(columnCounts, width, height, opts.sideStrip);
  if (sideStripResult.detected && !reason) {
    reason = "document_side_strip_detected";
  }

  const croppedByCoverage = coverageRatio < opts.minCoverage;
  const croppedByAsymmetry = insetRatio < opts.minInsetRatio && maxInset >= opts.minOppositeInsetRatio;
  const croppedByAspect =
    typeof opts.minAspectRatio === "number" &&
    typeof opts.maxAspectRatio === "number" &&
    (aspectRatio < opts.minAspectRatio || aspectRatio > opts.maxAspectRatio);
  const cropped = croppedByCoverage || croppedByAsymmetry || croppedByAspect || sideStripResult.detected;
  const tightFraming = coverageRatio > opts.maxCoverage && insetRatio < opts.minInsetRatio;
  if (tightFraming) {
    warning = "document_tight_framing";
  }

  return {
    reason,
    warning,
    metrics: {
      coverageRatio,
      insets: {
        left: leftInset,
        top: topInset,
        right: rightInset,
        bottom: bottomInset,
      },
      insetRatio,
      aspectRatio,
      edgePixelRatio,
      cropped,
      tightFraming,
      sideStrip: sideStripResult.metrics,
      multiple: multipleResult.metrics,
    },
  };
}

function detectMultipleDocuments(edgeMask, columnCounts, width, height, options) {
  if (!options || options.enabled === false) {
    return { reason: null, metrics: null };
  }

  const opts = { ...defaultQualityOptions.document.multiple, ...options };
  const centerBand = Math.max(1, Math.round(width * opts.centerBandRatio));
  const centerStart = Math.max(0, Math.floor((width - centerBand) / 2));
  const centerEnd = Math.min(width - 1, centerStart + centerBand - 1);

  let minCenterDensity = 1;
  for (let x = centerStart; x <= centerEnd; x += 1) {
    const density = columnCounts[x] / height;
    if (density < minCenterDensity) minCenterDensity = density;
  }

  const leftEnd = Math.max(0, centerStart - 1);
  const rightStart = Math.min(width - 1, centerEnd + 1);
  const leftMean = averageDensity(columnCounts, 0, leftEnd, height);
  const rightMean = averageDensity(columnCounts, rightStart, width - 1, height);

  let gutterDetected = false;
  if (minCenterDensity <= opts.gutterMaxDensity && leftMean >= opts.minSideDensity && rightMean >= opts.minSideDensity) {
    gutterDetected = true;
  }

  const components = findEdgeComponents(edgeMask, width, height, opts);
  const componentDetected = detectComponentSplit(components, opts);

  if (gutterDetected || componentDetected) {
    return {
      reason: `multiple_documents_detected:${gutterDetected ? "gutter" : "components"}`,
      metrics: {
        gutterDetected,
        minCenterDensity,
        leftMean,
        rightMean,
        componentCount: components.components.length,
        componentDetected,
      },
    };
  }

  return {
    reason: null,
    metrics: {
      gutterDetected,
      minCenterDensity,
      leftMean,
      rightMean,
      componentCount: components.components.length,
      componentDetected,
    },
  };
}

function averageDensity(columnCounts, start, end, height) {
  if (start > end) return 0;
  let sum = 0;
  let count = 0;
  for (let x = start; x <= end; x += 1) {
    sum += columnCounts[x] / height;
    count += 1;
  }
  return count ? sum / count : 0;
}

function detectSideStrip(columnCounts, width, height, options) {
  if (!options || options.enabled === false) {
    return { detected: false, metrics: null };
  }

  const opts = { ...defaultQualityOptions.document.sideStrip, ...options };
  const bandWidth = Math.max(1, Math.round(width * opts.bandRatio));
  const minBoundaryOffset = Math.max(1, Math.round(width * opts.minBoundaryOffsetRatio));
  const start = Math.max(0, width - bandWidth - minBoundaryOffset);
  const end = Math.max(0, width - minBoundaryOffset);

  let detected = false;
  let boundaryColumn = null;
  let leftAvg = 0;
  let rightAvg = 0;
  let boundaryDensity = 0;
  let rightToLeftRatio = 0;

  for (let x = start; x < end; x += 1) {
    const density = columnCounts[x] / height;
    if (density < opts.boundaryThreshold) continue;
    const leftStart = Math.max(0, x - bandWidth);
    const leftEnd = Math.max(0, x - 1);
    const rightStart = Math.min(width - 1, x + 1);
    const rightEnd = Math.min(width - 1, x + bandWidth);
    const leftMean = averageDensity(columnCounts, leftStart, leftEnd, height);
    const rightMean = averageDensity(columnCounts, rightStart, rightEnd, height);
    const ratio = leftMean > 0 ? rightMean / leftMean : 0;
    if (
      leftMean >= opts.contentThreshold &&
      rightMean >= opts.contentThreshold &&
      ratio >= opts.minRightToLeftRatio
    ) {
      detected = true;
      boundaryColumn = x;
      leftAvg = leftMean;
      rightAvg = rightMean;
      boundaryDensity = density;
      rightToLeftRatio = ratio;
      break;
    }
  }

  return {
    detected,
    metrics: {
      detected,
      boundaryColumn,
      boundaryDensity,
      leftAvg,
      rightAvg,
      rightToLeftRatio,
      bandWidth,
    },
  };
}

function findEdgeComponents(edgeMask, width, height, options) {
  const step = Math.max(1, options.componentStep || 1);
  const reducedWidth = Math.max(1, Math.floor(width / step));
  const reducedHeight = Math.max(1, Math.floor(height / step));
  const reduced = new Uint8Array(reducedWidth * reducedHeight);

  for (let y = 0; y < height; y += 1) {
    const ry = Math.floor(y / step);
    if (ry >= reducedHeight) continue;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!edgeMask[row + x]) continue;
      const rx = Math.floor(x / step);
      if (rx >= reducedWidth) continue;
      reduced[ry * reducedWidth + rx] = 1;
    }
  }

  const visited = new Uint8Array(reducedWidth * reducedHeight);
  const minPixelCount = Math.round(options.minComponentPixelRatio * reducedWidth * reducedHeight);
  const minBoxRatio = options.minComponentBoxRatio;

  const components = [];
  for (let y = 0; y < reducedHeight; y += 1) {
    for (let x = 0; x < reducedWidth; x += 1) {
      const idx = y * reducedWidth + x;
      if (!reduced[idx] || visited[idx]) continue;

      let pixels = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      const stack = [idx];
      visited[idx] = 1;

      while (stack.length) {
        const current = stack.pop();
        const cy = Math.floor(current / reducedWidth);
        const cx = current - cy * reducedWidth;
        pixels += 1;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          current - 1,
          current + 1,
          current - reducedWidth,
          current + reducedWidth,
        ];
        for (const n of neighbors) {
          if (n < 0 || n >= reduced.length) continue;
          if (visited[n] || !reduced[n]) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
      const boxRatio = boxArea / (reducedWidth * reducedHeight);
      if (pixels >= minPixelCount && boxRatio >= minBoxRatio) {
        components.push({
          pixels,
          minX,
          minY,
          maxX,
          maxY,
          boxRatio,
          widthRatio: (maxX - minX + 1) / reducedWidth,
          heightRatio: (maxY - minY + 1) / reducedHeight,
          centerX: (minX + maxX + 1) / (2 * reducedWidth),
          centerY: (minY + maxY + 1) / (2 * reducedHeight),
        });
      }
    }
  }

  return { components };
}

function detectComponentSplit(result, options) {
  const components = result.components || [];
  if (components.length < options.minComponentCount) return false;

  const filtered = components.filter(
    (component) =>
      component.widthRatio >= options.minComponentWidthRatio &&
      component.heightRatio >= options.minComponentHeightRatio
  );

  if (filtered.length < options.minComponentCount) return false;

  filtered.sort((a, b) => b.pixels - a.pixels);
  const primary = filtered[0];
  for (let i = 1; i < filtered.length; i += 1) {
    const candidate = filtered[i];
    const gap = Math.abs(candidate.centerX - primary.centerX);
    if (gap >= options.minComponentCenterGapRatio) {
      return true;
    }
  }

  return false;
}

module.exports = {
  evaluateImageQuality,
  defaultQualityOptions,
};
