import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CandleRow } from './quant.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'astraquant.db');
export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL, -- 'sample_historical' | 'uploaded_csv'
      record_count INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      missing_count INTEGER DEFAULT 0,
      duplicate_count INTEGER DEFAULT 0,
      invalid_ohlc_count INTEGER DEFAULT 0,
      has_volume INTEGER DEFAULT 1,
      is_cleaned INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      date_str TEXT NOT NULL,
      time_str TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER,
      is_valid INTEGER DEFAULT 1,
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_candles_dataset_ts ON candles(dataset_id, timestamp);

    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      algorithm TEXT NOT NULL,
      status TEXT NOT NULL,
      dataset_id INTEGER NOT NULL,
      dataset_size INTEGER NOT NULL,
      usable_samples INTEGER NOT NULL,
      train_size INTEGER NOT NULL,
      val_size INTEGER NOT NULL,
      test_size INTEGER NOT NULL,
      date_range TEXT NOT NULL,
      accuracy REAL NOT NULL,
      balanced_accuracy REAL NOT NULL,
      precision_macro REAL NOT NULL,
      recall_macro REAL NOT NULL,
      f1_macro REAL NOT NULL,
      confusion_matrix_json TEXT NOT NULL,
      class_distribution_json TEXT NOT NULL,
      feature_importance_json TEXT NOT NULL,
      prediction_history_json TEXT NOT NULL,
      model_artifact_json TEXT NOT NULL,
      min_confidence_threshold REAL DEFAULT 0.72,
      target_mode TEXT DEFAULT 'trend_regime',
      high_conviction_json TEXT,
      walk_forward_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      date_str TEXT NOT NULL,
      time_str TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      market_price REAL NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target_price REAL NOT NULL,
      risk_reward TEXT NOT NULL,
      confidence REAL NOT NULL,
      predicted_move_pct REAL NOT NULL,
      rsi REAL NOT NULL,
      macd REAL NOT NULL,
      macd_signal REAL NOT NULL,
      macd_hist REAL NOT NULL,
      reason TEXT NOT NULL,
      data_label TEXT NOT NULL,
      option_contract TEXT,
      option_strike INTEGER,
      option_type TEXT,
      option_expiry TEXT,
      option_lot_size INTEGER DEFAULT 15,
      option_entry_premium REAL,
      option_stop_loss REAL,
      option_target REAL,
      option_data_mode TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      initial_capital REAL NOT NULL,
      cash_balance REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      stop_loss REAL NOT NULL,
      target_price REAL NOT NULL,
      status TEXT NOT NULL, -- 'OPEN' | 'CLOSED'
      realized_pnl REAL DEFAULT 0,
      notes TEXT,
      instrument_type TEXT DEFAULT 'INDEX', -- 'INDEX' | 'OPTION'
      option_strike INTEGER,
      option_type TEXT, -- 'CE' | 'PE'
      option_expiry TEXT,
      lot_size INTEGER DEFAULT 1,
      lots INTEGER DEFAULT 1,
      is_auto_executed INTEGER DEFAULT 0,
      rationale TEXT,
      opened_candle_ts INTEGER,
      exit_reason TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS options_chain_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      expiry TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      rows_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER,
      signal_type TEXT NOT NULL,
      contract_name TEXT NOT NULL,
      strike INTEGER,
      option_type TEXT,
      entry_premium REAL,
      lots INTEGER DEFAULT 1,
      capital_required REAL,
      risk_check_status TEXT NOT NULL, -- 'PASSED' | 'BLOCKED'
      risk_check_detail TEXT NOT NULL,
      rationale TEXT NOT NULL,
      order_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      date_range TEXT NOT NULL,
      config_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      equity_curve_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      comparison_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cooldown_triggered_candle_ts INTEGER,
      cooldown_triggered_wall_ms INTEGER,
      cooldown_reason TEXT,
      last_reset_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe migrations for pre-existing SQLite databases
  const alterStatements = [
    "ALTER TABLE signals ADD COLUMN option_contract TEXT",
    "ALTER TABLE signals ADD COLUMN option_strike INTEGER",
    "ALTER TABLE signals ADD COLUMN option_type TEXT",
    "ALTER TABLE signals ADD COLUMN option_expiry TEXT",
    "ALTER TABLE signals ADD COLUMN option_lot_size INTEGER DEFAULT 15",
    "ALTER TABLE signals ADD COLUMN option_entry_premium REAL",
    "ALTER TABLE signals ADD COLUMN option_stop_loss REAL",
    "ALTER TABLE signals ADD COLUMN option_target REAL",
    "ALTER TABLE signals ADD COLUMN option_data_mode TEXT",
    "ALTER TABLE paper_orders ADD COLUMN instrument_type TEXT DEFAULT 'INDEX'",
    "ALTER TABLE paper_orders ADD COLUMN option_strike INTEGER",
    "ALTER TABLE paper_orders ADD COLUMN option_type TEXT",
    "ALTER TABLE paper_orders ADD COLUMN option_expiry TEXT",
    "ALTER TABLE paper_orders ADD COLUMN lot_size INTEGER DEFAULT 1",
    "ALTER TABLE paper_orders ADD COLUMN lots INTEGER DEFAULT 1",
    "ALTER TABLE paper_orders ADD COLUMN is_auto_executed INTEGER DEFAULT 0",
    "ALTER TABLE paper_orders ADD COLUMN rationale TEXT",
    "ALTER TABLE ml_models ADD COLUMN min_confidence_threshold REAL DEFAULT 0.72",
    "ALTER TABLE ml_models ADD COLUMN target_mode TEXT DEFAULT 'trend_regime'",
    "ALTER TABLE ml_models ADD COLUMN high_conviction_json TEXT",
    "ALTER TABLE ml_models ADD COLUMN walk_forward_json TEXT",
    "ALTER TABLE paper_orders ADD COLUMN opened_candle_ts INTEGER",
    "ALTER TABLE paper_orders ADD COLUMN exit_reason TEXT",
    "ALTER TABLE backtests ADD COLUMN comparison_json TEXT",
  ];
  for (const sql of alterStatements) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists
    }
  }

  // Initialize paper portfolio with ₹1,00,000 if not present
  const existingPortfolio = db.prepare('SELECT id FROM paper_portfolio WHERE id = 1').get();
  if (!existingPortfolio) {
    db.prepare(
      'INSERT INTO paper_portfolio (id, initial_capital, cash_balance, realized_pnl, updated_at) VALUES (1, 100000, 100000, 0, ?)'
    ).run(new Date().toISOString());
  }

  // Initialize risk_state if not present
  const existingRiskState = db.prepare('SELECT id FROM risk_state WHERE id = 1').get();
  if (!existingRiskState) {
    db.prepare(
      "INSERT INTO risk_state (id, cooldown_triggered_candle_ts, cooldown_triggered_wall_ms, cooldown_reason, last_reset_at) VALUES (1, NULL, NULL, NULL, '')"
    ).run();
  }

  // Initialize default settings if not present
  const existingSettings = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
  if (!existingSettings) {
    const defaultSettings = {
      theme: 'dark',
      ml: {
        nEstimators: 30,
        maxDepth: 6,
        minSamplesSplit: 8,
        horizonCandles: 3,
        signalThresholdPct: 0.1,
        minConfidenceThreshold: 0.72,
        targetMode: 'trend_regime',
        walkForwardEnabled: false,
      },
      trading: {
        defaultQuantity: 15,
        defaultLots: 1,
        riskPerTradePct: 1.0,
        stopLossMode: 'atr_dynamic',
        atrStopMult: 1.2,
        atrTargetMult: 2.4,
        defaultStopLossPct: 0.35,
        defaultTargetPct: 0.7,
        maxOpenPositions: 3,
        dailyMaxLoss: 3000,
        autoExecuteSignals: false,
        adxChopFilterEnabled: true,
        adxMinThreshold: 18,
        consecutiveLossCooldownEnabled: true,
        consecutiveLossLimit: 2,
        cooldownCandles: 6,
        timeBasedOptionExitEnabled: true,
        optionMaxHoldCandles: 6,
      },
      dataSource: {
        mode: 'sample_historical',
        optionsMode: 'simulated',
        timeframe: '5m',
        symbol: 'NIFTY BANK',
      },
      broker: {
        provider: 'Not Connected (Paper Mode Active)',
        liveTradingEnabled: false,
        apiEndpoint: 'https://api.broker-placeholder.in/v2',
        clientIdPlaceholder: 'Configured Server-Side Only',
      },
    };
    db.prepare('INSERT INTO app_settings (id, settings_json, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(defaultSettings),
      new Date().toISOString()
    );
  }

  // Seed Sample Historical 5-Minute Bank NIFTY Dataset if database has no datasets
  const datasetCount = db.prepare('SELECT COUNT(*) as cnt FROM datasets').get() as { cnt: number };
  if (datasetCount.cnt === 0) {
    seedSampleHistoricalDataset();
  }
}

