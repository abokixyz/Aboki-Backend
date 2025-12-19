// ============= src/services/lencoService.ts (LENCO INTEGRATION - CORRECTED) =============
/**
 * Lenco Service
 * 
 * Handles all Lenco integrations:
 * - Account verification via /v1/resolve endpoint
 * - Money transfers to bank accounts
 * - Webhook signature verification
 * - Bank list management
 * - Transfer status tracking
 * 
 * API Reference: https://lenco-api.readme.io/
 */

import axios from 'axios';
import crypto from 'crypto';

// ============= LENCO CONFIGURATION =============

const LENCO_API_KEY = process.env.LENCO_API_KEY || '';
const LENCO_API_BASE_URL = process.env.LENCO_API_BASE_URL || 'https://api.lenco.co/access/v1';
const LENCO_SECRET_KEY = process.env.LENCO_SECRET_KEY || '';

// Validate Lenco configuration on startup
if (!LENCO_API_KEY) {
  console.warn('⚠️ LENCO_API_KEY not set - Lenco integration will be disabled');
}

if (!LENCO_SECRET_KEY) {
  console.warn('⚠️ LENCO_SECRET_KEY not set - Webhook signature verification will be disabled');
}

// ============= LENCO API INTERFACES =============

interface LencoResolveResponse {
  status: boolean;
  message: string;
  data?: {
    accountName: string;
    accountNumber: string;
    bank: {
      code: string;
      name: string;
    };
  };
  error?: string;
}

interface LencoTransferResponse {
  status: boolean;
  message: string;
  data?: {
    reference: string;        // ✅ This is the correct field name
    amount: number;
    currency: string;
    status: string;
    id?: string;
  };
  error?: string;
}

// ============= BANK ACCOUNT VERIFICATION =============

/**
 * Verify bank account with Lenco using /v1/resolve endpoint
 * Returns account details if valid
 * 
 * API: GET https://api.lenco.co/access/v1/resolve
 * Params: account_number, bank_code
 */
