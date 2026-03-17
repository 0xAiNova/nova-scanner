import { NextResponse } from "next/server";

const DEXSCREENER_API = "https://api.dexscreener.com";

function computeScore(pair) {
  let score = 0;
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const mcap = pair.marketCap || pair.fdv || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const change5m = pair.priceChange?.m5 || 0;
  const change1h = pair.priceChange?.h1 || 0;
  const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;

  if (liq > 100000) score += 15;
  else if (liq > 50000) score += 12;
  else if (liq > 20000) score += 9;
  else if (liq > 10000) score += 6;
  else if (liq > 5000) score += 3;

  if (vol > 1000000) score += 20;
  else if (vol > 500000) score += 16;
  else if (vol > 100000) score += 12;
  else if (vol > 50000) score += 8;
  else if (vol > 10000) score += 4;

  if (mcap > 0) {
    const ratio = vol / mcap;
    if (ratio > 2) score += 15;
    else if (ratio > 1) score += 12;
    else if (ratio > 0.5) score += 9;
    else if (ratio > 0.2) score += 6;
  }

  const totalTxns5m = buys5m + sells5m;
  if (totalTxns5m > 0) {
    const buyRatio = buys5m / totalTxns5m;
    if (buyRatio > 0.7 && totalTxns5m > 20) score += 15;
    else if (buyRatio > 0.6 && totalTxns5m > 10) score += 10;
    else if (buyRatio > 0.55) score += 5;
  }

  if (change5m > 20) score += 15;
  else if (change5m > 10) score += 12;
  else if (change5m > 5) score += 8;
  else if (change5m > 0) score += 4;

  if (change1h > 50) score += 10;
  else if (change1h > 20) score += 7;
  else if (change1h > 5) score += 4;

  if (age < 1) score += 10;
  else if (age < 6) score += 8;
  else if (age < 24) score += 5;
  else if (age < 72) score += 2;

  return Math.min(score, 100);
}

function getSignal(score) {
  if (score >= 75) return "STRONG_BUY";
  if (score >= 50) return "WATCH";
  if (score >= 25) return "WEAK";
  return "SKIP";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain") || "solana";
  const minScore = parseInt(searchParams.get("minScore") || "0");
  const minLiq = parseInt(searchParams.get("minLiq") || "5000");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const search = searchParams.get("q");

  try {
    let allPairs = [];

    if (search) {
      // Search mode
      const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(search)}`);
      const data = await res.json();
      allPairs = data.pairs || [];
    } else {
      // Scanner mode — pull from profiles + boosts, then enrich
      const [profilesRes, boostsRes] = await Promise.all([
        fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`),
        fetch(`${DEXSCREENER_API}/token-boosts/top/v1`),
      ]);

      const profiles = await profilesRes.json();
      const boosts = await boostsRes.json();
      const profileList = Array.isArray(profiles) ? profiles : [];
      const boostList = Array.isArray(boosts) ? boosts : [];

      // Deduplicate and filter by chain
      const tokenMap = new Map();
      [...profileList, ...boostList].forEach((t) => {
        if (t.tokenAddress && (t.chainId === chain || chain === "all")) {
          tokenMap.set(`${t.chainId}:${t.tokenAddress}`, t);
        }
      });

      const tokens = Array.from(tokenMap.values());

      // Batch fetch pair data (30 per request)
      const byChain = {};
      tokens.forEach((t) => {
        if (!byChain[t.chainId]) byChain[t.chainId] = [];
        byChain[t.chainId].push(t);
      });

      for (const [c, tks] of Object.entries(byChain)) {
        for (let i = 0; i < tks.length; i += 30) {
          const batch = tks.slice(i, i + 30);
          const addresses = batch.map((t) => t.tokenAddress).join(",");
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

    // Score, filter, sort
    const scored = allPairs
      .map((p) => {
        const score = computeScore(p);
        return {
          token: p.baseToken?.address,
          symbol: p.baseToken?.symbol,
          name: p.baseToken?.name,
          chain: p.chainId,
          dex: p.dexId,
          price: p.priceUsd,
          priceNative: p.priceNative,
          marketCap: p.marketCap || p.fdv,
          liquidity: p.liquidity?.usd,
          volume24h: p.volume?.h24,
          volume1h: p.volume?.h1,
          priceChange: {
            m5: p.priceChange?.m5,
            h1: p.priceChange?.h1,
            h6: p.priceChange?.h6,
            h24: p.priceChange?.h24,
          },
          txns: {
            m5: { buys: p.txns?.m5?.buys, sells: p.txns?.m5?.sells },
            h1: { buys: p.txns?.h1?.buys, sells: p.txns?.h1?.sells },
            h24: { buys: p.txns?.h24?.buys, sells: p.txns?.h24?.sells },
          },
          pairAddress: p.pairAddress,
          pairCreatedAt: p.pairCreatedAt,
          dexUrl: p.url,
          boosts: p.boosts?.active || 0,
          score,
          signal: getSignal(score),
        };
      })
      .filter((t) => t.score >= minScore && (t.liquidity || 0) >= minLiq)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      chain,
      count: scored.length,
      filters: { minScore, minLiq, limit },
      tokens: scored,
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error.message }, { status: 500 });
  }
}
