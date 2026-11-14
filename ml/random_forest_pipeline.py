"""
ASTRAQUANT X-2026 — Portable Python Scikit-Learn Reference Pipeline
Implements the High-Precision Meta-Labeling & Trend-State Architecture:
- Zero non-stationary raw OHLC prices or raw point ATR in feature inputs
- 18 scale-invariant causal features:
  rsi, macd, macd_signal, macd_hist, return1, return3, ema9_ema21_spread_pct,
  vwap_distance, atr_norm_range, adx, htf_ema20_slope, htf_rsi14, rel_volume,
  time_sin, time_cos, mtf_confluence_score (-3..+3), rsi_momentum_slope, macd_hist_accel
- Selectable Target Mode:
  * "trend_regime": 3-candle forward EMA(5) > ±0.35 * ATR(14) AND ADX(14) > 20
  * "raw_return": 3-candle forward Close return > ±0.45 * ATR(14)
- Two-stage Meta-Labeling:
  * Stage 1 predicts direction (BUY / HOLD / SELL) with class_weight="balanced_subsample"
  * Stage 2 binary Random Forest scores trade probability on out-of-fold Stage 1 directional bars
  * Signals emit BUY/SELL only when Meta-Probability >= 0.72 AND ADX(14) >= 20
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
from sklearn.model_selection import KFold
import joblib


FEATURE_COLUMNS = [
    "rsi",
    "macd",
    "macd_signal",
    "macd_hist",
    "return1",
    "return3",
    "ema9_ema21_spread_pct",
    "vwap_distance",
    "atr_norm_range",
    "adx",
    "htf_ema20_slope",
    "htf_rsi14",
    "rel_volume",
    "time_sin",
    "time_cos",
    "mtf_confluence_score",
    "rsi_momentum_slope",
    "macd_hist_accel",
]


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

    is_bucket_end = bucket_key != bucket_key.shift(-1)
    htf_bars = df.loc[is_bucket_end, ["timestamp", "close"]].copy()
    htf_bars["htf_rsi14"] = compute_rsi(htf_bars["close"], 14)
    htf_ema20 = htf_bars["close"].ewm(span=20, min_periods=20, adjust=False).mean()
    htf_bars["htf_ema20_slope"] = htf_ema20.pct_change(1) * 100.0

    merged = pd.merge_asof(
        df[["timestamp"]].sort_values("timestamp"),
        htf_bars[["timestamp", "htf_ema20_slope", "htf_rsi14"]].sort_values("timestamp"),
        on="timestamp",
        direction="backward",
    )
    return merged["htf_ema20_slope"], merged["htf_rsi14"]


def prepare_features(df: pd.DataFrame, target_mode: str = "trend_regime") -> pd.DataFrame:
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["rsi"] = compute_rsi(df["close"], 14)
    df["macd"], df["macd_signal"], df["macd_hist"] = compute_macd(df["close"], 12, 26, 9)
    df["return1"] = df["close"].pct_change(1) * 100.0
    df["return3"] = df["close"].pct_change(3) * 100.0

    ema5 = df["close"].ewm(span=5, min_periods=5, adjust=False).mean()
    ema9 = df["close"].ewm(span=9, min_periods=9, adjust=False).mean()
    ema21 = df["close"].ewm(span=21, min_periods=21, adjust=False).mean()
    df["ema9_ema21_spread_pct"] = ((ema9 - ema21) / ema21.replace(0, np.nan)) * 100.0

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
    atr = compute_atr(df, 14)
    df["atr_norm_range"] = (df["high"] - df["low"]) / atr.replace(0, np.nan)
    df["adx"] = compute_adx(df, 14)

    # Strictly causal 15-minute HTF EMA(20) slope and RSI(14)
    df["htf_ema20_slope"], df["htf_rsi14"] = compute_causal_htf_15m(df)

    # Trend-Continuation & Regime Alignment Features
    c_ema = np.where(ema9 > ema21, 1, np.where(ema9 < ema21, -1, 0))
    c_vwap = np.where(df["close"] > intraday_vwap, 1, np.where(df["close"] < intraday_vwap, -1, 0))
    c_htf = np.where(df["htf_ema20_slope"] > 0, 1, np.where(df["htf_ema20_slope"] < 0, -1, 0))
    df["mtf_confluence_score"] = c_ema + c_vwap + c_htf
    df["rsi_momentum_slope"] = df["rsi"] - df["rsi"].shift(2)
    df["macd_hist_accel"] = df["macd_hist"] - df["macd_hist"].shift(1)

    # NSE session cyclical time-of-day features (09:15 to 15:30 IST = 375 minutes)
    dt = pd.to_datetime(df["date_str"] + " " + df["time_str"])
    elapsed = ((dt.dt.hour * 60 + dt.dt.minute) - 555).clip(lower=0, upper=375)
    angle = 2.0 * np.pi * (elapsed / 375.0)
    df["time_sin"] = np.sin(angle)
    df["time_cos"] = np.cos(angle)

    # Target Labeling Modes
    if target_mode == "raw_return":
        forward_move = df["close"].shift(-3) - df["close"]
        thresh = 0.45 * atr
        df["label"] = np.where(
            forward_move > thresh, "BUY", np.where(forward_move < -thresh, "SELL", "HOLD")
        )
    else:
        forward_ema5_move = ema5.shift(-3) - ema5
        thresh = 0.35 * atr
        df["label"] = np.where(
            (df["adx"] > 20) & (forward_ema5_move > thresh),
            "BUY",
            np.where((df["adx"] > 20) & (forward_ema5_move < -thresh), "SELL", "HOLD"),
        )

    return df.dropna().reset_index(drop=True)


def fit_two_stage_meta_rf(train_df: pd.DataFrame, random_state: int = 2026):
    X = train_df[FEATURE_COLUMNS].values
    y = train_df["label"].values

    stage1 = RandomForestClassifier(
        n_estimators=100,
        max_depth=6,
        min_samples_split=8,
        class_weight="balanced_subsample",
        random_state=random_state,
    )
    stage1.fit(X, y)

    # Generate 3-fold OOF directional predictions inside train_df for Stage 2 binary meta-labeler
    kf = KFold(n_splits=3, shuffle=False)
    meta_X, meta_y = [], []
    for tr_idx, va_idx in kf.split(X):
        f_clf = RandomForestClassifier(
            n_estimators=60,
            max_depth=6,
            min_samples_split=8,
            class_weight="balanced_subsample",
            random_state=random_state + 1,
        )
        f_clf.fit(X[tr_idx], y[tr_idx])
        probs = f_clf.predict_proba(X[va_idx])
        classes = list(f_clf.classes_)
        p_buy_idx = classes.index("BUY") if "BUY" in classes else -1
        p_hold_idx = classes.index("HOLD") if "HOLD" in classes else -1
        p_sell_idx = classes.index("SELL") if "SELL" in classes else -1

        for row_i, row_probs in enumerate(probs):
            best_cls = classes[int(np.argmax(row_probs))]
            if best_cls in ("BUY", "SELL"):
                pb = float(row_probs[p_buy_idx]) if p_buy_idx >= 0 else 0.0
                ph = float(row_probs[p_hold_idx]) if p_hold_idx >= 0 else 0.0
                ps = float(row_probs[p_sell_idx]) if p_sell_idx >= 0 else 0.0
                dir_sign = 1.0 if best_cls == "BUY" else -1.0
                meta_X.append(np.concatenate([X[va_idx[row_i]], [pb, ph, ps, dir_sign, abs(pb - ps)]]))
                meta_y.append(1 if best_cls == y[va_idx[row_i]] else 0)

    stage2 = None
    if len(meta_X) >= 20 and len(set(meta_y)) == 2:
        stage2 = RandomForestClassifier(
            n_estimators=65,
            max_depth=5,
            min_samples_split=6,
            class_weight="balanced_subsample",
            random_state=random_state + 99,
        )
        stage2.fit(np.array(meta_X), np.array(meta_y))

    return stage1, stage2


def predict_two_stage(stage1, stage2, df_slice: pd.DataFrame, min_conf: float = 0.72, min_adx: float = 20.0):
    X = df_slice[FEATURE_COLUMNS].values
    probs = stage1.predict_proba(X)
    classes = list(stage1.classes_)
    p_buy_idx = classes.index("BUY") if "BUY" in classes else -1
    p_hold_idx = classes.index("HOLD") if "HOLD" in classes else -1
    p_sell_idx = classes.index("SELL") if "SELL" in classes else -1

    preds = []
    for i, row_probs in enumerate(probs):
        best_idx = int(np.argmax(row_probs))
        raw_cls = classes[best_idx]
        raw_prob = float(row_probs[best_idx])
        adx_val = float(df_slice["adx"].iloc[i])

        if raw_cls not in ("BUY", "SELL") or adx_val < min_adx:
            preds.append("HOLD")
            continue

        if stage2 is not None:
            pb = float(row_probs[p_buy_idx]) if p_buy_idx >= 0 else 0.0
            ph = float(row_probs[p_hold_idx]) if p_hold_idx >= 0 else 0.0
            ps = float(row_probs[p_sell_idx]) if p_sell_idx >= 0 else 0.0
            dir_sign = 1.0 if raw_cls == "BUY" else -1.0
            mx = np.concatenate([X[i], [pb, ph, ps, dir_sign, abs(pb - ps)]]).reshape(1, -1)
            s2_classes = list(stage2.classes_)
            pos_idx = s2_classes.index(1) if 1 in s2_classes else 0
            trade_prob = float(stage2.predict_proba(mx)[0][pos_idx])
        else:
            trade_prob = raw_prob

        preds.append(raw_cls if trade_prob >= min_conf else "HOLD")

    return preds


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
    target_mode: str = "trend_regime",
    min_confidence_threshold: float = 0.72,
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

    enriched = prepare_features(df, target_mode=target_mode)
    n = len(enriched)
    train_end = int(n * 0.70)
    val_end = int(n * 0.85)

    train_df = enriched.iloc[:train_end]
    val_df = enriched.iloc[train_end:val_end]
    test_df = enriched.iloc[val_end:]

    stage1, stage2 = fit_two_stage_meta_rf(train_df, random_state=2026)
    test_preds = predict_two_stage(stage1, stage2, test_df, min_conf=min_confidence_threshold, min_adx=20.0)
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
            s1, s2 = fit_two_stage_meta_rf(wf_train, random_state=2026 + f * 17)
            wf_preds = predict_two_stage(s1, s2, wf_test, min_conf=min_confidence_threshold, min_adx=20.0)
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
        {
            "stage1": stage1,
            "stage2": stage2,
            "features": FEATURE_COLUMNS,
            "target_mode": target_mode,
            "min_confidence_threshold": min_confidence_threshold,
            "min_adx_gate": 20.0,
        },
        model_out,
    )

    return {
        "target_mode": target_mode,
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
