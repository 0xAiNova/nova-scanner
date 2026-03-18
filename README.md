# Nova Scanner — DexScreener Token Intelligence

Real-time multi-chain token scanner powered by DexScreener. Built for humans and AI agents — with structured JSON APIs, token scoring, risk detection, and action recommendations.

**Live:** [nova-scanner-taupe.vercel.app](https://nova-scanner-taupe.vercel.app) · **Static UI:** `/static-scanner.html` · Built by [@0xAiNovaCEO](https://x.com/0xAiNovaCEO)

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

### AI Agent API — `/api/ai` (Full Intelligence Layer)

`GET /api/ai` — AI-optimized endpoint with scoring breakdown, risk flags, action recommendations, and pre-computed ratios.

**Parameters:**
| Param | Options | Description |
|-------|---------|-------------|
| `chain` | `solana`, `ethereum`, `base`, `all` | Chain filter |
| `format` | `full`, `compact`, `actions_only` | Response verbosity |
| `action` | `BUY`, `WATCH`, `SKIP`, `AVOID` | Filter by recommendation |
| `minScore` | 0–100 | Minimum score |
| `q` | — | Search by symbol/address |

**Example calls:**
```bash
# Get BUY signals with full breakdown
curl "https://nova-scanner-taupe.vercel.app/api/ai?chain=solana&action=BUY&format=full"

# Compact fast-poll format
curl "https://nova-scanner-taupe.vercel.app/api/ai?format=compact&minScore=75"

# Actions only — for decision agents
curl "https://nova-scanner-taupe.vercel.app/api/ai?format=actions_only&action=BUY"

# Search a specific token
curl "https://nova-scanner-taupe.vercel.app/api/ai?q=BONK&format=full"
```

**Full format response per token:**
```json
{
  "identity": { "token": "...", "symbol": "BONK", "chain": "solana", "dexScreenerUrl": "..." },
  "market": { "priceUsd": "0.00001", "marketCap": 1200000, "liquidity": 80000, "volume": {...}, "priceChange": {...} },
  "transactions": { "m5": { "buys": 42, "sells": 8 }, "h1": {...}, "h24": {...} },
  "ratios": { "volumeToMcap": 1.8, "buyRatio5m": 0.84, "liquidityToMcap": 0.067, "volumeAcceleration": 2.1 },
  "scoring": { "total": 87, "breakdown": { "liquidity": {...}, "volume": {...}, "buyPressure": {...} } },
  "risk": { "flags": [...], "riskLevel": "LOW", "criticalCount": 0, "warningCount": 0 },
  "recommendation": { "action": "BUY", "confidence": "HIGH", "suggestedSize": "3-5% of portfolio", "suggestedStopLoss": "-30%" }
}
```

**Response also includes `_agentHints`** — endpoint examples, scoring guide, ratio interpretation guide built-in.

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
# Get top Solana tokens with score >= 50
curl "https://your-app.vercel.app/api/scan?chain=solana&minScore=50"

# Search for a specific token
curl "https://your-app.vercel.app/api/scan?q=BONK"

# High liquidity tokens across all chains
curl "https://your-app.vercel.app/api/scan?chain=all&minLiq=100000&minScore=75"
```

**Response format:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z",
  "chain": "solana",
  "count": 25,
  "tokens": [
    {
      "token": "ADDRESS",
      "symbol": "TOKEN",
      "name": "Token Name",
      "chain": "solana",
      "price": "0.001234",
      "marketCap": 500000,
      "liquidity": 50000,
      "volume24h": 200000,
      "priceChange": { "m5": 5.2, "h1": 12.5, "h6": -3.1, "h24": 45.0 },
      "txns": { "m5": { "buys": 45, "sells": 12 }, ... },
      "score": 82,
      "signal": "STRONG_BUY",
      "dexUrl": "https://dexscreener.com/solana/...",
      "pairAddress": "..."
    }
  ]
}
```

### DexScreener APIs Used

| Endpoint | Type | Rate Limit | Purpose |
|----------|------|-----------|---------|
| `/token-profiles/latest/v1` | REST | 60/min | Discover new token profiles |
| `/token-boosts/top/v1` | REST | 60/min | Find most boosted tokens |
| `/token-boosts/latest/v1` | REST + WSS | 60/min | Latest boost events |
| `/tokens/v1/{chain}/{addresses}` | REST | 300/min | Enrich with pair data |
| `/latest/dex/search?q=` | REST | 300/min | Search pairs |
| `wss://api.dexscreener.com/token-boosts/latest/v1` | WebSocket | — | Real-time boost stream |

## Deploy to Vercel

### Option 1: CLI Deploy
```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy from project directory
cd nova-scanner
vercel
```

### Option 2: Git Deploy
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import the repo
3. Framework preset: Next.js (auto-detected)
4. Click Deploy

### Option 3: From WSL
```bash
cd nova-scanner
vercel --yes
```

## Nova Agent Integration

To have your Nova agent consume this scanner data, add this to your agent's data pipeline:

```javascript
// In your Nova agent code
async function fetchScannerSignals() {
  const res = await fetch('https://your-app.vercel.app/api/scan?chain=solana&minScore=50&minLiq=10000');
  const data = await res.json();
  
  // Filter for actionable signals
  const strongBuys = data.tokens.filter(t => t.signal === 'STRONG_BUY');
  
  for (const token of strongBuys) {
    console.log(`[SIGNAL] ${token.symbol} — Score: ${token.score}, MCap: ${token.marketCap}, Liq: ${token.liquidity}`);
    // Pass to your trading engine for further analysis
  }
  
  return data.tokens;
}
```

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
- **Frontend**: React 18, Inter font (landing page theme)
- **Styling**: Custom CSS matching Nova landing page design
- **Data**: DexScreener Public API (no key required)
- **Deployment**: Vercel (auto-deploy on push to main)
- **Real-time**: Native WebSocket to DexScreener
- **Static UI**: `/static-scanner.html` (Vercel proxy at `/api/dex/...`)
