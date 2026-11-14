import express from 'express';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initDatabase,
  getActiveDataset,
  getActiveOptionsUpload,
  getAppSettingsObject,
  getCandlesForDataset,
  insertDatasetWithCandles,
} from './server/db.ts';
import {
  calculateIndicators,
  cleanCandleDataset,
  parseAndValidateCSV,
} from './server/quant.ts';
import {
  RandomForestArtifact,
  clampConfidenceThreshold,
  extractFeatureVector,
  generateSignalForCandle,
  getLabelingModeDescription,
  normalizeTargetMode,
  predictWithForest,
  trainRandomForestPipeline,
} from './server/randomForest.ts';
import { BacktestStrategy, runHistoricalBacktest } from './server/backtest.ts';
import {
  BANKNIFTY_LOT_SIZE,
  UploadedOptionRow,
  buildOptionsChain,
  computeBlackScholesGreeks,
  getReferenceExpiry,
  mapSignalToOptionContract,
  parseOptionsCSV,
} from './server/options.ts';
import {
  MarketFeedMode,
  advanceReplayTick,
  getLiveYahooBankNifty,
  getReplaySnapshot,
  normalizeFeedMode,
  resetReplayEngine,
  syncReplayBase,
} from './server/freeMarketFeed.ts';
import { EnrichedCandle } from './server/quant.ts';

initDatabase();

const app = express();
const PORT = 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to compute current IST market hours status cleanly
function getNseMarketStatus(): { status: string; note: string } {
  const now = new Date();
  // Convert to IST (+05:30)
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
  return {
    status: isOpen ? 'NSE Session Open (09:15–15:30 IST)' : 'NSE Session Closed',
    note: 'Displaying loaded historical 5-minute dataset (not live broker feed)',
  };
}

function getLatestTrainedModel(datasetId?: number) {
  const row = datasetId
    ? db
        .prepare('SELECT * FROM ml_models WHERE dataset_id = ? ORDER BY id DESC LIMIT 1')
        .get(datasetId)
    : db.prepare('SELECT * FROM ml_models ORDER BY id DESC LIMIT 1').get();
  return row as
    | {
        id: number;
        algorithm: string;
        status: string;
        dataset_id: number;
        dataset_size: number;
        usable_samples: number;
        train_size: number;
        val_size: number;
        test_size: number;
        date_range: string;
        accuracy: number;
        balanced_accuracy: number;
        precision_macro: number;
        recall_macro: number;
        f1_macro: number;
        confusion_matrix_json: string;
        class_distribution_json: string;
        feature_importance_json: string;
        prediction_history_json: string;
        model_artifact_json: string;
        min_confidence_threshold?: number | null;
        target_mode?: string | null;
        high_conviction_json?: string | null;
        walk_forward_json?: string | null;
        created_at: string;
      }
    | undefined;
}

// ============================================================================
// 1. UNIFIED MARKET FEED CONTEXT, OVERVIEW, CANDLES & SSE STREAMING
// ============================================================================
interface ActiveMarketContext {
  hasData: boolean;
  feedMode: MarketFeedMode;
  datasetId: number;
  datasetName: string;
  sourceType: string;
  dataLabel: string;
  hasVolume: boolean;
  candles: EnrichedCandle[];
  spotPrice: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  dateStr: string;
  timeStr: string;
  marketStatus: { status: string; note: string };
  feedMeta: {
    mode: MarketFeedMode;
    sourceUrl: string | null;
    fetchedAt: string | null;
    warning: string | null;
    replayProgress: string | null;
    tickSeq?: number;
    isBarComplete?: boolean;
  };
}

async function getActiveMarketContext(options?: { forceLiveFetch?: boolean }): Promise<ActiveMarketContext> {
  const settings = getAppSettingsObject();
  const feedMode = normalizeFeedMode(settings.dataSource.mode);
  const active = getActiveDataset();

  if (feedMode === 'free_live_nse') {
    const live = await getLiveYahooBankNifty(Boolean(options?.forceLiveFetch));
    if (live.candles.length > 0) {
      const enriched = calculateIndicators(live.candles);
      const latest = enriched[enriched.length - 1];
      const hasVol = enriched.some((c) => c.volume !== null && c.volume > 0);
      return {
        hasData: true,
        feedMode: 'free_live_nse',
        datasetId: active?.id ?? 1,
        datasetName: 'Yahoo Finance ^NSEBANK (5m)',
        sourceType: 'free_live_nse',
        dataLabel: live.isMarketOpen
          ? 'Free Live NSE Feed (Yahoo Finance ^NSEBANK)'
          : 'Free Live NSE Feed (Yahoo ^NSEBANK · Last Session)',
        hasVolume: hasVol,
        candles: enriched,
        spotPrice: live.spotPrice,
        prevClose: live.prevClose,
        dayHigh: live.dayHigh,
        dayLow: live.dayLow,
        dateStr: latest.date_str,
        timeStr: latest.time_str,
        marketStatus: {
          status: live.marketState,
          note: live.warning ?? 'Zero-API-key Yahoo Finance ^NSEBANK 5-minute intraday chart feed',
        },
        feedMeta: {
          mode: 'free_live_nse',
          sourceUrl: live.sourceUrl,
          fetchedAt: live.fetchedAt,
          warning: live.warning,
          replayProgress: null,
        },
      };
    }

    // Graceful fallback if Yahoo Finance is unreachable on cold start
    if (active) {
      const raw = getCandlesForDataset(active.id);
      if (raw.length > 0) {
        const enriched = calculateIndicators(raw);
        const latest = enriched[enriched.length - 1];
        const dayCandles = enriched.filter((c) => c.date_str === latest.date_str);
        const prevDays = enriched.filter((c) => c.date_str < latest.date_str);
        const prevClose = prevDays.length > 0 ? prevDays[prevDays.length - 1].close : dayCandles[0].open;
        return {
          hasData: true,
          feedMode: 'free_live_nse',
          datasetId: active.id,
          datasetName: active.name,
          sourceType: active.source_type,
          dataLabel: 'Free Live NSE Feed Unavailable · Fallback Historical CSV',
          hasVolume: Boolean(active.has_volume),
          candles: enriched,
          spotPrice: latest.close,
          prevClose,
          dayHigh: Math.max(...dayCandles.map((c) => c.high)),
          dayLow: Math.min(...dayCandles.map((c) => c.low)),
          dateStr: latest.date_str,
          timeStr: latest.time_str,
          marketStatus: {
            status: 'Live Feed Unreachable',
            note: live.warning ?? 'Showing fallback historical CSV while Yahoo Finance endpoint is unreachable.',
          },
          feedMeta: {
            mode: 'free_live_nse',
            sourceUrl: live.sourceUrl,
            fetchedAt: live.fetchedAt,
            warning: live.warning,
            replayProgress: null,
          },
        };
      }
    }
  }

  if (!active) {
    return {
      hasData: false,
      feedMode,
      datasetId: 0,
      datasetName: 'None',
      sourceType: 'none',
      dataLabel: 'No Dataset Loaded',
      hasVolume: false,
      candles: [],
      spotPrice: 53760,
      prevClose: 53760,
      dayHigh: 53760,
      dayLow: 53760,
      dateStr: '2026-11-11',
      timeStr: '15:25',
      marketStatus: getNseMarketStatus(),
      feedMeta: {
        mode: feedMode,
        sourceUrl: null,
        fetchedAt: null,
        warning: null,
        replayProgress: null,
      },
    };
  }

  const raw = getCandlesForDataset(active.id);
  if (raw.length === 0) {
    return {
      hasData: false,
      feedMode,
      datasetId: active.id,
      datasetName: active.name,
      sourceType: active.source_type,
      dataLabel: 'Empty Dataset',
      hasVolume: false,
      candles: [],
      spotPrice: 53760,
      prevClose: 53760,
      dayHigh: 53760,
      dayLow: 53760,
      dateStr: '2026-11-11',
      timeStr: '15:25',
      marketStatus: getNseMarketStatus(),
      feedMeta: {
        mode: feedMode,
        sourceUrl: null,
        fetchedAt: null,
        warning: null,
        replayProgress: null,
      },
    };
  }

  if (feedMode === 'simulated_replay') {
    syncReplayBase(active.id, raw);
    const replay = getReplaySnapshot();
    const enriched = calculateIndicators(replay.candles);
    const latest = enriched[enriched.length - 1];
    const dayCandles = enriched.filter((c) => c.date_str === latest.date_str);
    const prevDays = enriched.filter((c) => c.date_str < latest.date_str);
    const prevClose = prevDays.length > 0 ? prevDays[prevDays.length - 1].close : dayCandles[0].open;
    return {
      hasData: true,
      feedMode: 'simulated_replay',
      datasetId: active.id,
      datasetName: active.name,
      sourceType: 'simulated_replay',
      dataLabel: 'Simulated Live Stream (24/7 Tick Replay)',
      hasVolume: Boolean(active.has_volume),
      candles: enriched,
      spotPrice: latest.close,
      prevClose,
      dayHigh: Math.max(...dayCandles.map((c) => c.high)),
      dayLow: Math.min(...dayCandles.map((c) => c.low)),
      dateStr: latest.date_str,
      timeStr: latest.time_str,
      marketStatus: {
        status: '24/7 Simulated Live Tick Replay',
        note: `Streaming historical 5m candles (${replay.replayProgress})`,
      },
      feedMeta: {
        mode: 'simulated_replay',
        sourceUrl: null,
        fetchedAt: new Date().toISOString(),
        warning: null,
        replayProgress: replay.replayProgress,
        tickSeq: replay.tickSeq,
        isBarComplete: replay.isBarComplete,
      },
    };
  }

  // Default: Historical CSV
  const enriched = calculateIndicators(raw);
  const latest = enriched[enriched.length - 1];
  const dayCandles = enriched.filter((c) => c.date_str === latest.date_str);
  const prevDays = enriched.filter((c) => c.date_str < latest.date_str);
  const prevClose = prevDays.length > 0 ? prevDays[prevDays.length - 1].close : dayCandles[0].open;

  return {
    hasData: true,
    feedMode: 'historical_csv',
    datasetId: active.id,
    datasetName: active.name,
    sourceType: active.source_type,
    dataLabel:
      active.source_type === 'sample_historical'
        ? 'Historical CSV (Sample Bank NIFTY 5m)'
        : `Uploaded Historical CSV: ${active.name}`,
    hasVolume: Boolean(active.has_volume),
    candles: enriched,
    spotPrice: latest.close,
    prevClose,
    dayHigh: Math.max(...dayCandles.map((c) => c.high)),
    dayLow: Math.min(...dayCandles.map((c) => c.low)),
    dateStr: latest.date_str,
    timeStr: latest.time_str,
    marketStatus: getNseMarketStatus(),
    feedMeta: {
      mode: 'historical_csv',
      sourceUrl: null,
      fetchedAt: null,
      warning: null,
      replayProgress: null,
    },
  };
}

