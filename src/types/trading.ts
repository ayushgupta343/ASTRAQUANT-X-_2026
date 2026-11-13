export type PageId =
  | 'home'
  | 'dashboard'
  | 'ml'
  | 'signals'
  | 'paper'
  | 'backtest'
  | 'data'
  | 'risk'
  | 'options'
  | 'settings';

export type SignalClass = 'BUY' | 'SELL' | 'HOLD';

export type MarketFeedMode = 'historical_csv' | 'simulated_replay' | 'free_live_nse';

export interface OptionContractRecommendation {
  contractName: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  lotSize: number;
  entryPremium: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: string;
  delta: number;
  ivPct: number;
  dataMode: string;
  recommendedLots?: number;
  atrDynamic?: boolean;
}

export type RiskGuardrailStatusLevel = 'ACTIVE' | 'WARNING' | 'TRIGGERED';

export interface RiskTelemetry {
  overallStatus: RiskGuardrailStatusLevel;
  canPlaceManualOrder: boolean;
  canAutoExecute: boolean;
  latestSpot: number;
  latestAtr: number | null;
  latestAdx: number | null;
  guardrails: {
    dailyLossCap: {
      status: RiskGuardrailStatusLevel;
      dailyNetPnl: number;
      limit: number;
      pctUsed: number;
      detail: string;
    };
    maxOpenPositions: {
      status: RiskGuardrailStatusLevel;
      openCount: number;
      limit: number;
      detail: string;
    };
    adxRegimeFilter: {
      status: RiskGuardrailStatusLevel;
      enabled: boolean;
      currentAdx: number | null;
      minThreshold: number;
      detail: string;
    };
    consecutiveLossCooldown: {
      status: RiskGuardrailStatusLevel;
      enabled: boolean;
      consecutiveLosses: number;
      lossLimit: number;
      candlesRemaining: number;
      cooldownCandles: number;
      detail: string;
    };
    timeBasedOptionExit: {
      enabled: boolean;
      maxHoldCandles: number;
      openOptionPositionsCount: number;
      maxCandlesHeld: number;
    };
  };
}

