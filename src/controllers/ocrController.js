"use strict";

const fs = require("fs/promises");
const path = require("path");
const { defaultSystemPrompt, defaultJsonSchema } = require("../config/ocrConfig");
const { callLmStudio } = require("../services/lmService");
const { preprocessImage } = require("../services/imagePreprocess");
const { evaluateImageQuality, defaultQualityOptions } = require("../services/imageQuality");
const { convertPdfToImages, defaultPdfImageOptions } = require("../services/pdfToImages");
const { cropTopBottom, defaultCropOptions } = require("../services/imageCrop");
const requiredResponseMask = require("../config/prompts/ocr_json_required_response.json");
const postProcessRules = require("../config/prompts/ocr_json_postprocess_rules.json");
const LEFT_PROMPT_PATH = path.join(__dirname, "../config/prompts/ocr_system_prompt_left.md");
const RIGHT_PROMPT_PATH = path.join(__dirname, "../config/prompts/ocr_system_prompt_right.md");
const LEFT_SCHEMA_PATH = path.join(__dirname, "../config/prompts/ocr_json_schema_left.json");
const RIGHT_SCHEMA_PATH = path.join(__dirname, "../config/prompts/ocr_json_schema_right.json");

async function handleOcrJson(req, res) {
  const { paths, systemPrompt, jsonSchema, model, preprocess } = req.body || {};

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "paths must be a non-empty array of image file paths" });
  }

  const parsedSchema = resolveSchema(jsonSchema, defaultJsonSchema);
  if (parsedSchema instanceof Error) {
    return res.status(400).json({ error: `json schema parse error: ${parsedSchema.message}` });
  }

  const preprocessOptions = resolvePreprocess(preprocess);

  let images;
  try {
    images = await Promise.all(paths.map((imagePath) => readImageAsDataUrl(imagePath, preprocessOptions)));
  } catch (error) {
    return res.status(400).json({ error: `failed to read images: ${error.message}` });
  }

  const prompt = systemPrompt || defaultSystemPrompt || "You are an OCR assistant. Return valid JSON only.";

  try {
    const result = await callLmStudio({ prompt, images, schema: parsedSchema, model });
    const content = extractContent(result.data);
    const parsedContent = parseJsonContent(content);
    const postProcessed = applyPostprocessRules(parsedContent, postProcessRules);
    const filtered = filterResponseByRequired(postProcessed, requiredResponseMask);
    return res.json(filtered);
  } catch (error) {
    return res
      .status(error.status || 502)
      .json({ error: error.message || "lm studio request error", details: error.details || error.message });
  }
}

async function handleOcrQuality(req, res) {
  const { paths, preprocess, quality } = req.body || {};

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "paths must be a non-empty array of image file paths" });
  }

  const preprocessOptions = resolvePreprocess(preprocess);
  const qualityOptions = resolveQualityOptions(quality);

  let results;
  try {
    results = await Promise.all(
      paths.map(async (imagePath) => {
        const base = await loadImageBuffer(imagePath, preprocessOptions);
        const assessment = await evaluateImageQuality(base.buffer, qualityOptions);
        return {
          path: base.path,
          savedPath: base.savedPath,
          ...assessment,
        };
      })
    );
  } catch (error) {
    return res.status(400).json({ error: `failed to read images: ${error.message}` });
  }

  return res.json({
    ok: results.every((result) => result.ok),
    images: results,
  });
}

async function handleOcrImages(req, res) {
  const { paths, dpi } = req.body || {};

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "paths must be a non-empty array of PDF file paths" });
  }

  const pdfOptions = resolvePdfOptions(dpi);

  try {
    const results = await Promise.all(paths.map((pdfPath) => convertPdfToImages(pdfPath, pdfOptions)));
    return res.json({
      ok: true,
      dpi: pdfOptions.dpi,
      outputDir: pdfOptions.outputDir,
      files: results,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "failed to convert pdf to images" });
  }
}