function buildOverviewFromContext(ctx: ActiveMarketContext) {
  if (!ctx.hasData || ctx.candles.length === 0) {
    return {
      hasData: false,
      feedMode: ctx.feedMode,
      dataLabel: ctx.dataLabel,
      marketStatus: ctx.marketStatus,
      feedMeta: ctx.feedMeta,
    };
  }

  const latest = ctx.candles[ctx.candles.length - 1];
  const dailyChange = ctx.spotPrice - ctx.prevClose;
  const dailyChangePct = ctx.prevClose > 0 ? (dailyChange / ctx.prevClose) * 100 : 0;

  let trendDirection = 'Sideways / Consolidating';
  if (latest.ema20 !== null && latest.sma50 !== null) {
    if (latest.close > latest.ema20 && latest.ema20 > latest.sma50) {
      trendDirection = 'Bullish Uptrend';
    } else if (latest.close < latest.ema20 && latest.ema20 < latest.sma50) {
      trendDirection = 'Bearish Downtrend';
    } else if (latest.close > latest.ema20) {
      trendDirection = 'Mild Bullish Bias';
    } else {
      trendDirection = 'Mild Bearish Bias';
    }
  }

  const appSettings = getAppSettingsObject();
  const activeOptUpload = getActiveOptionsUpload();
  const uploadedOptionRows = activeOptUpload
    ? (JSON.parse(activeOptUpload.rows_json) as UploadedOptionRow[])
    : null;
  const preferredOptMode = appSettings.dataSource.optionsMode;

  const modelRow = getLatestTrainedModel(ctx.datasetId) ?? (ctx.feedMode === 'free_live_nse' ? getLatestTrainedModel() : undefined);
  let prediction: Record<string, unknown> = {
    modelStatus: 'Not trained',
    signal: null,
    confidence: null,
    predictedMovePct: null,
    recommendation: null,
    optionRecommendation: null,
  };

  if (modelRow) {
    const artifact = JSON.parse(modelRow.model_artifact_json) as RandomForestArtifact;
    const minConf = clampConfidenceThreshold(
      modelRow.min_confidence_threshold ?? appSettings.ml.minConfidenceThreshold
    );
    const generated = generateSignalForCandle(artifact, latest, minConf);
    if (generated) {
      const optionRec = mapSignalToOptionContract({
        signal: generated.signal_type,
        spot: ctx.spotPrice,
        dateStr: latest.date_str,
        rollingVolPct: latest.volatility,
        atr: appSettings.trading.stopLossMode === 'atr_dynamic' ? latest.atr : null,
        stopAtrMult: appSettings.trading.atrStopMult,
        targetAtrMult: appSettings.trading.atrTargetMult,
        capital: 100000,
        riskPerTradePct: appSettings.trading.riskPerTradePct,
        uploadedRows: uploadedOptionRows,
        preferredMode: preferredOptMode,
      });
      prediction = {
        modelStatus: 'Trained',
        modelId: modelRow.id,
        algorithm: modelRow.algorithm,
        signal: generated.signal_type,
        rawSignal: generated.raw_signal_type,
        thresholdGated: generated.threshold_gated,
        minConfidenceThreshold: minConf,
        confidence: generated.confidence,
        predictedMovePct: generated.predicted_move_pct,
        recommendation: {
          entryPrice: generated.entry_price,
          stopLoss: generated.stop_loss,
          targetPrice: generated.target_price,
          riskReward: generated.risk_reward,
          generatedAt: `${generated.date_str} ${generated.time_str} IST`,
          reason: generated.reason,
        },
        optionRecommendation: optionRec,
      };
    }
  }

  return {
    hasData: true,
    feedMode: ctx.feedMode,
    datasetId: ctx.datasetId,
    datasetName: ctx.datasetName,
    sourceType: ctx.sourceType,
    dataLabel: ctx.dataLabel,
    symbol: ctx.feedMode === 'free_live_nse' ? 'BANK NIFTY (^NSEBANK)' : 'BANK NIFTY',
    timeframe: '5m',
    currentPrice: ctx.spotPrice,
    prevClose: Number(ctx.prevClose.toFixed(2)),
    dailyChange: Number(dailyChange.toFixed(2)),
    dailyChangePct: Number(dailyChangePct.toFixed(2)),
    dayHigh: Number(ctx.dayHigh.toFixed(2)),
    dayLow: Number(ctx.dayLow.toFixed(2)),
    lastUpdateTime: `${ctx.dateStr} ${ctx.timeStr} IST`,
    marketStatus: ctx.marketStatus,
    feedMeta: ctx.feedMeta,
    hasVolume: ctx.hasVolume,
    indicators: {
      rsi: latest.rsi,
      macd: latest.macd,
      macdSignal: latest.macdSignal,
      macdHist: latest.macdHist,
      ema20: latest.ema20,
      sma50: latest.sma50,
      volatility: latest.volatility,
      vwap: latest.vwap,
      vwapDistance: latest.vwapDistance,
      atr: latest.atr,
      adx: latest.adx,
      htfEma20Slope: latest.htfEma20Slope,
      htfRsi14: latest.htfRsi14,
      trendDirection,
    },
    prediction,
  };
}

function buildOptionsChainFromContext(ctx: ActiveMarketContext, requestedModeQuery?: unknown) {
  const settings = getAppSettingsObject();
  const activeUpload = getActiveOptionsUpload();
  const uploadedRows = activeUpload ? (JSON.parse(activeUpload.rows_json) as UploadedOptionRow[]) : null;
  const requestedMode =
    requestedModeQuery === 'csv' || requestedModeQuery === 'simulated'
      ? requestedModeQuery
      : settings.dataSource.optionsMode;

  const latestVol = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].volatility : 0.16;
  const chainResult = buildOptionsChain({
    spot: ctx.spotPrice,
    dateStr: ctx.dateStr,
    rollingVolPct: latestVol,
    uploadedRows,
    preferredMode: requestedMode,
  });

  return {
    ...chainResult,
    lotSize: BANKNIFTY_LOT_SIZE,
    spotTimestamp: `${ctx.dateStr} ${ctx.timeStr} IST`,
    hasUploadedCsv: Boolean(activeUpload),
    uploadedCsvName: activeUpload?.name ?? null,
    uploadedCsvCount: activeUpload?.record_count ?? 0,
  };
}

