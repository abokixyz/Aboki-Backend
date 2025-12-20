// ============= src/services/offrampRateService.ts (FIXED) =============
/**
 * Offramp Rate Service
 * 
 * Calculates offramp rates with:
 * - Paycrest base rate (1400 NGN/USDC fallback)
 * - Offramp markup (+20 NGN)
 * - User fee (1%, capped at $2)
 * - LP fee (0.5%)
 */

import axios from 'axios';

// ============= CONFIGURATION =============

const PAYCREST_API_KEY = process.env.PAYCREST_API_KEY || '';
const PAYCREST_API_URL = process.env.PAYCREST_API_URL || 'https://api.paycrest.io/v1';

// Offramp constants
export const MIN_OFFRAMP = 0.1; // Minimum 10 USDC
export const MAX_OFFRAMP = 5000; // Maximum 5000 USDC
export const DEFAULT_FALLBACK_RATE = 1400; // NGN per USDC
export const OFFRAMP_MARKUP = 20; // NGN markup
export const FEE_PERCENTAGE = 1; // 1% user fee
export const FEE_MAX_USD = 2; // Max $2 fee
export const LP_FEE_PERCENTAGE = 0.5; // 0.5% liquidity provider fee

// Rate caching
let cachedRate: number | null = null;
let cacheTime: number = 0;
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
 * Fetch base rate from Paycrest
 * FIXED: Use correct endpoint format /rates/USDC/1/NGN
 */
