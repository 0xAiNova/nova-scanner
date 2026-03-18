import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───
const DEXSCREENER_API = "https://api.dexscreener.com";
const WS_URL = "wss://api.dexscreener.com";
const REFRESH_INTERVAL = 30000; // 30s for REST polling
const CHAINS = ["solana", "ethereum", "base", "bsc", "arbitrum", "avalanche", "polygon", "sui", "ton", "tron"];

// ─── Utility Functions ───
const fmt = (n, decimals = 2) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(decimals)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(decimals)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(decimals)}K`;
  return `$${Number(n).toFixed(decimals)}`;
};

const fmtPrice = (p) => {
  if (!p) return "—";
  const n = Number(p);
  if (n < 0.00001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};

const fmtAge = (ts) => {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
};

const pctClass = (v) => (v > 0 ? "pct-up" : v < 0 ? "pct-down" : "pct-flat");
const pctFmt = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

const computeScore = (pair) => {
  if (pair._score != null) return pair._score;
  let score = 0;
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const mcap = pair.marketCap || pair.fdv || 0;
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const change5m = pair.priceChange?.m5 || 0;
  const change1h = pair.priceChange?.h1 || 0;
  const boosts = pair.boosts?.active || 0;
  const age = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : 999;

  // Liquidity score (0-15)
  if (liq > 100000) score += 15;
  else if (liq > 50000) score += 12;
  else if (liq > 20000) score += 9;
  else if (liq > 10000) score += 6;
  else if (liq > 5000) score += 3;

  // Volume score (0-20)
  if (vol > 1000000) score += 20;
  else if (vol > 500000) score += 16;
  else if (vol > 100000) score += 12;
  else if (vol > 50000) score += 8;
  else if (vol > 10000) score += 4;

  // Volume/MCap ratio (0-15)
  if (mcap > 0) {
    const ratio = vol / mcap;
    if (ratio > 2) score += 15;
    else if (ratio > 1) score += 12;
    else if (ratio > 0.5) score += 9;
    else if (ratio > 0.2) score += 6;
  }

  // Buy pressure (0-15)
  const totalTxns5m = buys5m + sells5m;
  if (totalTxns5m > 0) {
    const buyRatio = buys5m / totalTxns5m;
    if (buyRatio > 0.7 && totalTxns5m > 20) score += 15;
    else if (buyRatio > 0.6 && totalTxns5m > 10) score += 10;
    else if (buyRatio > 0.55) score += 5;
  }

  // Momentum (0-15)
  if (change5m > 20) score += 15;
  else if (change5m > 10) score += 12;
  else if (change5m > 5) score += 8;
  else if (change5m > 0) score += 4;

  // 1h trend bonus (0-10)
  if (change1h > 50) score += 10;
  else if (change1h > 20) score += 7;
  else if (change1h > 5) score += 4;

  // Freshness bonus (0-10) — newer is better for memecoins
  if (age < 1) score += 10;
  else if (age < 6) score += 8;
  else if (age < 24) score += 5;
  else if (age < 72) score += 2;

  return Math.min(score, 100);
};

const getScoreLabel = (s) => {
  if (s >= 75) return { label: "STRONG", cls: "score-strong" };
  if (s >= 50) return { label: "WATCH", cls: "score-watch" };
  if (s >= 25) return { label: "WEAK", cls: "score-weak" };
  return { label: "SKIP", cls: "score-skip" };
};

// ─── API Functions ───
async function fetchScannerData(chain, search = null, limit = 100) {
  const params = new URLSearchParams({ chain, limit, minLiq: 5000 });
  if (search) params.set("q", search);
  const res = await fetch(`/api/scan?${params}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.tokens || [];
}

function normalizeToPair(t) {
  return {
    baseToken: { address: t.token, symbol: t.symbol, name: t.name },
    chainId: t.chain,
    dexId: t.dex,
    priceUsd: t.price,
    priceNative: t.priceNative,
    marketCap: t.marketCap,
    fdv: t.marketCap,
    liquidity: { usd: t.liquidity },
    volume: { h24: t.volume24h, h1: t.volume1h, h6: null },
    priceChange: t.priceChange,
    txns: t.txns,
    pairAddress: t.pairAddress,
    pairCreatedAt: t.pairCreatedAt,
    url: t.dexUrl,
    boosts: { active: t.boosts },
    info: { imageUrl: null, socials: [], websites: [] },
    _score: t.score,
    _signal: t.signal,
  };
}

// ─── Components ───

