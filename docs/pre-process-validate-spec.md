# Pre-process Image Validation Specification

This document describes the image quality validation performed by the OCR pre-processing endpoint (`POST /ocr/quality`). The goal is to reject low-quality inputs (blurry, under/overexposed, or poorly framed documents) before main OCR processing.

## Endpoint

- Path: `/ocr/quality`
- Method: `POST`
- Content-Type: `application/json`
- Request body: same shape as `/ocr/json` (at minimum `paths: string[]`).

## Request Body

```json
{
  "paths": ["/abs/or/relative/path/to/image.jpg"],
  "preprocess": true,
  "quality": {
    "sizeTiers": {
      "rejectBelow": 1000,
      "warnBelow": 1500,
      "excellentAt": 2500
    },
    "blurThreshold": 120,
    "brightness": {
      "minMean": 60,
      "maxMean": 200,
      "maxDarkPercent": 0.25,
      "maxBrightPercent": 0.2,
      "darkThreshold": 30,
      "brightThreshold": 225
    },
    "document": {
      "enabled": true,
      "edgeThreshold": 80,
      "minCoverage": 0.55,
      "maxCoverage": 0.995,
      "minInsetRatio": 0.001,
      "minOppositeInsetRatio": 0.08,
      "minAspectRatio": 0.6,
      "maxAspectRatio": 0.9,
      "sideStrip": {
        "enabled": true,
        "bandRatio": 0.06,
        "boundaryThreshold": 0.22,
        "contentThreshold": 0.12,
        "minBoundaryOffsetRatio": 0.12,
        "minRightToLeftRatio": 0.9
      },
      "multiple": {
        "enabled": true,
        "centerBandRatio": 0.2,
        "gutterMaxDensity": 0.012,
        "minSideDensity": 0.05,
        "componentStep": 4,
        "minComponentPixelRatio": 0.004,
        "minComponentBoxRatio": 0.2,
        "minComponentCount": 2,
        "minComponentWidthRatio": 0.25,
        "minComponentHeightRatio": 0.5,
        "minComponentCenterGapRatio": 0.35
      }
    }
  }
}
```

Notes:
- `preprocess` uses the existing preprocessing pipeline from `/ocr/json`.
- `quality` is optional. If omitted, defaults are used.
- `quality` can be a number to set only `blurThreshold`.
- `quality.brightness` can be set to `false` to disable brightness checks.
- `quality.document` can be set to `{ "enabled": false }` to disable document framing checks.

## Response Body

```json
{
  "ok": true,
  "images": [
    {
      "path": "/abs/path/image.jpg",
      "savedPath": "/abs/path/tmp/processed/image-pp.png",
      "ok": true,
      "reasons": [],
      "warnings": [
        "document_tight_framing"
      ],
      "metrics": {
        "width": 1200,
        "height": 1600,
        "shortEdge": 1200,
        "sizeTier": "pass",
        "blurScore": 240.5,
        "brightness": {
          "mean": 132.4,
          "darkPercent": 0.03,
          "brightPercent": 0.01
        },
        "document": {
          "coverageRatio": 0.82,
          "insets": {
            "left": 0.04,
            "top": 0.03,
            "right": 0.05,
            "bottom": 0.04
          },
          "insetRatio": 0.04,
          "aspectRatio": 0.7,
          "edgePixelRatio": 0.12,
          "cropped": false,
          "tightFraming": false,
          "sideStrip": {
            "detected": false,
            "boundaryColumn": null,
            "boundaryDensity": 0,
            "leftAvg": 0,
            "rightAvg": 0,
            "rightToLeftRatio": 0,
            "bandWidth": 0
          },
          "multiple": {
            "gutterDetected": false,
            "minCenterDensity": 0.02,
            "leftMean": 0.11,
            "rightMean": 0.1,
            "componentCount": 1,
            "componentDetected": false
          }
        }
      }
    }
  ]
}
```

- `ok` at the top-level is `true` only if all images pass.
- Each image includes `reasons` for rejection; empty means pass.
- Each image includes `warnings` for non-fatal issues (informational only).
- `sizeTier` is one of `reject`, `warn`, `pass`, `excellent`, `unknown`.

