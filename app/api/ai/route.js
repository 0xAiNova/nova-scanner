import { NextResponse } from "next/server";

const DEXSCREENER_API = "https://api.dexscreener.com";

// ─── Scoring Breakdown (transparent to AI) ───
function computeScoreBreakdown(pair) {
  const breakdown = {
    liquidity: { value: 0, max: 15, raw: pair.liquidity?.usd || 0 },
    volume: { value: 0, max: 20, raw: pair.volume?.h24 || 0 },
    volumeMcapRatio: { value: 0, max: 15, raw: 0 },
    buyPressure: { value: 0, max: 15, raw: 0 },
    momentum5m: { value: 0, max: 15, raw: pair.priceChange?.m5 || 0 },
    trend1h: { value: 0, max: 10, raw: pair.priceChange?.h1 || 0 },
    freshness: { value: 0, max: 10, raw: 0 },
  };

  const liq = breakdown.liquidity.raw;
  const vol = breakdown.volume.raw;
  const mcap = pair.marketCap || pair.fdv || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const change5m = pair.priceChange?.m5 || 0;
  const change1h = pair.priceChange?.h1 || 0;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;

  // Liquidity (0-15)
  if (liq > 100000) breakdown.liquidity.value = 15;
  else if (liq > 50000) breakdown.liquidity.value = 12;
  else if (liq > 20000) breakdown.liquidity.value = 9;
  else if (liq > 10000) breakdown.liquidity.value = 6;
  else if (liq > 5000) breakdown.liquidity.value = 3;

  // Volume (0-20)
  if (vol > 1000000) breakdown.volume.value = 20;
  else if (vol > 500000) breakdown.volume.value = 16;
  else if (vol > 100000) breakdown.volume.value = 12;
  else if (vol > 50000) breakdown.volume.value = 8;
  else if (vol > 10000) breakdown.volume.value = 4;

  // Volume/MCap ratio (0-15)
  if (mcap > 0) {
    const ratio = vol / mcap;
    breakdown.volumeMcapRatio.raw = Math.round(ratio * 100) / 100;
    if (ratio > 2) breakdown.volumeMcapRatio.value = 15;
    else if (ratio > 1) breakdown.volumeMcapRatio.value = 12;
    else if (ratio > 0.5) breakdown.volumeMcapRatio.value = 9;
    else if (ratio > 0.2) breakdown.volumeMcapRatio.value = 6;
  }

  // Buy pressure (0-15)
  const totalTxns5m = buys5m + sells5m;
  if (totalTxns5m > 0) {
    const buyRatio = buys5m / totalTxns5m;
    breakdown.buyPressure.raw = Math.round(buyRatio * 100) / 100;
    if (buyRatio > 0.7 && totalTxns5m > 20) breakdown.buyPressure.value = 15;
    else if (buyRatio > 0.6 && totalTxns5m > 10) breakdown.buyPressure.value = 10;
    else if (buyRatio > 0.55) breakdown.buyPressure.value = 5;
  }

  // Momentum 5m (0-15)
  if (change5m > 20) breakdown.momentum5m.value = 15;
  else if (change5m > 10) breakdown.momentum5m.value = 12;
  else if (change5m > 5) breakdown.momentum5m.value = 8;
  else if (change5m > 0) breakdown.momentum5m.value = 4;

  // 1h trend (0-10)
  if (change1h > 50) breakdown.trend1h.value = 10;
  else if (change1h > 20) breakdown.trend1h.value = 7;
  else if (change1h > 5) breakdown.trend1h.value = 4;

  // Freshness (0-10)
  breakdown.freshness.raw = Math.round(ageHours * 10) / 10;
  if (ageHours < 1) breakdown.freshness.value = 10;
  else if (ageHours < 6) breakdown.freshness.value = 8;
  else if (ageHours < 24) breakdown.freshness.value = 5;
  else if (ageHours < 72) breakdown.freshness.value = 2;

  const total = Object.values(breakdown).reduce((sum, b) => sum + b.value, 0);
  return { breakdown, total: Math.min(total, 100) };
}

