# NOVA SCANNER — DexScreener Token Intelligence

Real-time Solana meme coin scanner powered by DexScreener's public API and WebSocket feeds. Built for AI agent integration and fast token discovery.

> **Architecture Note (March 2026):** Nova Scanner now runs entirely client-side to eliminate AI agent credit burn. Previously, 5-min scheduled automations were invoking the AI agent 288+ times/day just for scanning. New architecture: scanner runs in-browser (zero agent credits), agent is only invoked on confirmed 80+ signals.

## Features

### Live Scanner Dashboard
- **Real-time token discovery** from DexScreener profiles + boost feeds
- **WebSocket connection** to DexScreener boost stream for instant alerts
- **Scoring engine** (0–100) based on liquidity, volume, buy pressure, momentum, freshness
- **Signal classification**: STRONG (75+), WATCH (50-74), WEAK (25-49), SKIP (<25)
- **Multi-chain support**: Solana, Ethereum, Base, BSC, Arbitrum, and more
- **Sortable columns**: Price changes (5m/1h/24h), volume, liquidity, market cap, age, score
- **Filters**: Chain, minimum liquidity, minimum score
- **Detail panel**: Full token breakdown with transaction data, links, and JSON export

### AI Agent API Endpoint
`GET /api/scan` — Returns scored tokens as structured JSON for agent consumption.

**Parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `chain` | `solana` | Filter by chain (or `all`) |
| `minScore` | `0` | Minimum score threshold |
| `minLiq` | `5000` | Minimum liquidity in USD |
| `limit` | `50` | Max tokens to return (max 100) |
| `q` | — | Search query (searches DexScreener pairs) |

**Example calls:**
```bash
# Get top Solana tokens with score >= 80
curl "https://nova-scanner.vercel.app/api/scan?chain=solana&minScore=80"

# Search for a specific token
curl "https://nova-scanner.vercel.app/api/scan?q=BONK"
```

### DexScreener APIs Used (all free, no key required)

| Endpoint | Type | Rate Limit | Purpose |
|----------|------|-----------|---------|
| `/token-profiles/latest/v1` | REST | 60/min | Discover new token profiles |
| `/token-boosts/top/v1` | REST | 60/min | Find most boosted tokens |
| `/tokens/v1/{chain}/{addresses}` | REST | 300/min | Enrich with pair data |
| `wss://api.dexscreener.com/token-boosts/latest/v1` | WebSocket | — | Real-time boost stream |

## Credit-Efficient Architecture

### Problem (old)
- Agent automation fired every 5 min → 288 agent invocations/day
- Each invocation: scan + score + write entities + send alerts = ~20 credits
- Total: **~5,760 credits/day** just for scanning

### Solution (new)
```
Browser/Vercel (free) → scans DexScreener continuously
                      → scores tokens client-side
                      → only calls Nova agent when score >= 80

Nova Agent (credits) → receives pre-filtered 80+ signals only
                     → logs to TradeJournal entity
                     → sends Telegram alert
                     → ~2-5 invocations/day max
```

**Credit reduction: ~98%**

## Nova Agent Integration

The scanner calls Nova's `/api/alert` endpoint only for confirmed STRONG signals:

```javascript
// Scanner → Nova Agent (only on score >= 80)
async function notifyNovaAgent(token) {
  if (token.score < 80) return; // Hard gate — no agent invocation below 80

  await fetch('https://nova-de13fb08.base44.app/functions/logSniperAlerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mint: token.token,
      symbol: token.symbol,
      signal_score: token.score,
      curve_sol: token.liquidity / 95, // approx
      price_usd: token.price,
      change_1h: token.priceChange?.h1,
      alert_type: 'new_token',
      message: `Score ${token.score} — ${token.signal}`
    })
  });
}
```

## Deploy to Vercel

```bash
# Clone and deploy
git clone https://github.com/0xAiNova/nova-scanner
cd nova-scanner
vercel --yes
```

Or connect the GitHub repo to Vercel for auto-deploy on push.

## Scoring Model

| Factor | Weight | Measurement |
|--------|--------|-------------|
| Liquidity depth | 15pts | Pool size tiers ($5K → $100K+) |
| 24h Volume | 20pts | Volume tiers ($10K → $1M+) |
| Vol/MCap ratio | 15pts | Trading intensity relative to size |
| Buy pressure (5m) | 15pts | Buy ratio with minimum txn count |
| Price momentum (5m) | 15pts | Short-term price acceleration |
| 1h trend | 10pts | Medium-term direction |
| Freshness | 10pts | Newer tokens score higher |

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Frontend**: React 18
- **Styling**: Custom CSS (dark terminal theme)
- **Data**: DexScreener Public API (no key required)
- **Deployment**: Vercel (free tier)
- **Real-time**: Native WebSocket to DexScreener
- **Agent**: Nova AI at [nova-de13fb08.base44.app](https://nova-de13fb08.base44.app)

## Repository Map

| Repo | Purpose |
|------|---------|
| [nova-scanner](https://github.com/0xAiNova/nova-scanner) | This — DexScreener scanner + dashboard |
| [0xainova](https://github.com/0xAiNova/0xainova) | Nova landing page (ainova.dev) |
| [nova-openclaw](https://github.com/0xAiNova/nova-openclaw) | OpenClaw config + brain files |
| [0xAiNovaCEO](https://github.com/0xAiNova/0xAiNovaCEO) | Nova X persona agent |

---
Built by [@0xAiNovaCEO](https://x.com/0xAiNovaCEO) — Nova Autonomous AI Agent on Solana
