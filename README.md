# Nova Scanner

Real-time Solana token intelligence. Powered by DexScreener. Built to be called by agents.

**Live:** `https://nova-scanner-taupe.vercel.app`

---

## API Reference

### `GET /api/scan` — Scored token list

Returns tokens from DexScreener (profiles + boosts), enriched and scored 0-100.

```
/api/scan?chain=solana&minScore=50&minLiq=10000&limit=25
```

| Param | Default | Notes |
|-------|---------|-------|
| `chain` | `solana` | `solana`, `ethereum`, `base`, `bsc`, `all` |
| `minScore` | `0` | 0-100 |
| `minLiq` | `5000` | USD |
| `limit` | `50` | max 100 |
| `q` | — | search by symbol/name/address |

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "chain": "solana",
  "count": 12,
  "tokens": [
    {
      "token": "MINT_ADDRESS",
      "symbol": "TOKEN",
      "chain": "solana",
      "price": "0.001234",
      "marketCap": 500000,
      "liquidity": 52000,
      "volume24h": 1450000,
      "priceChange": { "m5": 3.2, "h1": 18.5, "h6": -2.1, "h24": 44.0 },
      "txns": {
        "m5": { "buys": 42, "sells": 8 },
        "h1": { "buys": 310, "sells": 95 },
        "h24": { "buys": 2100, "sells": 890 }
      },
      "ageHours": 4.2,
      "score": 86,
      "signal": "STRONG_BUY",
      "dexUrl": "https://dexscreener.com/solana/..."
    }
  ]
}
```

---

### `GET /api/ai` — Full AI-optimized response

Same tokens with scoring breakdown, risk flags, action recommendations, and pre-computed ratios.

```
/api/ai?chain=solana&action=BUY&format=full&minScore=70
```

| Param | Options |
|-------|---------|
| `format` | `full` (default), `compact`, `actions_only` |
| `action` | `BUY`, `WATCH`, `SKIP`, `AVOID` |
| `chain` | same as /api/scan |
| `minScore` | 0-100 |
| `q` | search |

**`format=full` adds per-token:**
```json
{
  "scoring": {
    "total": 86,
    "breakdown": {
      "liquidity":       { "value": 12, "max": 15, "raw": 52311 },
      "volume":          { "value": 20, "max": 20, "raw": 1456411 },
      "volumeMcapRatio": { "value": 15, "max": 15, "raw": 4.18 },
      "buyPressure":     { "value": 15, "max": 15, "raw": 0.84 },
      "momentum5m":      { "value":  8, "max": 15, "raw": 6.2 },
      "trend1h":         { "value":  7, "max": 10, "raw": 22.1 },
      "freshness":       { "value":  8, "max": 10, "raw": 4.2 }
    }
  },
  "risk": {
    "flags": [{ "type": "INFO", "flag": "BOOSTED", "detail": "2 active boosts" }],
    "riskLevel": "LOW",
    "criticalCount": 0,
    "warningCount": 0
  },
  "recommendation": {
    "action": "BUY",
    "confidence": "HIGH",
    "reason": "Strong score (86/100) with 0 warnings",
    "suggestedSize": "3-5% of portfolio",
    "suggestedStopLoss": "-30%",
    "suggestedTakeProfit": ["50% at +50%", "25% at +100%", "hold 25% trailing -40%"]
  }
}
```

**`format=compact`** — minimal payload, fast polling:
```json
{ "symbol": "TOKEN", "score": 86, "signal": "STRONG_BUY", "price": "0.001234", "change1h": 18.5, "liquidity": 52000 }
```

**`format=actions_only`** — pure decisions:
```json
{ "symbol": "TOKEN", "action": "BUY", "confidence": "HIGH", "score": 86 }
```

---

## Scoring Model (0-100)

| Factor | Max | Signal |
|--------|-----|--------|
| Liquidity depth | 15 | $5K to $100K+ |
| 24h Volume | 20 | $10K to $1M+ |
| Vol/MCap ratio | 15 | 0.2x to 2x+ |
| Buy pressure 5m | 15 | >55% buys with txn count |
| Price momentum 5m | 15 | 0% to 20%+ |
| 1h trend | 10 | 5% to 50%+ |
| Freshness | 10 | <1h to <72h |

**Signals:** `STRONG_BUY` (75+) · `WATCH` (50-74) · `WEAK` (25-49) · `SKIP` (<25)

---

## Quick Usage (agent code)

```js
// Top Solana signals
const { tokens } = await fetch(
  "https://nova-scanner-taupe.vercel.app/api/scan?chain=solana&minScore=75&limit=10"
).then(r => r.json());
// tokens[0] => { symbol, score, signal, price, liquidity, volume24h, dexUrl, ... }

// Full AI analysis with risk flags
const data = await fetch(
  "https://nova-scanner-taupe.vercel.app/api/ai?chain=solana&action=BUY&format=full"
).then(r => r.json());
// data.tokens[0].recommendation.action === "BUY"
// data.tokens[0].risk.riskLevel === "LOW"

// Search by symbol
const result = await fetch(
  "https://nova-scanner-taupe.vercel.app/api/scan?q=BONK"
).then(r => r.json());
```

---

## Data Sources (no API key required)

| DexScreener Endpoint | Purpose |
|---------------------|---------|
| `/token-profiles/latest/v1` | Newly listed token profiles |
| `/token-boosts/top/v1` | Most boosted tokens |
| `/token-boosts/latest/v1` | Latest boost events |
| `/tokens/v1/{chain}/{addrs}` | Batch pair enrichment (30/req) |
| `/latest/dex/search?q=` | Symbol/address search |

Data refreshes every 30s via Vercel edge cache. No auth required.

---

Built by [@0xAiNovaCEO](https://x.com/0xAiNovaCEO)
