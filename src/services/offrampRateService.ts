// ============= src/services/offrampRateService.ts (FIXED - Cache Source) =============
/**
 * Offramp Rate Service
 * 
 * FIXED: Cache now stores original source (Paycrest/Fallback) to avoid validation errors
 */

import axios from 'axios';

// ============= CONFIGURATION =============

const PAYCREST_API_KEY = process.env.PAYCREST_API_KEY || '';
const PAYCREST_API_URL = process.env.PAYCREST_API_URL || 'https://api.paycrest.io/v1';

// Offramp constants
export const MIN_OFFRAMP = 0.1;
export const MAX_OFFRAMP = 5000;
export const DEFAULT_FALLBACK_RATE = 1400;
export const OFFRAMP_MARKUP = 20;
export const FEE_PERCENTAGE = 1;
export const FEE_MAX_USD = 2;
export const LP_FEE_PERCENTAGE = 0.5;

// Rate caching - NOW STORES ORIGINAL SOURCE
interface CachedRateData {
  rate: number;
  originalSource: 'Paycrest' | 'Fallback'; // ← Track original source
}

let cachedRateData: CachedRateData | null = null;
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
    source: 'Paycrest' | 'Fallback'; // ← Only valid enum values
    cached: boolean;
    timestamp: string;
  };
  error?: string;
}

// ============= UTILITY FUNCTIONS =============

/**
 * Fetch base rate from Paycrest
 */
async function getBaseRateFromPaycrest(): Promise<number> {
  try {
    if (!PAYCREST_API_KEY) {
      console.warn('⚠️  PAYCREST_API_KEY not configured');
      console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
      return DEFAULT_FALLBACK_RATE;
    }

    const url = `${PAYCREST_API_URL}/rates/USDC/1/NGN`;
    
    console.log('🌐 Fetching rate from Paycrest API...');

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': PAYCREST_API_KEY
      },
      timeout: 5000
    });

    console.log('   ✅ Paycrest API responded');

    if (response.data && response.data.status === 'success' && response.data.data) {
      let parsedRate = typeof response.data.data === 'string' 
        ? parseFloat(response.data.data) 
        : (response.data.data.rate || parseFloat(response.data.data));
        
      if (isNaN(parsedRate) || parsedRate <= 0) {
        throw new Error('Invalid rate value from Paycrest');
      }
      
      console.log(`   ✅ Paycrest rate: ${parsedRate} NGN/USDC`);
      return parsedRate;
    }

    console.warn('⚠️  Invalid Paycrest response format');
    console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
    return DEFAULT_FALLBACK_RATE;
  } catch (error: any) {
    console.warn(`⚠️  Error fetching Paycrest rate: ${error.message}`);
    console.warn(`   Using fallback rate: ${DEFAULT_FALLBACK_RATE} NGN/USDC`);
    return DEFAULT_FALLBACK_RATE;
  }
}

/**
 * Get and update base rate
 * FIXED: Returns original source even when serving from cache
 */
async function getAndUpdateBaseRate(): Promise<{ 
  rate: number; 
  isCached: boolean; 
  source: 'Paycrest' | 'Fallback'; 
}> {
  const now = Date.now();

  // Check if cache is still valid
  if (cachedRateData !== null && (now - cacheTime) <= CACHE_TTL) {
    const timeRemaining = Math.round((CACHE_TTL - (now - cacheTime)) / 1000);
    console.log(`📦 Using cached rate: ${cachedRateData.rate} NGN/USDC (${timeRemaining}s remaining)`);
    console.log(`   Original source: ${cachedRateData.originalSource}`);
    
    // ✅ FIXED: Return original source, not 'cache'
    return { 
      rate: cachedRateData.rate, 
      isCached: true, 
      source: cachedRateData.originalSource 
    };
  }

  // Cache expired or doesn't exist, fetch fresh from Paycrest
  console.log('📊 Cache expired or missing, fetching fresh rate...');
  const freshRate = await getBaseRateFromPaycrest();

  // Determine original source
  const originalSource: 'Paycrest' | 'Fallback' = 
    freshRate === DEFAULT_FALLBACK_RATE ? 'Fallback' : 'Paycrest';

  // ✅ FIXED: Cache the rate WITH its original source
  cachedRateData = {
    rate: freshRate,
    originalSource: originalSource
  };
  cacheTime = now;

  console.log(`   ✅ Cached rate: ${freshRate} NGN/USDC (source: ${originalSource})`);

  return { 
    rate: freshRate, 
    isCached: false, 
    source: originalSource 
  };
}

