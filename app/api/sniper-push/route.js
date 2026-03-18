/**
 * app/api/sniper-push/route.js
 * 
 * Vercel cron job — runs every 2 minutes (free tier).
 * Polls nova-scanner for tokens scoring ≥75.
 * Applies quality gates, deduplicates, then POSTs to Nova's webhook.
 * 
 * Nova never polls. She only wakes up when this fires a real signal.
 */

const SCANNER_URL = 'https://nova-scanner-taupe.vercel.app/api/scan';
const WEBHOOK_URL = process.env.NOVA_WEBHOOK_URL || 'https://api.base44.app/api/apps/69b8d60ca746bc75de13fb08/functions/sniperWebhook';
const WEBHOOK_SECRET = process.env.NOVA_WEBHOOK_SECRET || '';
const APP_TOKEN = process.env.NOVA_APP_TOKEN || '';

// In-memory dedup (per cold start, ~30min window)
const recentlyAlerted = new Map();
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

function cleanOldEntries() {
  const now = Date.now();
  for (const [mint, ts] of recentlyAlerted.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) recentlyAlerted.delete(mint);
  }
}

async function fetchTopTokens(minScore = 75, limit = 10) {
  const url = `${SCANNER_URL}?chain=solana&minScore=${minScore}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Nova-SniperPush/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Scanner responded ${res.status}`);
  const data = await res.json();
  return data.tokens || [];
}

async function pushToNova(token) {
  const headers = { 'Content-Type': 'application/json', 'x-nova-secret': WEBHOOK_SECRET };
  if (APP_TOKEN) headers['Authorization'] = `Bearer ${APP_TOKEN}`;
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(token),
    signal: AbortSignal.timeout(15000),
  });
  return await res.json();
}

export async function GET(req) {
  // Vercel cron sends GET requests
  cleanOldEntries();

  let tokens;
  try {
    tokens = await fetchTopTokens(75, 10);
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }

  let pushed = 0;
  let skipped = 0;
  const results = [];

  for (const token of tokens) {
    const mint = token.token;
    if (!mint) continue;

    // Dedup — skip if alerted within last 30 min
    if (recentlyAlerted.has(mint)) { skipped++; continue; }

    // Gate 1: too old (missed the window)
    if ((token.ageHours || 0) > 4) { skipped++; continue; }

    // Gate 2: weak buy/sell ratio
    const buys = token.txns?.h1?.buys || 0;
    const sells = token.txns?.h1?.sells || 1;
    if (buys / sells < 1.5) { skipped++; continue; }

    // Gate 3: must have real liquidity
    if ((token.liquidity || 0) < 8000) { skipped++; continue; }

    try {
      const result = await pushToNova(token);
      recentlyAlerted.set(mint, Date.now());
      pushed++;
      results.push({ symbol: token.symbol, score: token.score, ok: result.ok });
    } catch (err) {
      console.error(`Push failed for ${token.symbol}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  return Response.json({
    ok: true,
    scanned: tokens.length,
    pushed,
    skipped,
    results,
    timestamp: new Date().toISOString(),
  });
}
