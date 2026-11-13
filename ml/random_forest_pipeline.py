"""
ASTRAQUANT X-2026 — Portable Python Scikit-Learn Reference Pipeline
Implements the exact chronological 5-minute Bank NIFTY Random Forest workflow.
Requires: pandas, numpy, scikit-learn, joblib (for local Python execution).
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
    else:
        df["rel_volume"] = 1.0

    # Target label: future return over next 3 candles (15 minutes)
    df["future_ret"] = (df["close"].shift(-3) - df["close"]) / df["close"]
    df["label"] = np.where(
        df["future_ret"] > 0.0010,
        "BUY",
        np.where(df["future_ret"] < -0.0010, "SELL", "HOLD"),
    )
    return df.dropna().reset_index(drop=True)


def train_and_evaluate(db_path: str = "data/astraquant.db", model_out: str = "ml/rf_model.joblib"):
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
        "return1", "volatility", "candle_body", "candle_range", "rel_volume"
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
        class_weight="balanced",
        random_state=2026,
    )
    clf.fit(train_df[features], train_df["label"])

    test_preds = clf.predict(test_df[features])
    report = classification_report(test_df["label"], test_preds, output_dict=True, zero_division=0)
    cm = confusion_matrix(test_df["label"], test_preds, labels=["BUY", "HOLD", "SELL"]).tolist()

    Path(model_out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": clf, "features": features}, model_out)

    return {
        "train_size": len(train_df),
        "val_size": len(val_df),
        "test_size": len(test_df),
        "accuracy": round(accuracy_score(test_df["label"], test_preds) * 100, 2),
        "balanced_accuracy": round(balanced_accuracy_score(test_df["label"], test_preds) * 100, 2),
        "macro_f1": round(report["macro avg"]["f1-score"] * 100, 2),
        "confusion_matrix": cm,
    }


if __name__ == "__main__":
    print(json.dumps(train_and_evaluate(), indent=2))
