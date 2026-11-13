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
    trendDirection: string;
  };
  prediction?: {
    modelStatus: 'Not trained' | 'Trained';
    modelId?: number;
    algorithm?: string;
    signal: SignalClass | null;
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
  metrics?: {
    accuracy: number;
    balancedAccuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
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
    opened_at: string;
    notes: string | null;
  }>;
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
  };
  trading: {
    defaultQuantity: number;
    defaultLots: number;
    defaultStopLossPct: number;
    defaultTargetPct: number;
    maxOpenPositions: number;
    dailyMaxLoss: number;
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
  latestCandle: EnrichedCandle | null;
  candles?: EnrichedCandle[];
  streamAutoEvent?: { executed: boolean; contract: string; orderId: number } | null;
  serverTime: string;
}
