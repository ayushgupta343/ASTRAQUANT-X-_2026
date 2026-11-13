-- ASTRAQUANT X-2026 — PostgreSQL Migration Schema
-- Mirrors the SQLite schema for production PostgreSQL deployment.

CREATE TABLE IF NOT EXISTS datasets (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('sample_historical', 'uploaded_csv')),
  record_count INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  missing_count INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  invalid_ohlc_count INTEGER DEFAULT 0,
  has_volume BOOLEAN DEFAULT TRUE,
  is_cleaned BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candles (
  id BIGSERIAL PRIMARY KEY,
  dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  date_str DATE NOT NULL,
  time_str VARCHAR(5) NOT NULL,
  open NUMERIC(12, 2) NOT NULL,
  high NUMERIC(12, 2) NOT NULL,
  low NUMERIC(12, 2) NOT NULL,
  close NUMERIC(12, 2) NOT NULL,
  volume BIGINT,
  is_valid BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_candles_dataset_ts ON candles (dataset_id, timestamp);

CREATE TABLE IF NOT EXISTS ml_models (
  id BIGSERIAL PRIMARY KEY,
  algorithm TEXT NOT NULL,
  status TEXT NOT NULL,
  dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_size INTEGER NOT NULL,
  usable_samples INTEGER NOT NULL,
  train_size INTEGER NOT NULL,
  val_size INTEGER NOT NULL,
  test_size INTEGER NOT NULL,
  date_range TEXT NOT NULL,
  accuracy NUMERIC(6, 2) NOT NULL,
  balanced_accuracy NUMERIC(6, 2) NOT NULL,
  precision_macro NUMERIC(6, 2) NOT NULL,
  recall_macro NUMERIC(6, 2) NOT NULL,
  f1_macro NUMERIC(6, 2) NOT NULL,
  confusion_matrix_json JSONB NOT NULL,
  class_distribution_json JSONB NOT NULL,
  feature_importance_json JSONB NOT NULL,
  prediction_history_json JSONB NOT NULL,
  model_artifact_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  model_id BIGINT NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  date_str DATE NOT NULL,
  time_str VARCHAR(5) NOT NULL,
  signal_type VARCHAR(4) NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'HOLD')),
  market_price NUMERIC(12, 2) NOT NULL,
  entry_price NUMERIC(12, 2) NOT NULL,
  stop_loss NUMERIC(12, 2) NOT NULL,
  target_price NUMERIC(12, 2) NOT NULL,
  risk_reward TEXT NOT NULL,
  confidence NUMERIC(6, 2) NOT NULL,
  predicted_move_pct NUMERIC(6, 2) NOT NULL,
  rsi NUMERIC(6, 2) NOT NULL,
  macd NUMERIC(10, 2) NOT NULL,
  macd_signal NUMERIC(10, 2) NOT NULL,
  macd_hist NUMERIC(10, 2) NOT NULL,
  reason TEXT NOT NULL,
  data_label TEXT NOT NULL,
  option_contract TEXT,
  option_strike INTEGER,
  option_type VARCHAR(2) CHECK (option_type IN ('CE', 'PE')),
  option_expiry TEXT,
  option_lot_size INTEGER DEFAULT 15,
  option_entry_premium NUMERIC(12, 2),
  option_stop_loss NUMERIC(12, 2),
  option_target NUMERIC(12, 2),
  option_data_mode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_portfolio (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initial_capital NUMERIC(14, 2) NOT NULL DEFAULT 100000.00,
  cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 100000.00,
  realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL,
  entry_price NUMERIC(12, 2) NOT NULL,
  exit_price NUMERIC(12, 2),
  stop_loss NUMERIC(12, 2) NOT NULL,
  target_price NUMERIC(12, 2) NOT NULL,
  status VARCHAR(6) NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  realized_pnl NUMERIC(14, 2) DEFAULT 0.00,
  notes TEXT,
  instrument_type VARCHAR(10) DEFAULT 'INDEX' CHECK (instrument_type IN ('INDEX', 'OPTION')),
  option_strike INTEGER,
  option_type VARCHAR(2) CHECK (option_type IN ('CE', 'PE')),
  option_expiry TEXT,
  lot_size INTEGER DEFAULT 1,
  lots INTEGER DEFAULT 1,
  is_auto_executed BOOLEAN DEFAULT FALSE,
  rationale TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS options_chain_uploads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  expiry TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  rows_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_execution_logs (
  id BIGSERIAL PRIMARY KEY,
  signal_id BIGINT REFERENCES signals(id) ON DELETE SET NULL,
  signal_type VARCHAR(4) NOT NULL,
  contract_name TEXT NOT NULL,
  strike INTEGER,
  option_type VARCHAR(2),
  entry_premium NUMERIC(12, 2),
  lots INTEGER DEFAULT 1,
  capital_required NUMERIC(14, 2),
  risk_check_status VARCHAR(10) NOT NULL CHECK (risk_check_status IN ('PASSED', 'BLOCKED')),
  risk_check_detail TEXT NOT NULL,
  rationale TEXT NOT NULL,
  order_id BIGINT REFERENCES paper_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backtests (
  id BIGSERIAL PRIMARY KEY,
  dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  date_range TEXT NOT NULL,
  config_json JSONB NOT NULL,
  metrics_json JSONB NOT NULL,
  equity_curve_json JSONB NOT NULL,
  trades_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
