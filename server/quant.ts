export interface CandleRow {
  timestamp: number; // Unix seconds (UTC-aligned or IST epoch seconds)
  date_str: string;  // YYYY-MM-DD
  time_str: string;  // HH:MM
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  is_valid?: number;
}

export interface EnrichedCandle extends CandleRow {
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  ema20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema21: number | null;
  ema5: number | null;
  ema9Ema21SpreadPct: number | null;
  return1: number | null;
  return3: number | null;
  volatility: number | null;
  candleBody: number;
  candleRange: number;
  relVolume: number | null;
  vwap: number | null;
  vwapDistance: number | null;
  atr: number | null;
  atrNormRange: number | null;
  adx: number | null;
  htfEma20Slope: number | null;
  htfRsi14: number | null;
  mtfConfluenceScore: number | null;
  rsiMomentumSlope: number | null;
  macdHistAccel: number | null;
  timeSin: number;
  timeCos: number;
}

export interface ValidationReport {
  totalRows: number;
  missingCount: number;
  duplicateCount: number;
  invalidOhlcCount: number;
  hasVolume: boolean;
  startDate: string;
  endDate: string;
  issues: Array<{ row: number; reason: string; date?: string; time?: string }>;
}

/**
 * Computes Exponential Moving Average over numeric series (ignoring leading nulls).
 */
export function computeEMA(values: Array<number | null>, period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema: number | null = null;
  const validRun: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) {
      result[i] = null;
      continue;
    }
    if (ema === null) {
      validRun.push(v);
      if (validRun.length === period) {
        ema = validRun.reduce((acc, x) => acc + x, 0) / period;
        result[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      result[i] = ema;
    }
  }
  return result;
}

/**
 * Computes Simple Moving Average over numeric series.
 */
export function computeSMA(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

/**
 * Computes Wilder's RSI(14) causally (no look-ahead).
 */
export function computeRSI(closes: number[], period = 14): Array<number | null> {
  const result: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

/**
 * Computes MACD (12, 26, 9) causally.
 */
export function computeMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = computeEMA(closes, fast);
  const emaSlow = computeEMA(closes, slow);
  const macdLine: Array<number | null> = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null
  );
  const signalLine = computeEMA(macdLine, signalPeriod);
  const histLine: Array<number | null> = macdLine.map((m, i) =>
    m !== null && signalLine[i] !== null ? m - signalLine[i]! : null
  );
  return { macdLine, signalLine, histLine };
}

/**
 * Computes Wilder's ATR(14) causally.
 */
export function computeATR(candles: CandleRow[], period = 14): Array<number | null> {
  const atr: Array<number | null> = new Array(candles.length).fill(null);
  if (candles.length < period) return atr;

  const tr: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    if (i === 0) {
      tr[i] = hl;
    } else {
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(hl, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
    }
  }

  let sumTr = 0;
  for (let i = 0; i < period; i++) sumTr += tr[i];
  let prevAtr = sumTr / period;
  atr[period - 1] = prevAtr;

  for (let i = period; i < candles.length; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atr[i] = prevAtr;
  }
  return atr;
}

/**
 * Computes Wilder's ADX(14) trend-strength indicator causally.
 */
export function computeADX(candles: CandleRow[], period = 14): Array<number | null> {
  const adx: Array<number | null> = new Array(candles.length).fill(null);
  if (candles.length < period * 2) return adx;

  const tr: number[] = new Array(candles.length).fill(0);
  const plusDm: number[] = new Array(candles.length).fill(0);
  const minusDm: number[] = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let smoothedTr = 0;
  let smoothedPlusDm = 0;
  let smoothedMinusDm = 0;
  for (let i = 1; i <= period; i++) {
    smoothedTr += tr[i];
    smoothedPlusDm += plusDm[i];
    smoothedMinusDm += minusDm[i];
  }

  const dxSeries: number[] = [];
  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      smoothedTr = smoothedTr - smoothedTr / period + tr[i];
      smoothedPlusDm = smoothedPlusDm - smoothedPlusDm / period + plusDm[i];
      smoothedMinusDm = smoothedMinusDm - smoothedMinusDm / period + minusDm[i];
    }
    const plusDi = smoothedTr > 0 ? (100 * smoothedPlusDm) / smoothedTr : 0;
    const minusDi = smoothedTr > 0 ? (100 * smoothedMinusDm) / smoothedTr : 0;
    const diSum = plusDi + minusDi;
    const dx = diSum > 0 ? (100 * Math.abs(plusDi - minusDi)) / diSum : 0;
    dxSeries.push(dx);

    if (dxSeries.length === period) {
      const firstAdx = dxSeries.reduce((a, b) => a + b, 0) / period;
      adx[i] = firstAdx;
    } else if (dxSeries.length > period) {
      const prev = adx[i - 1] ?? dx;
      adx[i] = (prev * (period - 1) + dx) / period;
    }
  }
  return adx;
}

