import { CandleRow, EnrichedCandle, calculateIndicators, computeAtrRiskLevels } from './quant.ts';
import { RandomForestArtifact, extractFeatureVector, predictWithForest } from './randomForest.ts';

export type BacktestStrategy = 'ml_random_forest' | 'rsi_macd_confluence' | 'ema_sma_crossover';

export interface BacktestConfig {
  strategy: BacktestStrategy;
  startDate?: string;
  endDate?: string;
  initialCapital: number;
  positionSize: number; // Units / Bank NIFTY lot qty (e.g., 15 or 30)
  stopLossPct: number;  // e.g., 0.35 (%)
  targetPct: number;    // e.g., 0.70 (%)
  chargeBps: number;    // Transaction charges in basis points per leg (e.g. 3 bps)
  slippageBps: number;  // Slippage in basis points per leg (e.g. 2 bps)
  useAtrDynamic?: boolean;
  atrStopMult?: number;
  atrTargetMult?: number;
  useAdxFilter?: boolean;
  adxMinThreshold?: number;
  useConsecutiveLossCooldown?: boolean;
  consecutiveLossLimit?: number;
  cooldownCandles?: number;
}

export interface BacktestTrade {
  id: number;
  side: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  exitReason: 'Target Hit' | 'Stop-Loss Hit' | 'Signal Reversal' | 'End of Window';
}

export interface BacktestSummarySlice {
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  netProfit: number;
  totalTrades: number;
  sharpeRatio: number;
}

export interface BacktestBaselineComparison {
  filtered: BacktestSummarySlice;
  unfiltered: BacktestSummarySlice;
  blockedByAdxCount: number;
  blockedByCooldownCount: number;
  atrDynamicTradesCount: number;
  guardrailsApplied: {
    atrDynamic: boolean;
    adxFilter: boolean;
    consecutiveLossCooldown: boolean;
    adxMinThreshold: number;
    cooldownCandles: number;
  };
}

export interface BacktestResult {
  backtestType: 'Index-Direction Spot Simulation (Not Options Contracts)';
  strategy: BacktestStrategy;
  dateRange: string;
  barsTested: number;
  metrics: {
    initialCapital: number;
    finalCapital: number;
    netProfit: number;
    totalReturnPct: number;
    winRatePct: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    profitFactor: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    avgProfitPerTrade: number;
    avgLossPerTrade: number;
    totalCosts: number;
  };
  baselineComparison: BacktestBaselineComparison;
  equityCurve: Array<{
    time: string;
    equity: number;
    drawdownPct: number;
  }>;
  trades: BacktestTrade[];
}