function ScoreBadge({ score }) {
  const { label, cls } = getScoreLabel(score);
  return (
    <div className={`score-badge ${cls}`}>
      <span className="score-num">{score}</span>
      <span className="score-lbl">{label}</span>
    </div>
  );
}

function TokenRow({ pair, rank, onSelect }) {
  const score = computeScore(pair);
  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const totalTxns5m = buys5m + sells5m;
  const buyPressure = totalTxns5m > 0 ? ((buys5m / totalTxns5m) * 100).toFixed(0) : "—";

  return (
    <tr className={score >= 75 ? "row-hot" : ""} onClick={() => onSelect(pair)}>
      <td className="col-rank">{rank}</td>
      <td className="col-token">
        <div className="token-info">
          {pair.info?.imageUrl && <img src={pair.info.imageUrl} alt="" className="token-icon" />}
          <div>
            <span className="token-symbol">${pair.baseToken?.symbol || "?"}</span>
            <span className="token-name">{pair.baseToken?.name || "Unknown"}</span>
          </div>
        </div>
      </td>
      <td className="col-chain">
        <span className="chain-tag">{pair.chainId || "?"}</span>
      </td>
      <td className="col-price">{fmtPrice(pair.priceUsd)}</td>
      <td className={`col-change ${pctClass(pair.priceChange?.m5)}`}>{pctFmt(pair.priceChange?.m5)}</td>
      <td className={`col-change ${pctClass(pair.priceChange?.h1)}`}>{pctFmt(pair.priceChange?.h1)}</td>
      <td className={`col-change ${pctClass(pair.priceChange?.h24)}`}>{pctFmt(pair.priceChange?.h24)}</td>
      <td className="col-vol">{fmt(pair.volume?.h24)}</td>
      <td className="col-liq">{fmt(pair.liquidity?.usd)}</td>
      <td className="col-mcap">{fmt(pair.marketCap || pair.fdv)}</td>
      <td className="col-txns">
        <span className="txn-buys">{buys5m}B</span>/<span className="txn-sells">{sells5m}S</span>
        <div className="buy-pressure-bar">
          <div className="buy-fill" style={{ width: `${buyPressure}%` }}></div>
        </div>
      </td>
      <td className="col-age">{fmtAge(pair.pairCreatedAt)}</td>
      <td className="col-score">
        <ScoreBadge score={score} />
      </td>
    </tr>
  );
}