// ─── Risk Flag Detection ───
function detectRiskFlags(pair) {
  const flags = [];
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const mcap = pair.marketCap || pair.fdv || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const change5m = pair.priceChange?.m5 || 0;
  const change1h = pair.priceChange?.h1 || 0;
  const change24h = pair.priceChange?.h24 || 0;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;

  // Liquidity risks
  if (liq < 5000) flags.push({ type: "CRITICAL", flag: "MICRO_LIQUIDITY", detail: `Liquidity only $${Math.round(liq)} — high slippage, possible rug` });
  else if (liq < 10000) flags.push({ type: "WARNING", flag: "LOW_LIQUIDITY", detail: `Liquidity $${Math.round(liq)} — moderate slippage risk` });

  // Liquidity/MCap ratio — if liquidity is tiny vs mcap, the price is fragile
  if (mcap > 0 && liq > 0) {
    const liqMcapRatio = liq / mcap;
    if (liqMcapRatio < 0.03) flags.push({ type: "CRITICAL", flag: "FRAGILE_PRICE", detail: `Liq/MCap ratio ${(liqMcapRatio * 100).toFixed(1)}% — price collapses on any sell` });
    else if (liqMcapRatio < 0.1) flags.push({ type: "WARNING", flag: "THIN_LIQUIDITY_RATIO", detail: `Liq/MCap ratio ${(liqMcapRatio * 100).toFixed(1)}% — moderate sell impact` });
  }

  // Sell pressure detection
  const total5m = buys5m + sells5m;
  if (total5m > 10 && sells5m > buys5m * 1.5) {
    flags.push({ type: "WARNING", flag: "SELL_PRESSURE", detail: `5m sells (${sells5m}) significantly exceed buys (${buys5m})` });
  }

  const total1h = buys1h + sells1h;
  if (total1h > 20 && sells1h > buys1h * 1.3) {
    flags.push({ type: "WARNING", flag: "SELL_PRESSURE_1H", detail: `1h sells (${sells1h}) exceeding buys (${buys1h})` });
  }

  // Pump and dump pattern: huge 24h gain but 1h/5m going negative
  if (change24h > 100 && change1h < -10) {
    flags.push({ type: "CRITICAL", flag: "DUMP_IN_PROGRESS", detail: `Up ${change24h.toFixed(0)}% 24h but dropping ${change1h.toFixed(1)}% 1h — possible dump` });
  }

  if (change24h > 200 && change5m < -5) {
    flags.push({ type: "CRITICAL", flag: "BLOWOFF_TOP", detail: `Parabolic 24h (+${change24h.toFixed(0)}%) with 5m reversal (${change5m.toFixed(1)}%) — likely blowoff` });
  }

  // No activity
  if (total5m === 0 && total1h < 3) {
    flags.push({ type: "WARNING", flag: "DEAD_TOKEN", detail: "Near-zero trading activity" });
  }

  // Very new + high mcap = suspicious
  if (ageHours < 1 && mcap > 1000000) {
    flags.push({ type: "INFO", flag: "NEW_HIGH_MCAP", detail: `Less than 1 hour old with $${(mcap / 1e6).toFixed(1)}M mcap — could be bundled/insider launch` });
  }

  // No socials/info
  if (!pair.info?.socials?.length && !pair.info?.websites?.length) {
    flags.push({ type: "INFO", flag: "NO_SOCIALS", detail: "No website or social links found" });
  }

  // Boost detection (could be promotion/paid)
  if (pair.boosts?.active > 0) {
    flags.push({ type: "INFO", flag: "BOOSTED", detail: `Token has ${pair.boosts.active} active boosts — may be promoted/paid` });
  }

  return flags;
}