function simulateBacktestPass(
  filtered: EnrichedCandle[],
  config: BacktestConfig,
  rfArtifact: RandomForestArtifact | null | undefined,
  flags: {
    useAtrDynamic: boolean;
    useAdxFilter: boolean;
    useConsecutiveLossCooldown: boolean;
  }
) {
  const slippageMult = config.slippageBps / 10000;
  const chargeMult = config.chargeBps / 10000;
  const slMult = config.stopLossPct / 100;
  const tgtMult = config.targetPct / 100;
  const atrStopMult = config.atrStopMult ?? 1.2;
  const atrTargetMult = Math.max(atrStopMult * 2.0, config.atrTargetMult ?? 2.4);
  const adxMinThreshold = config.adxMinThreshold ?? 18;
  const consecutiveLossLimit = Math.max(1, config.consecutiveLossLimit ?? 2);
  const cooldownCandles = Math.max(1, config.cooldownCandles ?? 6);

  let equity = config.initialCapital;
  let peakEquity = equity;
  let maxDrawdownPct = 0;

  interface OpenPos {
    side: 'BUY' | 'SELL';
    entryPrice: number;
    entryTime: string;
    stopLoss: number;
    target: number;
    entryCost: number;
  }

  let openPos: OpenPos | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestResult['equityCurve'] = [];
  const dailyEndEquity = new Map<string, number>();
  let totalCosts = 0;

  let consecutiveLosses = 0;
  let cooldownRemaining = 0;
  let blockedByAdxCount = 0;
  let blockedByCooldownCount = 0;
  let atrDynamicTradesCount = 0;

  const closePosition = (
    pos: OpenPos,
    rawExitPrice: number,
    exitTime: string,
    reason: BacktestTrade['exitReason']
  ) => {
    const execExit =
      pos.side === 'BUY'
        ? rawExitPrice * (1 - slippageMult)
        : rawExitPrice * (1 + slippageMult);
    const exitCost = execExit * config.positionSize * chargeMult;
    const grossPnl =
      pos.side === 'BUY'
        ? (execExit - pos.entryPrice) * config.positionSize
        : (pos.entryPrice - execExit) * config.positionSize;
    const costs = pos.entryCost + exitCost;
    const netPnl = grossPnl - costs;

    equity += netPnl;
    totalCosts += costs;

    if (netPnl <= 0) {
      consecutiveLosses += 1;
      if (flags.useConsecutiveLossCooldown && consecutiveLosses >= consecutiveLossLimit) {
        cooldownRemaining = cooldownCandles;
        consecutiveLosses = 0;
      }
    } else {
      consecutiveLosses = 0;
    }

    trades.push({
      id: trades.length + 1,
      side: pos.side,
      entryTime: pos.entryTime,
      exitTime,
      entryPrice: Number(pos.entryPrice.toFixed(2)),
      exitPrice: Number(execExit.toFixed(2)),
      quantity: config.positionSize,
      grossPnl: Number(grossPnl.toFixed(2)),
      costs: Number(costs.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2)),
      exitReason: reason,
    });
  };

  for (let i = 1; i < filtered.length; i++) {
    const bar = filtered[i];
    const prevBar = filtered[i - 1];
    const barLabel = `${bar.date_str} ${bar.time_str}`;

    // 1. Check intra-bar Stop-Loss / Target conservatively (SL evaluated first)
    if (openPos) {
      if (openPos.side === 'BUY') {
        if (bar.low <= openPos.stopLoss) {
          closePosition(openPos, openPos.stopLoss, barLabel, 'Stop-Loss Hit');
          openPos = null;
        } else if (bar.high >= openPos.target) {
          closePosition(openPos, openPos.target, barLabel, 'Target Hit');
          openPos = null;
        }
      } else {
        if (bar.high >= openPos.stopLoss) {
          closePosition(openPos, openPos.stopLoss, barLabel, 'Stop-Loss Hit');
          openPos = null;
        } else if (bar.low <= openPos.target) {
          closePosition(openPos, openPos.target, barLabel, 'Target Hit');
          openPos = null;
        }
      }
    }

    // 2. Generate causal signal from previous closed bar (prevBar) to execute at current bar open (zero look-ahead)
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (config.strategy === 'ml_random_forest' && rfArtifact) {
      const vec = extractFeatureVector(prevBar);
      if (vec) {
        const pred = predictWithForest(rfArtifact, vec);
        signal = pred.signal;
      }
    } else if (config.strategy === 'rsi_macd_confluence') {
      if (prevBar.rsi !== null && prevBar.macdHist !== null) {
        if (prevBar.rsi < 48 && prevBar.macdHist > 0) signal = 'BUY';
        else if (prevBar.rsi > 52 && prevBar.macdHist < 0) signal = 'SELL';
      }
    } else if (config.strategy === 'ema_sma_crossover') {
      if (prevBar.ema20 !== null && prevBar.sma50 !== null) {
        if (prevBar.ema20 > prevBar.sma50 && prevBar.close > prevBar.ema20) signal = 'BUY';
        else if (prevBar.ema20 < prevBar.sma50 && prevBar.close < prevBar.ema20) signal = 'SELL';
      }
    }

    // 3. Reversal exit
    if (openPos && signal !== 'HOLD' && signal !== openPos.side) {
      closePosition(openPos, bar.open, barLabel, 'Signal Reversal');
      openPos = null;
    }

    // 4. Risk Guardrail Filtering on fresh entries (Consecutive-Loss Cooldown + ADX Chop Filter)
    let entrySignal: 'BUY' | 'SELL' | 'HOLD' = signal;
    if (!openPos && (entrySignal === 'BUY' || entrySignal === 'SELL')) {
      if (flags.useConsecutiveLossCooldown && cooldownRemaining > 0) {
        blockedByCooldownCount++;
        entrySignal = 'HOLD';
      } else if (flags.useAdxFilter && prevBar.adx !== null && prevBar.adx < adxMinThreshold) {
        blockedByAdxCount++;
        entrySignal = 'HOLD';
      }
    }

    if (!openPos && (entrySignal === 'BUY' || entrySignal === 'SELL') && i < filtered.length - 1) {
      const execEntry: number =
        entrySignal === 'BUY' ? bar.open * (1 + slippageMult) : bar.open * (1 - slippageMult);
      const entryCost: number = execEntry * config.positionSize * chargeMult;

      let stopLoss: number;
      let target: number;

      if (flags.useAtrDynamic && prevBar.atr !== null && prevBar.atr > 0) {
        const atrLevels = computeAtrRiskLevels({
          entryPrice: execEntry,
          atr: prevBar.atr,
          direction: entrySignal,
          stopAtrMult: atrStopMult,
          targetAtrMult: atrTargetMult,
        });
        stopLoss = atrLevels.stopLossPrice;
        target = atrLevels.targetPrice;
        atrDynamicTradesCount++;
      } else {
        stopLoss = entrySignal === 'BUY' ? execEntry * (1 - slMult) : execEntry * (1 + slMult);
        target = entrySignal === 'BUY' ? execEntry * (1 + tgtMult) : execEntry * (1 - tgtMult);
      }

      openPos = {
        side: entrySignal,
        entryPrice: execEntry,
        entryTime: barLabel,
        stopLoss,
        target,
        entryCost,
      };
    }

    if (cooldownRemaining > 0) {
      cooldownRemaining -= 1;
    }

    // Mark-to-market equity for drawdown & curve
    let mtm = equity;
    if (openPos) {
      const unrealized =
        openPos.side === 'BUY'
          ? (bar.close - openPos.entryPrice) * config.positionSize
          : (openPos.entryPrice - bar.close) * config.positionSize;
      mtm += unrealized - openPos.entryCost;
    }

    if (mtm > peakEquity) peakEquity = mtm;
    const ddPct = peakEquity > 0 ? ((peakEquity - mtm) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    dailyEndEquity.set(bar.date_str, mtm);

    const stride = filtered.length > 250 ? Math.ceil(filtered.length / 220) : 1;
    if (i % stride === 0 || i === filtered.length - 1) {
      equityCurve.push({
        time: `${bar.date_str.slice(5)} ${bar.time_str}`,
        equity: Number(mtm.toFixed(2)),
        drawdownPct: Number(ddPct.toFixed(2)),
      });
    }
  }

  // Close any residual position on last bar close
  if (openPos) {
    const lastBar = filtered[filtered.length - 1];
    closePosition(openPos, lastBar.close, `${lastBar.date_str} ${lastBar.time_str}`, 'End of Window');
    dailyEndEquity.set(lastBar.date_str, equity);
    openPos = null;
  }

  const winning = trades.filter((t) => t.netPnl > 0);
  const losing = trades.filter((t) => t.netPnl <= 0);
  const grossWin = winning.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losing.reduce((a, t) => a + t.netPnl, 0));

  const netProfit = equity - config.initialCapital;
  const totalReturnPct = (netProfit / config.initialCapital) * 100;
  const winRatePct = trades.length > 0 ? (winning.length / trades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.9 : 0;

  const dailyVals = [config.initialCapital, ...Array.from(dailyEndEquity.values())];
  const dailyReturns: number[] = [];
  for (let d = 1; d < dailyVals.length; d++) {
    if (dailyVals[d - 1] > 0) {
      dailyReturns.push((dailyVals[d] - dailyVals[d - 1]) / dailyVals[d - 1]);
    }
  }
  const meanRet = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const varRet =
    dailyReturns.length > 1
      ? dailyReturns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / (dailyReturns.length - 1)
      : 0;
  const stdRet = Math.sqrt(varRet);
  const sharpeRatio = stdRet > 1e-9 ? Math.max(-10, Math.min(10, (meanRet / stdRet) * Math.sqrt(252))) : 0;

  return {
    metrics: {
      initialCapital: config.initialCapital,
      finalCapital: Number(equity.toFixed(2)),
      netProfit: Number(netProfit.toFixed(2)),
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      winRatePct: Number(winRatePct.toFixed(2)),
      totalTrades: trades.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      avgProfitPerTrade: winning.length > 0 ? Number((grossWin / winning.length).toFixed(2)) : 0,
      avgLossPerTrade: losing.length > 0 ? Number((-grossLoss / losing.length).toFixed(2)) : 0,
      totalCosts: Number(totalCosts.toFixed(2)),
    },
    equityCurve,
    trades,
    blockedByAdxCount,
    blockedByCooldownCount,
    atrDynamicTradesCount,
  };
}