function parseMinutesSinceMidnight(timeStr: string): number {
  const parts = timeStr.split(':');
  const hh = Number(parts[0] ?? 9);
  const mm = Number(parts[1] ?? 15);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 555;
  return hh * 60 + mm;
}

/**
 * Computes strictly causal higher-timeframe (15-minute) EMA(20) slope and RSI(14)
 * mapped onto each 5-minute bar using ONLY completed 15-minute candles up to t.
 */
function computeCausalHtf15mFeatures(sorted: CandleRow[]): {
  htfEma20Slope: Array<number | null>;
  htfRsi14: Array<number | null>;
} {
  const n = sorted.length;
  const htfEma20Slope: Array<number | null> = new Array(n).fill(null);
  const htfRsi14: Array<number | null> = new Array(n).fill(null);

  const completed15mCloses: number[] = [];
  let activeBucketKey = '';
  let activeBucketClose = 0;
  let activeBucketFinalized = false;

  const getLatestHtfMetrics = () => {
    if (completed15mCloses.length < 15) {
      return { rsiVal: null, slopeVal: null };
    }
    const rsiArr = computeRSI(completed15mCloses, 14);
    const rsiVal = rsiArr[rsiArr.length - 1];
    let slopeVal: number | null = null;
    if (completed15mCloses.length >= 21) {
      const emaArr = computeEMA(completed15mCloses, 20);
      const curEma = emaArr[emaArr.length - 1];
      const prevEma = emaArr[emaArr.length - 2];
      if (curEma !== null && prevEma !== null && prevEma > 0) {
        slopeVal = ((curEma - prevEma) / prevEma) * 100;
      }
    }
    return { rsiVal, slopeVal };
  };

  for (let i = 0; i < n; i++) {
    const c = sorted[i];
    const mins = parseMinutesSinceMidnight(c.time_str);
    const minsSince0915 = mins - 555;
    const bucketIdx = minsSince0915 >= 0 ? Math.floor(minsSince0915 / 15) : Math.floor(mins / 15);
    const bucketKey = `${c.date_str}_${bucketIdx}`;

    // If a new 15m bucket started and previous bucket wasn't yet finalized (e.g., partial session), finalize previous now
    if (activeBucketKey && bucketKey !== activeBucketKey && !activeBucketFinalized) {
      completed15mCloses.push(activeBucketClose);
      activeBucketFinalized = true;
    }

    if (bucketKey !== activeBucketKey) {
      activeBucketKey = bucketKey;
      activeBucketClose = c.close;
      activeBucketFinalized = false;
    } else {
      activeBucketClose = c.close;
    }

    // Finalize current 15m bar strictly when the 3rd 5m bar in the 15m window completes (:25, :40, :55, :10)
    const offsetIn15m = minsSince0915 >= 0 ? minsSince0915 % 15 : ((mins % 15) + 15) % 15;
    if (!activeBucketFinalized && offsetIn15m >= 10) {
      completed15mCloses.push(activeBucketClose);
      activeBucketFinalized = true;
    }

    const { rsiVal, slopeVal } = getLatestHtfMetrics();
    htfRsi14[i] = rsiVal !== null ? Number(rsiVal.toFixed(2)) : null;
    htfEma20Slope[i] = slopeVal !== null ? Number(slopeVal.toFixed(4)) : null;
  }

  return { htfEma20Slope, htfRsi14 };
}