async function handleOcrHalfJson(req, res) {
  const { paths, model, preprocess } = req.body || {};

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "paths must be a non-empty array of image file paths" });
  }

  const [promptLeft, promptRight, schemaLeft, schemaRight] = await Promise.all([
    loadPromptFile(LEFT_PROMPT_PATH),
    loadPromptFile(RIGHT_PROMPT_PATH),
    loadJsonSchemaFile(LEFT_SCHEMA_PATH),
    loadJsonSchemaFile(RIGHT_SCHEMA_PATH),
  ]);

  if (!promptLeft || !promptRight) {
    return res.status(500).json({ error: "failed to load OCR system prompts for half processing" });
  }

  if (schemaLeft instanceof Error || schemaRight instanceof Error) {
    const errors = [schemaLeft, schemaRight].filter((s) => s instanceof Error).map((s) => s.message);
    return res.status(500).json({ error: `failed to load OCR schemas: ${errors.join("; ")}` });
  }

  const preprocessOptions = resolvePreprocess(preprocess);

  let images;
  try {
    images = await Promise.all(paths.map((imagePath) => readImageAsDataUrl(imagePath, preprocessOptions)));
  } catch (error) {
    return res.status(400).json({ error: `failed to read images: ${error.message}` });
  }

  try {
    const [leftResult, rightResult] = await Promise.all([
      callLmStudio({ prompt: promptLeft, images, schema: schemaLeft || defaultJsonSchema, model }),
      callLmStudio({ prompt: promptRight, images, schema: schemaRight || defaultJsonSchema, model }),
    ]);

    const leftParsed = parseJsonContent(extractContent(leftResult.data));
    const rightParsed = parseJsonContent(extractContent(rightResult.data));

    const leftPost = applyPostprocessRules(leftParsed, postProcessRules);
    const rightPost = applyPostprocessRules(rightParsed, postProcessRules);

    const leftFiltered = filterResponseByRequired(leftPost, requiredResponseMask);
    const rightFiltered = filterResponseByRequired(rightPost, requiredResponseMask);

    const combined = mergeResponses(leftFiltered, rightFiltered);
    return res.json(combined);
  } catch (error) {
    return res
      .status(error.status || 502)
      .json({ error: error.message || "lm studio request error", details: error.details || error.message });
  }
}

const handleOcrLeftJson = createSideHandler({
  promptPath: LEFT_PROMPT_PATH,
  schemaPath: LEFT_SCHEMA_PATH,
  label: "left",
});

const handleOcrRightJson = createSideHandler({
  promptPath: RIGHT_PROMPT_PATH,
  schemaPath: RIGHT_SCHEMA_PATH,
  label: "right",
});

async function handleOcrJsonCrop(req, res) {
  const { paths, systemPrompt, jsonSchema, model, preprocess, crop } = req.body || {};

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "paths must be a non-empty array of image file paths" });
  }

  const parsedSchema = resolveSchema(jsonSchema, defaultJsonSchema);
  if (parsedSchema instanceof Error) {
    return res.status(400).json({ error: `json schema parse error: ${parsedSchema.message}` });
  }

  const preprocessOptions = resolvePreprocess(preprocess);
  const cropOptions = resolveCropOptions(crop);

  let images;
  try {
    const variants = await Promise.all(
      paths.map((imagePath) => readImageWithCropVariants(imagePath, preprocessOptions, cropOptions))
    );
    images = variants.flat();
  } catch (error) {
    return res.status(400).json({ error: `failed to read images: ${error.message}` });
  }

  const prompt = systemPrompt || defaultSystemPrompt || "You are an OCR assistant. Return valid JSON only.";

  try {
    const result = await callLmStudio({ prompt, images, schema: parsedSchema, model });
    const content = extractContent(result.data);
    const parsedContent = parseJsonContent(content);
    const postProcessed = applyPostprocessRules(parsedContent, postProcessRules);
    const filtered = filterResponseByRequired(postProcessed, requiredResponseMask);
    return res.json(postProcessed);
  } catch (error) {
    return res
      .status(error.status || 502)
      .json({ error: error.message || "lm studio request error", details: error.details || error.message });
  }
}

function resolveSchema(inputSchema, envSchema) {
  if (!inputSchema && !envSchema) return null;

  if (inputSchema && typeof inputSchema === "object") return inputSchema;
  if (!inputSchema && envSchema && typeof envSchema === "object") return envSchema;

  const raw = typeof inputSchema === "string" ? inputSchema : envSchema;
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return error;
  }
}

function resolvePreprocess(raw) {
  if (raw === false || raw === null) return null;
  if (raw === true || typeof raw === "undefined") return {}; // default gentle pipeline
  if (typeof raw === "object") return raw;
  return null;
}

function resolveCropOptions(raw) {
  if (raw && typeof raw === "object") return { ...defaultCropOptions, ...raw };
  return { ...defaultCropOptions };
}