// ─── Action Recommendation ───
function getActionRecommendation(score, flags) {
  const criticalFlags = flags.filter((f) => f.type === "CRITICAL");
  const warningFlags = flags.filter((f) => f.type === "WARNING");

  if (criticalFlags.length >= 2) {
    return {
      action: "AVOID",
      confidence: "HIGH",
      reason: `${criticalFlags.length} critical risk flags detected`,
      suggestedSize: 0,
      suggestedStopLoss: null,
      suggestedTakeProfit: null,
    };
  }

  if (criticalFlags.length === 1 && score < 60) {
    return {
      action: "AVOID",
      confidence: "MEDIUM",
      reason: `Critical flag "${criticalFlags[0].flag}" with weak score (${score})`,
      suggestedSize: 0,
      suggestedStopLoss: null,
      suggestedTakeProfit: null,
    };
  }

  if (score >= 75 && criticalFlags.length === 0) {
    return {
      action: "BUY",
      confidence: warningFlags.length === 0 ? "HIGH" : "MEDIUM",
      reason: `Strong score (${score}/100) with ${warningFlags.length} warnings`,
      suggestedSize: warningFlags.length === 0 ? "3-5% of portfolio" : "2-3% of portfolio",
      suggestedStopLoss: "-30%",
      suggestedTakeProfit: ["50% at +50%", "25% at +100%", "hold 25% with trailing -40% stop"],
    };
  }

  if (score >= 50) {
    return {
      action: "WATCH",
      confidence: "MEDIUM",
      reason: `Moderate score (${score}/100) — monitor for improving signals before entry`,
      suggestedSize: "1-2% of portfolio if signals improve",
      suggestedStopLoss: "-25%",
      suggestedTakeProfit: ["50% at +30%", "50% at +75%"],
    };
  }

  return {
    action: "SKIP",
    confidence: "HIGH",
    reason: `Low score (${score}/100) — insufficient signal strength`,
    suggestedSize: 0,
    suggestedStopLoss: null,
    suggestedTakeProfit: null,
  };
}

// ─── Computed Ratios (pre-calculated for AI) ───
function computeRatios(pair) {
  const liq = pair.liquidity?.usd || 0;
  const vol24 = pair.volume?.h24 || 0;
  const vol1h = pair.volume?.h1 || 0;
  const mcap = pair.marketCap || pair.fdv || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const buys24h = pair.txns?.h24?.buys || 0;
  const sells24h = pair.txns?.h24?.sells || 0;
  const total5m = buys5m + sells5m;
  const total1h = buys1h + sells1h;
  const total24h = buys24h + sells24h;

  return {
    volumeToMcap: mcap > 0 ? Math.round((vol24 / mcap) * 1000) / 1000 : null,
    volumeToLiquidity: liq > 0 ? Math.round((vol24 / liq) * 1000) / 1000 : null,
    liquidityToMcap: mcap > 0 ? Math.round((liq / mcap) * 1000) / 1000 : null,
    buyRatio5m: total5m > 0 ? Math.round((buys5m / total5m) * 1000) / 1000 : null,
    buyRatio1h: total1h > 0 ? Math.round((buys1h / total1h) * 1000) / 1000 : null,
    buyRatio24h: total24h > 0 ? Math.round((buys24h / total24h) * 1000) / 1000 : null,
    txnVelocity5m: total5m,
    txnVelocity1h: total1h,
    txnVelocity24h: total24h,
    volumeAcceleration: vol1h > 0 && vol24 > 0 ? Math.round(((vol1h * 24) / vol24) * 1000) / 1000 : null,
    ageHours: pair.pairCreatedAt ? Math.round((Date.now() - pair.pairCreatedAt) / 3600000 * 10) / 10 : null,
  };
}

