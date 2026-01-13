"use strict";

const { LLM_URL = "http://localhost:1234/v1/chat/completions", MODEL = "lm-studio-vision-model" } =
  process.env;

function resolveUrl(url) {
  if (!url) return LLM_URL;
  if (url.endsWith("/v1/chat/completions")) return url;
  // If user provided base URL, attach the chat completions path.
  return `${url.replace(/\/+$/, "")}/v1/chat/completions`;
}

function buildLmStudioRequest({ prompt, images, model, schema }) {
  const contentBlocks = [
    { type: "text", text: "Perform OCR. Return only JSON matching the provided schema." },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    })),
  ];

  const payload = {
    model: model || MODEL,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: contentBlocks },
    ],
    temperature: 0,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2048,
  };

  if (schema) {
    payload.response_format = {
      type: "json_schema",
      json_schema: {
        name: "ocr_result",
        schema,
      },
    };
  } else {
    payload.response_format = { type: "json_object" };
  }

  return payload;
}

async function callLmStudio({ prompt, images, schema, model, url }) {
  const payload = buildLmStudioRequest({ prompt, images, schema, model });
  const targetUrl = resolveUrl(url);

  let response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    const error = new Error(`lm studio request error: ${networkError.message}`);
    error.status = 502;
    error.details = { url: targetUrl, cause: networkError.cause || networkError.code || networkError.type };
    error.payload = payload;
    throw error;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error("lm studio request failed");
    error.status = response.status || 502;
    error.details = data || { url: targetUrl, text: await response.text().catch(() => null) };
    error.payload = payload;
    throw error;
  }

  return { payload, data, status: response.status, url: targetUrl };
}

module.exports = {
  callLmStudio,
};
