import { SignalClass } from './randomForest.ts';

export const BANKNIFTY_LOT_SIZE = 15;
export const BANKNIFTY_STRIKE_STEP = 100;

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
  recommendedLots?: number;
  atrDynamic?: boolean;
  dataMode: 'Simulated Black-Scholes (Derived from Spot)' | 'Uploaded Historical Options CSV';
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

export interface UploadedOptionRow {
  strike: number;
  type: 'CE' | 'PE';
  expiry: string;
  ltp: number;
  ivPct: number;
  oi: number;
  volume: number;
}

/**
 * Standard normal PDF & CDF approximations (Abramowitz & Stegun) for Black-Scholes pricing.
 */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absX);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * erf);
}

export function roundToNearestStrike(spot: number, step = BANKNIFTY_STRIKE_STEP): number {
  return Math.round(spot / step) * step;
}

/**
 * Computes next weekly/monthly Wednesday Bank NIFTY reference expiry date relative to a candle date.
 */
export function getReferenceExpiry(dateStr?: string): string {
  const base = dateStr ? new Date(`${dateStr}T09:15:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return '2026-11-18';
  const day = base.getUTCDay(); // 3 = Wednesday
  let daysToWed = (3 - day + 7) % 7;
  if (daysToWed === 0) daysToWed = 7;
  const exp = new Date(base.getTime() + daysToWed * 86400 * 1000);
  return exp.toISOString().slice(0, 10);
}

/**
 * Computes Black-Scholes-Merton theoretical CE & PE premiums and Greeks.
 */
export function computeBlackScholesGreeks(params: {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  volatilityDecimal: number;
  riskFreeRate?: number;
  optionType: 'CE' | 'PE';
}): { ltp: number; delta: number; gamma: number; theta: number; vega: number } {
  const S = Math.max(1, params.spot);
  const K = Math.max(1, params.strike);
  const T = Math.max(1 / 365, params.timeToExpiryYears); // Floor at 1 calendar day
  const sigma = Math.max(0.06, Math.min(1.2, params.volatilityDecimal));
  const r = params.riskFreeRate ?? 0.068;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const pdfD1 = normPdf(d1);
  const cdfD1 = normCdf(d1);
  const cdfD2 = normCdf(d2);
  const discK = K * Math.exp(-r * T);

  let price = 0;
  let delta = 0;
  let thetaAnnual = 0;

  if (params.optionType === 'CE') {
    price = S * cdfD1 - discK * cdfD2;
    delta = cdfD1;
    thetaAnnual = -(S * pdfD1 * sigma) / (2 * sqrtT) - r * discK * cdfD2;
  } else {
    price = discK * normCdf(-d2) - S * normCdf(-d1);
    delta = cdfD1 - 1;
    thetaAnnual = -(S * pdfD1 * sigma) / (2 * sqrtT) + r * discK * normCdf(-d2);
  }

  const gamma = pdfD1 / (S * sigma * sqrtT);
  const vega = (S * pdfD1 * sqrtT) / 100; // Per 1% IV change
  const thetaPerDay = thetaAnnual / 365;

  return {
    ltp: Number(Math.max(1.5, price).toFixed(2)),
    delta: Number(delta.toFixed(3)),
    gamma: Number(gamma.toFixed(6)),
    theta: Number(thetaPerDay.toFixed(2)),
    vega: Number(vega.toFixed(2)),
  };
}

/**
 * Generates an interactive 11-strike Bank NIFTY options chain (±500 points around ATM)
 * using either an uploaded Historical Options CSV or Simulated Black-Scholes derived from Spot.
 */
export function buildOptionsChain(params: {
  spot: number;
  dateStr?: string;
  rollingVolPct?: number | null;
  uploadedRows?: UploadedOptionRow[] | null;
  preferredMode?: 'simulated' | 'csv';
}): {
  spotPrice: number;
  atmStrike: number;
  expiry: string;
  dataMode: 'Simulated Black-Scholes (Derived from Spot)' | 'Uploaded Historical Options CSV';
  modeKey: 'simulated' | 'csv';
  chain: OptionChainRow[];
} {
  const spot = params.spot || 53760;
  const atmStrike = roundToNearestStrike(spot);
  const defaultExpiry = getReferenceExpiry(params.dateStr);

  // Use uploaded CSV rows if requested and available
  if (params.preferredMode === 'csv' && params.uploadedRows && params.uploadedRows.length > 0) {
    const expiry = params.uploadedRows[0].expiry || defaultExpiry;
    const strikes = Array.from(new Set(params.uploadedRows.map((r) => r.strike))).sort((a, b) => a - b);
    // Focus on ±500 around ATM if strikes overlap, else show uploaded strikes sorted
    const nearStrikes = strikes.filter((s) => Math.abs(s - atmStrike) <= 500);
    const displayStrikes = nearStrikes.length >= 3 ? nearStrikes : strikes.slice(0, 15);

    const chain: OptionChainRow[] = displayStrikes.map((strike) => {
      const ceRow = params.uploadedRows!.find((r) => r.strike === strike && r.type === 'CE');
      const peRow = params.uploadedRows!.find((r) => r.strike === strike && r.type === 'PE');

      const baseIv = ((ceRow?.ivPct ?? peRow?.ivPct ?? 15.5) / 100);
      const ceGreeks = computeBlackScholesGreeks({
        spot,
        strike,
        timeToExpiryYears: 5 / 365,
        volatilityDecimal: baseIv,
        optionType: 'CE',
      });
      const peGreeks = computeBlackScholesGreeks({
        spot,
        strike,
        timeToExpiryYears: 5 / 365,
        volatilityDecimal: baseIv,
        optionType: 'PE',
      });

      return {
        strike,
        isAtm: strike === atmStrike,
        expiry: ceRow?.expiry || peRow?.expiry || expiry,
        ce: {
          ltp: ceRow?.ltp ?? ceGreeks.ltp,
          ivPct: ceRow?.ivPct ?? Number((baseIv * 100).toFixed(2)),
          oi: ceRow?.oi ?? 0,
          volume: ceRow?.volume ?? 0,
          delta: ceGreeks.delta,
          gamma: ceGreeks.gamma,
          theta: ceGreeks.theta,
          vega: ceGreeks.vega,
        },
        pe: {
          ltp: peRow?.ltp ?? peGreeks.ltp,
          ivPct: peRow?.ivPct ?? Number((baseIv * 100).toFixed(2)),
          oi: peRow?.oi ?? 0,
          volume: peRow?.volume ?? 0,
          delta: peGreeks.delta,
          gamma: peGreeks.gamma,
          theta: peGreeks.theta,
          vega: peGreeks.vega,
        },
      };
    });

    return {
      spotPrice: Number(spot.toFixed(2)),
      atmStrike,
      expiry,
      dataMode: 'Uploaded Historical Options CSV',
      modeKey: 'csv',
      chain,
    };
  }

  // Default: Simulated Black-Scholes Option Chain derived from Spot + Rolling Volatility
  // Convert 5m rolling volatility (%) to annualized IV estimate (bounded 12%–28%)
  const annualizedIv = params.rollingVolPct
    ? Math.max(0.12, Math.min(0.28, (params.rollingVolPct / 100) * Math.sqrt(75 * 252)))
    : 0.158;

  const timeToExpiryYears = 5 / 365; // ~5 calendar days to weekly expiry
  const chain: OptionChainRow[] = [];

  for (let offset = -500; offset <= 500; offset += 100) {
    const strike = atmStrike + offset;
    const moneynessDist = Math.abs(strike - spot) / spot;
    // Subtle volatility smile (OTM wings carry slightly higher IV)
    const smileIvCe = annualizedIv + moneynessDist * 0.45 + (strike > spot ? 0.004 : 0);
    const smileIvPe = annualizedIv + moneynessDist * 0.55 + (strike < spot ? 0.008 : 0);

    const ceGreeks = computeBlackScholesGreeks({
      spot,
      strike,
      timeToExpiryYears,
      volatilityDecimal: smileIvCe,
      optionType: 'CE',
    });
    const peGreeks = computeBlackScholesGreeks({
      spot,
      strike,
      timeToExpiryYears,
      volatilityDecimal: smileIvPe,
      optionType: 'PE',
    });

    // Deterministic OI/Volume curve peaking around ATM & 200-pt round strikes
    const roundBonus = strike % 500 === 0 ? 1.55 : 1.0;
    const distanceDecay = Math.exp(-Math.abs(offset) / 360);
    const ceOi = Math.round((1450000 * distanceDecay * roundBonus) * (strike >= spot ? 1.18 : 0.72));
    const peOi = Math.round((1450000 * distanceDecay * roundBonus) * (strike <= spot ? 1.22 : 0.68));
    const ceVol = Math.round(ceOi * 2.4);
    const peVol = Math.round(peOi * 2.35);

    chain.push({
      strike,
      isAtm: strike === atmStrike,
      expiry: defaultExpiry,
      ce: {
        ltp: ceGreeks.ltp,
        ivPct: Number((smileIvCe * 100).toFixed(2)),
        oi: ceOi,
        volume: ceVol,
        delta: ceGreeks.delta,
        gamma: ceGreeks.gamma,
        theta: ceGreeks.theta,
        vega: ceGreeks.vega,
      },
      pe: {
        ltp: peGreeks.ltp,
        ivPct: Number((smileIvPe * 100).toFixed(2)),
        oi: peOi,
        volume: peVol,
        delta: peGreeks.delta,
        gamma: peGreeks.gamma,
        theta: peGreeks.theta,
        vega: peGreeks.vega,
      },
    });
  }

  return {
    spotPrice: Number(spot.toFixed(2)),
    atmStrike,
    expiry: defaultExpiry,
    dataMode: 'Simulated Black-Scholes (Derived from Spot)',
    modeKey: 'simulated',
    chain,
  };
}

/**
 * Maps a directional BUY / SELL / HOLD signal onto the nearest ATM Bank NIFTY CE / PE option contract.
 */
export function mapSignalToOptionContract(params: {
  signal: SignalClass;
  spot: number;
  dateStr?: string;
  rollingVolPct?: number | null;
  atr?: number | null;
  stopAtrMult?: number;
  targetAtrMult?: number;
  capital?: number;
  riskPerTradePct?: number;
  uploadedRows?: UploadedOptionRow[] | null;
  preferredMode?: 'simulated' | 'csv';
}): OptionContractRecommendation | null {
  if (params.signal === 'HOLD') return null;

  const optionType: 'CE' | 'PE' = params.signal === 'BUY' ? 'CE' : 'PE';
  const chainData = buildOptionsChain({
    spot: params.spot,
    dateStr: params.dateStr,
    rollingVolPct: params.rollingVolPct,
    uploadedRows: params.uploadedRows,
    preferredMode: params.preferredMode,
  });

  const atmRow =
    chainData.chain.find((r) => r.strike === chainData.atmStrike) ??
    chainData.chain[Math.floor(chainData.chain.length / 2)];

  if (!atmRow) return null;

  const leg = optionType === 'CE' ? atmRow.ce : atmRow.pe;
  const entryPremium = leg.ltp;

  const stopMult = Math.max(0.5, params.stopAtrMult ?? 1.2);
  const targetMult = Math.max(stopMult * 2.0, params.targetAtrMult ?? 2.4);
  const rrRatio = targetMult / stopMult;

  let slDist = entryPremium * 0.2;
  let atrDynamic = false;
  if (params.atr && params.atr > 0) {
    const absDelta = Math.max(0.35, Math.min(0.75, Math.abs(leg.delta) || 0.5));
    const atrOptSl = absDelta * params.atr * stopMult;
    // Keep SL bounded realistically within [8%, 45%] of entry premium
    slDist = Math.min(entryPremium * 0.45, Math.max(entryPremium * 0.08, atrOptSl));
    atrDynamic = true;
  }

  const stopLoss = Number(Math.max(1, entryPremium - slDist).toFixed(2));
  const actualSlDist = Math.max(1, entryPremium - stopLoss);
  const targetPrice = Number((entryPremium + actualSlDist * rrRatio).toFixed(2));

  let recommendedLots = 1;
  if (params.capital && params.riskPerTradePct) {
    const maxRiskRupees = (params.capital * params.riskPerTradePct) / 100;
    const riskPerLot = actualSlDist * BANKNIFTY_LOT_SIZE;
    if (riskPerLot > 0) {
      recommendedLots = Math.max(1, Math.floor(maxRiskRupees / riskPerLot));
    }
  }

  return {
    contractName: `BANKNIFTY ${atmRow.expiry} ${atmRow.strike} ${optionType}`,
    strike: atmRow.strike,
    optionType,
    expiry: atmRow.expiry,
    lotSize: BANKNIFTY_LOT_SIZE,
    entryPremium,
    stopLoss,
    targetPrice,
    riskReward: `1:${rrRatio.toFixed(1)}`,
    delta: leg.delta,
    ivPct: leg.ivPct,
    recommendedLots,
    atrDynamic,
    dataMode: chainData.dataMode,
  };
}

/**
 * Parses an uploaded Options CSV file with columns:
 * Strike, Type (CE/PE), Expiry, Premium/LTP, IV, OI, Volume
 */
export function parseOptionsCSV(csvText: string): UploadedOptionRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('Options CSV must contain a header row and at least one contract row.');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));

  const strikeIdx = findCol(['strike', 'strike_price', 'strikeprice']);
  const typeIdx = findCol(['type', 'option_type', 'cp', 'ce_pe', 'side']);
  const expiryIdx = findCol(['expiry', 'expiry_date', 'exp']);
  const ltpIdx = findCol(['ltp', 'premium', 'price', 'close', 'option_price']);
  const ivIdx = findCol(['iv', 'iv_pct', 'implied_volatility']);
  const oiIdx = findCol(['oi', 'open_interest', 'openinterest']);
  const volIdx = findCol(['volume', 'vol', 'qty']);

  if (strikeIdx === -1 || typeIdx === -1 || ltpIdx === -1) {
    throw new Error(
      'Missing required options columns. Expected: Strike, Type (CE/PE), Premium/LTP (and optional Expiry, IV, OI, Volume).'
    );
  }

  const rows: UploadedOptionRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/['"]/g, ''));
    const strike = Number(cols[strikeIdx]);
    const typeRaw = (cols[typeIdx] ?? '').toUpperCase();
    const type = typeRaw === 'PE' || typeRaw === 'PUT' ? 'PE' : typeRaw === 'CE' || typeRaw === 'CALL' ? 'CE' : null;
    const ltp = Number(cols[ltpIdx]);

    if (!type || Number.isNaN(strike) || strike <= 0 || Number.isNaN(ltp) || ltp <= 0) {
      continue;
    }

    rows.push({
      strike: Math.round(strike),
      type,
      expiry: expiryIdx !== -1 && cols[expiryIdx] ? cols[expiryIdx] : getReferenceExpiry(),
      ltp: Number(ltp.toFixed(2)),
      ivPct: ivIdx !== -1 && cols[ivIdx] && !Number.isNaN(Number(cols[ivIdx])) ? Number(Number(cols[ivIdx]).toFixed(2)) : 15.5,
      oi: oiIdx !== -1 && cols[oiIdx] && !Number.isNaN(Number(cols[oiIdx])) ? Math.round(Number(cols[oiIdx])) : 0,
      volume: volIdx !== -1 && cols[volIdx] && !Number.isNaN(Number(cols[volIdx])) ? Math.round(Number(cols[volIdx])) : 0,
    });
  }

  if (rows.length === 0) {
    throw new Error('No valid CE/PE option contract rows found in uploaded CSV.');
  }

  return rows.sort((a, b) => a.strike - b.strike);
}