function DetailPanel({ pair, onClose }) {
  if (!pair) return null;
  const score = computeScore(pair);
  const { label } = getScoreLabel(score);
  const buys = { m5: pair.txns?.m5?.buys || 0, h1: pair.txns?.h1?.buys || 0, h24: pair.txns?.h24?.buys || 0 };
  const sells = { m5: pair.txns?.m5?.sells || 0, h1: pair.txns?.h1?.sells || 0, h24: pair.txns?.h24?.sells || 0 };

  const jsonExport = {
    token: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol,
    chain: pair.chainId,
    price: pair.priceUsd,
    mcap: pair.marketCap || pair.fdv,
    liquidity: pair.liquidity?.usd,
    volume_24h: pair.volume?.h24,
    score,
    signal: label,
    priceChange: pair.priceChange,
    txns: pair.txns,
    dexUrl: pair.url,
    pairAddress: pair.pairAddress,
    timestamp: new Date().toISOString(),
  };

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose}>✕</button>
        <div className="detail-header">
          {pair.info?.imageUrl && <img src={pair.info.imageUrl} alt="" className="detail-icon" />}
          <div>
            <h2>${pair.baseToken?.symbol}</h2>
            <p className="detail-name">{pair.baseToken?.name}</p>
            <span className="chain-tag">{pair.chainId}</span>
          </div>
          <ScoreBadge score={score} />
        </div>

        <div className="detail-grid">
          <div className="detail-card">
            <label>Price</label>
            <span>{fmtPrice(pair.priceUsd)}</span>
          </div>
          <div className="detail-card">
            <label>Market Cap</label>
            <span>{fmt(pair.marketCap || pair.fdv)}</span>
          </div>
          <div className="detail-card">
            <label>Liquidity</label>
            <span>{fmt(pair.liquidity?.usd)}</span>
          </div>
          <div className="detail-card">
            <label>24h Volume</label>
            <span>{fmt(pair.volume?.h24)}</span>
          </div>
        </div>

        <div className="detail-section">
          <h3>Price Changes</h3>
          <div className="change-row">
            <span>5m</span><span className={pctClass(pair.priceChange?.m5)}>{pctFmt(pair.priceChange?.m5)}</span>
            <span>1h</span><span className={pctClass(pair.priceChange?.h1)}>{pctFmt(pair.priceChange?.h1)}</span>
            <span>6h</span><span className={pctClass(pair.priceChange?.h6)}>{pctFmt(pair.priceChange?.h6)}</span>
            <span>24h</span><span className={pctClass(pair.priceChange?.h24)}>{pctFmt(pair.priceChange?.h24)}</span>
          </div>
        </div>

        <div className="detail-section">
          <h3>Transactions</h3>
          <table className="txn-table">
            <thead><tr><th></th><th>5m</th><th>1h</th><th>24h</th></tr></thead>
            <tbody>
              <tr><td>Buys</td><td className="txn-buys">{buys.m5}</td><td className="txn-buys">{buys.h1}</td><td className="txn-buys">{buys.h24}</td></tr>
              <tr><td>Sells</td><td className="txn-sells">{sells.m5}</td><td className="txn-sells">{sells.h1}</td><td className="txn-sells">{sells.h24}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="detail-section">
          <h3>Links</h3>
          <div className="detail-links">
            {pair.url && <a href={pair.url} target="_blank" rel="noopener noreferrer">DexScreener</a>}
            {pair.baseToken?.address && (
              <a href={`https://solscan.io/token/${pair.baseToken.address}`} target="_blank" rel="noopener noreferrer">Solscan</a>
            )}
            {pair.info?.socials?.map((s, i) => (
              <a key={i} href={s.handle?.startsWith("http") ? s.handle : `https://${s.platform}.com/${s.handle}`} target="_blank" rel="noopener noreferrer">{s.platform}</a>
            ))}
          </div>
        </div>

        <div className="detail-section">
          <h3>AI Agent JSON Export</h3>
          <pre className="json-export">{JSON.stringify(jsonExport, null, 2)}</pre>
          <button className="copy-btn" onClick={() => navigator.clipboard.writeText(JSON.stringify(jsonExport, null, 2))}>
            Copy JSON
          </button>
        </div>

        <div className="detail-address">
          <label>Token Address</label>
          <code onClick={() => navigator.clipboard.writeText(pair.baseToken?.address || "")}>{pair.baseToken?.address}</code>
          <label>Pair Address</label>
          <code onClick={() => navigator.clipboard.writeText(pair.pairAddress || "")}>{pair.pairAddress}</code>
        </div>
      </div>
    </div>
  );
}

function AgentDocs() {
  return (
    <div className="agent-docs">
      <h3>⚡ AI Agent API — Machine-Readable Token Intelligence</h3>
      <p>Nova Scanner exposes structured JSON endpoints optimized for AI agents, trading bots, and automation pipelines.</p>
      <div className="docs-grid">
        <div className="doc-card">
          <h4>GET /api/scan</h4>
          <p>Raw scored token list. Good for simple integrations. Returns symbol, price, score, signal, txns, and market data.</p>
          <code>/api/scan?chain=solana&minScore=50&limit=50</code>
        </div>
        <div className="doc-card">
          <h4>GET /api/ai</h4>
          <p>Full AI-optimized response with scoring breakdown, risk flags, action recommendations, pre-computed ratios, and agent usage hints.</p>
          <code>/api/ai?chain=solana&action=BUY&format=full</code>
        </div>
        <div className="doc-card">
          <h4>Compact Format</h4>
          <p>Minimal token data — ideal for high-frequency polling by agents that need speed over detail.</p>
          <code>/api/ai?format=compact&minScore=75</code>
        </div>
        <div className="doc-card">
          <h4>Actions Only</h4>
          <p>Returns just action + confidence + flags per token. Zero noise — built for decision agents that act on signals directly.</p>
          <code>/api/ai?format=actions_only&action=BUY</code>
        </div>
        <div className="doc-card">
          <h4>Search by Token</h4>
          <p>Search any token by symbol, name, or address. Returns scored results with full market snapshot.</p>
          <code>/api/ai?q=BONK&format=full</code>
        </div>
        <div className="doc-card">
          <h4>Score Guide</h4>
          <p>75–100: STRONG BUY · 50–74: WATCH · 25–49: WEAK · 0–24: SKIP. Risk levels: LOW / MEDIUM / HIGH based on flag detection.</p>
          <code>/api/ai?chain=solana&minScore=75&action=BUY</code>
        </div>
      </div>
    </div>
  );
}

function WsStatusDot({ connected }) {
  return <span className={`ws-dot ${connected ? "ws-live" : "ws-off"}`} title={connected ? "WebSocket Connected" : "WebSocket Disconnected"}></span>;
}