/**
 * Enriches chronological candles with all technical indicators and ML features.
 * Strictly causal: row i only depends on rows <= i.
 */
export function calculateIndicators(candles: CandleRow[]): EnrichedCandle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map((c) => c.close);

  const rsi = computeRSI(closes, 14);
  const { macdLine, signalLine, histLine } = computeMACD(closes, 12, 26, 9);
  const ema5 = computeEMA(closes, 5);
  const ema9 = computeEMA(closes, 9);
  const ema20 = computeEMA(closes, 20);
  const ema21 = computeEMA(closes, 21);
  const sma50 = computeSMA(closes, 50);
  const atr = computeATR(sorted, 14);
  const adx = computeADX(sorted, 14);
  const { htfEma20Slope, htfRsi14 } = computeCausalHtf15mFeatures(sorted);

  const returns1: Array<number | null> = sorted.map((c, i) =>
    i === 0 || sorted[i - 1].close === 0 ? null : (c.close - sorted[i - 1].close) / sorted[i - 1].close
  );
  const returns3: Array<number | null> = sorted.map((c, i) =>
    i < 3 || sorted[i - 3].close === 0 ? null : (c.close - sorted[i - 3].close) / sorted[i - 3].close
  );

  // Rolling 14-candle standard deviation of 1-bar returns (expressed in %)
  const volatility: Array<number | null> = new Array(sorted.length).fill(null);
  const volWindow = 14;
  for (let i = volWindow; i < sorted.length; i++) {
    const windowVals: number[] = [];
    for (let j = i - volWindow + 1; j <= i; j++) {
      if (returns1[j] !== null) windowVals.push(returns1[j]!);
    }
    if (windowVals.length >= 10) {
      const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
      const variance = windowVals.reduce((a, b) => a + (b - mean) ** 2, 0) / windowVals.length;
      volatility[i] = Math.sqrt(variance) * 100;
    }
  }

  // Relative volume vs 20-bar average
  const hasVolume = sorted.some((c) => c.volume !== null && c.volume > 0);
  const volSeries = sorted.map((c) => c.volume ?? 0);
  const volSma20 = hasVolume ? computeSMA(volSeries, 20) : new Array(sorted.length).fill(null);

  // Intraday VWAP (resets cumulatively at the start of each NSE trading day)
  let currentDay = '';
  let cumTPV = 0;
  let cumVol = 0;

  return sorted.map((c, i) => {
    if (c.date_str !== currentDay) {
      currentDay = c.date_str;
      cumTPV = 0;
      cumVol = 0;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const barVol = c.volume !== null && c.volume > 0 ? c.volume : 1;
    cumTPV += typicalPrice * barVol;
    cumVol += barVol;
    const dayVwap = cumVol > 0 ? cumTPV / cumVol : typicalPrice;
    const vwapDist = dayVwap > 0 ? (c.close - dayVwap) / dayVwap : 0;

    const baseOpen = c.open > 0 ? c.open : 1;
    const candleBody = ((c.close - c.open) / baseOpen) * 100;
    const candleRange = ((c.high - c.low) / baseOpen) * 100;
    const relVolume =
      hasVolume && c.volume !== null && volSma20[i] && volSma20[i]! > 0
        ? c.volume / volSma20[i]!
        : null;

    const barAtr = atr[i];
    const atrNormRange = barAtr !== null && barAtr > 0 ? (c.high - c.low) / barAtr : null;

    // Cyclical NSE session time features (09:15 IST to 15:30 IST = 375 mins)
    const mins = parseMinutesSinceMidnight(c.time_str);
    const elapsed = Math.max(0, Math.min(375, mins - 555));
    const angle = (2 * Math.PI * elapsed) / 375;

    const e5 = ema5[i];
    const e9 = ema9[i];
    const e21 = ema21[i];
    const emaSpreadPct =
      e9 !== null && e21 !== null && e21 > 0 ? Number((((e9 - e21) / e21) * 100).toFixed(4)) : null;

    const rsiSlope =
      i >= 2 && rsi[i] !== null && rsi[i - 2] !== null
        ? Number((rsi[i]! - rsi[i - 2]!).toFixed(4))
        : null;

    const macdAccel =
      i >= 1 && histLine[i] !== null && histLine[i - 1] !== null
        ? Number((histLine[i]! - histLine[i - 1]!).toFixed(4))
        : null;

    const htfSlope = htfEma20Slope[i];
    let mtfConfluenceScore: number | null = null;
    if (e9 !== null && e21 !== null && htfSlope !== null) {
      const c1 = e9 > e21 ? 1 : e9 < e21 ? -1 : 0;
      const c2 = c.close > dayVwap ? 1 : c.close < dayVwap ? -1 : 0;
      const c3 = htfSlope > 0 ? 1 : htfSlope < 0 ? -1 : 0;
      mtfConfluenceScore = c1 + c2 + c3;
    }

    return {
      ...c,
      rsi: rsi[i] !== null ? Number(rsi[i]!.toFixed(2)) : null,
      macd: macdLine[i] !== null ? Number(macdLine[i]!.toFixed(2)) : null,
      macdSignal: signalLine[i] !== null ? Number(signalLine[i]!.toFixed(2)) : null,
      macdHist: histLine[i] !== null ? Number(histLine[i]!.toFixed(2)) : null,
      ema20: ema20[i] !== null ? Number(ema20[i]!.toFixed(2)) : null,
      sma50: sma50[i] !== null ? Number(sma50[i]!.toFixed(2)) : null,
      ema9: e9 !== null ? Number(e9.toFixed(2)) : null,
      ema21: e21 !== null ? Number(e21.toFixed(2)) : null,
      ema5: e5 !== null ? Number(e5.toFixed(2)) : null,
      ema9Ema21SpreadPct: emaSpreadPct,
      return1: returns1[i] !== null ? Number((returns1[i]! * 100).toFixed(4)) : null,
      return3: returns3[i] !== null ? Number((returns3[i]! * 100).toFixed(4)) : null,
      volatility: volatility[i] !== null ? Number(volatility[i]!.toFixed(4)) : null,
      candleBody: Number(candleBody.toFixed(4)),
      candleRange: Number(candleRange.toFixed(4)),
      relVolume: relVolume !== null ? Number(relVolume.toFixed(3)) : null,
      vwap: Number(dayVwap.toFixed(2)),
      vwapDistance: Number((vwapDist * 100).toFixed(4)),
      atr: barAtr !== null ? Number(barAtr.toFixed(2)) : null,
      atrNormRange: atrNormRange !== null ? Number(atrNormRange.toFixed(4)) : null,
      adx: adx[i] !== null ? Number(adx[i]!.toFixed(2)) : null,
      htfEma20Slope: htfSlope,
      htfRsi14: htfRsi14[i],
      mtfConfluenceScore,
      rsiMomentumSlope: rsiSlope,
      macdHistAccel: macdAccel,
      timeSin: Number(Math.sin(angle).toFixed(4)),
      timeCos: Number(Math.cos(angle).toFixed(4)),
    };
  });
}