function resolveQualityOptions(raw) {
  if (raw === false || raw === null) return { ...defaultQualityOptions };
  if (typeof raw === "number") return { ...defaultQualityOptions, blurThreshold: raw };
  if (raw && typeof raw === "object") {
    const merged = { ...defaultQualityOptions, ...raw };
    if (raw.brightness === false) {
      merged.brightness = false;
    } else if (raw.brightness && typeof raw.brightness === "object") {
      merged.brightness = { ...defaultQualityOptions.brightness, ...raw.brightness };
    }

    if (raw.document === false) {
      merged.document = { ...defaultQualityOptions.document, enabled: false };
    } else if (raw.document && typeof raw.document === "object") {
      merged.document = { ...defaultQualityOptions.document, ...raw.document };
      if (raw.document.multiple === false) {
        merged.document.multiple = { ...defaultQualityOptions.document.multiple, enabled: false };
      } else if (raw.document.multiple && typeof raw.document.multiple === "object") {
        merged.document.multiple = { ...defaultQualityOptions.document.multiple, ...raw.document.multiple };
      }
      if (raw.document.sideStrip === false) {
        merged.document.sideStrip = { ...defaultQualityOptions.document.sideStrip, enabled: false };
      } else if (raw.document.sideStrip && typeof raw.document.sideStrip === "object") {
        merged.document.sideStrip = { ...defaultQualityOptions.document.sideStrip, ...raw.document.sideStrip };
      }
    }

    if (raw.sizeTiers && typeof raw.sizeTiers === "object") {
      merged.sizeTiers = { ...defaultQualityOptions.sizeTiers, ...raw.sizeTiers };
    }

    return merged;
  }
  return { ...defaultQualityOptions };
}

function resolvePdfOptions(dpi) {
  const resolvedDpi = Number.isFinite(dpi) ? dpi : defaultPdfImageOptions.dpi;
  return { ...defaultPdfImageOptions, dpi: resolvedDpi };
}

async function readImageAsDataUrl(imagePath, preprocessOptions = null) {
  const base = await loadImageBuffer(imagePath, preprocessOptions);
  const base64 = base.buffer.toString("base64");
  return {
    path: base.path,
    dataUrl: `data:${base.mime};base64,${base64}`,
    savedPath: base.savedPath,
  };
}

async function readImageWithCropVariants(imagePath, preprocessOptions = null, cropOptions = {}) {
  const base = await loadImageBuffer(imagePath, preprocessOptions);
  const base64 = base.buffer.toString("base64");
  const original = {
    path: base.path,
    dataUrl: `data:${base.mime};base64,${base64}`,
    savedPath: base.savedPath,
    variant: "full",
  };

  const cropped = await cropTopBottom(base.buffer, base.mime, { ...cropOptions, sourcePath: base.path });
  const variants = [
    {
      path: base.path,
      dataUrl: `data:${cropped.top.mime};base64,${cropped.top.buffer.toString("base64")}`,
      variant: "top_half_zoom",
      savedPath: cropped.top.savedPath,
    },
    {
      path: base.path,
      dataUrl: `data:${cropped.bottom.mime};base64,${cropped.bottom.buffer.toString("base64")}`,
      variant: "bottom_half_zoom",
      savedPath: cropped.bottom.savedPath,
    },
  ];

  return [original, ...variants];
}

async function loadImageBuffer(imagePath, preprocessOptions = null) {
  const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), imagePath);

  if (preprocessOptions) {
    const processed = await preprocessImage(absolutePath, preprocessOptions);
    return {
      buffer: processed.buffer,
      mime: processed.mime,
      path: processed.path || absolutePath,
      savedPath: processed.savedPath,
    };
  }

  const buffer = await fs.readFile(absolutePath);
  const mime = guessMimeType(absolutePath);
  return {
    buffer,
    mime,
    path: absolutePath,
  };
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function extractContent(data) {
  if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    return null;
  }
  const choice = data.choices[0];
  if (choice && choice.message && typeof choice.message.content !== "undefined") {
    return choice.message.content;
  }
  return null;
}

function parseJsonContent(content) {
  if (content === null || typeof content === "undefined") {
    return null;
  }
  if (typeof content === "object") {
    return content;
  }
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (error) {
      return { _raw: content, _error: "failed to parse JSON content" };
    }
  }
  return { _raw: content, _error: "unexpected content type" };
}

function filterResponseByRequired(data, mask) {
  if (!mask || typeof mask !== "object" || data === null || typeof data !== "object") return data;
  const result = Array.isArray(mask) ? [] : {};

  for (const [key, requirement] of Object.entries(mask)) {
    if (requirement === true) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = data[key];
      }
      continue;
    }

    if (requirement && typeof requirement === "object" && !Array.isArray(requirement)) {
      const child = filterResponseByRequired(data[key] || {}, requirement);
      if (hasContent(child)) {
        result[key] = child;
      }
    }
  }

  return result;
}