// ============= MAIN RATE FUNCTION =============

/**
 * Calculate offramp rate with fees
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

    // Step 1: Get base rate (with original source tracking)
    console.log(`Step 1️⃣  Fetching base rate...`);
    const { rate: baseRate, isCached, source } = await getAndUpdateBaseRate();

    // Step 2: Add markup
    const offrampRate = baseRate + OFFRAMP_MARKUP;
    console.log(`\nStep 2️⃣  Adding markup...`);
    console.log(`   Base Rate: ${baseRate} NGN/USDC (${isCached ? 'cached, ' : ''}source: ${source})`);
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

    // Step 4: Calculate net USDC after fee
    const netUSDC = amountUSDC - feeUSDC;
    console.log(`\nStep 4️⃣  Net USDC after fee...`);
    console.log(`   = ${netUSDC.toFixed(6)} USDC`);

    // Step 5: Calculate NGN amount
    const ngnAmount = netUSDC * offrampRate;
    console.log(`\nStep 5️⃣  Converting to NGN...`);
    console.log(`   = ₦${ngnAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

    // Step 6: Calculate LP fee (0.5% of net USDC)
    const lpFeeUSDC = netUSDC * (LP_FEE_PERCENTAGE / 100);
    console.log(`\nStep 6️⃣  LP fee: ${lpFeeUSDC.toFixed(6)} USDC`);

    // Step 7: Calculate effective rate
    const effectiveRate = ngnAmount / amountUSDC;
    console.log(`\nStep 7️⃣  Effective rate: ${effectiveRate.toFixed(2)} NGN/USDC`);

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
        source: source, // ✅ FIXED: Always 'Paycrest' or 'Fallback'
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
 * Get offramp rate by NGN amount (reverse calculation)
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

    const { rate: baseRate } = await getAndUpdateBaseRate();
    const offrampRate = baseRate + OFFRAMP_MARKUP;
    const netUSDC = amountNGN / offrampRate;

    let amountUSDC: number;
    if (netUSDC * (FEE_PERCENTAGE / 100) > FEE_MAX_USD) {
      amountUSDC = netUSDC + FEE_MAX_USD;
    } else {
      amountUSDC = netUSDC / (1 - FEE_PERCENTAGE / 100);
    }

    if (amountUSDC < MIN_OFFRAMP || amountUSDC > MAX_OFFRAMP) {
      return {
        success: false,
        error: `NGN amount corresponds to ${amountUSDC.toFixed(2)} USDC, outside range (${MIN_OFFRAMP}-${MAX_OFFRAMP})`
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
 * Get current rate information
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
 * Set manual rate (for testing)
 */
export function setManualRate(rate: number, source: 'Paycrest' | 'Fallback' = 'Paycrest'): void {
  cachedRateData = { rate, originalSource: source };
  cacheTime = Date.now();
  console.log(`✅ Manual rate set: ${rate} NGN/USDC (source: ${source})`);
}

/**
 * Clear rate cache
 */
export function clearRateCache(): void {
  cachedRateData = null;
  cacheTime = 0;
  console.log('✅ Rate cache cleared');
}

/**
 * Get cache status
 */
export function getCacheStatus(): {
  isCached: boolean;
  cachedRate: number | null;
  cachedSource: 'Paycrest' | 'Fallback' | null;
  cacheAge: number;
  cacheExpiry: number;
} {
  const now = Date.now();
  const cacheAge = cacheTime > 0 ? now - cacheTime : 0;
  const cacheExpiry = Math.max(0, CACHE_TTL - cacheAge);

  return {
    isCached: cachedRateData !== null && cacheAge <= CACHE_TTL,
    cachedRate: cachedRateData?.rate || null,
    cachedSource: cachedRateData?.originalSource || null,
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