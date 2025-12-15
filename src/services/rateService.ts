// ============= src/services/rateService.ts (FIXED) =============
import axios from 'axios';

// Configuration
const PAYCREST_API_KEY = process.env.PAYCREST_API_KEY;
const PAYCREST_API_URL = process.env.PAYCREST_API_URL || 'https://api.paycrest.io/v1';

// Rate constants
const RATE_MARKUP_NGN = 40; // Add ₦40 to the base rate
const FEE_PERCENTAGE = 0.015; // 1.5%
const MAX_FEE_NGN = 2000; // Cap fee at ₦2000

// Cache configuration
interface CacheItem {
  value: any;
  expiry: number;
}

class SimpleCache {
  private store: Map<string, CacheItem> = new Map();

  set(key: string, value: any, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiry: Date.now() + (ttlSeconds * 1000)
    });
  }

  get(key: string, includeExpired = false): any | null {
    const item = this.store.get(key);
    if (!item) return null;
    
    if (includeExpired || Date.now() < item.expiry) {
      return item.value;
    }
    
    return null;
  }

  clear(): void {
    this.store.clear();
  }
}

const cache = new SimpleCache();

interface RateResult {
  rate: number;
  source: string;
  status: string;
  cached?: boolean;
  cacheType?: 'fresh' | 'expired';
  warning?: string;
  lastUpdate?: string;
}

/**
 * Fetch USD/NGN rate from Paycrest API (USDC)
 * FIXED: Request rate for 1 USDC instead of 10 to get per-unit rate
 */
async function fetchPaycrestRate(amount = 1): Promise<RateResult> {
  try {
    const url = `${PAYCREST_API_URL}/rates/USDC/${amount}/NGN`;
    
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        ...(PAYCREST_API_KEY && { 'x-api-key': PAYCREST_API_KEY })
      },
      timeout: 5000
    });
    
    if (response.data && response.data.status === 'success' && response.data.data) {
      let parsedRate = typeof response.data.data === 'string' 
        ? parseFloat(response.data.data) 
        : (response.data.data.rate || parseFloat(response.data.data));
      
      // If we requested multiple USDC, divide by amount to get rate per 1 USDC
      if (amount > 1) {
        parsedRate = parsedRate / amount;
      }
        
      if (isNaN(parsedRate) || parsedRate <= 0) {
        throw new Error('Invalid rate value from Paycrest');
      }
      
      console.log(`✅ Paycrest rate: ₦${parsedRate.toFixed(2)} per 1 USDC`);
      
      return { rate: parsedRate, source: 'Paycrest', status: 'success' };
    } else {
      throw new Error('Invalid response format from Paycrest API');
    }
  } catch (error: any) {
    throw new Error(`Paycrest API failed: ${error.message}`);
  }
}

/**
 * Fetch USD/NGN rate from ExchangeRate-API
 */
async function fetchExchangeRateApi(): Promise<RateResult> {
  try {
    const url = 'https://api.exchangerate-api.com/v4/latest/USD';
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data && response.data.rates && response.data.rates.NGN) {
      const rate = response.data.rates.NGN;
      return { rate, source: 'ExchangeRate-API', status: 'success' };
    } else {
      throw new Error('Invalid response from ExchangeRate-API');
    }
  } catch (error: any) {
    throw new Error(`ExchangeRate-API failed: ${error.message}`);
  }
}

/**
 * Fetch USD/NGN rate from Fawazahmed0 API
 */
async function fetchFawazahmedRate(): Promise<RateResult> {
  try {
    const url = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data && response.data.usd && response.data.usd.ngn) {
      const rate = response.data.usd.ngn;
      return { 
        rate, 
        source: 'Fawazahmed0', 
        status: 'success', 
        lastUpdate: response.data.date 
      };
    } else {
      throw new Error('Invalid response from Fawazahmed0');
    }
  } catch (error: any) {
    throw new Error(`Fawazahmed0 API failed: ${error.message}`);
  }
}

/**
 * Get USD/NGN rate with full fallback chain
 */