## Validation Checks

### 1) Resolution

Purpose: reject images that are too small for reliable OCR.

Default thresholds:
- `sizeTiers.rejectBelow`: 1000
- `sizeTiers.warnBelow`: 1500
- `sizeTiers.excellentAt`: 2500

Failure reasons:
- `size_too_small:<shortEdge>`

Warnings:
- `size_low:<shortEdge>` (still processed)

### 2) Blurriness (Laplacian Variance)

Purpose: detect blurry or shaky images.

Method:
- Convert to grayscale and compute variance of the Laplacian operator.
- Lower variance indicates blur.

Default threshold:
- `blurThreshold`: 120

Failure reason:
- `blur_score_below_threshold:<score>`

### 3) Brightness

Purpose: detect underexposed or overexposed images.

Method:
- Downsample to max 512px on the long edge.
- Convert to grayscale.
- Compute mean brightness and percentage of pixels below/above thresholds.

Defaults:
- `minMean`: 60
- `maxMean`: 200
- `darkThreshold`: 30
- `brightThreshold`: 225
- `maxDarkPercent`: 0.25
- `maxBrightPercent`: 0.2

Warnings (first match in order):
- `brightness_mean_low:<mean>`
- `brightness_mean_high:<mean>`
- `brightness_too_dark_pixels:<fraction>`
- `brightness_too_bright_pixels:<fraction>`

### 4) Document Framing (Edge-Based Heuristic)

Purpose: detect images where the document is cropped or missing.

Method:
- Downsample to max 512px on the long edge.
- Apply a simple Sobel edge magnitude.
- Compute the bounding box of strong edges.
- Evaluate coverage and margin against thresholds.

Defaults:
- `enabled`: true
- `edgeThreshold`: 80
- `minCoverage`: 0.55
- `maxCoverage`: 0.995
- `minInsetRatio`: 0.001
- `minOppositeInsetRatio`: 0.08
- `minAspectRatio`: 0.6
- `maxAspectRatio`: 0.9
- `sideStrip.enabled`: true
- `sideStrip.bandRatio`: 0.06
- `sideStrip.boundaryThreshold`: 0.22
- `sideStrip.contentThreshold`: 0.12
- `sideStrip.minBoundaryOffsetRatio`: 0.12
- `sideStrip.minRightToLeftRatio`: 0.9

Failure reasons (first match in order):
- `document_coverage_low:<ratio>`
- `document_edges_not_found`
- `multiple_documents_detected:gutter`
- `multiple_documents_detected:components`
- `document_aspect_ratio_out_of_range:<ratio>`
- `document_side_strip_detected`
- `document.cropped` is `true` when coverage is below `minCoverage` or when one side is tight and the opposite side has a wide margin.
- `document.tightFraming` is `true` when coverage is above `maxCoverage` and inset is below `minInsetRatio`.
- `document_tight_framing` is returned as a warning, not a failure.

### 5) Multiple Document Detection (Hybrid)

Purpose: reject images that contain more than one form/page (e.g., two-page spread).

Method:
- Gutter heuristic: compute edge density per column and look for a low-density band near the center with strong edges on both sides.
- Component heuristic: downsample edge map and count large edge-connected regions.

Defaults:
- `enabled`: true
- `centerBandRatio`: 0.2
- `gutterMaxDensity`: 0.012
- `minSideDensity`: 0.05
- `componentStep`: 4
- `minComponentPixelRatio`: 0.004
- `minComponentBoxRatio`: 0.2
- `minComponentCount`: 2
- `minComponentWidthRatio`: 0.25
- `minComponentHeightRatio`: 0.5
- `minComponentCenterGapRatio`: 0.35

Failure reasons:
- `multiple_documents_detected:gutter`
- `multiple_documents_detected:components`

## Configuration Guidance

- Increase `blurThreshold` to be stricter on blur.
- Raise `minCoverage` to require more of the page visible.
- Raise `minMean` or lower `maxMean` to tighten exposure checks.
- Disable a check if it is too aggressive for specific workloads.
