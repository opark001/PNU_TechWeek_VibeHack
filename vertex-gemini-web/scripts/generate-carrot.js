import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment
let PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.PROJECT_ID;

const LOCATION = process.env.VERTEX_LOCATION || process.env.LOCATION || 'global';
// Gemini 2.5 Flash Image (aka nano-banana, Preview)
const MODEL_ID = process.env.VERTEX_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';

function apiBase() {
  return LOCATION === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${LOCATION}-aiplatform.googleapis.com`;
}

async function getAccessToken() {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) {
    throw new Error('Failed to acquire access token. Run: gcloud auth application-default login');
  }
  return token.token;
}

async function resolveProjectId() {
  if (!PROJECT_ID) {
    try {
      const auth = new GoogleAuth();
      const pid = await auth.getProjectId();
      if (pid) PROJECT_ID = pid;
    } catch {
      // ignore
    }
  }
}

function extFromMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

async function main() {
  await resolveProjectId();
  if (!PROJECT_ID) {
    throw new Error(
      'PROJECT_ID not set. Set GOOGLE_CLOUD_PROJECT or PROJECT_ID env var, or run: gcloud config set project YOUR_PROJECT_ID'
    );
  }

  const prompt =
    process.argv.slice(2).join(' ') ||
    '선명하고 고해상도의 당근 이미지를 생성해줘. 정사각형(1024x1024 느낌), 스튜디오 라이팅, 부드러운 그림자, 흰 배경.';

  const url = `${apiBase()}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      // For image generation on Flash Image, do NOT send responseMimeType.
      responseModalities: ['IMAGE'],
    },
  };

  const token = await getAccessToken();
  const { data } = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': PROJECT_ID,
    },
    timeout: 180000,
  });

  // Extract first inlineData image
  let inline = null;
  for (const cand of data?.candidates || []) {
    for (const part of cand?.content?.parts || []) {
      if (part?.inlineData?.data) {
        inline = part.inlineData;
        break;
      }
    }
    if (inline) break;
  }

  if (!inline) {
    console.error('Raw response:\n', JSON.stringify(data, null, 2));
    throw new Error('No image returned from the model (inlineData not found).');
  }

  const mime = inline.mimeType || 'image/png';
  const ext = extFromMime(mime);

  const outDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `carrot-${ts}.${ext}`);
  fs.writeFileSync(outPath, Buffer.from(inline.data, 'base64'));

  console.log(`Saved image to ${outPath} (${mime})`);
}

main().catch((err) => {
  console.error('Image generation failed:', err?.response?.data || err?.message || err);
  process.exit(1);
});
