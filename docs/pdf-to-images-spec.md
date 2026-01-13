# PDF to Images API Specification

This document describes the PDF-to-image conversion endpoint that renders each PDF page to a PNG at 300 DPI.

## Endpoint

- Path: `/ocr/images`
- Method: `POST`
- Content-Type: `application/json`

## Request Body

```json
{
  "paths": ["/mnt/c/git/demo-ocr-test/docs/samples/DAY1/sample_a_1.pdf"],
  "dpi": 300
}
```

Notes:
- `paths` must be a non-empty array of PDF file paths.
- `dpi` is optional; defaults to 300.

## Response Body

```json
{
  "ok": true,
  "dpi": 300,
  "outputDir": "/abs/path/to/tmp/pdf-images",
  "files": [
    {
      "sourcePath": "/abs/path/to/sample_a_1.pdf",
      "outputDir": "/abs/path/to/tmp/pdf-images",
      "images": [
        "/abs/path/to/tmp/pdf-images/sample_a_1-1700000000000-1.png",
        "/abs/path/to/tmp/pdf-images/sample_a_1-1700000000000-2.png"
      ]
    }
  ]
}
```

## Conversion Details

- Tool: `pdftoppm` (Poppler)
- DPI: 300 by default (configurable via `dpi`)
- Output format: PNG
- Output directory: `tmp/pdf-images` (auto-created)
- Output naming: `<basename>-<timestamp>-<page>.png`

## System Dependencies

Install `pdftoppm` via Poppler:

Debian/Ubuntu:
```
sudo apt-get update
sudo apt-get install -y poppler-utils
```

Alpine:
```
sudo apk add poppler-utils
```

RHEL/CentOS:
```
sudo yum install -y poppler-utils
```

macOS (Homebrew):
```
brew install poppler
```