function normalizeDateTime(dateRaw: string, timeRaw: string): { dateStr: string; timeStr: string; timestamp: number } | null {
  const dClean = dateRaw.trim();
  const tClean = timeRaw.trim() || '09:15';
  if (!dClean) return null;

  let yyyy = '';
  let mm = '';
  let dd = '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(dClean)) {
    [yyyy, mm, dd] = dClean.split('-');
  } else if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(dClean)) {
    const parts = dClean.split(/[/-]/);
    dd = parts[0];
    mm = parts[1];
    yyyy = parts[2];
  } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(dClean)) {
    [yyyy, mm, dd] = dClean.split('/');
  } else {
    const parsed = new Date(`${dClean} ${tClean}`);
    if (Number.isNaN(parsed.getTime())) return null;
    yyyy = String(parsed.getUTCFullYear());
    mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    dd = String(parsed.getUTCDate()).padStart(2, '0');
  }

  const timeParts = tClean.split(':');
  const hh = String(Number(timeParts[0] ?? 9)).padStart(2, '0');
  const min = String(Number(timeParts[1] ?? 15)).padStart(2, '0');
  if (Number.isNaN(Number(hh)) || Number.isNaN(Number(min))) return null;

  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;

  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
    timestamp: Math.floor(ms / 1000),
  };
}