async function getBaseRateFromPaycrest(): Promise<number> {
  try {
    if (!PAYCREST_API_KEY) {
      console.warn('⚠️  PAYCREST_API_KEY not configured');
      console.warn(`   Set PAYCREST_API_KEY in .env to fetch live rates`);
      console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
      return DEFAULT_FALLBACK_RATE;
    }

    // FIXED: Use correct endpoint format matching rateService.ts
    const url = `${PAYCREST_API_URL}/rates/USDC/1/NGN`;
    
    console.log('🌐 Fetching rate from Paycrest API...');
    console.log(`   URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': PAYCREST_API_KEY
      },
      timeout: 5000
    });

    console.log('   ✅ Paycrest API responded');

    // Handle response format (matching rateService.ts)
    if (response.data && response.data.status === 'success' && response.data.data) {
      let parsedRate = typeof response.data.data === 'string' 
        ? parseFloat(response.data.data) 
        : (response.data.data.rate || parseFloat(response.data.data));
        
      if (isNaN(parsedRate) || parsedRate <= 0) {
        throw new Error('Invalid rate value from Paycrest');
      }
      
      console.log(`   ✅ Paycrest rate fetched: ${parsedRate} NGN/USDC`);
      return parsedRate;
    }

    console.warn('⚠️  Invalid Paycrest response format');
    console.warn(`   Response: ${JSON.stringify(response.data).slice(0, 100)}`);
    console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
    return DEFAULT_FALLBACK_RATE;
  } catch (error: any) {
    console.warn(`⚠️  Error fetching Paycrest rate: ${error.message}`);
    if (error.response) {
      console.warn(`   Status: ${error.response.status}`);
      console.warn(`   Data: ${JSON.stringify(error.response.data).slice(0, 100)}`);
    }
    console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
    return DEFAULT_FALLBACK_RATE;
  }
}

/**
 * Get and update base rate
 * Tries Paycrest first, falls back to cache or default
 */
async function getAndUpdateBaseRate(): Promise<{ rate: number; isCached: boolean; source: string }> {
  const now = Date.now();

  // Check if cache is still valid
  if (cachedRate !== null && (now - cacheTime) <= CACHE_TTL) {
    console.log(`📦 Using cached rate: ${cachedRate} NGN/USDC (${Math.round((CACHE_TTL - (now - cacheTime)) / 1000)}s remaining)`);
    return { rate: cachedRate, isCached: true, source: 'cache' };
  }

  // Cache expired or doesn't exist, fetch fresh from Paycrest
  console.log('📊 Cache expired or missing, fetching fresh rate...');
  const freshRate = await getBaseRateFromPaycrest();

  // Update cache
  cachedRate = freshRate;
  cacheTime = now;

  return { rate: freshRate, isCached: false, source: freshRate === DEFAULT_FALLBACK_RATE ? 'fallback' : 'Paycrest' };
}

// ============= MAIN RATE FUNCTION =============

/**
 * @function getOfframpRate
 * @desc     Calculate offramp rate with fees
 * 
 * Rate Calculation:
 * 1. Fetch base rate from Paycrest (or use cache/fallback)
 * 2. Add offramp markup (+20 NGN)
 * 3. Calculate user fee (1%, max $2)
 * 4. Calculate LP fee (0.5%)
 * 
 * Example (100 USDC):
 * - Base Rate: 1400 NGN/USDC
 * - Offramp Rate: 1420 NGN/USDC (1400 + 20)
 * - User Fee: 1 USDC (1% of 100)
 * - Net USDC: 99 USDC
 * - NGN Amount: 99 × 1420 = ₦140,580
 * - LP Fee: 0.495 USDC (0.5% of 99)
 * - Effective Rate: 140,580 / 100 = 1405.80 NGN/USDC
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

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📊 OFFRAMP RATE CALCULATION`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Amount: ${amountUSDC} USDC\n`);

    // Step 1: Get base rate
    console.log(`Step 1️⃣  Fetching base rate...`);
    const { rate: baseRate, isCached, source } = await getAndUpdateBaseRate();

    // Step 2: Add markup
    const offrampRate = baseRate + OFFRAMP_MARKUP;
    console.log(`\nStep 2️⃣  Adding markup...`);
    console.log(`   Base Rate: ${baseRate} NGN/USDC (from ${source})`);
    console.log(`   + Markup: ${OFFRAMP_MARKUP} NGN`);
    console.log(`   = Offramp Rate: ${offrampRate} NGN/USDC`);

    // Step 3: Calculate user fee (1%, capped at $2)
    const feePercentage = FEE_PERCENTAGE / 100;
    const feeUSDC = Math.min(amountUSDC * feePercentage, FEE_MAX_USD);
    const effectiveFeePercent = (feeUSDC / amountUSDC) * 100;
    const feeNGN = feeUSDC * baseRate;

    console.log(`\nStep 3️⃣  Calculating user fee...`);
    console.log(`   Fee: ${FEE_PERCENTAGE}% of ${amountUSDC} USDC`);
    console.log(`   = ${feeUSDC.toFixed(6)} USDC (${effectiveFeePercent.toFixed(2)}%)`);
    console.log(`   = ₦${feeNGN.toFixed(2)} (at base rate)`);

    // Step 4: Calculate net USDC after fee
    const netUSDC = amountUSDC - feeUSDC;
    console.log(`\nStep 4️⃣  Net USDC after fee...`);
    console.log(`   ${amountUSDC} USDC - ${feeUSDC.toFixed(6)} USDC`);
    console.log(`   = ${netUSDC.toFixed(6)} USDC`);

    // Step 5: Calculate NGN amount
    const ngnAmount = netUSDC * offrampRate;
    console.log(`\nStep 5️⃣  Converting to NGN...`);
    console.log(`   ${netUSDC.toFixed(6)} USDC × ${offrampRate} NGN/USDC`);
    console.log(`   = ₦${ngnAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

    // Step 6: Calculate LP fee (0.5% of net USDC)
    const lpFeeUSDC = netUSDC * (LP_FEE_PERCENTAGE / 100);
    console.log(`\nStep 6️⃣  Calculating LP fee...`);
    console.log(`   ${LP_FEE_PERCENTAGE}% of ${netUSDC.toFixed(6)} USDC`);
    console.log(`   = ${lpFeeUSDC.toFixed(6)} USDC (to admin wallet)`);

    // Step 7: Calculate effective rate
    const effectiveRate = ngnAmount / amountUSDC;
    console.log(`\nStep 7️⃣  Effective rate (all-in)...`);
    console.log(`   ₦${ngnAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${amountUSDC} USDC`);
    console.log(`   = ${effectiveRate.toFixed(2)} NGN/USDC`);

    const timestamp = new Date().toISOString();

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ CALCULATION COMPLETE`);
    console.log(`${'═'.repeat(70)}\n`);

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
        source: source,
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

    console.log(`\n📊 Reverse calculation: ₦${amountNGN.toLocaleString()} → USDC`);

    // Get base rate
    const { rate: baseRate } = await getAndUpdateBaseRate();
    const offrampRate = baseRate + OFFRAMP_MARKUP;

    // Reverse: NGN / offrampRate = net USDC
    const netUSDC = amountNGN / offrampRate;

    // Account for fee: netUSDC = amountUSDC - fee
    let amountUSDC: number;

    if (netUSDC * (FEE_PERCENTAGE / 100) > FEE_MAX_USD) {
      amountUSDC = netUSDC + FEE_MAX_USD;
    } else {
      amountUSDC = netUSDC / (1 - FEE_PERCENTAGE / 100);
    }

    // Validate
    if (amountUSDC < MIN_OFFRAMP || amountUSDC > MAX_OFFRAMP) {
      return {
        success: false,
        error: `NGN amount corresponds to ${amountUSDC.toFixed(2)} USDC, which is outside allowed range (${MIN_OFFRAMP}-${MAX_OFFRAMP})`
      };
    }

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
 * @desc     Clear rate cache and fetch fresh from Paycrest on next call
 */
export function clearRateCache(): void {
  cachedRate = null;
  cacheTime = 0;
  console.log('✅ Rate cache cleared - will fetch fresh on next call');
}

/**
 * @function getCacheStatus
 * @desc     Get cache status information
 */
export function getCacheStatus(): {
  isCached: boolean;
  cachedRate: number | null;
  cacheAge: number;
  cacheExpiry: number;
} {
  const now = Date.now();
  const cacheAge = cacheTime > 0 ? now - cacheTime : 0;
  const cacheExpiry = Math.max(0, CACHE_TTL - cacheAge);

  return {
    isCached: cachedRate !== null && cacheAge <= CACHE_TTL,
    cachedRate,
    cacheAge,
    cacheExpiry
  };
}

// ============= EXPORTS =============

export default {
  getOfframpRate,
  getOfframpRateByNGN,
  getRateInfo,
  setManualRate,
  clearRateCache,
  getCacheStatus,
  MIN_OFFRAMP,
  MAX_OFFRAMP,
  DEFAULT_FALLBACK_RATE,
  OFFRAMP_MARKUP,
  FEE_PERCENTAGE,
  FEE_MAX_USD,
  LP_FEE_PERCENTAGE
};