# ASTRAQUANT X-2026
**Intelligent Trading & Applied AI Platform for Bank NIFTY (5-Minute Timeframe)**

ASTRAQUANT X-2026 is a full-stack quantitative trading terminal and applied machine learning workspace built for Bank NIFTY 5-minute market analysis, chronological Random Forest signal generation, historical backtesting, risk management, and simulated paper trading.

---

## Key Capabilities

- **Main Trading Dashboard**: Interactive 5-minute Bank NIFTY candlestick chart (TradingView Lightweight Charts) with volume, crosshair OHLC readout, RSI (14), MACD (12, 26, 9), EMA (20) / SMA (50), rolling volatility, AI prediction panel, and Entry / Stop-Loss / Target recommendations.
- **AI / ML Prediction Engine**: Chronological 70% / 15% / 15% (Train / Validation / Test) Random Forest Classifier predicting next 3-candle (15-minute) market direction (`BUY` > +0.10%, `SELL` < -0.10%, `HOLD` otherwise). Displays real evaluation metrics (Accuracy, Balanced Accuracy, Precision, Recall, F1-Score, 3×3 Confusion Matrix, Feature Importance, and Prediction History). Model state explicitly reads `Not trained` until trained on active data.
- **Trading Signals Monitor**: Generated `BUY`, `SELL`, and `HOLD` signals with indicator context, model confidence, and Entry / Stop-Loss / Target levels.
- **Paper Trading Terminal**: Simulated trading environment starting with `₹1,00,000` virtual capital. Supports simulated `BUY` / `SELL` orders, position management, mark-to-market unrealized P&L, realized P&L, and full trade history.
- **Historical Backtesting**: Causal bar-by-bar backtester (zero look-ahead bias) with configurable date range, strategy selection, stop-loss %, target %, position size, transaction charges (bps), and slippage (bps). Displays Equity Curve, Sharpe Ratio, Max Drawdown, Profit Factor, Win Rate, and Trade Log. Clearly distinguishes Index-Direction Spot Simulation from Options Contract backtesting.
- **Data Management**: Upload Bank NIFTY 5-minute CSV datasets (`Date, Time, Open, High, Low, Close, Volume` with `Volume` optional), preview records, detect missing values / duplicates / invalid OHLC rows, clean datasets, activate datasets, and export clean CSVs.
- **Risk Management**: Interactive calculators for position sizing, risk per trade, stop-loss/target levels, risk/reward ratio, daily maximum loss, and capital allocation.
- **Options Module (Pending Data)**: Structured architectural blueprint for CE/PE contracts, strikes, expiries, OI, and Greeks — clearly marked pending until actual historical options contract pricing data is connected.

---

## Architecture & Project Structure

- `server.ts` — Express REST API server + Vite middleware (Port `3000`)
- `server/db.ts` — SQLite (`node:sqlite`) persistence layer + Sample Historical 5-minute Bank NIFTY seeder
- `server/quant.ts` — Causal technical indicator calculator (RSI, MACD, EMA, SMA, volatility) + CSV parser/validator/cleaner
- `server/randomForest.ts` — CART Decision Tree & Random Forest Classifier + chronological splitter + evaluator + signal generator
- `server/backtest.ts` — Causal backtesting engine with slippage and transaction costs
- `ml/random_forest_pipeline.py` — Portable Python Scikit-Learn reference script
- `db/postgres_schema.sql` — PostgreSQL migration DDL for production scaling
- `src/` — React + TypeScript + Tailwind CSS v4 frontend modules

---

## Installation & Starting the Application

### Prerequisites
- Node.js `v22+` (includes native `node:sqlite`)
- npm `v10+`
- Optional (for standalone Python ML execution): Python `3.10+` with `pandas`, `numpy`, `scikit-learn`, `joblib`

### Install Dependencies & Start
```bash
npm install
npm run dev
```
The full-stack application runs on `http://localhost:3000`.

### Production Build
```bash
npm run build
npm start
```

---

## Workflow Guide

### 1. Upload Historical Bank NIFTY 5-Minute Data
1. Navigate to **Data Management** in the left workspace sidebar.
2. Prepare a CSV with headers: `Date,Time,Open,High,Low,Close,Volume` (`Volume` is optional; `Date` accepts `YYYY-MM-DD` or `DD-MM-YYYY`).
3. Upload the CSV file. The validator inspects missing cells, duplicate timestamps, and OHLC integrity (`High >= max(Open, Close)` and `Low <= min(Open, Close)`).
4. Click **Clean Dataset** if anomalies are detected, then **Activate** to make it the active dataset across charts, ML, and backtesting.
*(Note: On initial launch, a clearly labeled Sample Historical 5-Minute Bank NIFTY dataset is pre-loaded so all tools work immediately without fabricating live market feeds.)*

### 2. Train the Random Forest Model
1. Open **AI / ML Prediction**.
2. Review the chronological split settings (`70% Train · 15% Validation · 15% Test`, zero random shuffling).
3. Configure ensemble hyperparameters (`nEstimators`, `maxDepth`, `minSamplesSplit`) and click **Train Random Forest Model**.
4. Inspect out-of-sample test metrics, the 3×3 confusion matrix, feature importance rankings, and prediction history.

### 3. Run Historical Backtests
1. Open **Backtesting**.
2. Select a strategy (`ML Random Forest`, `RSI + MACD Confluence`, or `EMA 20 / SMA 50 Momentum`), date range, stop-loss %, target %, lot quantity, transaction charges, and slippage.
3. Click **Run Backtest** to inspect the equity curve, Sharpe ratio, max drawdown, profit factor, and trade log.

### 4. Start Paper Trading
1. Open **Paper Trading**.
2. Place a simulated `BUY` or `SELL` order using virtual `₹1,00,000` capital (optionally pre-filled from the latest AI recommendation).
3. Track open positions with mark-to-market unrealized P&L, close positions manually, or reset the virtual portfolio at any time.

---

## Disclaimer
ASTRAQUANT X-2026 is an analytical, educational, and paper-trading platform. Direction predictions and backtests on historical index data do not guarantee future returns, and no live broker orders are executed.