function hasContent(value) {
  if (value === null || typeof value === "undefined") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function applyPostprocessRules(data, rules) {
  if (!rules || !Array.isArray(rules) || !data || typeof data !== "object") return data;

  for (const rule of rules) {
    if (!rule || !rule.if) continue;

    const actual = getPath(data, rule.if.path);
    const matches = rule.if.not_empty ? !isEmptyValue(actual) : matchEquals(actual, rule.if.equals);
    if (!matches) continue;

    const whenEmpty = Array.isArray(rule.when_empty) ? rule.when_empty : [];
    const whenNotEmpty = Array.isArray(rule.when_not_empty) ? rule.when_not_empty : [];
    const whenEmptyOk = whenEmpty.every((p) => isEmptyValue(getPath(data, p)));
    const whenNotEmptyOk = whenNotEmpty.every((p) => !isEmptyValue(getPath(data, p)));
    if (!whenEmptyOk || !whenNotEmptyOk) continue;

    if (rule.set_null) {
      const targets = Array.isArray(rule.set_null) ? rule.set_null : [rule.set_null];
      for (const target of targets) {
        setPath(data, target, null);
      }
    }

    if (rule.set_from && rule.set_from.source && rule.set_from.target) {
      const sourceVal = getPath(data, rule.set_from.source);
      const shouldSet = !isEmptyValue(sourceVal) || rule.set_from.allow_null;
      if (shouldSet) {
        setPath(data, rule.set_from.target, sourceVal);
      }
    }

    if (rule.split_date) {
      const sourceVal = getPath(data, rule.split_date.source);
      const parts = parseYmd(sourceVal);
      if (parts) {
        const targets = rule.split_date.targets || {};
        if (targets.year) setPath(data, targets.year, parts.year);
        if (targets.month) setPath(data, targets.month, parts.month);
        if (targets.day) setPath(data, targets.day, parts.day);
      }
    }
  }

  return data;
}

function matchEquals(actual, expected) {
  if (expected === true) {
    return actual === true || actual === "true";
  }
  if (expected === false) {
    return actual === false || actual === "false";
  }
  if (typeof expected === "undefined") {
    return actual === true || actual === "true";
  }
  return Object.is(actual, expected);
}

function getPath(obj, pathString) {
  if (!pathString || typeof pathString !== "string") return undefined;
  return pathString.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && Object.prototype.hasOwnProperty.call(acc, key)) {
      return acc[key];
    }
    return undefined;
  }, obj);
}

function setPath(obj, pathString, value) {
  if (!pathString || typeof pathString !== "string" || !obj || typeof obj !== "object") return;
  const parts = pathString.split(".");
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (i === parts.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
}

function isEmptyValue(value) {
  if (value === null || typeof value === "undefined") return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function parseYmd(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return {
    year: y,
    month: m.padStart(2, "0"),
    day: d.padStart(2, "0"),
  };
}

async function loadPromptFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function loadJsonSchemaFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return error instanceof Error ? error : new Error("unknown schema read error");
  }
}

function mergeResponses(left, right) {
  const leftObj = isPlainObject(left) ? left : {};
  const rightObj = isPlainObject(right) ? right : {};

  if (isPlainObject(left) && isPlainObject(right)) {
    return { ...leftObj, ...rightObj };
  }

  if (isPlainObject(left)) {
    return { ...leftObj, right };
  }

  if (isPlainObject(right)) {
    return { ...rightObj, left };
  }

  return { left, right };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createSideHandler({ promptPath, schemaPath, label }) {
  return async function handleSide(req, res) {
    const { paths, model, preprocess } = req.body || {};

    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: "paths must be a non-empty array of image file paths" });
    }

    const [prompt, schema] = await Promise.all([loadPromptFile(promptPath), loadJsonSchemaFile(schemaPath)]);

    if (!prompt) {
      return res.status(500).json({ error: `failed to load ${label} OCR system prompt` });
    }

    if (schema instanceof Error) {
      return res.status(500).json({ error: `failed to load ${label} OCR schema: ${schema.message}` });
    }

    const preprocessOptions = resolvePreprocess(preprocess);

    let images;
    try {
      images = await Promise.all(paths.map((imagePath) => readImageAsDataUrl(imagePath, preprocessOptions)));
    } catch (error) {
      return res.status(400).json({ error: `failed to read images: ${error.message}` });
    }

    try {
      const result = await callLmStudio({ prompt, images, schema: schema || defaultJsonSchema, model });
      const parsed = parseJsonContent(extractContent(result.data));
      const postProcessed = applyPostprocessRules(parsed, postProcessRules);
      const filtered = filterResponseByRequired(postProcessed, requiredResponseMask);
      return res.json(filtered);
    } catch (error) {
      return res
        .status(error.status || 502)
        .json({ error: error.message || "lm studio request error", details: error.details || error.message });
    }
  };
}

module.exports = {
  handleOcrJson,
  handleOcrQuality,
  handleOcrImages,
  handleOcrHalfJson,
  handleOcrLeftJson,
  handleOcrRightJson,
  handleOcrJsonCrop,
};
