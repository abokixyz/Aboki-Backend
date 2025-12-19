// ============= src/services/offrampRateService.ts (OFFRAMP RATE CALCULATION) =============
/**
 * Offramp Rate Service
 * 
 * Calculates offramp rates with:
 * - Paycrest base rate (1400 NGN/USDC)
 * - Offramp markup (+20 NGN)
 * - User fee (1%, capped at $2)
 * - LP fee (0.5%)
 */

import axios from 'axios';

// ============= CONFIGURATION =============

const PAYCREST_API_BASE_URL = process.env.PAYCREST_API_BASE_URL || 'https://api.paycrest.io';
const PAYCREST_API_KEY = process.env.PAYCREST_API_KEY || '';
const PAYCREST_RATE_ENDPOINT = '/v1/rates'; // or '/v1/rates' depending on Paycrest version

// Construct full URL
const PAYCREST_RATE_URL = `${PAYCREST_API_BASE_URL}${PAYCREST_RATE_ENDPOINT}`;

// Offramp constants
export const MIN_OFFRAMP = 10; // Minimum 10 USDC
export const MAX_OFFRAMP = 5000; // Maximum 5000 USDC
export const DEFAULT_FALLBACK_RATE = 1400; // NGN per USDC
export const OFFRAMP_MARKUP = 20; // NGN markup
export const FEE_PERCENTAGE = 1; // 1% user fee
export const FEE_MAX_USD = 2; // Max $2 fee
export const LP_FEE_PERCENTAGE = 0.5; // 0.5% liquidity provider fee

// Rate caching - always initialized with default fallback
let cachedRate: number = DEFAULT_FALLBACK_RATE;
let cacheTime: number = Date.now();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============= INTERFACES =============

export interface FeeBreakdown {
  percentage: number;
  amountUSDC: number;
  amountNGN: number;
  maxFeeUSD: number;
  effectiveFeePercent: number;
}

export interface CalculationDetails {
  amountUSDC: number;
  feeUSDC: number;
  netUSDC: number;
  ngnAmount: number;
  effectiveRate: number;
  lpFeeUSDC: number;
  breakdown: string;
}

export interface OfframpRateResponse {
  success: boolean;
  data?: {
    baseRate: number;
    offrampRate: number;
    markup: number;
    fee: FeeBreakdown;
    calculation: CalculationDetails;
    source: string;
    cached: boolean;
    timestamp: string;
  };
  error?: string;
}

// ============= UTILITY FUNCTIONS =============

/**
 * Get current base rate - always returns a number
 */
function getCurrentBaseRate(): number {
  // cachedRate is always a number (initialized with DEFAULT_FALLBACK_RATE)
  return cachedRate;
}

/**
 * Fetch base rate from Paycrest
 */
