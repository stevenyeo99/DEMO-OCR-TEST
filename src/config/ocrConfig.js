"use strict";

const fs = require("fs");
const path = require("path");

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function findFirstFile(paths) {
  for (const p of paths) {
    if (!p) continue;
    const content = readFileIfExists(p);
    if (content !== null) {
      return content;
    }
  }
  return null;
}

const promptFromFile = findFirstFile([
  process.env.OCR_SYSTEM_PROMPT_FILE,
  path.join(process.cwd(), "src", "config", "prompts", "ocr_system_prompt.md"),
  path.join(process.cwd(), "prompts", "ocr_system_prompt.md"),
  path.join(process.cwd(), "ocr_system_prompt.md"),
]);

const defaultSystemPrompt =
  promptFromFile ||
  process.env.OCR_SYSTEM_PROMPT ||
  process.env.LM_SYSTEM_PROMPT ||
  "You are an OCR assistant. Extract structured data as JSON that matches the provided schema.";

let defaultJsonSchema = null;
const schemaEnv = process.env.OCR_JSON_SCHEMA || process.env.LM_JSON_SCHEMA;
const schemaFromFile = findFirstFile([
  process.env.OCR_JSON_SCHEMA_FILE,
  path.join(process.cwd(), "src", "config", "prompts", "ocr_json_schema.json"),
  path.join(process.cwd(), "prompts", "ocr_json_schema.json"),
  path.join(process.cwd(), "ocr_json_schema.json"),
]);

if (schemaEnv) {
  try {
    defaultJsonSchema = JSON.parse(schemaEnv);
  } catch {
    defaultJsonSchema = null;
  }
} else if (schemaFromFile) {
  try {
    defaultJsonSchema = JSON.parse(schemaFromFile);
  } catch {
    defaultJsonSchema = null;
  }
} else {
  defaultJsonSchema = {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  };
}

module.exports = {
  defaultSystemPrompt,
  defaultJsonSchema,
};
