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
  return1: number | null;
  return3: number | null;
  volatility: number | null;
  candleBody: number;
  candleRange: number;
  relVolume: number | null;
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
  let validRun: number[] = [];

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
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i]! - emaSlow[i]!) : null
  );
  const signalLine = computeEMA(macdLine, signalPeriod);
  const histLine: Array<number | null> = macdLine.map((m, i) =>
    m !== null && signalLine[i] !== null ? m - signalLine[i]! : null
  );
  return { macdLine, signalLine, histLine };
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
  const ema20 = computeEMA(closes, 20);
  const sma50 = computeSMA(closes, 50);

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

  return sorted.map((c, i) => {
    const baseOpen = c.open > 0 ? c.open : 1;
    const candleBody = ((c.close - c.open) / baseOpen) * 100;
    const candleRange = ((c.high - c.low) / baseOpen) * 100;
    const relVolume =
      hasVolume && c.volume !== null && volSma20[i] && volSma20[i]! > 0
        ? c.volume / volSma20[i]!
        : null;

    return {
      ...c,
      rsi: rsi[i] !== null ? Number(rsi[i]!.toFixed(2)) : null,
      macd: macdLine[i] !== null ? Number(macdLine[i]!.toFixed(2)) : null,
      macdSignal: signalLine[i] !== null ? Number(signalLine[i]!.toFixed(2)) : null,
      macdHist: histLine[i] !== null ? Number(histLine[i]!.toFixed(2)) : null,
      ema20: ema20[i] !== null ? Number(ema20[i]!.toFixed(2)) : null,
      sma50: sma50[i] !== null ? Number(sma50[i]!.toFixed(2)) : null,
      return1: returns1[i] !== null ? Number((returns1[i]! * 100).toFixed(4)) : null,
      return3: returns3[i] !== null ? Number((returns3[i]! * 100).toFixed(4)) : null,
      volatility: volatility[i] !== null ? Number(volatility[i]!.toFixed(4)) : null,
      candleBody: Number(candleBody.toFixed(4)),
      candleRange: Number(candleRange.toFixed(4)),
      relVolume: relVolume !== null ? Number(relVolume.toFixed(3)) : null,
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