/**
 * Generates deterministic, realistic 5-minute Bank NIFTY historical OHLCV candles
 * across 12 NSE trading sessions (09:15 to 15:25 IST = 75 candles/day = 900 candles).
 * Explicitly labeled as Sample Historical Dataset (NOT live prices).
 */
function seedSampleHistoricalDataset() {
  const tradingDays = [
    '2026-10-27',
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
  ];

  // Deterministic PRNG
  let seed = 51480;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const candles: CandleRow[] = [];
  let price = 51480.0;
  let regimeDrift = 0.00018;

  for (let d = 0; d < tradingDays.length; d++) {
    const dateStr = tradingDays[d];
    // Overnight gap
    const gap = (rand() - 0.48) * 140;
    price = Math.max(48500, price + gap);
    regimeDrift = d % 3 === 0 ? 0.00022 : d % 3 === 1 ? -0.00019 : 0.00005;

    for (let bar = 0; bar < 75; bar++) {
      const totalMins = 9 * 60 + 15 + bar * 5;
      const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
      const mm = String(totalMins % 60).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;
      const ts = Math.floor(Date.parse(`${dateStr}T${timeStr}:00+05:30`) / 1000);

      // Intraday U-shaped volatility (higher at open 09:15-10:15 & close 14:30-15:25)
      const sessionFactor = bar < 12 || bar > 60 ? 1.55 : 0.9;
      const cyclicWave = Math.sin((d * 75 + bar) / 11) * 0.00085;
      const shock = (rand() - 0.5) * 0.0022 * sessionFactor;
      const pctMove = regimeDrift + cyclicWave + shock;

      const open = Number(price.toFixed(2));
      const close = Number((open * (1 + pctMove)).toFixed(2));
      const wickUp = Math.abs(rand() * 38 * sessionFactor);
      const wickDown = Math.abs(rand() * 38 * sessionFactor);
      const high = Number((Math.max(open, close) + wickUp).toFixed(2));
      const low = Number((Math.min(open, close) - wickDown).toFixed(2));
      const volume = Math.round((42000 + rand() * 88000) * sessionFactor);

      candles.push({
        timestamp: ts,
        date_str: dateStr,
        time_str: timeStr,
        open,
        high,
        low,
        close,
        volume,
        is_valid: 1,
      });

      price = close;
    }
  }

  insertDatasetWithCandles({
    name: 'Bank NIFTY 5m Sample Historical (12 Sessions)',
    sourceType: 'sample_historical',
    candles,
    missingCount: 0,
    duplicateCount: 0,
    invalidOhlcCount: 0,
    hasVolume: true,
    activate: true,
  });
}