// ─── Main App ───
export default function App() {
  const [view, setView] = useState("scanner"); // scanner | boosted | search
  const [pairs, setPairs] = useState([]);
  const [boostedTokens, setBoostedTokens] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [chainFilter, setChainFilter] = useState("all");
  const [minLiq, setMinLiq] = useState(5000);
  const [minScore, setMinScore] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsEvents, setWsEvents] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);

  // ─── WebSocket Connection ───
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket(`${WS_URL}/token-boosts/latest/v1`);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connectWs, 5000);
      };
      ws.onerror = () => setWsConnected(false);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const items = Array.isArray(data) ? data : data?.data || [data];
          setWsEvents((prev) => [...items.slice(0, 5), ...prev].slice(0, 50));
        } catch (e) {
          console.warn("WS parse error", e);
        }
      };
      wsRef.current = ws;
    } catch (e) {
      console.warn("WS connect failed", e);
    }
  }, []);

  // ─── Data Loading ───
  const loadScannerData = useCallback(async () => {
    try {
      setError(null);
      const chain = chainFilter === "all" ? "solana" : chainFilter;
      const rawTokens = await fetchScannerData(chain);
      const fetchedPairs = rawTokens.map(normalizeToPair);
      setPairs(fetchedPairs);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
      console.error("Load error:", e);
    } finally {
      setLoading(false);
    }
  }, [chainFilter]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const rawTokens = await fetchScannerData("solana", searchQuery);
      setSearchResults(rawTokens.map(normalizeToPair));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadScannerData();
    connectWs();
    intervalRef.current = setInterval(loadScannerData, REFRESH_INTERVAL);
    return () => {
      clearInterval(intervalRef.current);
      wsRef.current?.close();
    };
  }, [loadScannerData, connectWs]);

  // ─── Sorting & Filtering ───
  const sortPairs = (list) => {
    return [...list].sort((a, b) => {
      let va, vb;
      switch (sortField) {
        case "score": va = computeScore(a); vb = computeScore(b); break;
        case "volume": va = a.volume?.h24 || 0; vb = b.volume?.h24 || 0; break;
        case "liquidity": va = a.liquidity?.usd || 0; vb = b.liquidity?.usd || 0; break;
        case "mcap": va = a.marketCap || a.fdv || 0; vb = b.marketCap || b.fdv || 0; break;
        case "change5m": va = a.priceChange?.m5 || 0; vb = b.priceChange?.m5 || 0; break;
        case "change1h": va = a.priceChange?.h1 || 0; vb = b.priceChange?.h1 || 0; break;
        case "change24h": va = a.priceChange?.h24 || 0; vb = b.priceChange?.h24 || 0; break;
        case "age": va = a.pairCreatedAt || 0; vb = b.pairCreatedAt || 0; break;
        default: va = computeScore(a); vb = computeScore(b);
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  };

  const filterPairs = (list) =>
    list.filter((p) => {
      if (chainFilter !== "all" && p.chainId !== chainFilter) return false;
      if ((p.liquidity?.usd || 0) < minLiq) return false;
      if (computeScore(p) < minScore) return false;
      return true;
    });

  const handleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const displayPairs = view === "search" ? sortPairs(filterPairs(searchResults)) : sortPairs(filterPairs(pairs));

  const exportAllJSON = () => {
    const data = displayPairs.map((p) => ({
      token: p.baseToken?.address,
      symbol: p.baseToken?.symbol,
      chain: p.chainId,
      price: p.priceUsd,
      mcap: p.marketCap || p.fdv,
      liquidity: p.liquidity?.usd,
      volume_24h: p.volume?.h24,
      score: computeScore(p),
      signal: getScoreLabel(computeScore(p)).label,
      priceChange: p.priceChange,
      txns: p.txns,
      dexUrl: p.url,
      pairAddress: p.pairAddress,
    }));
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const SortHeader = ({ field, children }) => (
    <th onClick={() => handleSort(field)} className={`sortable ${sortField === field ? "sorted" : ""}`}>
      {children} {sortField === field ? (sortDir === "desc" ? "▾" : "▴") : ""}
    </th>
  );

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">
            <span className="logo-icon">◈</span> NOVA SCANNER
          </h1>
          <WsStatusDot connected={wsConnected} />
          <span className="header-sub">DexScreener Token Intelligence</span>
        </div>
        <div className="header-right">
          {lastRefresh && <span className="last-refresh">Updated {lastRefresh.toLocaleTimeString()}</span>}
          <button className="btn-refresh" onClick={loadScannerData} disabled={loading}>
            {loading ? "↻ Scanning..." : "↻ Refresh"}
          </button>
          <button className="btn-export" onClick={exportAllJSON}>⎘ Export JSON</button>
        </div>
      </header>

      {/* Nav Tabs */}
      <nav className="nav-tabs">
        <button className={view === "scanner" ? "tab active" : "tab"} onClick={() => setView("scanner")}>
          ◉ Live Scanner
        </button>
        <button className={view === "boosted" ? "tab active" : "tab"} onClick={() => setView("boosted")}>
          ⚡ Boosted Feed
        </button>
        <button className={view === "search" ? "tab active" : "tab"} onClick={() => setView("search")}>
          ⌕ Search
        </button>
      </nav>

      {/* Filters Bar */}
      <div className="filters-bar">
        <div className="filter-group">
          <label>Chain</label>
          <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)}>
            <option value="all">All Chains</option>
            {CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Min Liquidity</label>
          <select value={minLiq} onChange={(e) => setMinLiq(Number(e.target.value))}>
            <option value={0}>Any</option>
            <option value={1000}>$1K+</option>
            <option value={5000}>$5K+</option>
            <option value={10000}>$10K+</option>
            <option value={50000}>$50K+</option>
            <option value={100000}>$100K+</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Min Score</label>
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            <option value={0}>All</option>
            <option value={25}>25+</option>
            <option value={50}>50+ (Watch)</option>
            <option value={75}>75+ (Strong)</option>
          </select>
        </div>
        {view === "search" && (
          <div className="filter-group search-group">
            <input
              type="text"
              placeholder="Search token name, symbol, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button onClick={handleSearch} disabled={loading}>Search</button>
          </div>
        )}
        <div className="filter-stat">
          <span>{displayPairs.length} tokens</span>
        </div>
      </div>

      {error && <div className="error-bar">⚠ {error}</div>}

      {/* Boosted Feed (WebSocket events) */}
      {view === "boosted" && wsEvents.length > 0 && (
        <div className="ws-feed">
          <h3>⚡ Live Boost Feed <WsStatusDot connected={wsConnected} /></h3>
          <div className="ws-events">
            {wsEvents.map((ev, i) => (
              <div key={i} className="ws-event">
                <span className="ws-chain">{ev.chainId}</span>
                <span className="ws-addr" title={ev.tokenAddress}>
                  {ev.tokenAddress?.slice(0, 6)}...{ev.tokenAddress?.slice(-4)}
                </span>
                {ev.totalAmount && <span className="ws-boost">🔥 {ev.totalAmount} boosts</span>}
                {ev.description && <span className="ws-desc">{ev.description.slice(0, 60)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Table */}
      <div className="table-wrap">
        {loading && pairs.length === 0 ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Scanning DexScreener feeds...</p>
          </div>
        ) : (
          <table className="scanner-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Token</th>
                <th>Chain</th>
                <th>Price</th>
                <SortHeader field="change5m">5m</SortHeader>
                <SortHeader field="change1h">1h</SortHeader>
                <SortHeader field="change24h">24h</SortHeader>
                <SortHeader field="volume">Vol 24h</SortHeader>
                <SortHeader field="liquidity">Liquidity</SortHeader>
                <SortHeader field="mcap">MCap</SortHeader>
                <th>5m Txns</th>
                <SortHeader field="age">Age</SortHeader>
                <SortHeader field="score">Score</SortHeader>
              </tr>
            </thead>
            <tbody>
              {displayPairs.length === 0 ? (
                <tr><td colSpan={13} className="empty-row">No tokens match current filters</td></tr>
              ) : (
                displayPairs.map((p, i) => (
                  <TokenRow key={`${p.pairAddress}-${i}`} pair={p} rank={i + 1} onSelect={setSelectedPair} />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* API Reference Footer */}
      <footer className="footer">
        <div className="api-endpoints">
          <h4>API Endpoints for AI Agent Integration</h4>
          <div className="endpoint-grid">
            <code>GET /token-profiles/latest/v1</code>
            <code>GET /token-boosts/top/v1</code>
            <code>GET /token-boosts/latest/v1</code>
            <code>GET /tokens/v1/&#123;chain&#125;/&#123;addresses&#125;</code>
            <code>GET /latest/dex/search?q=&#123;query&#125;</code>
            <code>WSS /token-boosts/latest/v1</code>
          </div>
        </div>
        <p>NOVA SCANNER · Powered by DexScreener Public API · Data refreshes every 30s · Not financial advice</p>
      </footer>

      {/* Detail Panel */}
      <DetailPanel pair={selectedPair} onClose={() => setSelectedPair(null)} />
      <AgentDocs />
    </div>
  );
}
