'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_URL = process.env.OPENAI_BASE_URL || undefined;
const TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || '60000');
const IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024';
const OUTPUT_DIR = path.join(__dirname, '../uploads/stories');
const DEFAULT_PROMPT = '简约温暖插画风格，柔和色调，无文字，正方形构图，一个人在窗边慢慢平复情绪，带一点希望感。';

function parseArgs(argv) {
  const args = { prompt: DEFAULT_PROMPT };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--prompt' && argv[index + 1]) {
      args.prompt = argv[index + 1];
      index += 1;
    } else if (token === '--model' && argv[index + 1]) {
      args.model = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function extractImageBase64(payload) {
  const images = payload?.data;
  if (Array.isArray(images) && typeof images[0]?.b64_json === 'string' && images[0].b64_json) {
    return images[0].b64_json;
  }
  return null;
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractErrorDetail(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload?.error?.message) return String(payload.error.message);
  if (payload?.response?.data?.error?.message) return String(payload.response.data.error.message);
  if (payload?.message) return String(payload.message);
  return '';
}

function classifyOpenAIError(err) {
  const raw = String(err?.message || err || '');
  const code = err?.status || err?.code || null;
  const message = extractErrorDetail(err) || raw;

  if (code === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return {
      kind: 'quota_exceeded',
      message,
    };
  }

  if (code === 404 || /NOT_FOUND|not found/i.test(message)) {
    return {
      kind: 'model_not_found',
      message,
    };
  }

  if (code === 401 || code === 403 || /permission|unauthorized|forbidden/i.test(message)) {
    return {
      kind: 'auth_error',
      message,
    };
  }

  return {
    kind: 'unknown_error',
    message,
  };
}

async function main() {
  const { prompt, model: modelOverride } = parseArgs(process.argv);
  const model = modelOverride || MODEL;

  if (!API_KEY) {
    console.error('[OpenAIImageTest] Missing OPENAI_API_KEY in backend/.env');
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({
    apiKey: API_KEY,
    baseURL: BASE_URL,
    timeout: TIMEOUT_MS,
  });

  console.log('[OpenAIImageTest] Starting image generation smoke test');
  console.log(`[OpenAIImageTest] Model: ${model}`);
  console.log(`[OpenAIImageTest] Prompt: ${prompt}`);

  try {
    const startedAt = Date.now();
    const response = await client.images.generate({
      model,
      prompt,
      size: IMAGE_SIZE,
    });
    const elapsedMs = Date.now() - startedAt;
    const imageBase64 = extractImageBase64(response);

    if (!imageBase64) {
      const responseText = response ? JSON.stringify(response).slice(0, 240) : '';
      console.error('[OpenAIImageTest] Request succeeded but no b64_json payload was returned.');
      if (responseText) {
        console.error(`[OpenAIImageTest] Response preview: ${responseText}`);
      }
      process.exitCode = 2;
      return;
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const ext = extensionForMimeType('image/png');
    const fileName = `openai-image-smoke-${Date.now()}.${ext}`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));

    console.log(`[OpenAIImageTest] Success in ${elapsedMs}ms`);
    console.log(`[OpenAIImageTest] Saved image: ${filePath}`);
    console.log('[OpenAIImageTest] Mime type: image/png');
  } catch (err) {
    const classified = classifyOpenAIError(err);
    console.error(`[OpenAIImageTest] Failed: ${classified.kind}`);
    console.error(`[OpenAIImageTest] Detail: ${classified.message}`);
    process.exitCode = 1;
  }
}

main();