// ─── Main Handler ───
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") || "solana";
  const minScore = parseInt(searchParams.get("minScore") || "0");
  const minLiq = parseInt(searchParams.get("minLiq") || "5000");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const search = searchParams.get("q");
  const format = searchParams.get("format") || "full"; // full | compact | actions_only
  const actionFilter = searchParams.get("action"); // BUY | WATCH | SKIP | AVOID

  try {
    let allPairs = [];

    if (search) {
      const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(search)}`);
      const data = await res.json();
      allPairs = data.pairs || [];
    } else {
      const [profilesRes, boostsRes] = await Promise.all([
        fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`),
        fetch(`${DEXSCREENER_API}/token-boosts/top/v1`),
      ]);

      const profiles = await profilesRes.json();
      const boosts = await boostsRes.json();
      const profileList = Array.isArray(profiles) ? profiles : [];
      const boostList = Array.isArray(boosts) ? boosts : [];

      const tokenMap = new Map();
      [...profileList, ...boostList].forEach((t) => {
        if (t.tokenAddress && (t.chainId === chain || chain === "all")) {
          tokenMap.set(`${t.chainId}:${t.tokenAddress}`, t);
        }
      });

      const byChain = {};
      Array.from(tokenMap.values()).forEach((t) => {
        if (!byChain[t.chainId]) byChain[t.chainId] = [];
        byChain[t.chainId].push(t);
      });

      for (const [c, tks] of Object.entries(byChain)) {
        for (let i = 0; i < tks.length; i += 30) {
          const addresses = tks.slice(i, i + 30).map((t) => t.tokenAddress).join(",");
          try {
            const res = await fetch(`${DEXSCREENER_API}/tokens/v1/${c}/${addresses}`);
            const pairs = await res.json();
            if (Array.isArray(pairs)) allPairs.push(...pairs);
          } catch (e) {
            console.warn(`Batch failed for ${c}:`, e.message);
          }
        }
      }
    }

    // ─── Process each token ───
    const processed = allPairs
      .map((p) => {
        const { breakdown, total: score } = computeScoreBreakdown(p);
        const riskFlags = detectRiskFlags(p);
        const recommendation = getActionRecommendation(score, riskFlags);
        const ratios = computeRatios(p);

        // ─── Format based on requested format ───
        if (format === "compact") {
          return {
            token: p.baseToken?.address,
            symbol: p.baseToken?.symbol,
            chain: p.chainId,
            price: p.priceUsd,
            mcap: p.marketCap || p.fdv,
            liq: p.liquidity?.usd,
            vol24h: p.volume?.h24,
            chg5m: p.priceChange?.m5,
            chg1h: p.priceChange?.h1,
            score,
            action: recommendation.action,
            confidence: recommendation.confidence,
            criticalFlags: riskFlags.filter((f) => f.type === "CRITICAL").length,
            warningFlags: riskFlags.filter((f) => f.type === "WARNING").length,
            buyRatio5m: ratios.buyRatio5m,
            pair: p.pairAddress,
          };
        }

        if (format === "actions_only") {
          return {
            token: p.baseToken?.address,
            symbol: p.baseToken?.symbol,
            chain: p.chainId,
            score,
            ...recommendation,
            flags: riskFlags.map((f) => f.flag),
          };
        }

        // Full format
        return {
          // ── Identity ──
          identity: {
            token: p.baseToken?.address,
            symbol: p.baseToken?.symbol,
            name: p.baseToken?.name,
            chain: p.chainId,
            dex: p.dexId,
            pairAddress: p.pairAddress,
            dexScreenerUrl: p.url,
          },

          // ── Market Data (current snapshot) ──
          market: {
            priceUsd: p.priceUsd,
            priceNative: p.priceNative,
            marketCap: p.marketCap || p.fdv,
            liquidity: p.liquidity?.usd,
            volume: {
              h1: p.volume?.h1,
              h6: p.volume?.h6,
              h24: p.volume?.h24,
            },
            priceChange: {
              m5: p.priceChange?.m5,
              h1: p.priceChange?.h1,
              h6: p.priceChange?.h6,
              h24: p.priceChange?.h24,
            },
          },

          // ── Transaction Flow ──
          transactions: {
            m5: { buys: p.txns?.m5?.buys || 0, sells: p.txns?.m5?.sells || 0 },
            h1: { buys: p.txns?.h1?.buys || 0, sells: p.txns?.h1?.sells || 0 },
            h24: { buys: p.txns?.h24?.buys || 0, sells: p.txns?.h24?.sells || 0 },
          },

          // ── Pre-computed Ratios (saves agent compute) ──
          ratios,

          // ── Score with transparent breakdown ──
          scoring: {
            total: score,
            breakdown,
          },

          // ── Risk Analysis ──
          risk: {
            flags: riskFlags,
            criticalCount: riskFlags.filter((f) => f.type === "CRITICAL").length,
            warningCount: riskFlags.filter((f) => f.type === "WARNING").length,
            riskLevel: riskFlags.some((f) => f.type === "CRITICAL")
              ? "HIGH"
              : riskFlags.some((f) => f.type === "WARNING")
                ? "MEDIUM"
                : "LOW",
          },

          // ── Action Recommendation ──
          recommendation,

          // ── Metadata ──
          meta: {
            boosts: p.boosts?.active || 0,
            pairCreatedAt: p.pairCreatedAt,
            ageHours: ratios.ageHours,
            hasSocials: !!(p.info?.socials?.length),
            hasWebsite: !!(p.info?.websites?.length),
            socials: p.info?.socials || [],
            websites: p.info?.websites || [],
          },
        };
      })
      .filter((t) => {
        const s = format === "full" ? t.scoring.total : t.score;
        const l = format === "full" ? t.market?.liquidity : t.liq;
        const a = format === "full" ? t.recommendation.action : t.action;
        if (s < minScore) return false;
        if ((l || 0) < minLiq) return false;
        if (actionFilter && a !== actionFilter.toUpperCase()) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = format === "full" ? a.scoring.total : a.score;
        const sb = format === "full" ? b.scoring.total : b.score;
        return sb - sa;
      })
      .slice(0, limit);

    // ─── Response with agent-friendly metadata ───
    const actionSummary = {};
    processed.forEach((t) => {
      const a = format === "full" ? t.recommendation.action : t.action;
      actionSummary[a] = (actionSummary[a] || 0) + 1;
    });

    return NextResponse.json({
      // ── Agent Metadata ──
      _meta: {
        status: "ok",
        version: "2.0",
        timestamp: new Date().toISOString(),
        dataSource: "dexscreener_public_api",
        refreshInterval: "30s",
        format,
      },

      // ── Query Echo (so agent knows what it asked for) ──
      query: {
        chain,
        minScore,
        minLiq,
        limit,
        search: search || null,
        actionFilter: actionFilter || null,
      },

      // ── Summary (quick agent decision layer) ──
      summary: {
        totalScanned: allPairs.length,
        totalReturned: processed.length,
        actionBreakdown: actionSummary,
        topScore: processed.length > 0 ? (format === "full" ? processed[0].scoring.total : processed[0].score) : 0,
        avgScore: processed.length > 0
          ? Math.round(processed.reduce((s, t) => s + (format === "full" ? t.scoring.total : t.score), 0) / processed.length)
          : 0,
      },

      // ── Token Data ──
      tokens: processed,

      // ── Usage Hints for AI Agent ──
      _agentHints: {
        endpoints: {
          fullScan: "/api/ai?chain=solana&minScore=50&format=full",
          quickScan: "/api/ai?chain=solana&minScore=75&format=compact",
          buySignalsOnly: "/api/ai?chain=solana&action=BUY&format=actions_only",
          searchToken: "/api/ai?q=BONK&format=full",
        },
        scoringGuide: {
          "75-100": "STRONG — high conviction entry, check risk flags before executing",
          "50-74": "WATCH — monitor for improvement, don't enter yet",
          "25-49": "WEAK — insufficient signal, skip unless you have alpha not captured here",
          "0-24": "SKIP — no edge detected",
        },
        riskLevels: {
          LOW: "No critical or warning flags — cleanest setup",
          MEDIUM: "Warning flags present — reduce position size",
          HIGH: "Critical flags detected — avoid or use minimal size with tight stops",
        },
        ratioGuide: {
          volumeToMcap: "> 1.0 = very high activity relative to size (bullish), < 0.1 = dead",
          buyRatio5m: "> 0.65 = strong buy pressure, < 0.4 = sell pressure dominance",
          liquidityToMcap: "> 0.1 = healthy, < 0.03 = fragile price (critical risk)",
          volumeAcceleration: "> 1.5 = volume increasing vs 24h avg, < 0.5 = fading",
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        _meta: { status: "error", timestamp: new Date().toISOString() },
        error: { message: error.message, type: error.constructor.name },
      },
      { status: 500 }
    );
  }
}
