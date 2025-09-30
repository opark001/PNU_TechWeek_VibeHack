import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';
import { readFile } from 'fs/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.resolve(__dirname, '..', 'images')));

// Environment configuration
let PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.PROJECT_ID;

const LOCATION =
  process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';

// Model IDs from official docs:
// - Text/multimodal: gemini-2.5-flash (GA)
// - Image generation/editing (aka nano-banana): gemini-2.5-flash-image-preview (Preview)
const TEXT_MODEL =
  process.env.VERTEX_TEXT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL =
  process.env.VERTEX_IMAGE_MODEL || 'gemini-2.5-flash-image-preview';

const PORT = process.env.PORT || 3000;

function apiBase() {
  return LOCATION === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${LOCATION}-aiplatform.googleapis.com`;
}
function endpointForModel(modelId) {
  return `${apiBase()}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:generateContent`;
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
    } catch (_) {
      // ignore
    }
  }
}

async function ensureProjectConfigured() {
  await resolveProjectId();
  if (!PROJECT_ID) {
    const msg =
      'PROJECT_ID not set. Set GOOGLE_CLOUD_PROJECT or PROJECT_ID env var, or configure via ADC (gcloud config set project ...).';
    throw new Error(msg);
  }
}

app.get('/api/config', (_req, res) => {
  res.json({
    projectId: PROJECT_ID || null,
    location: LOCATION,
    textModel: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
  });
});

// Text or general multimodal generation (returns text)
app.post('/api/generate-text', async (req, res) => {
  try {
    await ensureProjectConfigured();

    const {
      prompt,
      systemInstruction,
      temperature,
      topP,
      maxOutputTokens,
      modelId,
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt (string) is required' });
    }

    const effectiveModel = (modelId || TEXT_MODEL).trim();
    const url = endpointForModel(effectiveModel);

    const generationConfig = {};
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    if (typeof topP === 'number') generationConfig.topP = topP;
    if (typeof maxOutputTokens === 'number') generationConfig.maxOutputTokens = maxOutputTokens;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    };

    if (systemInstruction && typeof systemInstruction === 'string') {
      body.systemInstruction = {
        role: 'system',
        parts: [{ text: systemInstruction }],
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    const accessToken = await getAccessToken();
    const { data } = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });

    // Extract text from the first candidate
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        ?.filter(Boolean)
        ?.join('') || '';

    return res.json({
      model: effectiveModel,
      text,
      usageMetadata: data?.usageMetadata || null,
    });
  } catch (err) {
    console.error('[generate-text] error:', err?.response?.data || err);
    return res.status(500).json({
      error: 'Text generation failed',
      details: err?.response?.data || err?.message || String(err),
    });
  }
});

// Image generation or editing (returns base64 image(s))
app.post('/api/generate-image', async (req, res) => {
  try {
    await ensureProjectConfigured();

    const {
      prompt,
      imageBase64, // optional data URL or pure base64
      imageMimeType, // optional when imageBase64 provided
      responseMimeType, // default: image/png
      modelId,
      temperature,
      topP,
      maxOutputTokens,
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt (string) is required' });
    }

    const effectiveModel = (modelId || IMAGE_MODEL).trim();
    const url = endpointForModel(effectiveModel);

    // Build parts
    const parts = [{ text: prompt }];

    if (imageBase64) {
      const { cleanB64, mime } = normalizeBase64(imageBase64, imageMimeType);
      parts.push({
        inlineData: {
          mimeType: mime,
          data: cleanB64,
        },
      });
    }

    const generationConfig = {
      responseModalities: ['IMAGE'],
    };
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    if (typeof topP === 'number') generationConfig.topP = topP;

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };

    const accessToken = await getAccessToken();
    const { data } = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 180000,
    });

    // Collect all inlineData parts (could be multiple images)
    const images = [];
    const candidates = data?.candidates || [];
    for (const cand of candidates) {
      const cparts = cand?.content?.parts || [];
      for (const p of cparts) {
        if (p.inlineData?.data) {
          const mime = p.inlineData.mimeType || 'image/png';
          images.push({
            mimeType: mime,
            dataUrl: `data:${mime};base64,${p.inlineData.data}`,
          });
        }
      }
    }

    if (images.length === 0) {
      return res.status(502).json({
        error: 'No image returned from the model',
        raw: data,
      });
    }

    return res.json({
      model: effectiveModel,
      images,
      usageMetadata: data?.usageMetadata || null,
    });
  } catch (err) {
    console.error('[generate-image] error:', err?.response?.data || err);
    return res.status(500).json({
      error: 'Image generation failed',
      details: err?.response?.data || err?.message || String(err),
    });
  }
});

function normalizeBase64(input, mimeFromClient) {
  // Accept both data URL and raw base64
  let clean = input;
  let mime = mimeFromClient || 'image/png';
  const match = /^data:(.+);base64,(.*)$/.exec(input);
  if (match) {
    mime = match[1] || mime;
    clean = match[2] || '';
  }
  // Remove whitespace/newlines
  clean = clean.replace(/\s+/g, '');
  return { cleanB64: clean, mime };
}

/**
 * Minimal API to expose the system instruction text for battle simulation
 */
app.get('/api/prompt', async (_req, res) => {
  try {
    const p = path.resolve(__dirname, '..', '프롬프트.txt');
    const text = await readFile(p, 'utf8');
    res.type('text/plain').send(text);
  } catch (err) {
    console.error('[GET /api/prompt] error:', err);
    res.status(500).json({ error: 'Failed to load system prompt' });
  }
});

/**
 * Team B rosters by stage (fixed from champ_concept.txt)
 */
const TEAM_B_BY_STAGE = {
  1: [
    { name: '조환규', ability: '네스파 폭격(난해한 알고리즘 과제 지속 폭격)' },
    { name: '채흥석', ability: '학점 폭격(엄격 평가/F학점 투하)' },
    { name: '김정구', ability: '발표 지목(불시 발표 유도)' },
  ],
  2: [
    { name: '아카자', ability: '무도가·재생·기척감지' },
    { name: '조커', ability: '칼·기만·무자비(근접 약점)' },
    { name: '쿠파', ability: '납치·피지컬·등껍질 방어(느림)' },
  ],
  3: [
    { name: '시진핑', ability: '만리방화벽(검열·정보왜곡·여론조작)' },
    { name: '트럼프', ability: '관세 폭탄(무역·경제 압박)' },
    { name: '김정은', ability: '화성 미사일(ICBM·핵 위협)' },
  ],
};

/**
 * Battle Simulation API (stage-aware, system prompt from 프롬프트.txt)
 * Body: { stage: 1|2|3, teamA: [{name, ability},{name, ability},{name, ability}] }
 */
app.post('/api/battle-simulate', async (req, res) => {
  try {
    await ensureProjectConfigured();

    const { teamA, stage } = req.body || {};
    if (!Array.isArray(teamA) || teamA.length !== 3) {
      return res.status(400).json({ error: 'teamA must be an array of 3 items' });
    }
    for (let i = 0; i < 3; i++) {
      const it = teamA[i] || {};
      if (typeof it.name !== 'string' || !it.name.trim() || typeof it.ability !== 'string' || !it.ability.trim()) {
        return res.status(400).json({ error: `teamA[${i}] requires non-empty name and ability` });
      }
    }

    let st = parseInt(stage, 10);
    if (!Number.isFinite(st) || st < 1 || st > 3) st = 1;

    const teamB = TEAM_B_BY_STAGE[st];

    const prompt = [
      '팀 A',
      `- 이름: ${teamA[0].name.trim()} / 능력: ${teamA[0].ability.trim()}`,
      `- 이름: ${teamA[1].name.trim()} / 능력: ${teamA[1].ability.trim()}`,
      `- 이름: ${teamA[2].name.trim()} / 능력: ${teamA[2].ability.trim()}`,
      '팀 B',
      ...teamB.map((b) => `- 이름: ${b.name} / 능력: ${b.ability}`),
    ].join('\n');

    // Load fixed system instruction from project root
    const sysPath = path.resolve(__dirname, '..', '프롬프트.txt');
    const systemInstruction = await readFile(sysPath, 'utf8');

    const effectiveModel = TEXT_MODEL.trim();
    const url = endpointForModel(effectiveModel);

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
    };

    const accessToken = await getAccessToken();
    const { data } = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        ?.filter(Boolean)
        ?.join('') || '';

    return res.json({
      model: effectiveModel,
      text,
      usageMetadata: data?.usageMetadata || null,
    });
  } catch (err) {
    console.error('[battle-simulate] error:', err?.response?.data || err);
    return res.status(500).json({
      error: 'Battle simulation failed',
      details: err?.response?.data || err?.message || String(err),
    });
  }
});

/**
 * Serve UI
 * Express v5에서 '*' 와일드카드가 path-to-regexp 변경으로 오류를 유발하므로
 * 루트 라우트와 fallback 미들웨어를 사용합니다.
 */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!PROJECT_ID) {
    console.warn('Warning: PROJECT_ID not set. Set env var or run: gcloud config get-value project');
  }
  console.log(`Using location: ${LOCATION}`);
  console.log(`Text model: ${TEXT_MODEL}`);
  console.log(`Image model: ${IMAGE_MODEL}`);
});