/**
 * Parses uploaded CSV text supporting Date, Time, Open, High, Low, Close, and optional Volume.
 * Also supports combined Datetime/Timestamp column if Date & Time are merged.
 */
export function parseAndValidateCSV(csvText: string): {
  candles: CandleRow[];
  report: ValidationReport;
} {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must contain a header row and at least one data row.');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));

  const dateIdx = findCol(['date', 'trading_date', 'datetime', 'timestamp']);
  const timeIdx = findCol(['time', 'candle_time']);
  const openIdx = findCol(['open', 'o']);
  const highIdx = findCol(['high', 'h']);
  const lowIdx = findCol(['low', 'l']);
  const closeIdx = findCol(['close', 'c', 'ltp']);
  const volIdx = findCol(['volume', 'vol', 'qty', 'v']);

  if (dateIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
    throw new Error(
      'Missing required columns. Expected: Date, Time (optional if Date has timestamp), Open, High, Low, Close, and optional Volume.'
    );
  }

  const candles: CandleRow[] = [];
  const seenKeys = new Set<string>();
  const issues: Array<{ row: number; reason: string; date?: string; time?: string }> = [];

  let missingCount = 0;
  let duplicateCount = 0;
  let invalidOhlcCount = 0;
  let hasVolume = false;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/['"]/g, ''));
    let rawDate = cols[dateIdx] ?? '';
    let rawTime = timeIdx !== -1 ? (cols[timeIdx] ?? '') : '';

    if (!rawTime && rawDate.includes(' ')) {
      const split = rawDate.split(/\s+/);
      rawDate = split[0];
      rawTime = split[1] ?? '09:15';
    } else if (!rawTime && rawDate.includes('T')) {
      const split = rawDate.split('T');
      rawDate = split[0];
      rawTime = split[1].slice(0, 5);
    }

    const dt = normalizeDateTime(rawDate, rawTime);
    const open = Number(cols[openIdx]);
    const high = Number(cols[highIdx]);
    const low = Number(cols[lowIdx]);
    const close = Number(cols[closeIdx]);
    const volRaw = volIdx !== -1 && cols[volIdx] !== undefined && cols[volIdx] !== '' ? Number(cols[volIdx]) : null;

    if (volRaw !== null && !Number.isNaN(volRaw)) {
      hasVolume = true;
    }

    if (
      !dt ||
      cols[openIdx] === '' ||
      cols[highIdx] === '' ||
      cols[lowIdx] === '' ||
      cols[closeIdx] === '' ||
      Number.isNaN(open) ||
      Number.isNaN(high) ||
      Number.isNaN(low) ||
      Number.isNaN(close)
    ) {
      missingCount++;
      issues.push({ row: i + 1, reason: 'Missing or non-numeric OHLC/Date value', date: rawDate, time: rawTime });
      continue;
    }

    const key = `${dt.dateStr}_${dt.timeStr}`;
    let isDuplicate = false;
    if (seenKeys.has(key)) {
      duplicateCount++;
      isDuplicate = true;
      issues.push({ row: i + 1, reason: 'Duplicate timestamp record', date: dt.dateStr, time: dt.timeStr });
    }
    seenKeys.add(key);

    const isInvalidOhlc =
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < low ||
      high < Math.max(open, close) ||
      low > Math.min(open, close);

    if (isInvalidOhlc) {
      invalidOhlcCount++;
      issues.push({ row: i + 1, reason: 'Invalid OHLC relationship (H < max(O,C) or L > min(O,C))', date: dt.dateStr, time: dt.timeStr });
    }

    candles.push({
      timestamp: dt.timestamp,
      date_str: dt.dateStr,
      time_str: dt.timeStr,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: volRaw !== null && !Number.isNaN(volRaw) ? Math.max(0, Math.round(volRaw)) : null,
      is_valid: !isDuplicate && !isInvalidOhlc ? 1 : 0,
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);

  return {
    candles,
    report: {
      totalRows: lines.length - 1,
      missingCount,
      duplicateCount,
      invalidOhlcCount,
      hasVolume,
      startDate: candles[0]?.date_str ?? '',
      endDate: candles[candles.length - 1]?.date_str ?? '',
      issues: issues.slice(0, 50),
    },
  };
}

/**
 * Cleans a candle series by removing invalid OHLC rows, deduplicating timestamps,
 * fixing minor rounding, and sorting chronologically.
 */
export function cleanCandleDataset(candles: CandleRow[]): {
  cleaned: CandleRow[];
  removedCount: number;
} {
  const map = new Map<string, CandleRow>();
  let removed = 0;

  for (const c of candles) {
    const validOhlc =
      c.open > 0 &&
      c.high > 0 &&
      c.low > 0 &&
      c.close > 0 &&
      c.high >= c.low &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close);

    if (!validOhlc) {
      removed++;
      continue;
    }
    const key = `${c.date_str}_${c.time_str}`;
    if (map.has(key)) {
      removed++;
      continue;
    }
    map.set(key, { ...c, is_valid: 1 });
  }

  const cleaned = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  return { cleaned, removedCount: removed };
}

export interface AtrRiskLevels {
  entryPrice: number;
  atr: number;
  slPoints: number;
  targetPoints: number;
  stopLossPrice: number;
  targetPrice: number;
  riskReward: number;
}

/**
 * Computes ATR-based dynamic Stop-Loss (default 1.2 × ATR) and Take-Profit (default 2.4 × ATR),
 * strictly enforcing a minimum 1:2 Risk-to-Reward ratio.
 */
export function computeAtrRiskLevels(params: {
  entryPrice: number;
  atr: number;
  direction: 'BUY' | 'SELL';
  stopAtrMult?: number;
  targetAtrMult?: number;
}): AtrRiskLevels {
  const stopMult = Math.max(0.5, params.stopAtrMult ?? 1.2);
  const rawTargetMult = params.targetAtrMult ?? 2.4;
  // Enforce minimum 1:2 R:R ratio
  const targetMult = Math.max(rawTargetMult, stopMult * 2.0);

  const safeAtr = Math.max(1, params.atr);
  const slPoints = Number((safeAtr * stopMult).toFixed(2));
  const targetPoints = Number((safeAtr * targetMult).toFixed(2));

  const stopLossPrice =
    params.direction === 'BUY'
      ? Number(Math.max(1, params.entryPrice - slPoints).toFixed(2))
      : Number((params.entryPrice + slPoints).toFixed(2));
  const targetPrice =
    params.direction === 'BUY'
      ? Number((params.entryPrice + targetPoints).toFixed(2))
      : Number(Math.max(1, params.entryPrice - targetPoints).toFixed(2));

  return {
    entryPrice: Number(params.entryPrice.toFixed(2)),
    atr: Number(safeAtr.toFixed(2)),
    slPoints,
    targetPoints,
    stopLossPrice,
    targetPrice,
    riskReward: Number((targetPoints / slPoints).toFixed(2)),
  };
}

/**
 * Computes volatility-adjusted Bank NIFTY lots (Lot Size = 15) so that a stop-out
 * aligns with the configured Risk Per Trade % of capital.
 */
export function computeVolatilityPositionSize(params: {
  capital: number;
  riskPct: number;
  slPointsPerUnit: number;
  lotSize?: number;
}): {
  maxRiskRupees: number;
  riskPerLot: number;
  exactLots: number;
  recommendedLots: number;
  recommendedQty: number;
  stopOutLossAtLots: number;
} {
  const lotSize = Math.max(1, params.lotSize ?? 15);
  const maxRiskRupees = Number(((Math.max(1000, params.capital) * Math.max(0.1, params.riskPct)) / 100).toFixed(2));
  const slDist = Math.max(0.5, params.slPointsPerUnit);
  const riskPerLot = Number((slDist * lotSize).toFixed(2));
  const exactLots = riskPerLot > 0 ? maxRiskRupees / riskPerLot : 1;
  const recommendedLots = Math.max(1, Math.floor(exactLots));
  const recommendedQty = recommendedLots * lotSize;
  const stopOutLossAtLots = Number((recommendedLots * riskPerLot).toFixed(2));

  return {
    maxRiskRupees,
    riskPerLot,
    exactLots: Number(exactLots.toFixed(2)),
    recommendedLots,
    recommendedQty,
    stopOutLossAtLots,
  };
}