export function insertDatasetWithCandles(params: {
  name: string;
  sourceType: 'sample_historical' | 'uploaded_csv';
  candles: CandleRow[];
  missingCount: number;
  duplicateCount: number;
  invalidOhlcCount: number;
  hasVolume: boolean;
  activate?: boolean;
}): number {
  const now = new Date().toISOString();
  const startDate = params.candles[0]?.date_str ?? '';
  const endDate = params.candles[params.candles.length - 1]?.date_str ?? '';

  if (params.activate) {
    db.prepare('UPDATE datasets SET is_active = 0').run();
  }

  const res = db
    .prepare(
      `INSERT INTO datasets (
        name, source_type, record_count, start_date, end_date,
        missing_count, duplicate_count, invalid_ohlc_count, has_volume,
        is_cleaned, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.name,
      params.sourceType,
      params.candles.length,
      startDate,
      endDate,
      params.missingCount,
      params.duplicateCount,
      params.invalidOhlcCount,
      params.hasVolume ? 1 : 0,
      params.duplicateCount === 0 && params.invalidOhlcCount === 0 && params.missingCount === 0 ? 1 : 0,
      params.activate ? 1 : 0,
      now
    );

  const datasetId = Number(res.lastInsertRowid);
  const insertCandle = db.prepare(
    `INSERT INTO candles (dataset_id, timestamp, date_str, time_str, open, high, low, close, volume, is_valid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    for (const c of params.candles) {
      insertCandle.run(
        datasetId,
        c.timestamp,
        c.date_str,
        c.time_str,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.is_valid ?? 1
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return datasetId;
}

export function getActiveDataset() {
  return db.prepare('SELECT * FROM datasets WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get() as
    | {
        id: number;
        name: string;
        source_type: string;
        record_count: number;
        start_date: string;
        end_date: string;
        missing_count: number;
        duplicate_count: number;
        invalid_ohlc_count: number;
        has_volume: number;
        is_cleaned: number;
        is_active: number;
        created_at: string;
      }
    | undefined;
}

export function getCandlesForDataset(datasetId: number): CandleRow[] {
  return db
    .prepare(
      'SELECT timestamp, date_str, time_str, open, high, low, close, volume, is_valid FROM candles WHERE dataset_id = ? ORDER BY timestamp ASC'
    )
    .all(datasetId) as unknown as CandleRow[];
}

export function getActiveOptionsUpload() {
  return db
    .prepare('SELECT * FROM options_chain_uploads WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    .get() as
    | {
        id: number;
        name: string;
        expiry: string;
        record_count: number;
        rows_json: string;
        is_active: number;
        created_at: string;
      }
    | undefined;
}

export function getAppSettingsObject() {
  const row = db.prepare('SELECT settings_json FROM app_settings WHERE id = 1').get() as
    | { settings_json: string }
    | undefined;
  const parsed = row ? JSON.parse(row.settings_json) : {};
  return {
    theme: parsed.theme ?? 'dark',
    ml: {
      nEstimators: parsed.ml?.nEstimators ?? 30,
      maxDepth: parsed.ml?.maxDepth ?? 6,
      minSamplesSplit: parsed.ml?.minSamplesSplit ?? 8,
      horizonCandles: parsed.ml?.horizonCandles ?? 3,
      signalThresholdPct: parsed.ml?.signalThresholdPct ?? 0.1,
      minConfidenceThreshold: parsed.ml?.minConfidenceThreshold ?? 0.72,
      targetMode: (parsed.ml?.targetMode === 'raw_return' ? 'raw_return' : 'trend_regime') as
        | 'trend_regime'
        | 'raw_return',
      walkForwardEnabled: Boolean(parsed.ml?.walkForwardEnabled ?? false),
    },
    trading: {
      defaultQuantity: parsed.trading?.defaultQuantity ?? 15,
      defaultLots: parsed.trading?.defaultLots ?? 1,
      riskPerTradePct: parsed.trading?.riskPerTradePct ?? 1.0,
      stopLossMode: (parsed.trading?.stopLossMode === 'fixed_pct' ? 'fixed_pct' : 'atr_dynamic') as
        | 'atr_dynamic'
        | 'fixed_pct',
      atrStopMult: parsed.trading?.atrStopMult ?? 1.2,
      atrTargetMult: parsed.trading?.atrTargetMult ?? 2.4,
      defaultStopLossPct: parsed.trading?.defaultStopLossPct ?? 0.35,
      defaultTargetPct: parsed.trading?.defaultTargetPct ?? 0.7,
      maxOpenPositions: parsed.trading?.maxOpenPositions ?? 3,
      dailyMaxLoss: parsed.trading?.dailyMaxLoss ?? 3000,
      autoExecuteSignals: Boolean(parsed.trading?.autoExecuteSignals ?? false),
      adxChopFilterEnabled: Boolean(parsed.trading?.adxChopFilterEnabled ?? true),
      adxMinThreshold: parsed.trading?.adxMinThreshold ?? 18,
      consecutiveLossCooldownEnabled: Boolean(parsed.trading?.consecutiveLossCooldownEnabled ?? true),
      consecutiveLossLimit: parsed.trading?.consecutiveLossLimit ?? 2,
      cooldownCandles: parsed.trading?.cooldownCandles ?? 6,
      timeBasedOptionExitEnabled: Boolean(parsed.trading?.timeBasedOptionExitEnabled ?? true),
      optionMaxHoldCandles: parsed.trading?.optionMaxHoldCandles ?? 6,
    },
    dataSource: {
      mode: parsed.dataSource?.mode ?? 'sample_historical',
      optionsMode: (parsed.dataSource?.optionsMode === 'csv' ? 'csv' : 'simulated') as 'simulated' | 'csv',
      timeframe: parsed.dataSource?.timeframe ?? '5m',
      symbol: parsed.dataSource?.symbol ?? 'NIFTY BANK',
    },
    broker: {
      provider: parsed.broker?.provider ?? 'Not Connected (Paper Mode Active)',
      liveTradingEnabled: false,
      apiEndpoint: parsed.broker?.apiEndpoint ?? 'https://api.broker-placeholder.in/v2',
      clientIdPlaceholder: parsed.broker?.clientIdPlaceholder ?? 'Configured Server-Side Only',
    },
  };
}
