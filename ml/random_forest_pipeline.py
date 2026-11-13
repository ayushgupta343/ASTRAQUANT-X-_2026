"""
ASTRAQUANT X-2026 — Portable Python Scikit-Learn Reference Pipeline
Implements the upgraded strictly causal 5-minute Bank NIFTY Random Forest workflow:
- Intraday VWAP Distance (reset daily)
- ATR(14) & ATR-Normalized Candle Range
- ADX(14) trend strength
- Strictly causal Higher-Timeframe (15-minute) EMA(20) slope & RSI(14)
- NSE session cyclical time-of-day features (sin/cos from 09:15 IST)
- Volatility-adaptive ±0.75 * ATR(14) / Close 3-candle target threshold
- class_weight="balanced_subsample"
- High-conviction probability thresholding & rolling walk-forward evaluation
"""

import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
)
import joblib


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


def compute_macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd = ema_fast - ema_slow
    macd_signal = macd.ewm(span=signal, adjust=False).mean()
    macd_hist = macd - macd_signal
    return macd, macd_signal, macd_hist


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def compute_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    sm_tr = tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    sm_plus = pd.Series(plus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    sm_minus = pd.Series(minus_dm, index=df.index).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    plus_di = 100.0 * (sm_plus / sm_tr.replace(0, np.nan))
    minus_di = 100.0 * (sm_minus / sm_tr.replace(0, np.nan))
    dx = 100.0 * ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    return dx.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def compute_causal_htf_15m(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """
    Aggregates 5m bars into 15m bars aligned to 09:15 IST and merges EMA(20) slope
    and RSI(14) strictly causally using only completed 15m candles at or before bar t.
    """
    dt = pd.to_datetime(df["date_str"] + " " + df["time_str"])
    mins = dt.dt.hour * 60 + dt.dt.minute
    mins_since_0915 = mins - 555
    bucket_idx = np.where(mins_since_0915 >= 0, mins_since_0915 // 15, mins // 15)
    bucket_key = df["date_str"] + "_" + pd.Series(bucket_idx, index=df.index).astype(str)

    # Identify the last 5m bar index of each bucket (closed 15m bar completion timestamp)
    is_bucket_end = bucket_key != bucket_key.shift(-1)
    htf_bars = df.loc[is_bucket_end, ["timestamp", "close"]].copy()
    htf_bars["htf_rsi14"] = compute_rsi(htf_bars["close"], 14)
    htf_ema20 = htf_bars["close"].ewm(span=20, min_periods=20, adjust=False).mean()
    htf_bars["htf_ema20_slope"] = htf_ema20.pct_change(1) * 100.0

    # Strict merge_asof backward on completion timestamps ensures zero future intra-bucket leakage
    merged = pd.merge_asof(
        df[["timestamp"]].sort_values("timestamp"),
        htf_bars[["timestamp", "htf_ema20_slope", "htf_rsi14"]].sort_values("timestamp"),
        on="timestamp",
        direction="backward",
    )
    return merged["htf_ema20_slope"], merged["htf_rsi14"]


def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["rsi"] = compute_rsi(df["close"], 14)
    df["macd"], df["macd_signal"], df["macd_hist"] = compute_macd(df["close"], 12, 26, 9)
    df["return1"] = df["close"].pct_change(1) * 100.0
    df["volatility"] = df["return1"].rolling(14).std()
    df["candle_body"] = ((df["close"] - df["open"]) / df["open"]) * 100.0
    df["candle_range"] = ((df["high"] - df["low"]) / df["open"]) * 100.0

    if "volume" in df.columns and df["volume"].notna().any():
        vol_sma = df["volume"].rolling(20).mean().replace(0, np.nan)
        df["rel_volume"] = (df["volume"] / vol_sma).fillna(1.0)
        eff_vol = df["volume"].fillna(1.0).clip(lower=1.0)
    else:
        df["rel_volume"] = 1.0
        eff_vol = pd.Series(1.0, index=df.index)

    # Intraday VWAP resetting daily
    typical_price = (df["high"] + df["low"] + df["close"]) / 3.0
    tpv = typical_price * eff_vol
    cum_tpv = tpv.groupby(df["date_str"]).cumsum()
    cum_vol = eff_vol.groupby(df["date_str"]).cumsum()
    intraday_vwap = cum_tpv / cum_vol
    df["vwap_distance"] = ((df["close"] - intraday_vwap) / intraday_vwap) * 100.0

    # ATR(14), ATR-normalized candle range, and ADX(14)
    df["atr"] = compute_atr(df, 14)
    df["atr_norm_range"] = (df["high"] - df["low"]) / df["atr"].replace(0, np.nan)
    df["adx"] = compute_adx(df, 14)

    # Strictly causal 15-minute HTF EMA(20) slope and RSI(14)
    df["htf_ema20_slope"], df["htf_rsi14"] = compute_causal_htf_15m(df)

    # NSE session cyclical time-of-day features (09:15 to 15:30 IST = 375 minutes)
    dt = pd.to_datetime(df["date_str"] + " " + df["time_str"])
    elapsed = ((dt.dt.hour * 60 + dt.dt.minute) - 555).clip(lower=0, upper=375)
    angle = 2.0 * np.pi * (elapsed / 375.0)
    df["time_sin"] = np.sin(angle)
    df["time_cos"] = np.cos(angle)

    # Volatility-adaptive target label: future 3-bar return vs ±0.75 * ATR(14) / Close
    df["future_ret"] = (df["close"].shift(-3) - df["close"]) / df["close"]
    adaptive_thresh = 0.75 * (df["atr"] / df["close"])
    df["label"] = np.where(
        df["future_ret"] > adaptive_thresh,
        "BUY",
        np.where(df["future_ret"] < -adaptive_thresh, "SELL", "HOLD"),
    )
    return df.dropna().reset_index(drop=True)


def apply_confidence_threshold(probs: np.ndarray, classes: np.ndarray, min_conf: float) -> list[str]:
    class_list = list(classes)
    gated = []
    for row in probs:
        best_idx = int(np.argmax(row))
        best_cls = class_list[best_idx]
        best_prob = float(row[best_idx])
        if best_cls in ("BUY", "SELL") and best_prob >= min_conf:
            gated.append(best_cls)
        else:
            gated.append("HOLD")
    return gated


def evaluate_high_conviction(y_true: pd.Series, y_pred: list[str]) -> dict:
    directional_mask = [p in ("BUY", "SELL") for p in y_pred]
    dir_total = sum(directional_mask)
    dir_hits = sum(1 for yt, yp in zip(y_true, y_pred) if yp in ("BUY", "SELL") and yt == yp)
    coverage = (dir_total / max(1, len(y_pred))) * 100.0
    precision = (dir_hits / dir_total) * 100.0 if dir_total > 0 else 0.0
    return {
        "directional_signals": dir_total,
        "directional_hits": dir_hits,
        "high_conviction_precision": round(precision, 2),
        "trade_coverage_pct": round(coverage, 2),
    }


def train_and_evaluate(
    db_path: str = "data/astraquant.db",
    model_out: str = "ml/rf_model.joblib",
    min_confidence_threshold: float = 0.65,
    walk_forward: bool = False,
):
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query(
        """
        SELECT c.timestamp, c.date_str, c.time_str, c.open, c.high, c.low, c.close, c.volume
        FROM candles c
        JOIN datasets d ON c.dataset_id = d.id
        WHERE d.is_active = 1
        ORDER BY c.timestamp ASC
        """,
        conn,
    )
    conn.close()

    enriched = prepare_features(df)
    features = [
        "open", "high", "low", "close",
        "rsi", "macd", "macd_signal", "macd_hist",
        "return1", "volatility", "candle_body", "candle_range", "rel_volume",
        "vwap_distance", "atr", "atr_norm_range", "adx",
        "htf_ema20_slope", "htf_rsi14", "time_sin", "time_cos",
    ]

    # Chronological 70 / 15 / 15 split (never shuffled)
    n = len(enriched)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)

    train_df = enriched.iloc[:train_end]
    val_df = enriched.iloc[train_end:val_end]
    test_df = enriched.iloc[val_end:]

    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=6,
        min_samples_split=8,
        class_weight="balanced_subsample",
        random_state=2026,
    )
    clf.fit(train_df[features], train_df["label"])

    test_probs = clf.predict_proba(test_df[features])
    test_preds = apply_confidence_threshold(test_probs, clf.classes_, min_confidence_threshold)
    report = classification_report(test_df["label"], test_preds, output_dict=True, zero_division=0)
    cm = confusion_matrix(test_df["label"], test_preds, labels=["BUY", "HOLD", "SELL"]).tolist()
    hc = evaluate_high_conviction(test_df["label"], test_preds)

    wf_folds = []
    if walk_forward and n >= 160:
        n_folds = 4 if n >= 400 else 3
        init_train = int(n * 0.50)
        fold_size = max(15, (n - init_train) // n_folds)
        for f in range(n_folds):
            t_start = init_train + f * fold_size
            t_end = n if f == n_folds - 1 else t_start + fold_size
            wf_train = enriched.iloc[:t_start]
            wf_test = enriched.iloc[t_start:t_end]
            wf_clf = RandomForestClassifier(
                n_estimators=100,
                max_depth=6,
                min_samples_split=8,
                class_weight="balanced_subsample",
                random_state=2026 + f,
            )
            wf_clf.fit(wf_train[features], wf_train["label"])
            wf_preds = apply_confidence_threshold(
                wf_clf.predict_proba(wf_test[features]), wf_clf.classes_, min_confidence_threshold
            )
            wf_hc = evaluate_high_conviction(wf_test["label"], wf_preds)
            wf_folds.append(
                {
                    "fold": f + 1,
                    "overall_accuracy": round(accuracy_score(wf_test["label"], wf_preds) * 100, 2),
                    **wf_hc,
                }
            )

    Path(model_out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"model": clf, "features": features, "min_confidence_threshold": min_confidence_threshold},
        model_out,
    )

    return {
        "train_size": len(train_df),
        "val_size": len(val_df),
        "test_size": len(test_df),
        "min_confidence_threshold": min_confidence_threshold,
        "accuracy": round(accuracy_score(test_df["label"], test_preds) * 100, 2),
        "balanced_accuracy": round(balanced_accuracy_score(test_df["label"], test_preds) * 100, 2),
        "macro_f1": round(report["macro avg"]["f1-score"] * 100, 2),
        "high_conviction": hc,
        "walk_forward": wf_folds if walk_forward else None,
        "confusion_matrix": cm,
    }


if __name__ == "__main__":
    print(json.dumps(train_and_evaluate(walk_forward=True), indent=2))