app.get('/api/market/overview', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const ctx = await getActiveMarketContext({ forceLiveFetch: force });
    res.json(buildOverviewFromContext(ctx));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/market/candles', async (req, res) => {
  try {
    const ctx = await getActiveMarketContext();
    if (!ctx.hasData) {
      return res.json({ candles: [], dataset: null });
    }
    const limitParam = Number(req.query.limit ?? 0);
    const result = limitParam > 0 ? ctx.candles.slice(-limitParam) : ctx.candles;

    res.json({
      dataset: {
        id: ctx.datasetId,
        name: ctx.datasetName,
        sourceType: ctx.sourceType,
        hasVolume: ctx.hasVolume,
        recordCount: ctx.candles.length,
        startDate: ctx.candles[0]?.date_str ?? '',
        endDate: ctx.candles[ctx.candles.length - 1]?.date_str ?? '',
      },
      candles: result,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 2. DATA MANAGEMENT (UPLOAD, PREVIEW, VALIDATE, CLEAN, EXPORT)
// ============================================================================
app.get('/api/data/datasets', (_req, res) => {
  try {
    const datasets = db.prepare('SELECT * FROM datasets ORDER BY is_active DESC, id DESC').all();
    const active = getActiveDataset();
    const preview = active
      ? db
          .prepare(
            'SELECT date_str, time_str, open, high, low, close, volume, is_valid FROM candles WHERE dataset_id = ? ORDER BY timestamp DESC LIMIT 25'
          )
          .all(active.id)
      : [];
    res.json({ datasets, activeDataset: active ?? null, preview });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/data/upload', upload.single('file'), (req, res) => {
  try {
    let csvText = '';
    let datasetName = 'Uploaded Bank NIFTY CSV';

    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
      datasetName = req.file.originalname || datasetName;
    } else if (typeof req.body?.csvText === 'string') {
      csvText = req.body.csvText;
      datasetName = req.body.filename || datasetName;
    } else {
      return res.status(400).json({ error: 'Please provide a CSV file or csvText payload.' });
    }

    const { candles, report } = parseAndValidateCSV(csvText);
    if (candles.length === 0) {
      return res.status(400).json({ error: 'No valid candle rows could be parsed from the CSV.' });
    }

    const activate = req.body?.activate !== false && req.body?.activate !== 'false';
    const datasetId = insertDatasetWithCandles({
      name: datasetName,
      sourceType: 'uploaded_csv',
      candles,
      missingCount: report.missingCount,
      duplicateCount: report.duplicateCount,
      invalidOhlcCount: report.invalidOhlcCount,
      hasVolume: report.hasVolume,
      activate,
    });

    res.json({
      datasetId,
      name: datasetName,
      report,
      activated: activate,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/data/clean', (req, res) => {
  try {
    const datasetId = Number(req.body?.datasetId) || getActiveDataset()?.id;
    if (!datasetId) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }

    const raw = getCandlesForDataset(datasetId);
    const { cleaned, removedCount } = cleanCandleDataset(raw);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM candles WHERE dataset_id = ?').run(datasetId);
      const ins = db.prepare(
        `INSERT INTO candles (dataset_id, timestamp, date_str, time_str, open, high, low, close, volume, is_valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      );
      for (const c of cleaned) {
        ins.run(datasetId, c.timestamp, c.date_str, c.time_str, c.open, c.high, c.low, c.close, c.volume);
      }
      db.prepare(
        `UPDATE datasets
         SET record_count = ?, start_date = ?, end_date = ?,
             missing_count = 0, duplicate_count = 0, invalid_ohlc_count = 0, is_cleaned = 1
         WHERE id = ?`
      ).run(
        cleaned.length,
        cleaned[0]?.date_str ?? '',
        cleaned[cleaned.length - 1]?.date_str ?? '',
        datasetId
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({
      datasetId,
      removedCount,
      cleanedCount: cleaned.length,
      message: `Cleaned dataset: removed ${removedCount} duplicate or invalid OHLC rows.`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/data/activate', (req, res) => {
  try {
    const datasetId = Number(req.body?.datasetId);
    if (!datasetId) {
      return res.status(400).json({ error: 'Valid datasetId is required.' });
    }
    const exists = db.prepare('SELECT id FROM datasets WHERE id = ?').get(datasetId);
    if (!exists) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }
    db.prepare('UPDATE datasets SET is_active = 0').run();
    db.prepare('UPDATE datasets SET is_active = 1 WHERE id = ?').run(datasetId);
    res.json({ success: true, activeDatasetId: datasetId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/data/export', (req, res) => {
  try {
    const datasetId = Number(req.query.datasetId) || getActiveDataset()?.id;
    if (!datasetId) {
      return res.status(404).json({ error: 'No dataset available to export.' });
    }
    const ds = db.prepare('SELECT name FROM datasets WHERE id = ?').get(datasetId) as { name: string } | undefined;
    const candles = getCandlesForDataset(datasetId);

    const lines = ['Date,Time,Open,High,Low,Close,Volume'];
    for (const c of candles) {
      lines.push(`${c.date_str},${c.time_str},${c.open},${c.high},${c.low},${c.close},${c.volume ?? ''}`);
    }

    const safeName = (ds?.name ?? 'banknifty_5m').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 3. MACHINE LEARNING (RANDOM FOREST TRAINING, STATUS, PREDICTION, SIGNALS)
// ============================================================================
app.get('/api/model/status', (_req, res) => {
  try {
    const appSettings = getAppSettingsObject();
    const active = getActiveDataset();
    if (!active) {
      return res.json({
        status: 'Not trained',
        reason: 'No active dataset loaded.',
        minConfidenceThreshold: appSettings.ml.minConfidenceThreshold,
        targetMode: appSettings.ml.targetMode,
        labelingMode: getLabelingModeDescription(appSettings.ml.targetMode),
        walkForwardEnabled: appSettings.ml.walkForwardEnabled,
      });
    }

    const modelRow = getLatestTrainedModel(active.id);
    if (!modelRow) {
      return res.json({
        status: 'Not trained',
        datasetId: active.id,
        datasetName: active.name,
        datasetSize: active.record_count,
        dateRange: `${active.start_date} to ${active.end_date}`,
        minConfidenceThreshold: appSettings.ml.minConfidenceThreshold,
        targetMode: appSettings.ml.targetMode,
        labelingMode: getLabelingModeDescription(appSettings.ml.targetMode),
        walkForwardEnabled: appSettings.ml.walkForwardEnabled,
      });
    }

    const minConfidenceThreshold = clampConfidenceThreshold(
      modelRow.min_confidence_threshold ?? appSettings.ml.minConfidenceThreshold
    );
    const targetMode = normalizeTargetMode(modelRow.target_mode ?? appSettings.ml.targetMode);

    res.json({
      status: 'Trained',
      modelId: modelRow.id,
      algorithm: modelRow.algorithm,
      datasetId: modelRow.dataset_id,
      datasetName: active.name,
      datasetSize: modelRow.dataset_size,
      usableSamples: modelRow.usable_samples,
      trainSize: modelRow.train_size,
      valSize: modelRow.val_size,
      testSize: modelRow.test_size,
      dateRange: modelRow.date_range,
      minConfidenceThreshold,
      targetMode,
      labelingMode: getLabelingModeDescription(targetMode),
      walkForwardEnabled: Boolean(modelRow.walk_forward_json),
      metrics: {
        accuracy: modelRow.accuracy,
        balancedAccuracy: modelRow.balanced_accuracy,
        precision: modelRow.precision_macro,
        recall: modelRow.recall_macro,
        f1Score: modelRow.f1_macro,
      },
      highConviction: modelRow.high_conviction_json ? JSON.parse(modelRow.high_conviction_json) : null,
      walkForward: modelRow.walk_forward_json ? JSON.parse(modelRow.walk_forward_json) : null,
      confusionMatrix: JSON.parse(modelRow.confusion_matrix_json),
      classDistribution: JSON.parse(modelRow.class_distribution_json),
      featureImportance: JSON.parse(modelRow.feature_importance_json),
      predictionHistory: JSON.parse(modelRow.prediction_history_json),
      trainedAt: modelRow.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/model/train', async (req, res) => {
  try {
    const active = getActiveDataset();
    const ctx = await getActiveMarketContext();
    if (!active && ctx.candles.length < 120) {
      return res.status(400).json({ error: 'No active dataset loaded. Upload or activate a dataset first.' });
    }

    const usingLiveFeedForTrain = ctx.feedMode === 'free_live_nse' && ctx.candles.length >= 120;
    const raw = usingLiveFeedForTrain
      ? ctx.candles.map((c) => ({
          timestamp: c.timestamp,
          date_str: c.date_str,
          time_str: c.time_str,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          is_valid: 1,
        }))
      : getCandlesForDataset(active!.id);

    const appSettings = getAppSettingsObject();
    const nEstimators = Math.min(80, Math.max(10, Number(req.body?.nEstimators ?? appSettings.ml.nEstimators ?? 30)));
    const maxDepth = Math.min(10, Math.max(3, Number(req.body?.maxDepth ?? appSettings.ml.maxDepth ?? 6)));
    const minSamplesSplit = Math.min(
      25,
      Math.max(4, Number(req.body?.minSamplesSplit ?? appSettings.ml.minSamplesSplit ?? 8))
    );
    const minConfidenceThreshold = clampConfidenceThreshold(
      req.body?.minConfidenceThreshold ?? appSettings.ml.minConfidenceThreshold ?? 0.72
    );
    const targetMode = normalizeTargetMode(req.body?.targetMode ?? appSettings.ml.targetMode);
    const walkForward = Boolean(req.body?.walkForward ?? appSettings.ml.walkForwardEnabled ?? false);

    // Persist active ML hyperparameters, target mode & conviction threshold in settings
    const now = new Date().toISOString();
    appSettings.ml.nEstimators = nEstimators;
    appSettings.ml.maxDepth = maxDepth;
    appSettings.ml.minSamplesSplit = minSamplesSplit;
    appSettings.ml.minConfidenceThreshold = minConfidenceThreshold;
    appSettings.ml.targetMode = targetMode;
    appSettings.ml.walkForwardEnabled = walkForward;
    db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(appSettings),
      now
    );

    const evaluation = trainRandomForestPipeline(raw, {
      nEstimators,
      maxDepth,
      minSamplesSplit,
      horizonCandles: 3,
      minConfidenceThreshold,
      targetMode,
      walkForward,
    });

    const datasetIdForModel = active?.id ?? ctx.datasetId ?? 1;
    const insertModel = db.prepare(
      `INSERT INTO ml_models (
        algorithm, status, dataset_id, dataset_size, usable_samples,
        train_size, val_size, test_size, date_range,
        accuracy, balanced_accuracy, precision_macro, recall_macro, f1_macro,
        confusion_matrix_json, class_distribution_json, feature_importance_json,
        prediction_history_json, model_artifact_json,
        min_confidence_threshold, target_mode, high_conviction_json, walk_forward_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const modelRes = insertModel.run(
      evaluation.artifact.algorithm,
      'Trained',
      datasetIdForModel,
      evaluation.datasetSize,
      evaluation.usableSamples,
      evaluation.trainSize,
      evaluation.valSize,
      evaluation.testSize,
      evaluation.dateRange,
      evaluation.accuracy,
      evaluation.balancedAccuracy,
      evaluation.precisionMacro,
      evaluation.recallMacro,
      evaluation.f1Macro,
      JSON.stringify(evaluation.confusionMatrix),
      JSON.stringify(evaluation.classDistribution),
      JSON.stringify(evaluation.featureImportance),
      JSON.stringify(evaluation.predictionHistory),
      JSON.stringify(evaluation.artifact),
      minConfidenceThreshold,
      targetMode,
      JSON.stringify(evaluation.highConviction),
      evaluation.walkForward ? JSON.stringify(evaluation.walkForward) : null,
      now
    );

    const modelId = Number(modelRes.lastInsertRowid);

    // Generate & store signals for the most recent 30 candles in the dataset (out-of-sample / tail monitoring)
    const enriched = calculateIndicators(raw);
    const tailCandles = enriched.slice(-30);
    const dataLabel = usingLiveFeedForTrain
      ? 'Free Live NSE (^NSEBANK)'
      : active?.source_type === 'sample_historical'
      ? 'Sample Historical'
      : 'Uploaded Historical CSV';

    const activeOptUpload = getActiveOptionsUpload();
    const uploadedOptionRows = activeOptUpload
      ? (JSON.parse(activeOptUpload.rows_json) as UploadedOptionRow[])
      : null;
    const preferredOptMode = appSettings.dataSource.optionsMode;

    db.prepare('DELETE FROM signals').run();
    const insertSig = db.prepare(
      `INSERT INTO signals (
        model_id, timestamp, date_str, time_str, signal_type,
        market_price, entry_price, stop_loss, target_price, risk_reward,
        confidence, predicted_move_pct, rsi, macd, macd_signal, macd_hist,
        reason, data_label,
        option_contract, option_strike, option_type, option_expiry,
        option_lot_size, option_entry_premium, option_stop_loss, option_target, option_data_mode,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const c of tailCandles) {
      const sig = generateSignalForCandle(evaluation.artifact, c, minConfidenceThreshold);
      if (sig) {
        const opt = mapSignalToOptionContract({
          signal: sig.signal_type,
          spot: sig.market_price,
          dateStr: sig.date_str,
          rollingVolPct: c.volatility,
          atr: appSettings.trading.stopLossMode === 'atr_dynamic' ? c.atr : null,
          stopAtrMult: appSettings.trading.atrStopMult,
          targetAtrMult: appSettings.trading.atrTargetMult,
          capital: 100000,
          riskPerTradePct: appSettings.trading.riskPerTradePct,
          uploadedRows: uploadedOptionRows,
          preferredMode: preferredOptMode,
        });

        insertSig.run(
          modelId,
          sig.timestamp,
          sig.date_str,
          sig.time_str,
          sig.signal_type,
          sig.market_price,
          sig.entry_price,
          sig.stop_loss,
          sig.target_price,
          sig.risk_reward,
          sig.confidence,
          sig.predicted_move_pct,
          sig.rsi,
          sig.macd,
          sig.macd_signal,
          sig.macd_hist,
          sig.reason,
          dataLabel,
          opt?.contractName ?? null,
          opt?.strike ?? null,
          opt?.optionType ?? null,
          opt?.expiry ?? null,
          opt?.lotSize ?? BANKNIFTY_LOT_SIZE,
          opt?.entryPremium ?? null,
          opt?.stopLoss ?? null,
          opt?.targetPrice ?? null,
          opt?.dataMode ?? null,
          now
        );
      }
    }

    // If Auto-Execute Signals (Simulated) is enabled, execute on latest BUY/SELL signal automatically
    let autoExecResult: unknown = null;
    if (appSettings.trading.autoExecuteSignals) {
      autoExecResult = await tryAutoExecuteLatestSignal();
    }

    res.json({
      status: 'Trained',
      modelId,
      algorithm: evaluation.artifact.algorithm,
      datasetId: datasetIdForModel,
      datasetName: usingLiveFeedForTrain ? 'Yahoo Finance ^NSEBANK (5m)' : (active?.name ?? ctx.datasetName),
      datasetSize: evaluation.datasetSize,
      usableSamples: evaluation.usableSamples,
      trainSize: evaluation.trainSize,
      valSize: evaluation.valSize,
      testSize: evaluation.testSize,
      dateRange: evaluation.dateRange,
      minConfidenceThreshold,
      targetMode,
      labelingMode: evaluation.labelingMode,
      walkForwardEnabled: walkForward,
      metrics: {
        accuracy: evaluation.accuracy,
        balancedAccuracy: evaluation.balancedAccuracy,
        precision: evaluation.precisionMacro,
        recall: evaluation.recallMacro,
        f1Score: evaluation.f1Macro,
      },
      highConviction: evaluation.highConviction,
      walkForward: evaluation.walkForward,
      confusionMatrix: evaluation.confusionMatrix,
      classDistribution: evaluation.classDistribution,
      featureImportance: evaluation.featureImportance,
      predictionHistory: evaluation.predictionHistory,
      autoExecution: autoExecResult,
      trainedAt: now,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/model/predict', (req, res) => {
  try {
    const active = getActiveDataset();
    if (!active) {
      return res.status(400).json({ error: 'No active dataset loaded.' });
    }
    const modelRow = getLatestTrainedModel(active.id);
    if (!modelRow) {
      return res.status(400).json({ error: 'Model is not trained yet. Train the Random Forest model first.' });
    }

    const appSettings = getAppSettingsObject();
    const minConfidenceThreshold = clampConfidenceThreshold(
      req.body?.minConfidenceThreshold ?? modelRow.min_confidence_threshold ?? appSettings.ml.minConfidenceThreshold
    );
    const artifact = JSON.parse(modelRow.model_artifact_json) as RandomForestArtifact;
    const raw = getCandlesForDataset(active.id);
    const enriched = calculateIndicators(raw);
    const idxParam = req.body?.candleIndex;
    const targetCandle =
      typeof idxParam === 'number' && idxParam >= 0 && idxParam < enriched.length
        ? enriched[idxParam]
        : enriched[enriched.length - 1];

    const vec = extractFeatureVector(targetCandle, artifact.featureNames);
    if (!vec) {
      return res.status(400).json({ error: 'Selected candle lacks sufficient indicator warm-up history.' });
    }

    const pred = predictWithForest(artifact, vec, {
      minConfidenceOverride: minConfidenceThreshold,
      adx: targetCandle.adx,
    });
    const signal = generateSignalForCandle(artifact, targetCandle, minConfidenceThreshold);

    res.json({
      modelId: modelRow.id,
      minConfidenceThreshold,
      candle: {
        date_str: targetCandle.date_str,
        time_str: targetCandle.time_str,
        close: targetCandle.close,
        rsi: targetCandle.rsi,
        macd: targetCandle.macd,
        macdHist: targetCandle.macdHist,
      },
      prediction: pred,
      signal,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/signals', (_req, res) => {
  try {
    const active = getActiveDataset();
    const modelRow = active ? getLatestTrainedModel(active.id) : undefined;
    if (!modelRow) {
      return res.json({
        modelStatus: 'Not trained',
        signals: [],
      });
    }
    const signals = db.prepare('SELECT * FROM signals WHERE model_id = ? ORDER BY timestamp DESC').all(modelRow.id);
    res.json({
      modelStatus: 'Trained',
      modelId: modelRow.id,
      signals,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 4. BACKTESTING ENGINE
// ============================================================================
app.post('/api/backtest/run', (req, res) => {
  try {
    const active = getActiveDataset();
    if (!active) {
      return res.status(400).json({ error: 'No active dataset loaded.' });
    }

    const appSettings = getAppSettingsObject();
    const strategy = (req.body?.strategy || 'rsi_macd_confluence') as BacktestStrategy;
    const startDate = req.body?.startDate || undefined;
    const endDate = req.body?.endDate || undefined;
    const initialCapital = Math.max(10000, Number(req.body?.initialCapital ?? 100000));
    const positionSize = Math.max(1, Number(req.body?.positionSize ?? 15));
    const stopLossPct = Math.max(0.05, Number(req.body?.stopLossPct ?? 0.35));
    const targetPct = Math.max(0.05, Number(req.body?.targetPct ?? 0.7));
    const chargeBps = Math.max(0, Number(req.body?.chargeBps ?? 3));
    const slippageBps = Math.max(0, Number(req.body?.slippageBps ?? 2));
    const useAtrDynamic =
      req.body?.useAtrDynamic !== undefined
        ? Boolean(req.body.useAtrDynamic)
        : appSettings.trading.stopLossMode === 'atr_dynamic';
    const atrStopMult = Number(req.body?.atrStopMult ?? appSettings.trading.atrStopMult ?? 1.2);
    const atrTargetMult = Number(req.body?.atrTargetMult ?? appSettings.trading.atrTargetMult ?? 2.4);
    const useAdxFilter =
      req.body?.useAdxFilter !== undefined
        ? Boolean(req.body.useAdxFilter)
        : appSettings.trading.adxChopFilterEnabled;
    const adxMinThreshold = Number(req.body?.adxMinThreshold ?? appSettings.trading.adxMinThreshold ?? 18);
    const useConsecutiveLossCooldown =
      req.body?.useConsecutiveLossCooldown !== undefined
        ? Boolean(req.body.useConsecutiveLossCooldown)
        : appSettings.trading.consecutiveLossCooldownEnabled;
    const consecutiveLossLimit = Number(
      req.body?.consecutiveLossLimit ?? appSettings.trading.consecutiveLossLimit ?? 2
    );
    const cooldownCandles = Number(req.body?.cooldownCandles ?? appSettings.trading.cooldownCandles ?? 6);

    const modelRow = getLatestTrainedModel(active.id);
    const artifact = modelRow ? (JSON.parse(modelRow.model_artifact_json) as RandomForestArtifact) : null;

    const raw = getCandlesForDataset(active.id);
    const oosIdx = modelRow ? Math.min(raw.length - 1, modelRow.train_size + modelRow.val_size) : 0;
    const minMlTimestamp = modelRow && raw[oosIdx] ? raw[oosIdx].timestamp : null;

    const result = runHistoricalBacktest(
      raw,
      {
        strategy,
        startDate,
        endDate,
        initialCapital,
        positionSize,
        stopLossPct,
        targetPct,
        chargeBps,
        slippageBps,
        useAtrDynamic,
        atrStopMult,
        atrTargetMult,
        useAdxFilter,
        adxMinThreshold,
        useConsecutiveLossCooldown,
        consecutiveLossLimit,
        cooldownCandles,
      },
      artifact,
      minMlTimestamp
    );

    const now = new Date().toISOString();
    const saved = db
      .prepare(
        `INSERT INTO backtests (
          dataset_id, strategy, date_range, config_json, metrics_json, equity_curve_json, trades_json, comparison_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        active.id,
        strategy,
        result.dateRange,
        JSON.stringify({
          initialCapital,
          positionSize,
          stopLossPct,
          targetPct,
          chargeBps,
          slippageBps,
          useAtrDynamic,
          useAdxFilter,
          useConsecutiveLossCooldown,
        }),
        JSON.stringify(result.metrics),
        JSON.stringify(result.equityCurve),
        JSON.stringify(result.trades),
        JSON.stringify(result.baselineComparison),
        now
      );

    res.json({
      id: Number(saved.lastInsertRowid),
      ...result,
      createdAt: now,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/backtest/results', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM backtests ORDER BY id DESC LIMIT 10').all() as Array<{
      id: number;
      dataset_id: number;
      strategy: string;
      date_range: string;
      config_json: string;
      metrics_json: string;
      equity_curve_json: string;
      trades_json: string;
      comparison_json?: string | null;
      created_at: string;
    }>;

    const formatted = rows.map((r) => ({
      id: r.id,
      datasetId: r.dataset_id,
      strategy: r.strategy,
      dateRange: r.date_range,
      config: JSON.parse(r.config_json),
      metrics: JSON.parse(r.metrics_json),
      equityCurve: JSON.parse(r.equity_curve_json),
      trades: JSON.parse(r.trades_json),
      baselineComparison: r.comparison_json ? JSON.parse(r.comparison_json) : null,
      createdAt: r.created_at,
    }));

    res.json({ results: formatted });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 5. OPTIONS CHAIN & OPTIONS CSV MODULE
// ============================================================================
function getLatestSpotAndVol(): { spot: number; dateStr: string; timeStr: string; rollingVolPct: number | null } {
  const active = getActiveDataset();
  if (!active) return { spot: 53760, dateStr: '2026-11-11', timeStr: '15:25', rollingVolPct: 0.16 };
  const raw = getCandlesForDataset(active.id);
  if (raw.length === 0) return { spot: 53760, dateStr: '2026-11-11', timeStr: '15:25', rollingVolPct: 0.16 };
  const enriched = calculateIndicators(raw);
  const last = enriched[enriched.length - 1];
  return {
    spot: last.close,
    dateStr: last.date_str,
    timeStr: last.time_str,
    rollingVolPct: last.volatility,
  };
}

app.get('/api/options/chain', async (req, res) => {
  try {
    const ctx = await getActiveMarketContext();
    res.json(buildOptionsChainFromContext(ctx, req.query.mode));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/options/upload', upload.single('file'), (req, res) => {
  try {
    let csvText = '';
    let name = 'Uploaded Options Chain CSV';
    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
      name = req.file.originalname || name;
    } else if (typeof req.body?.csvText === 'string') {
      csvText = req.body.csvText;
      name = req.body.filename || name;
    } else {
      return res.status(400).json({ error: 'Please provide an Options CSV file or csvText payload.' });
    }

    const rows = parseOptionsCSV(csvText);
    const expiry = rows[0]?.expiry ?? getReferenceExpiry();
    const now = new Date().toISOString();

    db.prepare('UPDATE options_chain_uploads SET is_active = 0').run();
    const ins = db
      .prepare(
        'INSERT INTO options_chain_uploads (name, expiry, record_count, rows_json, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      )
      .run(name, expiry, rows.length, JSON.stringify(rows), now);

    // Switch default optionsMode in settings to 'csv'
    const settings = getAppSettingsObject();
    settings.dataSource.optionsMode = 'csv';
    db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(settings),
      now
    );

    res.json({
      uploadId: Number(ins.lastInsertRowid),
      name,
      expiry,
      recordCount: rows.length,
      mode: 'csv',
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/options/mode', (req, res) => {
  try {
    const mode = req.body?.mode === 'csv' ? 'csv' : 'simulated';
    if (mode === 'csv' && !getActiveOptionsUpload()) {
      return res.status(400).json({
        error: 'No Historical Options CSV uploaded yet. Upload an Options CSV first or stay on Simulated Black-Scholes mode.',
      });
    }
    const settings = getAppSettingsObject();
    settings.dataSource.optionsMode = mode;
    const now = new Date().toISOString();
    db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(settings),
      now
    );
    res.json({ optionsMode: mode });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 6. PAPER TRADING (INDEX + OPTIONS CE/PE + AUTO-EXECUTE SIGNALS)
// ============================================================================
function getCurrentMarkPrice(): { price: number; timestampLabel: string; rollingVolPct: number | null; dateStr: string } {
  const { spot, dateStr, timeStr, rollingVolPct } = getLatestSpotAndVol();
  return { price: spot, timestampLabel: `${dateStr} ${timeStr} IST`, rollingVolPct, dateStr };
}

function getOptionMarkPremium(params: {
  strike: number;
  optionType: 'CE' | 'PE';
  spot: number;
  rollingVolPct: number | null;
  dateStr: string;
}): number {
  const settings = getAppSettingsObject();
  const activeUpload = getActiveOptionsUpload();
  if (settings.dataSource.optionsMode === 'csv' && activeUpload) {
    const rows = JSON.parse(activeUpload.rows_json) as UploadedOptionRow[];
    const match = rows.find((r) => r.strike === params.strike && r.type === params.optionType);
    if (match) return match.ltp;
  }
  const annualizedIv = params.rollingVolPct
    ? Math.max(0.12, Math.min(0.28, (params.rollingVolPct / 100) * Math.sqrt(75 * 252)))
    : 0.158;
  const moneynessDist = Math.abs(params.strike - params.spot) / Math.max(1, params.spot);
  const smileIv =
    params.optionType === 'CE'
      ? annualizedIv + moneynessDist * 0.45 + (params.strike > params.spot ? 0.004 : 0)
      : annualizedIv + moneynessDist * 0.55 + (params.strike < params.spot ? 0.008 : 0);
  const greeks = computeBlackScholesGreeks({
    spot: params.spot,
    strike: params.strike,
    timeToExpiryYears: 5 / 365,
    volatilityDecimal: smileIv,
    optionType: params.optionType,
  });
  return greeks.ltp;
}

function getRiskStateRow() {
  return db.prepare('SELECT * FROM risk_state WHERE id = 1').get() as
    | {
        id: number;
        cooldown_triggered_candle_ts: number | null;
        cooldown_triggered_wall_ms: number | null;
        cooldown_reason: string | null;
        last_reset_at: string;
      }
    | undefined;
}

function getConsecutiveLossStreakSinceReset(lastResetAt: string): number {
  const closed = db
    .prepare(
      "SELECT realized_pnl, closed_at FROM paper_orders WHERE status = 'CLOSED' AND COALESCE(closed_at, '') > ? ORDER BY closed_at DESC, id DESC LIMIT 20"
    )
    .all(lastResetAt || '') as Array<{ realized_pnl: number; closed_at: string }>;

  let streak = 0;
  for (const row of closed) {
    if (row.realized_pnl < 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function syncCooldownAfterOrderClose(latestCandleTs: number | null) {
  const settings = getAppSettingsObject();
  if (!settings.trading.consecutiveLossCooldownEnabled) return;
  const riskState = getRiskStateRow();
  const streak = getConsecutiveLossStreakSinceReset(riskState?.last_reset_at ?? '');
  const limit = Math.max(1, Number(settings.trading.consecutiveLossLimit ?? 2));
  if (streak >= limit && !riskState?.cooldown_triggered_candle_ts) {
    db.prepare(
      'UPDATE risk_state SET cooldown_triggered_candle_ts = ?, cooldown_triggered_wall_ms = ?, cooldown_reason = ? WHERE id = 1'
    ).run(latestCandleTs ?? Math.floor(Date.now() / 1000), Date.now(), `${streak} consecutive losing trades`);
  }
}

function resetRiskCooldownState() {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE risk_state SET cooldown_triggered_candle_ts = NULL, cooldown_triggered_wall_ms = NULL, cooldown_reason = NULL, last_reset_at = ? WHERE id = 1'
  ).run(now);
}

function processOpenPositionExits(ctx: ActiveMarketContext) {
  const settings = getAppSettingsObject();
  const latest = ctx.candles[ctx.candles.length - 1];
  if (!latest) return [];

  const openOrders = db
    .prepare("SELECT * FROM paper_orders WHERE status = 'OPEN' ORDER BY id ASC")
    .all() as Array<{
    id: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entry_price: number;
    stop_loss: number;
    target_price: number;
    instrument_type: string | null;
    option_strike: number | null;
    option_type: 'CE' | 'PE' | null;
    opened_candle_ts: number | null;
  }>;

  const autoClosed: Array<{ orderId: number; symbol: string; reason: string; realizedPnl: number }> = [];

  for (const pos of openOrders) {
    const isOption = pos.instrument_type === 'OPTION' && pos.option_strike && pos.option_type;
    const markPrice = isOption
      ? getOptionMarkPremium({
          strike: pos.option_strike!,
          optionType: pos.option_type!,
          spot: ctx.spotPrice,
          rollingVolPct: latest.volatility,
          dateStr: ctx.dateStr,
        })
      : ctx.spotPrice;

    let exitReason: string | null = null;

    // 1. Stop-Loss & Target check during live / replay streaming
    if (ctx.feedMode !== 'historical_csv' && pos.opened_candle_ts !== latest.timestamp) {
      if (pos.side === 'BUY') {
        if (markPrice <= pos.stop_loss) exitReason = 'Stop-Loss Hit';
        else if (markPrice >= pos.target_price) exitReason = 'Target Hit';
      } else {
        if (markPrice >= pos.stop_loss) exitReason = 'Stop-Loss Hit';
        else if (markPrice <= pos.target_price) exitReason = 'Target Hit';
      }
    }

    // 2. Time-Based Option Exit after N candles (default 6 candles = 30 mins) to prevent Theta decay bleed
    if (
      !exitReason &&
      isOption &&
      settings.trading.timeBasedOptionExitEnabled &&
      pos.opened_candle_ts
    ) {
      const maxHoldCandles = Math.max(1, Number(settings.trading.optionMaxHoldCandles ?? 6));
      const candlesHeld = ctx.candles.filter((c) => c.timestamp > pos.opened_candle_ts!).length;
      if (candlesHeld >= maxHoldCandles) {
        exitReason = `Time-Based Option Exit (${candlesHeld} candles / Theta Guard)`;
      }
    }

    if (exitReason) {
      const pnl =
        pos.side === 'BUY'
          ? (markPrice - pos.entry_price) * pos.quantity
          : (pos.entry_price - markPrice) * pos.quantity;
      const roundedPnl = Number(pnl.toFixed(2));
      const now = new Date().toISOString();

      db.exec('BEGIN');
      try {
        db.prepare(
          "UPDATE paper_orders SET status = 'CLOSED', exit_price = ?, realized_pnl = ?, exit_reason = ?, closed_at = ? WHERE id = ?"
        ).run(Number(markPrice.toFixed(2)), roundedPnl, exitReason, now, pos.id);

        db.prepare(
          'UPDATE paper_portfolio SET cash_balance = cash_balance + ?, realized_pnl = realized_pnl + ?, updated_at = ? WHERE id = 1'
        ).run(roundedPnl, roundedPnl, now);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      syncCooldownAfterOrderClose(latest.timestamp);
      autoClosed.push({ orderId: pos.id, symbol: pos.symbol, reason: exitReason, realizedPnl: roundedPnl });
    }
  }

  return autoClosed;
}

type GuardrailLevel = 'ACTIVE' | 'WARNING' | 'TRIGGERED';

function computeRiskTelemetry(
  ctx: ActiveMarketContext,
  portfolio: ReturnType<typeof computePortfolioSnapshot>
) {
  const settings = getAppSettingsObject();
  const latest = ctx.candles[ctx.candles.length - 1] ?? null;

  // 1. Daily Max Loss Kill-Switch
  const dailyMaxLossLimit = Math.max(100, Math.abs(Number(settings.trading.dailyMaxLoss ?? 3000)));
  const lossUsed = Math.max(0, -portfolio.dailyNetPnl);
  const lossPctUsed = Number(Math.min(100, (lossUsed / dailyMaxLossLimit) * 100).toFixed(1));
  const dailyLossStatus: GuardrailLevel =
    portfolio.dailyNetPnl <= -dailyMaxLossLimit
      ? 'TRIGGERED'
      : lossUsed >= dailyMaxLossLimit * 0.75
      ? 'WARNING'
      : 'ACTIVE';

  // 2. Max Open Positions
  const maxPosLimit = Math.max(1, Number(settings.trading.maxOpenPositions ?? 3));
  const openCount = portfolio.openPositions.length;
  const maxPosStatus: GuardrailLevel =
    openCount >= maxPosLimit
      ? 'TRIGGERED'
      : maxPosLimit >= 2 && openCount >= maxPosLimit - 1
      ? 'WARNING'
      : 'ACTIVE';

  // 3. ADX Chop Filter
  const adxEnabled = Boolean(settings.trading.adxChopFilterEnabled ?? true);
  const adxMin = Number(settings.trading.adxMinThreshold ?? 18);
  const currentAdx = latest?.adx ?? null;
  let adxStatus: GuardrailLevel = 'ACTIVE';
  if (adxEnabled && currentAdx !== null) {
    if (currentAdx < adxMin) adxStatus = 'TRIGGERED';
    else if (currentAdx < adxMin + 3) adxStatus = 'WARNING';
  }

  // 4. Consecutive-Loss Cooldown (6 candles / 30 mins after 2 consecutive losses)
  const cooldownEnabled = Boolean(settings.trading.consecutiveLossCooldownEnabled ?? true);
  const lossLimit = Math.max(1, Number(settings.trading.consecutiveLossLimit ?? 2));
  const cooldownCandles = Math.max(1, Number(settings.trading.cooldownCandles ?? 6));
  const riskState = getRiskStateRow();
  const streak = getConsecutiveLossStreakSinceReset(riskState?.last_reset_at ?? '');
  let candlesRemaining = 0;

  if (cooldownEnabled && riskState?.cooldown_triggered_candle_ts) {
    const candlesAfterTrigger = ctx.candles.filter(
      (c) => c.timestamp > riskState.cooldown_triggered_candle_ts!
    ).length;
    const wallMinsElapsed = riskState.cooldown_triggered_wall_ms
      ? (Date.now() - riskState.cooldown_triggered_wall_ms) / 60000
      : 0;
    const effectiveElapsed = Math.max(
      candlesAfterTrigger,
      ctx.feedMode === 'free_live_nse' ? Math.floor(wallMinsElapsed / 5) : 0
    );
    candlesRemaining = Math.max(0, cooldownCandles - effectiveElapsed);
    if (candlesRemaining === 0) {
      resetRiskCooldownState();
    }
  } else if (cooldownEnabled && streak >= lossLimit && latest) {
    db.prepare(
      'UPDATE risk_state SET cooldown_triggered_candle_ts = ?, cooldown_triggered_wall_ms = ?, cooldown_reason = ? WHERE id = 1'
    ).run(latest.timestamp, Date.now(), `${streak} consecutive losing trades`);
    candlesRemaining = cooldownCandles;
  }

  const cooldownStatus: GuardrailLevel = !cooldownEnabled
    ? 'ACTIVE'
    : candlesRemaining > 0
    ? 'TRIGGERED'
    : streak >= Math.max(1, lossLimit - 1)
    ? 'WARNING'
    : 'ACTIVE';

  // 5. Time-Based Option Exit telemetry
  const maxHoldCandles = Math.max(1, Number(settings.trading.optionMaxHoldCandles ?? 6));
  const openOptions = portfolio.openPositions.filter((p) => p.instrument_type === 'OPTION');
  let maxCandlesHeld = 0;
  for (const pos of openOptions) {
    if (pos.opened_candle_ts) {
      const held = ctx.candles.filter((c) => c.timestamp > pos.opened_candle_ts!).length;
      if (held > maxCandlesHeld) maxCandlesHeld = held;
    }
  }

  const statuses: GuardrailLevel[] = [dailyLossStatus, maxPosStatus, adxStatus, cooldownStatus];
  const overallStatus: GuardrailLevel = statuses.includes('TRIGGERED')
    ? 'TRIGGERED'
    : statuses.includes('WARNING')
    ? 'WARNING'
    : 'ACTIVE';

  return {
    overallStatus,
    canPlaceManualOrder: dailyLossStatus !== 'TRIGGERED' && maxPosStatus !== 'TRIGGERED',
    canAutoExecute:
      dailyLossStatus !== 'TRIGGERED' &&
      maxPosStatus !== 'TRIGGERED' &&
      adxStatus !== 'TRIGGERED' &&
      cooldownStatus !== 'TRIGGERED',
    latestSpot: ctx.spotPrice,
    latestAtr: latest?.atr ?? null,
    latestAdx: currentAdx,
    guardrails: {
      dailyLossCap: {
        status: dailyLossStatus,
        dailyNetPnl: portfolio.dailyNetPnl,
        limit: dailyMaxLossLimit,
        pctUsed: lossPctUsed,
        detail:
          dailyLossStatus === 'TRIGGERED'
            ? `Kill-Switch Halted: Daily Net P&L ₹${portfolio.dailyNetPnl.toFixed(0)} hit -₹${dailyMaxLossLimit}`
            : `Daily Net P&L ₹${portfolio.dailyNetPnl.toFixed(0)} / -₹${dailyMaxLossLimit} cap`,
      },
      maxOpenPositions: {
        status: maxPosStatus,
        openCount,
        limit: maxPosLimit,
        detail: `${openCount}/${maxPosLimit} active positions`,
      },
      adxRegimeFilter: {
        status: adxStatus,
        enabled: adxEnabled,
        currentAdx,
        minThreshold: adxMin,
        detail: !adxEnabled
          ? 'Filter Disabled'
          : currentAdx === null
          ? 'Warming up ADX(14)'
          : currentAdx < adxMin
          ? `Blocked: ADX(14) ${currentAdx.toFixed(1)} < ${adxMin} (Choppy Regime)`
          : `Trending: ADX(14) ${currentAdx.toFixed(1)} ≥ ${adxMin}`,
      },
      consecutiveLossCooldown: {
        status: cooldownStatus,
        enabled: cooldownEnabled,
        consecutiveLosses: streak,
        lossLimit,
        candlesRemaining,
        cooldownCandles,
        detail: !cooldownEnabled
          ? 'Cooldown Disabled'
          : candlesRemaining > 0
          ? `Paused: ${candlesRemaining} candles (${candlesRemaining * 5}m) remaining after ${lossLimit} losses`
          : `Loss Streak ${streak}/${lossLimit} · Clear`,
      },
      timeBasedOptionExit: {
        enabled: Boolean(settings.trading.timeBasedOptionExitEnabled ?? true),
        maxHoldCandles,
        openOptionPositionsCount: openOptions.length,
        maxCandlesHeld,
      },
    },
  };
}

function computePortfolioSnapshot(markOverride?: {
  price: number;
  timestampLabel: string;
  rollingVolPct: number | null;
  dateStr: string;
}) {
  const portfolio = db.prepare('SELECT * FROM paper_portfolio WHERE id = 1').get() as {
    initial_capital: number;
    cash_balance: number;
    realized_pnl: number;
    updated_at: string;
  };
  const openPositions = db
    .prepare("SELECT * FROM paper_orders WHERE status = 'OPEN' ORDER BY id DESC")
    .all() as Array<{
    id: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entry_price: number;
    stop_loss: number;
    target_price: number;
    instrument_type: string | null;
    option_strike: number | null;
    option_type: 'CE' | 'PE' | null;
    option_expiry: string | null;
    lot_size: number | null;
    lots: number | null;
    is_auto_executed: number | null;
    rationale: string | null;
    opened_candle_ts: number | null;
    opened_at: string;
    notes: string | null;
  }>;

  const mark = markOverride ?? getCurrentMarkPrice();
  let totalUnrealizedPnl = 0;
  let lockedCapital = 0;

  const enrichedOpen = openPositions.map((pos) => {
    const isOption = pos.instrument_type === 'OPTION' && pos.option_strike && pos.option_type;
    const currentMark = isOption
      ? getOptionMarkPremium({
          strike: pos.option_strike!,
          optionType: pos.option_type!,
          spot: mark.price,
          rollingVolPct: mark.rollingVolPct,
          dateStr: mark.dateStr,
        })
      : mark.price;

    const unrealized =
      pos.side === 'BUY'
        ? (currentMark - pos.entry_price) * pos.quantity
        : (pos.entry_price - currentMark) * pos.quantity;

    const posCapital = isOption
      ? pos.side === 'BUY'
        ? pos.entry_price * pos.quantity
        : Math.max(pos.entry_price * pos.quantity * 2.5, mark.price * pos.quantity * 0.1)
      : pos.entry_price * pos.quantity * 0.1;

    totalUnrealizedPnl += unrealized;
    lockedCapital += posCapital;

    return {
      ...pos,
      instrument_type: isOption ? 'OPTION' : 'INDEX',
      mark_price: Number(currentMark.toFixed(2)),
      unrealized_pnl: Number(unrealized.toFixed(2)),
      capital_used: Number(posCapital.toFixed(2)),
    };
  });

  const totalEquity = portfolio.cash_balance + totalUnrealizedPnl;
  const availableCapital = Math.max(0, portfolio.cash_balance - lockedCapital);
  const dailyNetPnl = portfolio.realized_pnl + totalUnrealizedPnl;

  return {
    isSimulated: true,
    disclaimer: 'Simulated Paper Trading Only — Virtual ₹1,00,000 capital. No real broker orders are placed.',
    initialCapital: portfolio.initial_capital,
    cashBalance: Number(portfolio.cash_balance.toFixed(2)),
    lockedCapital: Number(lockedCapital.toFixed(2)),
    availableCapital: Number(availableCapital.toFixed(2)),
    realizedPnl: Number(portfolio.realized_pnl.toFixed(2)),
    unrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
    dailyNetPnl: Number(dailyNetPnl.toFixed(2)),
    totalEquity: Number(totalEquity.toFixed(2)),
    markPrice: mark.price,
    markTimestamp: mark.timestampLabel,
    openPositions: enrichedOpen,
    updatedAt: portfolio.updated_at,
  };
}

function executeSimulatedOrder(params: {
  instrumentType: 'INDEX' | 'OPTION';
  side: 'BUY' | 'SELL';
  quantity?: number;
  lots?: number;
  lotSize?: number;
  optionStrike?: number | null;
  optionType?: 'CE' | 'PE' | null;
  optionExpiry?: string | null;
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  notes?: string;
  rationale?: string;
  isAutoExecuted?: boolean;
  openedCandleTs?: number | null;
  markOverride?: {
    price: number;
    timestampLabel: string;
    rollingVolPct: number | null;
    dateStr: string;
  };
}) {
  const settings = getAppSettingsObject();
  const snap = computePortfolioSnapshot(params.markOverride);
  const mark = params.markOverride ?? getCurrentMarkPrice();

  const isOption = params.instrumentType === 'OPTION';
  const lotSize = isOption ? (params.lotSize ?? BANKNIFTY_LOT_SIZE) : 1;
  const lots = isOption ? Math.max(1, Math.round(params.lots ?? 1)) : 1;
  const quantity = isOption ? lots * lotSize : Math.max(1, Math.round(params.quantity ?? 15));

  const strike = isOption ? (params.optionStrike ?? Math.round(mark.price / 100) * 100) : null;
  const optionType = isOption ? (params.optionType ?? 'CE') : null;
  const expiry = isOption ? (params.optionExpiry ?? getReferenceExpiry(mark.dateStr)) : null;

  const refPrice = isOption
    ? getOptionMarkPremium({
        strike: strike!,
        optionType: optionType!,
        spot: mark.price,
        rollingVolPct: mark.rollingVolPct,
        dateStr: mark.dateStr,
      })
    : mark.price;

  const entryPrice = Number((params.entryPrice && params.entryPrice > 0 ? params.entryPrice : refPrice).toFixed(2));
  const stopLoss = Number(
    (params.stopLoss && params.stopLoss > 0
      ? params.stopLoss
      : isOption
      ? params.side === 'BUY'
        ? Math.max(1, entryPrice * 0.8)
        : entryPrice * 1.2
      : params.side === 'BUY'
      ? entryPrice * 0.9965
      : entryPrice * 1.0035
    ).toFixed(2)
  );
  const targetPrice = Number(
    (params.targetPrice && params.targetPrice > 0
      ? params.targetPrice
      : isOption
      ? params.side === 'BUY'
        ? entryPrice * 1.4
        : Math.max(1, entryPrice * 0.6)
      : params.side === 'BUY'
      ? entryPrice * 1.007
      : entryPrice * 0.993
    ).toFixed(2)
  );

  // Guardrail 1: Daily Max Loss Kill-Switch (halts ALL new orders)
  const dailyMaxLoss = Number(settings.trading.dailyMaxLoss ?? 3000);
  if (snap.dailyNetPnl <= -Math.abs(dailyMaxLoss)) {
    throw new Error(
      `BLOCKED (Daily Max Loss Kill-Switch): Net P&L ₹${snap.dailyNetPnl.toFixed(0)} hit daily loss limit of -₹${dailyMaxLoss}.`
    );
  }

  // Guardrail 2: Max Open Positions check
  const maxOpen = Number(settings.trading.maxOpenPositions ?? 3);
  if (snap.openPositions.length >= maxOpen) {
    throw new Error(
      `BLOCKED (Max Open Positions): ${snap.openPositions.length}/${maxOpen} open positions active.`
    );
  }

  // Guardrail 3: Capital Required = Option Premium × Lot Size × Lots (for Option BUY), or margin for SELL/Index
  const capitalRequired = isOption
    ? params.side === 'BUY'
      ? entryPrice * lotSize * lots
      : Math.max(entryPrice * lotSize * lots * 2.5, mark.price * lotSize * lots * 0.1)
    : entryPrice * quantity * 0.1;

  if (capitalRequired > snap.availableCapital) {
    throw new Error(
      `BLOCKED (Insufficient Capital): Required ₹${capitalRequired.toFixed(0)}, available ₹${snap.availableCapital.toFixed(0)}.`
    );
  }

  const symbol = isOption ? `BANKNIFTY ${expiry} ${strike} ${optionType}` : 'BANK NIFTY (SIM)';
  const now = new Date().toISOString();

  const orderRes = db
    .prepare(
      `INSERT INTO paper_orders (
        symbol, side, quantity, entry_price, stop_loss, target_price, status, realized_pnl,
        notes, instrument_type, option_strike, option_type, option_expiry, lot_size, lots,
        is_auto_executed, rationale, opened_candle_ts, opened_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      symbol,
      params.side,
      quantity,
      entryPrice,
      stopLoss,
      targetPrice,
      params.notes ?? '',
      isOption ? 'OPTION' : 'INDEX',
      strike,
      optionType,
      expiry,
      lotSize,
      lots,
      params.isAutoExecuted ? 1 : 0,
      params.rationale ?? null,
      params.openedCandleTs ?? null,
      now
    );

  db.prepare('UPDATE paper_portfolio SET updated_at = ? WHERE id = 1').run(now);

  return {
    orderId: Number(orderRes.lastInsertRowid),
    symbol,
    instrumentType: isOption ? 'OPTION' : 'INDEX',
    side: params.side,
    quantity,
    lots,
    lotSize,
    strike,
    optionType,
    expiry,
    entryPrice,
    stopLoss,
    targetPrice,
    capitalRequired: Number(capitalRequired.toFixed(2)),
    status: 'OPEN',
  };
}

function checkAutoExecutionGuardrails(
  ctx: ActiveMarketContext,
  portfolio: ReturnType<typeof computePortfolioSnapshot>
): string | null {
  const telemetry = computeRiskTelemetry(ctx, portfolio);
  if (telemetry.guardrails.dailyLossCap.status === 'TRIGGERED') {
    return telemetry.guardrails.dailyLossCap.detail;
  }
  if (telemetry.guardrails.adxRegimeFilter.status === 'TRIGGERED') {
    return telemetry.guardrails.adxRegimeFilter.detail;
  }
  if (telemetry.guardrails.consecutiveLossCooldown.status === 'TRIGGERED') {
    return telemetry.guardrails.consecutiveLossCooldown.detail;
  }
  if (telemetry.guardrails.maxOpenPositions.status === 'TRIGGERED') {
    return `BLOCKED (Max Open Positions): ${telemetry.guardrails.maxOpenPositions.detail}`;
  }
  return null;
}

async function tryAutoExecuteLatestSignal() {
  const settings = getAppSettingsObject();
  const ctx = await getActiveMarketContext();
  const latestBar = ctx.candles[ctx.candles.length - 1] ?? null;
  const markOverride = {
    price: ctx.spotPrice,
    timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
    rollingVolPct: latestBar?.volatility ?? null,
    dateStr: ctx.dateStr,
  };

  const latestSignal = db
    .prepare(
      "SELECT * FROM signals WHERE signal_type IN ('BUY', 'SELL') ORDER BY timestamp DESC LIMIT 1"
    )
    .get() as
    | {
        id: number;
        timestamp: number;
        date_str: string;
        time_str: string;
        signal_type: 'BUY' | 'SELL';
        option_contract: string | null;
        option_strike: number | null;
        option_type: 'CE' | 'PE' | null;
        option_expiry: string | null;
        option_lot_size: number | null;
        option_entry_premium: number | null;
        option_stop_loss: number | null;
        option_target: number | null;
        reason: string;
      }
    | undefined;

  if (!latestSignal) {
    return { executed: false, reason: 'No actionable BUY or SELL signal available yet (train model first).' };
  }

  // Prevent duplicate execution for the exact same signal ID
  const existingLog = db
    .prepare("SELECT id FROM auto_execution_logs WHERE signal_id = ? AND risk_check_status = 'PASSED'")
    .get(latestSignal.id);
  if (existingLog) {
    return {
      executed: false,
      reason: `Latest signal (${latestSignal.signal_type} ${latestSignal.option_contract ?? ''}) was already auto-executed.`,
    };
  }

  const now = new Date().toISOString();
  const lotSize = latestSignal.option_lot_size ?? BANKNIFTY_LOT_SIZE;
  const entryPrem = latestSignal.option_entry_premium ?? 250;
  const slPrem = latestSignal.option_stop_loss ?? Number(Math.max(1, entryPrem * 0.8).toFixed(2));
  const portfolio = computePortfolioSnapshot(markOverride);

  // Volatility-adjusted lot sizing when ATR-Dynamic mode is enabled
  let lots = Math.max(1, Number(settings.trading.defaultLots ?? 1));
  if (settings.trading.stopLossMode === 'atr_dynamic') {
    const slDist = Math.max(1, entryPrem - slPrem);
    const maxRiskRupees = (portfolio.totalEquity * Number(settings.trading.riskPerTradePct ?? 1.0)) / 100;
    lots = Math.max(1, Math.floor(maxRiskRupees / (slDist * lotSize)));
  }

  const contractName =
    latestSignal.option_contract ??
    `BANKNIFTY ${latestSignal.option_expiry ?? getReferenceExpiry()} ${latestSignal.option_strike ?? ''} ${latestSignal.option_type ?? (latestSignal.signal_type === 'BUY' ? 'CE' : 'PE')}`;
  const capReq = Number((entryPrem * lotSize * lots).toFixed(2));

  try {
    const blockReason = checkAutoExecutionGuardrails(ctx, portfolio);
    if (blockReason) {
      throw new Error(blockReason);
    }

    const order = executeSimulatedOrder({
      instrumentType: 'OPTION',
      side: 'BUY', // Directional option buyer: BUY CE on BUY signal, BUY PE on SELL signal
      lots,
      lotSize,
      optionStrike: latestSignal.option_strike,
      optionType: latestSignal.option_type ?? (latestSignal.signal_type === 'BUY' ? 'CE' : 'PE'),
      optionExpiry: latestSignal.option_expiry,
      entryPrice: entryPrem,
      stopLoss: slPrem,
      targetPrice: latestSignal.option_target ?? undefined,
      notes: `Auto-Executed on ${latestSignal.signal_type} signal (${latestSignal.date_str} ${latestSignal.time_str})`,
      rationale: latestSignal.reason,
      isAutoExecuted: true,
      openedCandleTs: latestBar?.timestamp ?? latestSignal.timestamp,
      markOverride,
    });

    db.prepare(
      `INSERT INTO auto_execution_logs (
        signal_id, signal_type, contract_name, strike, option_type, entry_premium,
        lots, capital_required, risk_check_status, risk_check_detail, rationale, order_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PASSED', ?, ?, ?, ?)`
    ).run(
      latestSignal.id,
      latestSignal.signal_type,
      contractName,
      latestSignal.option_strike,
      latestSignal.option_type,
      order.entryPrice,
      lots,
      order.capitalRequired,
      `Passed: Capital ₹${order.capitalRequired.toLocaleString('en-IN')} · ADX/Cooldown/Loss Cap Clear`,
      latestSignal.reason,
      order.orderId,
      now
    );

    return { executed: true, status: 'PASSED', order };
  } catch (err) {
    const detail = (err as Error).message;
    db.prepare(
      `INSERT INTO auto_execution_logs (
        signal_id, signal_type, contract_name, strike, option_type, entry_premium,
        lots, capital_required, risk_check_status, risk_check_detail, rationale, order_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?, ?, NULL, ?)`
    ).run(
      latestSignal.id,
      latestSignal.signal_type,
      contractName,
      latestSignal.option_strike,
      latestSignal.option_type,
      entryPrem,
      lots,
      capReq,
      detail,
      latestSignal.reason,
      now
    );
    return { executed: false, status: 'BLOCKED', reason: detail };
  }
}

app.get('/api/risk/status', async (_req, res) => {
  try {
    const ctx = await getActiveMarketContext();
    processOpenPositionExits(ctx);
    const lastVol = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].volatility : null;
    const portfolio = computePortfolioSnapshot({
      price: ctx.spotPrice,
      timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
      rollingVolPct: lastVol,
      dateStr: ctx.dateStr,
    });
    const riskTelemetry = computeRiskTelemetry(ctx, portfolio);
    res.json({
      riskTelemetry,
      tradingSettings: getAppSettingsObject().trading,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/risk/reset-cooldown', async (_req, res) => {
  try {
    resetRiskCooldownState();
    const ctx = await getActiveMarketContext();
    const lastVol = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].volatility : null;
    const portfolio = computePortfolioSnapshot({
      price: ctx.spotPrice,
      timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
      rollingVolPct: lastVol,
      dateStr: ctx.dateStr,
    });
    const riskTelemetry = computeRiskTelemetry(ctx, portfolio);
    res.json({ success: true, riskTelemetry });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/portfolio', async (_req, res) => {
  try {
    const ctx = await getActiveMarketContext();
    processOpenPositionExits(ctx);
    const lastVol = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].volatility : null;
    const snap = computePortfolioSnapshot({
      price: ctx.spotPrice,
      timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
      rollingVolPct: lastVol,
      dateStr: ctx.dateStr,
    });
    const riskTelemetry = computeRiskTelemetry(ctx, snap);
    res.json({
      ...snap,
      riskTelemetry,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/paper-trading/order', async (req, res) => {
  try {
    const ctx = await getActiveMarketContext();
    const latestBar = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1] : null;
    const lastVol = latestBar?.volatility ?? null;
    const instrumentType = req.body?.instrumentType === 'OPTION' ? 'OPTION' : 'INDEX';
    const side = req.body?.side === 'SELL' ? 'SELL' : 'BUY';

    const order = executeSimulatedOrder({
      instrumentType,
      side,
      quantity: req.body?.quantity !== undefined ? Number(req.body.quantity) : undefined,
      lots: req.body?.lots !== undefined ? Number(req.body.lots) : undefined,
      lotSize: req.body?.lotSize !== undefined ? Number(req.body.lotSize) : BANKNIFTY_LOT_SIZE,
      optionStrike: req.body?.optionStrike !== undefined ? Number(req.body.optionStrike) : null,
      optionType: req.body?.optionType === 'PE' ? 'PE' : req.body?.optionType === 'CE' ? 'CE' : null,
      optionExpiry: typeof req.body?.optionExpiry === 'string' ? req.body.optionExpiry : null,
      entryPrice: req.body?.entryPrice !== undefined ? Number(req.body.entryPrice) : undefined,
      stopLoss: req.body?.stopLoss !== undefined ? Number(req.body.stopLoss) : undefined,
      targetPrice: req.body?.targetPrice !== undefined ? Number(req.body.targetPrice) : undefined,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : '',
      rationale: typeof req.body?.rationale === 'string' ? req.body.rationale : undefined,
      isAutoExecuted: false,
      openedCandleTs: latestBar?.timestamp ?? null,
      markOverride: {
        price: ctx.spotPrice,
        timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
        rollingVolPct: lastVol,
        dateStr: ctx.dateStr,
      },
    });

    res.json(order);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/paper-trading/auto-execute', async (req, res) => {
  try {
    const settings = getAppSettingsObject();
    if (typeof req.body?.enabled === 'boolean') {
      settings.trading.autoExecuteSignals = req.body.enabled;
      const now = new Date().toISOString();
      db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
        JSON.stringify(settings),
        now
      );
    }

    let execution: unknown = null;
    if (settings.trading.autoExecuteSignals && req.body?.triggerNow !== false) {
      execution = await tryAutoExecuteLatestSignal();
    }

    const logs = db.prepare('SELECT * FROM auto_execution_logs ORDER BY id DESC LIMIT 30').all();
    res.json({
      autoExecuteSignals: settings.trading.autoExecuteSignals,
      execution,
      logs,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/paper-trading/auto-logs', (_req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM auto_execution_logs ORDER BY id DESC LIMIT 40').all();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/paper-trading/close', async (req, res) => {
  try {
    const orderId = Number(req.body?.orderId);
    const order = db.prepare("SELECT * FROM paper_orders WHERE id = ? AND status = 'OPEN'").get(orderId) as
      | {
          id: number;
          side: 'BUY' | 'SELL';
          quantity: number;
          entry_price: number;
          instrument_type: string | null;
          option_strike: number | null;
          option_type: 'CE' | 'PE' | null;
        }
      | undefined;

    if (!order) {
      return res.status(404).json({ error: 'Open paper order not found.' });
    }

    const ctx = await getActiveMarketContext();
    const latestBar = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1] : null;
    const lastVol = latestBar?.volatility ?? null;
    const isOption = order.instrument_type === 'OPTION' && order.option_strike && order.option_type;
    const defaultExit = isOption
      ? getOptionMarkPremium({
          strike: order.option_strike!,
          optionType: order.option_type!,
          spot: ctx.spotPrice,
          rollingVolPct: lastVol,
          dateStr: ctx.dateStr,
        })
      : ctx.spotPrice;

    const exitPrice = Number(req.body?.exitPrice ?? defaultExit);
    const pnl =
      order.side === 'BUY'
        ? (exitPrice - order.entry_price) * order.quantity
        : (order.entry_price - exitPrice) * order.quantity;
    const roundedPnl = Number(pnl.toFixed(2));
    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
      db.prepare(
        "UPDATE paper_orders SET status = 'CLOSED', exit_price = ?, realized_pnl = ?, exit_reason = 'Manual Close', closed_at = ? WHERE id = ?"
      ).run(Number(exitPrice.toFixed(2)), roundedPnl, now, orderId);

      db.prepare(
        'UPDATE paper_portfolio SET cash_balance = cash_balance + ?, realized_pnl = realized_pnl + ?, updated_at = ? WHERE id = 1'
      ).run(roundedPnl, roundedPnl, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    syncCooldownAfterOrderClose(latestBar?.timestamp ?? null);

    res.json({
      orderId,
      exitPrice: Number(exitPrice.toFixed(2)),
      realizedPnl: roundedPnl,
      status: 'CLOSED',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/paper-trading/reset', (_req, res) => {
  try {
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM paper_orders').run();
      db.prepare('DELETE FROM auto_execution_logs').run();
      db.prepare(
        'UPDATE paper_portfolio SET initial_capital = 100000, cash_balance = 100000, realized_pnl = 0, updated_at = ? WHERE id = 1'
      ).run(now);
      db.prepare(
        'UPDATE risk_state SET cooldown_triggered_candle_ts = NULL, cooldown_triggered_wall_ms = NULL, cooldown_reason = NULL, last_reset_at = ? WHERE id = 1'
      ).run(now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ success: true, initialCapital: 100000 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/paper-trading/history', (_req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM paper_orders ORDER BY id DESC').all();
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 7. SETTINGS
// ============================================================================
app.get('/api/settings', (_req, res) => {
  try {
    const row = db.prepare('SELECT updated_at FROM app_settings WHERE id = 1').get() as {
      updated_at: string;
    };
    res.json({ settings: getAppSettingsObject(), updatedAt: row?.updated_at ?? new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const incoming = req.body?.settings;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload.' });
    }
    if (incoming.broker) {
      incoming.broker.liveTradingEnabled = false;
      delete incoming.broker.apiKey;
      delete incoming.broker.apiSecret;
      delete incoming.broker.accessToken;
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(incoming),
      now
    );
    res.json({ settings: getAppSettingsObject(), updatedAt: now });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// 8. LIVE MARKET FEED MODE SWITCHER & SERVER-SENT EVENTS (GET /api/market/stream)
// ============================================================================
const sseClients = new Set<express.Response>();
let streamTimer: ReturnType<typeof setInterval> | null = null;
let streamTickCounter = 0;
let lastStreamAutoKey = '';

async function buildMarketStreamPayload(options?: { includeFullCandles?: boolean; forceLiveFetch?: boolean }) {
  const ctx = await getActiveMarketContext({ forceLiveFetch: options?.forceLiveFetch });
  const autoClosedExits = processOpenPositionExits(ctx);
  const overview = buildOverviewFromContext(ctx);
  const optionsChain = buildOptionsChainFromContext(ctx);
  const lastVol = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].volatility : null;
  const markOverride = {
    price: ctx.spotPrice,
    timestampLabel: `${ctx.dateStr} ${ctx.timeStr} IST`,
    rollingVolPct: lastVol,
    dateStr: ctx.dateStr,
  };
  let portfolio = computePortfolioSnapshot(markOverride);

  // If streaming in simulated_replay or free_live_nse and Auto-Execute is enabled,
  // auto-stage a paper trade when a new completed candle emits a BUY/SELL signal transition.
  const settings = getAppSettingsObject();
  const latest = ctx.candles[ctx.candles.length - 1] ?? null;
  let streamAutoEvent: unknown = autoClosedExits.length > 0 ? { autoClosed: true, exits: autoClosedExits } : null;

  if (
    settings.trading.autoExecuteSignals &&
    ctx.feedMode !== 'historical_csv' &&
    latest &&
    (ctx.feedMode === 'free_live_nse' || ctx.feedMeta.isBarComplete)
  ) {
    const predSignal = (overview.prediction as { signal?: string | null; optionRecommendation?: { contractName: string; strike: number; optionType: 'CE' | 'PE'; expiry: string; lotSize: number; entryPremium: number; stopLoss: number; targetPrice: number; recommendedLots?: number } | null; recommendation?: { reason: string } | null })?.signal;
    const optRec = (overview.prediction as { optionRecommendation?: { contractName: string; strike: number; optionType: 'CE' | 'PE'; expiry: string; lotSize: number; entryPremium: number; stopLoss: number; targetPrice: number; recommendedLots?: number } | null })?.optionRecommendation;
    const reason = (overview.prediction as { recommendation?: { reason: string } | null })?.recommendation?.reason ?? 'Streaming Random Forest signal';

    if ((predSignal === 'BUY' || predSignal === 'SELL') && optRec) {
      const autoKey = `${ctx.feedMode}_${latest.timestamp}_${predSignal}`;
      if (autoKey !== lastStreamAutoKey) {
        lastStreamAutoKey = autoKey;
        const lots = Math.max(
          1,
          Number(
            settings.trading.stopLossMode === 'atr_dynamic' && optRec.recommendedLots
              ? optRec.recommendedLots
              : settings.trading.defaultLots ?? 1
          )
        );
        const now = new Date().toISOString();
        try {
          const blockReason = checkAutoExecutionGuardrails(ctx, portfolio);
          if (blockReason) {
            throw new Error(blockReason);
          }

          const order = executeSimulatedOrder({
            instrumentType: 'OPTION',
            side: 'BUY',
            lots,
            lotSize: optRec.lotSize,
            optionStrike: optRec.strike,
            optionType: optRec.optionType,
            optionExpiry: optRec.expiry,
            entryPrice: optRec.entryPremium,
            stopLoss: optRec.stopLoss,
            targetPrice: optRec.targetPrice,
            notes: `Auto-Executed from ${ctx.feedMode} stream (${latest.date_str} ${latest.time_str})`,
            rationale: reason,
            isAutoExecuted: true,
            openedCandleTs: latest.timestamp,
            markOverride,
          });
          db.prepare(
            `INSERT INTO auto_execution_logs (
              signal_id, signal_type, contract_name, strike, option_type, entry_premium,
              lots, capital_required, risk_check_status, risk_check_detail, rationale, order_id, created_at
            ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'PASSED', ?, ?, ?, ?)`
          ).run(
            predSignal,
            optRec.contractName,
            optRec.strike,
            optRec.optionType,
            order.entryPrice,
            lots,
            order.capitalRequired,
            `Stream Passed: Capital ₹${order.capitalRequired.toLocaleString('en-IN')} · ADX/Cooldown/Loss Cap Clear`,
            reason,
            order.orderId,
            now
          );
          streamAutoEvent = { executed: true, contract: optRec.contractName, orderId: order.orderId };
          portfolio = computePortfolioSnapshot(markOverride);
        } catch (err) {
          const capReq = Number((optRec.entryPremium * optRec.lotSize * lots).toFixed(2));
          db.prepare(
            `INSERT INTO auto_execution_logs (
              signal_id, signal_type, contract_name, strike, option_type, entry_premium,
              lots, capital_required, risk_check_status, risk_check_detail, rationale, order_id, created_at
            ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?, ?, NULL, ?)`
          ).run(
            predSignal,
            optRec.contractName,
            optRec.strike,
            optRec.optionType,
            optRec.entryPremium,
            lots,
            capReq,
            (err as Error).message,
            reason,
            now
          );
        }
      }
    }
  }

  const riskTelemetry = computeRiskTelemetry(ctx, portfolio);

  return {
    type: 'market_tick',
    feedMode: ctx.feedMode,
    overview,
    optionsChain,
    portfolio: {
      ...portfolio,
      riskTelemetry,
    },
    riskTelemetry,
    latestCandle: latest,
    candles: options?.includeFullCandles ? ctx.candles : undefined,
    streamAutoEvent,
    serverTime: new Date().toISOString(),
  };
}

function broadcastSseEvent(payload: unknown) {
  const frame = `event: market_tick\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

function ensureStreamLoop() {
  if (streamTimer || sseClients.size === 0) return;
  streamTimer = setInterval(async () => {
    if (sseClients.size === 0) {
      if (streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
      }
      return;
    }

    try {
      streamTickCounter += 1;
      const settings = getAppSettingsObject();
      const feedMode = normalizeFeedMode(settings.dataSource.mode);

      if (feedMode === 'simulated_replay') {
        const active = getActiveDataset();
        if (active) {
          const raw = getCandlesForDataset(active.id);
          syncReplayBase(active.id, raw);
        }
        const { isBarComplete } = advanceReplayTick();
        const payload = await buildMarketStreamPayload({
          includeFullCandles: isBarComplete || streamTickCounter % 20 === 0,
        });
        broadcastSseEvent(payload);
      } else if (feedMode === 'free_live_nse') {
        // Poll Yahoo Finance ^NSEBANK every ~10 seconds (every 7th 1.5s interval)
        if (streamTickCounter % 7 === 0) {
          const payload = await buildMarketStreamPayload({
            includeFullCandles: true,
            forceLiveFetch: true,
          });
          broadcastSseEvent(payload);
        } else {
          for (const client of sseClients) {
            try {
              client.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
              sseClients.delete(client);
            }
          }
        }
      } else {
        // Static Historical CSV mode: heartbeat every 15s (no fake ticks)
        if (streamTickCounter % 10 === 0) {
          for (const client of sseClients) {
            try {
              client.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
              sseClients.delete(client);
            }
          }
        }
      }
    } catch {
      // Keep SSE loop alive across transient errors
    }
  }, 1500);
}

app.get('/api/market/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  ensureStreamLoop();

  try {
    const initialPayload = await buildMarketStreamPayload({ includeFullCandles: true });
    res.write(`event: market_tick\ndata: ${JSON.stringify(initialPayload)}\n\n`);
  } catch (err) {
    res.write(`event: stream_error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
  }

  req.on('close', () => {
    sseClients.delete(res);
    if (sseClients.size === 0 && streamTimer) {
      clearInterval(streamTimer);
      streamTimer = null;
    }
  });
});

app.post('/api/market/feed-mode', async (req, res) => {
  try {
    const requestedMode = normalizeFeedMode(req.body?.mode);
    const settings = getAppSettingsObject();
    settings.dataSource.mode = requestedMode;
    const now = new Date().toISOString();
    db.prepare('UPDATE app_settings SET settings_json = ?, updated_at = ? WHERE id = 1').run(
      JSON.stringify(settings),
      now
    );

    if (requestedMode === 'simulated_replay') {
      const active = getActiveDataset();
      if (active) {
        syncReplayBase(active.id, getCandlesForDataset(active.id));
        if (req.body?.resetReplay) {
          resetReplayEngine();
        }
      }
    }

    const payload = await buildMarketStreamPayload({
      includeFullCandles: true,
      forceLiveFetch: requestedMode === 'free_live_nse',
    });

    if (sseClients.size > 0) {
      broadcastSseEvent(payload);
    }

    res.json({
      feedMode: requestedMode,
      settings: getAppSettingsObject(),
      overview: payload.overview,
      candles: payload.candles ?? [],
      optionsChain: payload.optionsChain,
      portfolio: payload.portfolio,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/market/replay/control', async (req, res) => {
  try {
    const action = req.body?.action;
    const active = getActiveDataset();
    if (active) {
      syncReplayBase(active.id, getCandlesForDataset(active.id));
    }
    if (action === 'reset') {
      resetReplayEngine();
    } else if (action === 'step') {
      advanceReplayTick();
    }
    const payload = await buildMarketStreamPayload({ includeFullCandles: true });
    if (sseClients.size > 0) {
      broadcastSseEvent(payload);
    }
    res.json({
      overview: payload.overview,
      candles: payload.candles ?? [],
      optionsChain: payload.optionsChain,
      portfolio: payload.portfolio,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API 404 & STRUCTURED JSON ERROR HANDLERS (PREVENT HTML SPA FALLBACK ON /api/*)
// ============================================================================
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    code: 'API_NOT_FOUND',
  });
});

app.use(
  '/api',
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (res.headersSent) {
      return;
    }
    const e = err as {
      status?: number;
      statusCode?: number;
      type?: string;
      code?: string;
      message?: string;
    };
    let status = e.status || e.statusCode || 500;
    let message = e.message || 'Internal server error.';

    if (e.type === 'entity.too.large' || e.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message =
        'Uploaded CSV or request payload exceeds the size limit (10MB JSON / 15MB file upload).';
    } else if (e.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON request body.';
    }

    res.status(status).json({
      error: message,
      code: e.code ?? e.type ?? 'API_ERROR',
    });
  }
);

// ============================================================================
// VITE MIDDLEWARE & STATIC SERVE
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({
          error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
          code: 'API_NOT_FOUND',
        });
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASTRAQUANT X-2026 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