export async function getUsdNgnRateWithFallback(): Promise<RateResult> {
  const cacheKey = 'usd-ngn-rate';
  
  // 1. Check fresh cache
  let cachedData = cache.get(cacheKey);
  if (cachedData) {
    return {
      ...cachedData,
      cached: true,
      cacheType: 'fresh'
    };
  }
  
  // 2. Check expired cache for fallback
  cachedData = cache.get(cacheKey, true);
  
  // 3. Try Paycrest (Primary) - FIXED: Request rate for 1 USDC
  try {
    const result = await fetchPaycrestRate(1);
    cache.set(cacheKey, result, 1800); // Cache for 30 minutes
    return {
      ...result,
      cached: false
    };
  } catch (paycrestError) {
    console.warn('⚠️ Paycrest failed, trying fallbacks...');
  }
  
  // 4. Try ExchangeRate-API (Fallback 1)
  try {
    const result = await fetchExchangeRateApi();
    cache.set(cacheKey, result, 1800);
    return {
      ...result,
      cached: false
    };
  } catch (exchangeError) {
    console.warn('⚠️ ExchangeRate-API failed, trying next fallback...');
  }
  
  // 5. Try Fawazahmed0 (Fallback 2)
  try {
    const result = await fetchFawazahmedRate();
    cache.set(cacheKey, result, 1800);
    return {
      ...result,
      cached: false
    };
  } catch (fawazError) {
    console.warn('⚠️ Fawazahmed0 also failed...');
  }
  
  // 6. Use expired cache if available
  if (cachedData) {
    return {
      ...cachedData,
      cached: true,
      cacheType: 'expired',
      warning: 'All APIs failed, using expired cached data'
    };
  }
  
  // 7. Last resort: hardcoded fallback
  const fallbackRate = 1550;
  return {
    rate: fallbackRate,
    source: 'Hardcoded Fallback',
    status: 'fallback',
    cached: false,
    warning: 'All APIs and cache failed, using hardcoded rate'
  };
}

/**
 * Calculate onramp rate with markup and fee
 */
export interface OnrampRateCalculation {
  baseRate: number;
  onrampRate: number;
  markup: number;
  feePercentage: number;
  feeAmount: number;
  maxFee: number;
  effectiveRate: number;
  amountNGN?: number;
  totalPayable?: number;
  amountUSDC?: number;
  source: string;
  cached: boolean;
  warning?: string;
}

export async function calculateOnrampRate(amountNGN?: number): Promise<OnrampRateCalculation> {
  try {
    // Get base rate from API with fallbacks
    const rateResult = await getUsdNgnRateWithFallback();
    const baseRate = rateResult.rate;
    
    // Apply markup: Add ₦40 to base rate
    const onrampRate = baseRate + RATE_MARKUP_NGN;
    
    // Calculate fee (1.5% of amount, capped at ₦2000)
    let feeAmount = 0;
    let totalPayable = 0;
    let amountUSDC = 0;
    let effectiveRate = onrampRate;
    
    if (amountNGN && amountNGN > 0) {
      // Calculate raw fee (1.5% of desired amount)
      const rawFee = amountNGN * FEE_PERCENTAGE;
      
      // Cap fee at ₦2000
      feeAmount = Math.min(rawFee, MAX_FEE_NGN);
      
      // Total payable = amount + fee (fee is ADDED, not deducted)
      totalPayable = amountNGN + feeAmount;
      
      // Calculate USDC amount (based on desired amount, not total payable)
      amountUSDC = amountNGN / onrampRate;
      
      // Calculate effective rate (what user actually pays per USDC)
      effectiveRate = totalPayable / amountUSDC;
      
      // Debug log
      console.log(`💰 Rate Calculation for ₦${amountNGN.toLocaleString()}:`);
      console.log(`   Base Rate: ₦${baseRate.toFixed(2)}`);
      console.log(`   Onramp Rate: ₦${onrampRate.toFixed(2)}`);
      console.log(`   USDC Amount: ${amountUSDC.toFixed(6)} USDC`);
      console.log(`   Fee: ₦${feeAmount.toFixed(2)}`);
      console.log(`   Total Payable: ₦${totalPayable.toFixed(2)}`);
    }
    
    return {
      baseRate: parseFloat(baseRate.toFixed(2)),
      onrampRate: parseFloat(onrampRate.toFixed(2)),
      markup: RATE_MARKUP_NGN,
      feePercentage: FEE_PERCENTAGE * 100, // Convert to percentage
      feeAmount: parseFloat(feeAmount.toFixed(2)),
      maxFee: MAX_FEE_NGN,
      effectiveRate: parseFloat(effectiveRate.toFixed(2)),
      ...(amountNGN && { 
        amountNGN: parseFloat(amountNGN.toFixed(2)),
        totalPayable: parseFloat(totalPayable.toFixed(2)),
        amountUSDC: parseFloat(amountUSDC.toFixed(6))
      }),
      source: rateResult.source,
      cached: rateResult.cached || false,
      ...(rateResult.warning && { warning: rateResult.warning })
    };
  } catch (error: any) {
    throw new Error(`Failed to calculate onramp rate: ${error.message}`);
  }
}

/**
 * Get onramp rate endpoint controller
 */
export async function getOnrampRate(amountNGN?: number): Promise<OnrampRateCalculation> {
  return await calculateOnrampRate(amountNGN);
}

export default {
  getUsdNgnRateWithFallback,
  calculateOnrampRate,
  getOnrampRate
};