export async function verifyBankAccountWithLenco(
  bankCode: string,
  accountNumber: string
): Promise<{
  success: boolean;
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
  bankName?: string;
  error?: string;
}> {
  try {
    if (!LENCO_API_KEY) {
      console.error('❌ Lenco API key not configured');
      return {
        success: false,
        error: 'Bank verification service not configured'
      };
    }

    console.log(`🏦 Verifying account with Lenco: ${accountNumber} (${bankCode})`);

    // Call Lenco resolve endpoint
    const response = await axios.get(
      `${LENCO_API_BASE_URL}/resolve`,
      {
        params: {
          account_number: accountNumber,
          bank_code: bankCode
        },
        headers: {
          'Authorization': `Bearer ${LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const data = response.data as LencoResolveResponse;

    if (data.status && data.data) {
      console.log(`✅ Account verified: ${data.data.accountName}`);
      return {
        success: true,
        accountNumber: data.data.accountNumber,
        accountName: data.data.accountName,
        bankCode: data.data.bank.code,
        bankName: data.data.bank.name
      };
    } else {
      console.error('❌ Account verification failed:', data.message);
      return {
        success: false,
        error: data.message || 'Account verification failed'
      };
    }
  } catch (error: any) {
    console.error('❌ Error verifying account with Lenco:', error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Verification failed'
    };
  }
}

/**
 * Alias for verifyBankAccountWithLenco (for backward compatibility)
 */
export const verifyBankAccount = verifyBankAccountWithLenco;

// ============= MONEY TRANSFER =============

/**
 * Initiate money transfer via Lenco
 * Settles user's offramp request to their bank account
 * 
 * API: POST https://api.lenco.co/access/v1/transfers
 */
export async function initiateLencoTransfer(
  amountNGN: number,
  accountNumber: string,
  bankCode: string,
  accountName: string,
  reference: string
): Promise<{
  success: boolean;
  transferId?: string;    // ✅ Return as transferId for consistency
  error?: string;
}> {
  try {
    if (!LENCO_API_KEY) {
      console.error('❌ Lenco API key not configured');
      return {
        success: false,
        error: 'Transfer service not configured'
      };
    }

    console.log(`💸 Initiating Lenco transfer`);
    console.log(`   Amount: ₦${amountNGN.toLocaleString()}`);
    console.log(`   Account: ${accountNumber}`);
    console.log(`   Reference: ${reference}`);

    // Call Lenco transfer endpoint
    const response = await axios.post(
      `${LENCO_API_BASE_URL}/transfers`,
      {
        amount: Math.floor(amountNGN),
        currency: 'NGN',
        recipient: {
          account_number: accountNumber,
          bank_code: bankCode,
          account_name: accountName
        },
        meta_data: {
          reference: reference,
          source: 'aboki_offramp',
          timestamp: new Date().toISOString()
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${LENCO_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `${reference}_${Date.now()}`
        },
        timeout: 15000
      }
    );

    const data = response.data as LencoTransferResponse;

    if (data.status && data.data) {
      console.log(`✅ Lenco transfer initiated`);
      console.log(`   Reference: ${data.data.reference}`);
      console.log(`   Status: ${data.data.status}`);

      return {
        success: true,
        transferId: data.data.reference  // ✅ Map Lenco's "reference" to our "transferId"
      };
    } else {
      console.error('❌ Transfer initiation failed:', data.message);
      return {
        success: false,
        error: data.message || 'Transfer initiation failed'
      };
    }
  } catch (error: any) {
    console.error('❌ Error initiating Lenco transfer:', error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Transfer failed'
    };
  }
}

// ============= WEBHOOK VERIFICATION =============

/**
 * Verify Lenco webhook signature (HMAC-SHA256)
 * Secret key is embedded in the function
 */
export function verifyLencoWebhook(
  payload: any,
  signature: string
): boolean {
  if (!LENCO_SECRET_KEY) {
    console.warn('⚠️ LENCO_SECRET_KEY not set - skipping webhook signature verification');
    return true;
  }

  try {
    const hash = crypto
      .createHmac('sha256', LENCO_SECRET_KEY)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return hash === signature;
  } catch (error) {
    console.error('❌ Webhook signature verification error:', error);
    return false;
  }
}

/**
 * Alias for verifyLencoWebhook (for backward compatibility)
 */
export const verifyWebhookSignature = verifyLencoWebhook;

// ============= BANK LIST UTILITIES =============

interface Bank {
  code: string;
  name: string;
}

let cachedBanks: Bank[] | null = null;
let bankCacheTime = 0;
const BANK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get list of supported banks from Lenco
 * Results are cached for 24 hours
 */
export async function getSupportedBanks(): Promise<Bank[]> {
  try {
    // Return cached if still valid
    if (cachedBanks !== null && Date.now() - bankCacheTime < BANK_CACHE_TTL) {
      return cachedBanks;
    }

    if (!LENCO_API_KEY) {
      console.warn('⚠️ Lenco API key not configured - cannot fetch bank list');
      return [];
    }

    console.log('🏦 Fetching supported banks from Lenco...');

    const response = await axios.get(
      `${LENCO_API_BASE_URL}/banks`,
      {
        headers: {
          'Authorization': `Bearer ${LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.data) {
      const banks: Bank[] = response.data.data.map((bank: any) => ({
        code: bank.code,
        name: bank.name
      }));
      cachedBanks = banks;
      bankCacheTime = Date.now();

      console.log(`✅ Loaded ${banks.length} banks`);
      return banks;
    }

    return [];
  } catch (error: any) {
    console.error('❌ Error fetching banks from Lenco:', error.message);
    return [];
  }
}

/**
 * Get bank name by code
 */
export async function getBankName(bankCode: string): Promise<string | null> {
  try {
    const banks = await getSupportedBanks();
    const bank = banks.find(b => b.code === bankCode);
    return bank?.name || null;
  } catch (error) {
    console.error('❌ Error getting bank name:', error);
    return null;
  }
}

// ============= TRANSFER STATUS =============

/**
 * Get transfer status from Lenco
 */
export async function getTransferStatus(transferId: string): Promise<{
  success: boolean;
  status?: string;
  amount?: number;
  currency?: string;
  error?: string;
}> {
  try {
    if (!LENCO_API_KEY) {
      return {
        success: false,
        error: 'Lenco API key not configured'
      };
    }

    const response = await axios.get(
      `${LENCO_API_BASE_URL}/transfers/${transferId}`,
      {
        headers: {
          'Authorization': `Bearer ${LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.data) {
      return {
        success: true,
        status: response.data.data.status,
        amount: response.data.data.amount,
        currency: response.data.data.currency
      };
    }

    return {
      success: false,
      error: 'Failed to fetch transfer status'
    };
  } catch (error: any) {
    console.error('❌ Error fetching transfer status:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============= EXPORTS =============

export default {
  verifyBankAccountWithLenco,
  verifyBankAccount,           // ✅ Alias
  initiateLencoTransfer,
  verifyLencoWebhook,
  verifyWebhookSignature,      // ✅ Alias
  getSupportedBanks,
  getBankName,
  getTransferStatus
};