export interface OptionLegQuote {
  ltp: number;
  ivPct: number;
  oi: number;
  volume: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChainRow {
  strike: number;
  isAtm: boolean;
  expiry: string;
  ce: OptionLegQuote;
  pe: OptionLegQuote;
}

export interface OptionsChainResponse {
  spotPrice: number;
  atmStrike: number;
  expiry: string;
  lotSize: number;
  spotTimestamp: string;
  dataMode: 'Simulated Black-Scholes (Derived from Spot)' | 'Uploaded Historical Options CSV';
  modeKey: 'simulated' | 'csv';
  hasUploadedCsv: boolean;
  uploadedCsvName: string | null;
  uploadedCsvCount: number;
  chain: OptionChainRow[];
}

export interface AutoExecutionLog {
  id: number;
  signal_id: number | null;
  signal_type: SignalClass;
  contract_name: string;
  strike: number | null;
  option_type: 'CE' | 'PE' | null;
  entry_premium: number | null;
  lots: number;
  capital_required: number | null;
  risk_check_status: 'PASSED' | 'BLOCKED';
  risk_check_detail: string;
  rationale: string;
  order_id: number | null;
  created_at: string;
}

export interface EnrichedCandle {
  timestamp: number;
  date_str: string;
  time_str: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
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
  vwap?: number | null;
  vwapDistance?: number | null;
  atr?: number | null;
  atrNormRange?: number | null;
  adx?: number | null;
  htfEma20Slope?: number | null;
  htfRsi14?: number | null;
  timeSin?: number;
  timeCos?: number;
}

export interface MarketOverviewResponse {
  hasData: boolean;
  feedMode?: MarketFeedMode;
  datasetId?: number;
  datasetName?: string;
  sourceType?: string;
  dataLabel: string;
  symbol?: string;
  timeframe?: string;
  currentPrice?: number;
  prevClose?: number;
  dailyChange?: number;
  dailyChangePct?: number;
  dayHigh?: number;
  dayLow?: number;
  lastUpdateTime?: string;
  marketStatus: {
    status: string;
    note: string;
  };
  feedMeta?: {
    mode: MarketFeedMode;
    sourceUrl: string | null;
    fetchedAt: string | null;
    warning: string | null;
    replayProgress: string | null;
    tickSeq?: number;
    isBarComplete?: boolean;
  };
  hasVolume?: boolean;
  indicators?: {
    rsi: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHist: number | null;
    ema20: number | null;
    sma50: number | null;
    volatility: number | null;
    vwap?: number | null;
    vwapDistance?: number | null;
    atr?: number | null;
    adx?: number | null;
    htfEma20Slope?: number | null;
    htfRsi14?: number | null;
    trendDirection: string;
  };
  prediction?: {
    modelStatus: 'Not trained' | 'Trained';
    modelId?: number;
    algorithm?: string;
    signal: SignalClass | null;
    rawSignal?: SignalClass | null;
    thresholdGated?: boolean;
    minConfidenceThreshold?: number;
    confidence: number | null;
    predictedMovePct: number | null;
    recommendation: {
      entryPrice: number;
      stopLoss: number;
      targetPrice: number;
      riskReward: string;
      generatedAt: string;
      reason: string;
    } | null;
    optionRecommendation?: OptionContractRecommendation | null;
  };
}

export interface HighConvictionMetrics {
  minConfidenceThreshold: number;
  totalTestBars: number;
  directionalSignals: number;
  directionalHits: number;
  buySignals: number;
  buyHits: number;
  sellSignals: number;
  sellHits: number;
  precision: number;
  buyPrecision: number;
  sellPrecision: number;
  tradeCoveragePct: number;
  avgDirectionalConfidence: number;
}

export interface WalkForwardFold {
  fold: number;
  trainRange: string;
  testRange: string;
  trainSize: number;
  testSize: number;
  overallAccuracy: number;
  balancedAccuracy: number;
  highConvictionPrecision: number;
  tradeCoveragePct: number;
  directionalSignals: number;
  directionalHits: number;
}

export interface WalkForwardEvaluation {
  enabled: boolean;
  foldCount: number;
  folds: WalkForwardFold[];
  meanOverallAccuracy: number;
  meanHighConvictionPrecision: number;
  meanTradeCoveragePct: number;
  totalDirectionalSignals: number;
  totalDirectionalHits: number;
}

export interface ModelStatusResponse {
  status: 'Not trained' | 'Trained';
  reason?: string;
  modelId?: number;
  algorithm?: string;
  datasetId?: number;
  datasetName?: string;
  datasetSize?: number;
  usableSamples?: number;
  trainSize?: number;
  valSize?: number;
  testSize?: number;
  dateRange?: string;
  minConfidenceThreshold?: number;
  walkForwardEnabled?: boolean;
  metrics?: {
    accuracy: number;
    balancedAccuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
  highConviction?: HighConvictionMetrics | null;
  walkForward?: WalkForwardEvaluation | null;
  confusionMatrix?: number[][];
  classDistribution?: { BUY: number; HOLD: number; SELL: number };
  featureImportance?: Array<{ feature: string; importance: number }>;
  predictionHistory?: Array<{
    timestamp: number;
    date_str: string;
    time_str: string;
    close: number;
    actual: SignalClass;
    predicted: SignalClass;
    rawPredicted?: SignalClass;
    thresholdGated?: boolean;
    confidence: number;
    futureReturnPct: number;
  }>;
  trainedAt?: string;
}

export interface TradingSignalRecord {
  id: number;
  model_id: number;
  timestamp: number;
  date_str: string;
  time_str: string;
  signal_type: SignalClass;
  market_price: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  risk_reward: string;
  confidence: number;
  predicted_move_pct: number;
  rsi: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  reason: string;
  data_label: string;
  option_contract: string | null;
  option_strike: number | null;
  option_type: 'CE' | 'PE' | null;
  option_expiry: string | null;
  option_lot_size: number | null;
  option_entry_premium: number | null;
  option_stop_loss: number | null;
  option_target: number | null;
  option_data_mode: string | null;
  created_at: string;
}

export interface PaperPortfolioResponse {
  isSimulated: boolean;
  disclaimer: string;
  initialCapital: number;
  cashBalance: number;
  lockedCapital: number;
  availableCapital: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dailyNetPnl: number;
  totalEquity: number;
  markPrice: number;
  markTimestamp: string;
  openPositions: Array<{
    id: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entry_price: number;
    stop_loss: number;
    target_price: number;
    mark_price: number;
    unrealized_pnl: number;
    capital_used: number;
    instrument_type: 'INDEX' | 'OPTION';
    option_strike: number | null;
    option_type: 'CE' | 'PE' | null;
    option_expiry: string | null;
    lot_size: number | null;
    lots: number | null;
    is_auto_executed: number | null;
    rationale: string | null;
    opened_candle_ts?: number | null;
    opened_at: string;
    notes: string | null;
  }>;
  riskTelemetry?: RiskTelemetry;
  updatedAt: string;
}

export interface PaperOrderRecord {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  target_price: number;
  status: 'OPEN' | 'CLOSED';
  realized_pnl: number;
  notes: string | null;
  instrument_type: string | null;
  option_strike: number | null;
  option_type: 'CE' | 'PE' | null;
  option_expiry: string | null;
  lot_size: number | null;
  lots: number | null;
  is_auto_executed: number | null;
  rationale: string | null;
  opened_candle_ts?: number | null;
  exit_reason?: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface PaperTradePrefill {
  instrumentType: 'OPTION' | 'INDEX';
  side: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  target: number;
  strike?: number;
  optionType?: 'CE' | 'PE';
  expiry?: string;
  lots?: number;
  lotSize?: number;
  notes?: string;
  rationale?: string;
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

export interface BacktestRunResult {
  id?: number;
  backtestType: string;
  strategy: string;
  dateRange: string;
  barsTested?: number;
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
  baselineComparison?: BacktestBaselineComparison | null;
  equityCurve: Array<{
    time: string;
    equity: number;
    drawdownPct: number;
  }>;
  trades: Array<{
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
    exitReason: string;
  }>;
  createdAt?: string;
}

export interface DatasetMeta {
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

export interface AppSettings {
  theme: 'dark' | 'light';
  ml: {
    nEstimators: number;
    maxDepth: number;
    minSamplesSplit: number;
    horizonCandles: number;
    signalThresholdPct: number;
    minConfidenceThreshold?: number;
    walkForwardEnabled?: boolean;
  };
  trading: {
    defaultQuantity: number;
    defaultLots: number;
    defaultStopLossPct: number;
    defaultTargetPct: number;
    riskPerTradePct?: number;
    stopLossMode?: 'atr_dynamic' | 'fixed_pct';
    atrStopMult?: number;
    atrTargetMult?: number;
    maxOpenPositions: number;
    dailyMaxLoss: number;
    adxChopFilterEnabled?: boolean;
    adxMinThreshold?: number;
    consecutiveLossCooldownEnabled?: boolean;
    consecutiveLossLimit?: number;
    cooldownCandles?: number;
    timeBasedOptionExitEnabled?: boolean;
    optionMaxHoldCandles?: number;
    autoExecuteSignals: boolean;
  };
  dataSource: {
    mode: string;
    optionsMode: 'simulated' | 'csv';
    timeframe: string;
    symbol: string;
  };
  broker: {
    provider: string;
    liveTradingEnabled: boolean;
    apiEndpoint: string;
    clientIdPlaceholder: string;
  };
}

export interface MarketStreamTickPayload {
  type: 'market_tick';
  feedMode: MarketFeedMode;
  overview: MarketOverviewResponse;
  optionsChain: OptionsChainResponse;
  portfolio: PaperPortfolioResponse;
  riskTelemetry?: RiskTelemetry;
  latestCandle: EnrichedCandle | null;
  candles?: EnrichedCandle[];
  streamAutoEvent?: { executed?: boolean; contract?: string; orderId?: number; autoClosed?: boolean } | null;
  serverTime: string;
}