async function getBaseRateFromPaycrest(): Promise<number> {
  try {
    if (!PAYCREST_API_KEY) {
      console.warn('⚠️ Paycrest API key not configured, using fallback rate');
      return DEFAULT_FALLBACK_RATE;
    }

    console.log('📊 Fetching rate from Paycrest...');

    const response = await axios.get(PAYCREST_RATE_URL, {
      headers: {
        'Authorization': `Bearer ${PAYCREST_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    if (response.data && response.data.data && response.data.data.rate) {
      const rate = parseFloat(response.data.data.rate);
      console.log(`✅ Paycrest rate: ${rate} NGN/USDC`);
      return rate;
    }

    console.warn('⚠️ Invalid Paycrest response, using fallback rate');
    return DEFAULT_FALLBACK_RATE;
  } catch (error: any) {
    console.warn(`⚠️ Error fetching Paycrest rate: ${error.message}`);
    console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
    return DEFAULT_FALLBACK_RATE;
  }
}

/**
 * Check if cache is still valid and update if needed
 * Always returns a valid base rate
 */
async function getAndUpdateBaseRate(): Promise<{ rate: number; isCached: boolean }> {
  const now = Date.now();
  
  // Check if cache expired
  if (now - cacheTime > CACHE_TTL) {
    // Cache expired, fetch new rate
    const freshRate = await getBaseRateFromPaycrest();
    cachedRate = freshRate;
    cacheTime = now;
    return { rate: freshRate, isCached: false };
  }
  
  // Cache still valid
  return { rate: cachedRate, isCached: true };
}

// ============= MAIN RATE FUNCTION =============

/**
 * @function getOfframpRate
 * @desc     Calculate offramp rate with fees
 * 
 * Formula:
 * 1. Base rate from Paycrest (fallback: 1400)
 * 2. Add offramp markup (+20 NGN)
 * 3. Calculate user fee (1%, max $2)
 * 4. Calculate LP fee (0.5%)
 * 
 * @param    amountUSDC - Amount in USDC (e.g., 100)
 * @returns  OfframpRateResponse with detailed breakdown
 */
export async function getOfframpRate(amountUSDC: number): Promise<OfframpRateResponse> {
  try {
    // Validation
    if (!amountUSDC || amountUSDC <= 0) {
      return {
        success: false,
        error: 'Invalid amount'
      };
    }

    if (amountUSDC < MIN_OFFRAMP || amountUSDC > MAX_OFFRAMP) {
      return {
        success: false,
        error: `Amount must be between ${MIN_OFFRAMP} and ${MAX_OFFRAMP} USDC`
      };
    }

    console.log(`\n📊 Calculating offramp rate for ${amountUSDC} USDC`);

    // Step 1: Get base rate (guaranteed to be a number)
    const { rate: baseRate, isCached } = await getAndUpdateBaseRate();
    
    if (isCached) {
      console.log(`📦 Using cached rate: ${baseRate} NGN/USDC`);
    } else {
      console.log(`📊 Fetched fresh rate: ${baseRate} NGN/USDC`);
    }

    // Step 2: Add markup
    const offrampRate = baseRate + OFFRAMP_MARKUP;
    console.log(`📈 Offramp rate (with markup): ${offrampRate} NGN/USDC`);

    // Step 3: Calculate user fee (1%, capped at $2)
    const feePercentage = FEE_PERCENTAGE / 100;
    const feeUSDC = Math.min(amountUSDC * feePercentage, FEE_MAX_USD);
    const effectiveFeePercent = (feeUSDC / amountUSDC) * 100;
    const feeNGN = feeUSDC * baseRate; // Fee in NGN at base rate

    console.log(`💰 User fee: ${feeUSDC.toFixed(6)} USDC (${effectiveFeePercent.toFixed(2)}%)`);

    // Step 4: Calculate net USDC after fee
    const netUSDC = amountUSDC - feeUSDC;
    console.log(`✅ Net USDC (after fee): ${netUSDC.toFixed(6)} USDC`);

    // Step 5: Calculate NGN amount
    const ngnAmount = netUSDC * offrampRate;
    console.log(`💵 NGN amount: ₦${ngnAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

    // Step 6: Calculate LP fee (0.5% of net USDC)
    const lpFeeUSDC = netUSDC * (LP_FEE_PERCENTAGE / 100);
    console.log(`🏦 LP fee: ${lpFeeUSDC.toFixed(6)} USDC`);

    // Step 7: Calculate effective rate
    const effectiveRate = ngnAmount / amountUSDC;
    console.log(`📊 Effective rate: ${effectiveRate.toFixed(2)} NGN/USDC`);

    const timestamp = new Date().toISOString();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ RATE CALCULATION COMPLETE`);
    console.log(`${'═'.repeat(60)}`);

    return {
      success: true,
      data: {
        baseRate,
        offrampRate,
        markup: OFFRAMP_MARKUP,
        fee: {
          percentage: FEE_PERCENTAGE,
          amountUSDC: feeUSDC,
          amountNGN: feeNGN,
          maxFeeUSD: FEE_MAX_USD,
          effectiveFeePercent
        },
        calculation: {
          amountUSDC,
          feeUSDC,
          netUSDC,
          ngnAmount,
          effectiveRate,
          lpFeeUSDC,
          breakdown: `${amountUSDC} USDC - ${feeUSDC.toFixed(6)} USDC fee = ${netUSDC.toFixed(6)} USDC net = ₦${ngnAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        },
        source: isCached ? 'cache' : 'Paycrest',
        cached: isCached,
        timestamp
      }
    };
  } catch (error: any) {
    console.error('❌ Error calculating rate:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * @function getOfframpRateByNGN
 * @desc     Get offramp rate by NGN amount (reverse calculation)
 * 
 * @param    amountNGN - Amount in NGN
 * @returns  OfframpRateResponse with USDC equivalent
 */
export async function getOfframpRateByNGN(amountNGN: number): Promise<OfframpRateResponse> {
  try {
    if (!amountNGN || amountNGN <= 0) {
      return {
        success: false,
        error: 'Invalid amount'
      };
    }

    console.log(`\n📊 Calculating USDC amount for ₦${amountNGN.toLocaleString()}`);

    // Get base rate (guaranteed to be a number)
    const { rate: baseRate } = await getAndUpdateBaseRate();
    const offrampRate = baseRate + OFFRAMP_MARKUP;

    // Reverse calculation: NGN / offrampRate = net USDC
    const netUSDC = amountNGN / offrampRate;

    // Account for fee: netUSDC = amountUSDC - fee
    // fee = amountUSDC * FEE_PERCENTAGE or max FEE_MAX_USD
    // Solve for amountUSDC
    let amountUSDC: number;

    if (netUSDC * (FEE_PERCENTAGE / 100) > FEE_MAX_USD) {
      // Fee is capped at $2
      amountUSDC = netUSDC + FEE_MAX_USD;
    } else {
      // Fee is percentage
      amountUSDC = netUSDC / (1 - FEE_PERCENTAGE / 100);
    }

    // Validate
    if (amountUSDC < MIN_OFFRAMP || amountUSDC > MAX_OFFRAMP) {
      return {
        success: false,
        error: `NGN amount corresponds to ${amountUSDC.toFixed(2)} USDC, which is outside allowed range (${MIN_OFFRAMP}-${MAX_OFFRAMP})`
      };
    }

    console.log(`✅ USDC amount: ${amountUSDC.toFixed(6)} USDC`);

    // Get full rate breakdown for this USDC amount
    return getOfframpRate(amountUSDC);
  } catch (error: any) {
    console.error('❌ Error calculating by NGN:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * @function getRateInfo
 * @desc     Get current rate information (current rate, limits, fees)
 * 
 * @returns  Current rate details
 */
export async function getRateInfo(): Promise<{
  success: boolean;
  baseRate?: number;
  offrampRate?: number;
  markup?: number;
  minAmount?: number;
  maxAmount?: number;
  feePercentage?: number;
  feeMax?: number;
  lpFeePercentage?: number;
  error?: string;
}> {
  try {
    // Get base rate (guaranteed to be a number)
    const { rate: baseRate } = await getAndUpdateBaseRate();

    return {
      success: true,
      baseRate,
      offrampRate: baseRate + OFFRAMP_MARKUP,
      markup: OFFRAMP_MARKUP,
      minAmount: MIN_OFFRAMP,
      maxAmount: MAX_OFFRAMP,
      feePercentage: FEE_PERCENTAGE,
      feeMax: FEE_MAX_USD,
      lpFeePercentage: LP_FEE_PERCENTAGE
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ============= MANUAL RATE MANAGEMENT =============

/**
 * @function setManualRate
 * @desc     Set manual base rate (for testing)
 * 
 * @param    rate - Manual base rate
 */
export function setManualRate(rate: number): void {
  cachedRate = rate;
  cacheTime = Date.now();
  console.log(`✅ Manual rate set: ${rate} NGN/USDC`);
}

/**
 * @function clearRateCache
 * @desc     Clear rate cache and fetch fresh from Paycrest
 */
export function clearRateCache(): void {
  cachedRate = DEFAULT_FALLBACK_RATE;
  cacheTime = 0;
  console.log('✅ Rate cache cleared');
}

// ============= EXPORTS =============

export default {
  getOfframpRate,
  getOfframpRateByNGN,
  getRateInfo,
  setManualRate,
  clearRateCache,
  MIN_OFFRAMP,
  MAX_OFFRAMP,
  DEFAULT_FALLBACK_RATE,
  OFFRAMP_MARKUP,
  FEE_PERCENTAGE,
  FEE_MAX_USD,
  LP_FEE_PERCENTAGE
};