export function runHistoricalBacktest(
  rawCandles: CandleRow[],
  config: BacktestConfig,
  rfArtifact?: RandomForestArtifact | null,
  minMlTimestamp?: number | null
): BacktestResult {
  if (config.strategy === 'ml_random_forest' && !rfArtifact) {
    throw new Error(
      'Random Forest model is not trained yet. Train the model on the AI/ML Prediction page first, or choose RSI + MACD Confluence / EMA Crossover.'
    );
  }

  // Calculate indicators on full ordered dataset first (strictly causal) before filtering date range
  const allEnriched = calculateIndicators(rawCandles);
  let filtered: EnrichedCandle[] = allEnriched.filter((c) => {
    if (config.startDate && c.date_str < config.startDate) return false;
    if (config.endDate && c.date_str > config.endDate) return false;
    return true;
  });

  // Prevent look-ahead / in-sample leakage when backtesting the trained Random Forest
  if (config.strategy === 'ml_random_forest' && minMlTimestamp) {
    const oosFiltered = filtered.filter((c) => c.timestamp >= minMlTimestamp);
    if (oosFiltered.length >= 25) {
      filtered = oosFiltered;
    }
  }

  if (filtered.length < 25) {
    throw new Error('Selected date range contains fewer than 25 candles. Expand the date range to run a valid backtest.');
  }

  const useAtrDynamic = config.useAtrDynamic ?? true;
  const useAdxFilter = config.useAdxFilter ?? true;
  const useConsecutiveLossCooldown = config.useConsecutiveLossCooldown ?? true;

  const filteredPass = simulateBacktestPass(filtered, config, rfArtifact, {
    useAtrDynamic,
    useAdxFilter,
    useConsecutiveLossCooldown,
  });

  const unfilteredPass = simulateBacktestPass(filtered, config, rfArtifact, {
    useAtrDynamic: false,
    useAdxFilter: false,
    useConsecutiveLossCooldown: false,
  });

  const baselineComparison: BacktestBaselineComparison = {
    filtered: {
      winRatePct: filteredPass.metrics.winRatePct,
      profitFactor: filteredPass.metrics.profitFactor,
      maxDrawdownPct: filteredPass.metrics.maxDrawdownPct,
      totalReturnPct: filteredPass.metrics.totalReturnPct,
      netProfit: filteredPass.metrics.netProfit,
      totalTrades: filteredPass.metrics.totalTrades,
      sharpeRatio: filteredPass.metrics.sharpeRatio,
    },
    unfiltered: {
      winRatePct: unfilteredPass.metrics.winRatePct,
      profitFactor: unfilteredPass.metrics.profitFactor,
      maxDrawdownPct: unfilteredPass.metrics.maxDrawdownPct,
      totalReturnPct: unfilteredPass.metrics.totalReturnPct,
      netProfit: unfilteredPass.metrics.netProfit,
      totalTrades: unfilteredPass.metrics.totalTrades,
      sharpeRatio: unfilteredPass.metrics.sharpeRatio,
    },
    blockedByAdxCount: filteredPass.blockedByAdxCount,
    blockedByCooldownCount: filteredPass.blockedByCooldownCount,
    atrDynamicTradesCount: filteredPass.atrDynamicTradesCount,
    guardrailsApplied: {
      atrDynamic: useAtrDynamic,
      adxFilter: useAdxFilter,
      consecutiveLossCooldown: useConsecutiveLossCooldown,
      adxMinThreshold: config.adxMinThreshold ?? 18,
      cooldownCandles: config.cooldownCandles ?? 6,
    },
  };

  return {
    backtestType: 'Index-Direction Spot Simulation (Not Options Contracts)',
    strategy: config.strategy,
    dateRange: `${filtered[0].date_str} to ${filtered[filtered.length - 1].date_str}`,
    barsTested: filtered.length,
    metrics: filteredPass.metrics,
    baselineComparison,
    equityCurve: filteredPass.equityCurve,
    trades: filteredPass.trades.slice(-150).reverse(),
  };
}
