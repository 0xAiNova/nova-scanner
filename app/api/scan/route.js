import { NextResponse } from "next/server";

const DEXSCREENER_API = "https://api.dexscreener.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

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

  const total5m = buys5m + sells5m;
  if (total5m > 0) {
    const br = buys5m / total5m;
    if (br > 0.7 && total5m > 20) score += 15;
    else if (br > 0.6 && total5m > 10) score += 10;
    else if (br > 0.55) score += 5;
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

async function enrichBatch(chainId, addresses) {
  try {
    const res = await fetch(
      `${DEXSCREENER_API}/tokens/v1/${chainId}/${addresses.join(",")}`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
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
      const res = await fetch(
        `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(search)}`,
        { next: { revalidate: 30 } }
      );
      const data = await res.json();
      allPairs = data.pairs || [];
    } else {
      // Pull 3 sources in parallel
      const [profilesRes, topBoostsRes, latestBoostsRes] = await Promise.allSettled([
        fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`, { next: { revalidate: 30 } }),
        fetch(`${DEXSCREENER_API}/token-boosts/top/v1`, { next: { revalidate: 30 } }),
        fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`, { next: { revalidate: 30 } }),
      ]);

      const parseList = async (settled) => {
        if (settled.status !== "fulfilled" || !settled.value.ok) return [];
        const d = await settled.value.json();
        return Array.isArray(d) ? d : [];
      };

      const [profiles, topBoosts, latestBoosts] = await Promise.all([
        parseList(profilesRes),
        parseList(topBoostsRes),
        parseList(latestBoostsRes),
      ]);

      // Deduplicate by chainId:tokenAddress
      const tokenMap = new Map();
      [...profiles, ...topBoosts, ...latestBoosts].forEach((t) => {
        if (!t.tokenAddress) return;
        if (chain !== "all" && t.chainId !== chain) return;
        const key = `${t.chainId}:${t.tokenAddress}`;
        if (!tokenMap.has(key)) tokenMap.set(key, t);
      });

      // Group by chain, batch enrich in parallel (30/req)
      const byChain = {};
      for (const t of tokenMap.values()) {
        if (!byChain[t.chainId]) byChain[t.chainId] = [];
        byChain[t.chainId].push(t.tokenAddress);
      }

      const enrichPromises = [];
      for (const [chainId, addrs] of Object.entries(byChain)) {
        for (let i = 0; i < addrs.length; i += 30) {
          enrichPromises.push(enrichBatch(chainId, addrs.slice(i, i + 30)));
        }
      }

      const results = await Promise.all(enrichPromises);
      allPairs = results.flat();
    }

    const scored = allPairs
      .filter((p) => p.baseToken?.address)
      .map((p) => {
        const score = computeScore(p);
        return {
          token: p.baseToken.address,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          chain: p.chainId,
          dex: p.dexId,
          price: p.priceUsd,
          marketCap: p.marketCap || p.fdv || null,
          liquidity: p.liquidity?.usd || null,
          volume24h: p.volume?.h24 || null,
          volume1h: p.volume?.h1 || null,
          priceChange: {
            m5: p.priceChange?.m5 ?? null,
            h1: p.priceChange?.h1 ?? null,
            h6: p.priceChange?.h6 ?? null,
            h24: p.priceChange?.h24 ?? null,
          },
          txns: {
            m5: { buys: p.txns?.m5?.buys ?? 0, sells: p.txns?.m5?.sells ?? 0 },
            h1: { buys: p.txns?.h1?.buys ?? 0, sells: p.txns?.h1?.sells ?? 0 },
            h24: { buys: p.txns?.h24?.buys ?? 0, sells: p.txns?.h24?.sells ?? 0 },
          },
          pairAddress: p.pairAddress,
          ageHours: p.pairCreatedAt
            ? Math.round(((Date.now() - p.pairCreatedAt) / 3600000) * 10) / 10
            : null,
          dexUrl: p.url,
          boosts: p.boosts?.active || 0,
          score,
          signal: getSignal(score),
        };
      })
      .filter((t) => t.score >= minScore && (t.liquidity || 0) >= minLiq)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        chain,
        count: scored.length,
        filters: { minScore, minLiq, limit },
        tokens: scored,
      },
      { headers: CORS }
    );
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: 500, headers: CORS }
    );
  }
}
