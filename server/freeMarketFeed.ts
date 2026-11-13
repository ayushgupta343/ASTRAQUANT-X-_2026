import { CandleRow } from './quant.ts';

export type MarketFeedMode = 'historical_csv' | 'simulated_replay' | 'free_live_nse';

export const YAHOO_BANKNIFTY_1D_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=1d';
export const YAHOO_BANKNIFTY_5D_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?interval=5m&range=5d';

export function normalizeFeedMode(raw?: string | null): MarketFeedMode {
  if (raw === 'simulated_replay') return 'simulated_replay';
  if (raw === 'free_live_nse') return 'free_live_nse';
  return 'historical_csv';
}

export interface LiveYahooFeedResult {
  ok: boolean;
  candles: CandleRow[];
  spotPrice: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  marketState: string;
  isMarketOpen: boolean;
  fetchedAt: string;
  sourceUrl: string;
  warning: string | null;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        marketState?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

function unixToIstDateAndTime(unixSec: number): { dateStr: string; timeStr: string } {
  const istMs = unixSec * 1000 + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
  };
}

function extractCandlesFromYahooResult(
  result: NonNullable<NonNullable<YahooChartResponse['chart']>['result']>[number]
): CandleRow[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) return [];

  const opens = quote.open ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  const byTs = new Map<number, CandleRow>();

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    if (
      ts == null ||
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      o <= 0 ||
      h <= 0 ||
      l <= 0 ||
      c <= 0
    ) {
      continue;
    }

    const { dateStr, timeStr } = unixToIstDateAndTime(ts);
    const fixedOpen = Number(o.toFixed(2));
    const fixedClose = Number(c.toFixed(2));
    const fixedHigh = Number(Math.max(h, fixedOpen, fixedClose).toFixed(2));
    const fixedLow = Number(Math.min(l, fixedOpen, fixedClose).toFixed(2));
    const fixedVol = v !== null && v !== undefined && !Number.isNaN(v) ? Math.max(0, Math.round(v)) : null;

    byTs.set(ts, {
      timestamp: ts,
      date_str: dateStr,
      time_str: timeStr,
      open: fixedOpen,
      high: fixedHigh,
      low: fixedLow,
      close: fixedClose,
      volume: fixedVol,
      is_valid: 1,
    });
  }

  return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchYahooJson(url: string): Promise<YahooChartResponse> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Yahoo Finance returned HTTP ${res.status}`);
  }
  return (await res.json()) as YahooChartResponse;
}

// In-memory Yahoo cache to prevent excessive upstream hits during SSE ticks
let cachedLiveResult: LiveYahooFeedResult | null = null;
let lastLiveFetchMs = 0;
let cachedWarmupCandles: CandleRow[] = [];
let lastWarmupFetchMs = 0;

export async function getLiveYahooBankNifty(force = false): Promise<LiveYahooFeedResult> {
  const nowMs = Date.now();
  if (!force && cachedLiveResult && nowMs - lastLiveFetchMs < 8500) {
    return cachedLiveResult;
  }

  try {
    // Warm up 5-day 5m history at most every 5 minutes so SMA(50)/MACD(12,26,9) have full context
    if (cachedWarmupCandles.length === 0 || nowMs - lastWarmupFetchMs > 5 * 60 * 1000) {
      try {
        const warmupJson = await fetchYahooJson(YAHOO_BANKNIFTY_5D_URL);
        const warmupRes = warmupJson?.chart?.result?.[0];
        if (warmupRes) {
          cachedWarmupCandles = extractCandlesFromYahooResult(warmupRes);
          lastWarmupFetchMs = nowMs;
        }
      } catch {
        // Non-fatal: 1d intraday fetch still runs below
      }
    }

    let json1d: YahooChartResponse;
    try {
      json1d = await fetchYahooJson(YAHOO_BANKNIFTY_1D_URL);
    } catch {
      json1d = await fetchYahooJson(
        YAHOO_BANKNIFTY_1D_URL.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com')
      );
    }

    const res1d = json1d?.chart?.result?.[0];
    if (!res1d) {
      throw new Error(json1d?.chart?.error?.description || 'Empty Yahoo Finance chart result for ^NSEBANK');
    }

    const candles1d = extractCandlesFromYahooResult(res1d);
    const mergedMap = new Map<number, CandleRow>();
    for (const c of cachedWarmupCandles) mergedMap.set(c.timestamp, c);
    for (const c of candles1d) mergedMap.set(c.timestamp, c);
    const merged = Array.from(mergedMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    if (merged.length === 0) {
      throw new Error('No OHLC candles returned from Yahoo Finance for ^NSEBANK.');
    }

    const latestBar = merged[merged.length - 1];
    const meta = res1d.meta ?? {};
    const spotPrice = Number((meta.regularMarketPrice ?? latestBar.close).toFixed(2));
    const prevClose = Number(
      (meta.chartPreviousClose ?? meta.previousClose ?? latestBar.open).toFixed(2)
    );

    const latestSessionDate = latestBar.date_str;
    const sessionBars = merged.filter((c) => c.date_str === latestSessionDate);
    const calcHigh = sessionBars.reduce((m, c) => Math.max(m, c.high), latestBar.high);
    const calcLow = sessionBars.reduce((m, c) => Math.min(m, c.low), latestBar.low);
    const dayHigh = Number((meta.regularMarketDayHigh ?? calcHigh).toFixed(2));
    const dayLow = Number((meta.regularMarketDayLow ?? calcLow).toFixed(2));

    // Align latest candle close with live regularMarketPrice if same session
    if (candles1d.length > 0 && spotPrice > 0) {
      const last = merged[merged.length - 1];
      merged[merged.length - 1] = {
        ...last,
        close: spotPrice,
        high: Number(Math.max(last.high, spotPrice).toFixed(2)),
        low: Number(Math.min(last.low, spotPrice).toFixed(2)),
      };
    }

    const rawState = (meta.marketState ?? '').toUpperCase();
    const isMarketOpen = rawState === 'REGULAR';
    const marketState = isMarketOpen
      ? 'NSE Live Session Open (^NSEBANK)'
      : 'NSE Session Closed · Latest ^NSEBANK Intraday Session';

    const result: LiveYahooFeedResult = {
      ok: true,
      candles: merged,
      spotPrice,
      prevClose,
      dayHigh,
      dayLow,
      marketState,
      isMarketOpen,
      fetchedAt: new Date().toISOString(),
      sourceUrl: YAHOO_BANKNIFTY_1D_URL,
      warning: null,
    };

    cachedLiveResult = result;
    lastLiveFetchMs = nowMs;
    return result;
  } catch (err) {
    const errMsg = (err as Error).message || 'Unable to reach Yahoo Finance ^NSEBANK feed.';
    if (cachedLiveResult) {
      return {
        ...cachedLiveResult,
        ok: false,
        warning: `Yahoo Finance refresh delayed (${errMsg}). Displaying last cached ^NSEBANK snapshot.`,
      };
    }
    return {
      ok: false,
      candles: [],
      spotPrice: 0,
      prevClose: 0,
      dayHigh: 0,
      dayLow: 0,
      marketState: 'Feed Unavailable',
      isMarketOpen: false,
      fetchedAt: new Date().toISOString(),
      sourceUrl: YAHOO_BANKNIFTY_1D_URL,
      warning: `Could not reach Yahoo Finance public endpoint (${errMsg}).`,
    };
  }
}

// ============================================================================
// SIMULATED LIVE TICK REPLAY ENGINE (24/7 Historical CSV Tick Stream)
// ============================================================================
interface ReplayState {
  datasetId: number;
  allCandles: CandleRow[];
  warmupEndIndex: number;
  cursorIndex: number;
  subStep: 0 | 1 | 2;
  tickSeq: number;
}

let replayState: ReplayState | null = null;

export function syncReplayBase(datasetId: number, allCandles: CandleRow[]) {
  if (allCandles.length === 0) {
    replayState = null;
    return;
  }
  const needsInit =
    !replayState ||
    replayState.datasetId !== datasetId ||
    replayState.allCandles.length !== allCandles.length;

  if (needsInit) {
    const warmupEndIndex =
      allCandles.length > 100
        ? Math.max(60, allCandles.length - 75)
        : Math.max(10, Math.floor(allCandles.length * 0.6));
    replayState = {
      datasetId,
      allCandles,
      warmupEndIndex: Math.min(warmupEndIndex, allCandles.length - 1),
      cursorIndex: Math.min(warmupEndIndex, allCandles.length - 1),
      subStep: 0,
      tickSeq: 1,
    };
  }
}

export function resetReplayEngine() {
  if (!replayState) return;
  replayState.cursorIndex = replayState.warmupEndIndex;
  replayState.subStep = 0;
  replayState.tickSeq += 1;
}

export function advanceReplayTick(): { isBarComplete: boolean; tickSeq: number } {
  if (!replayState || replayState.allCandles.length === 0) {
    return { isBarComplete: false, tickSeq: 0 };
  }

  replayState.tickSeq += 1;
  if (replayState.subStep < 2) {
    replayState.subStep = (replayState.subStep + 1) as 0 | 1 | 2;
    return { isBarComplete: replayState.subStep === 2, tickSeq: replayState.tickSeq };
  }

  // Advance to next 5m candle (wrap around smoothly for 24/7 continuous testing)
  replayState.subStep = 0;
  if (replayState.cursorIndex + 1 < replayState.allCandles.length) {
    replayState.cursorIndex += 1;
  } else {
    replayState.cursorIndex = replayState.warmupEndIndex;
  }
  return { isBarComplete: false, tickSeq: replayState.tickSeq };
}

export function getReplaySnapshot(): {
  candles: CandleRow[];
  isBarComplete: boolean;
  tickSeq: number;
  replayProgress: string;
} {
  if (!replayState || replayState.allCandles.length === 0) {
    return {
      candles: [],
      isBarComplete: false,
      tickSeq: 0,
      replayProgress: '0/0',
    };
  }

  const { allCandles, cursorIndex, subStep, warmupEndIndex, tickSeq } = replayState;
  const completedPrefix = allCandles.slice(0, cursorIndex);
  const target = allCandles[cursorIndex];

  let activeBar: CandleRow = target;
  if (subStep === 0) {
    const partialClose = Number((target.open + (target.close - target.open) * 0.3).toFixed(2));
    const upperWick = (target.high - Math.max(target.open, target.close)) * 0.35;
    const lowerWick = (Math.min(target.open, target.close) - target.low) * 0.35;
    activeBar = {
      ...target,
      close: partialClose,
      high: Number((Math.max(target.open, partialClose) + upperWick).toFixed(2)),
      low: Number((Math.min(target.open, partialClose) - lowerWick).toFixed(2)),
      volume: target.volume !== null ? Math.round(target.volume * 0.35) : null,
    };
  } else if (subStep === 1) {
    const partialClose = Number((target.open + (target.close - target.open) * 0.68).toFixed(2));
    const upperWick = (target.high - Math.max(target.open, target.close)) * 0.8;
    const lowerWick = (Math.min(target.open, target.close) - target.low) * 0.8;
    activeBar = {
      ...target,
      close: partialClose,
      high: Number((Math.max(target.open, partialClose) + upperWick).toFixed(2)),
      low: Number((Math.min(target.open, partialClose) - lowerWick).toFixed(2)),
      volume: target.volume !== null ? Math.round(target.volume * 0.7) : null,
    };
  }

  const totalReplayBars = Math.max(1, allCandles.length - warmupEndIndex);
  const currentStepBar = Math.min(totalReplayBars, cursorIndex - warmupEndIndex + 1);

  return {
    candles: [...completedPrefix, activeBar],
    isBarComplete: subStep === 2,
    tickSeq,
    replayProgress: `Bar ${currentStepBar}/${totalReplayBars} (Tick ${subStep + 1}/3)`,
  };
}
