// ============= src/services/walletService.ts (WITH SMART ACCOUNT SUPPORT) =============
import { createPublicClient, http, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { toSafeSmartAccount } from 'permissionless/accounts';
import crypto from 'crypto';

/**
 * ============= CONFIGURATION =============
 */
export type NetworkType = 'base-mainnet' | 'base-sepolia';

// USDC Contract Addresses
const USDC_ADDRESS_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ADDRESS_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// EntryPoint v0.7
const ENTRYPOINT_ADDRESS_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

// Validate encryption key on startup
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

if (!WALLET_ENCRYPTION_KEY) {
  console.error('❌ CRITICAL: WALLET_ENCRYPTION_KEY must be set in .env!');
  throw new Error('WALLET_ENCRYPTION_KEY environment variable is required');
}

const ENCRYPTION_KEY: string = WALLET_ENCRYPTION_KEY;

// Test encryption key is valid base64 and 32 bytes
try {
  const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error(`Key must be 32 bytes, got ${keyBuffer.length}`);
  }
  console.log('✅ Wallet encryption key validated (32 bytes)');
} catch (error: any) {
  console.error('❌ Invalid WALLET_ENCRYPTION_KEY:', error.message);
  throw new Error('WALLET_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key');
}

// ERC20 ABI for balance checking
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  }
] as const;

/**
 * ============= ENCRYPTION UTILITIES =============
 */

/**
 * Encrypt private key using AES-256-CBC
 * Format: BASE64(IV + ENCRYPTED_DATA)
 */
function encryptPrivateKey(privateKey: string): string {
  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'base64');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const combined = Buffer.concat([iv, encrypted]);
    return combined.toString('base64');
  } catch (error: any) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt private key (for internal use)
 */
function decryptPrivateKey(encryptedKey: string): string {
  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'base64');
    const encrypted = Buffer.from(encryptedKey, 'base64');
    
    const iv = encrypted.slice(0, 16);
    const encryptedData = encrypted.slice(16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Test encryption/decryption on startup
 */
function testEncryption(): void {
  try {
    const testKey = '0x' + '1'.repeat(64);
    const encrypted = encryptPrivateKey(testKey);
    const decrypted = decryptPrivateKey(encrypted);
    
    if (testKey !== decrypted) {
      throw new Error('Decrypted value does not match original');
    }
    
    console.log('✅ Encryption test passed');
  } catch (error: any) {
    console.error('❌ Encryption test FAILED:', error.message);
    throw new Error('Encryption system is broken! Cannot proceed.');
  }
}

// Run encryption test on module load
testEncryption();

/**
 * ============= SMART ACCOUNT UTILITIES =============
 */

/**
 * Get Smart Account address from EOA private key
 * This is deterministic - same private key always produces same Smart Account address
 */
async function getSmartAccountAddress(
  privateKey: string,
  network: NetworkType = 'base-mainnet'
): Promise<string> {
  try {
    const signer = privateKeyToAccount(privateKey as `0x${string}`);
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const safeAccount = await toSafeSmartAccount({
      client: publicClient,
      owners: [signer],
      threshold: BigInt(1),
      version: '1.4.1',
      entryPoint: {
        address: ENTRYPOINT_ADDRESS_V07,
        version: '0.7',
      },
    });

    return safeAccount.address;
  } catch (error: any) {
    console.error('❌ Failed to get Smart Account address:', error.message);
    throw new Error(`Smart Account address generation failed: ${error.message}`);
  }
}

/**
 * ============= WALLET CREATION =============
 */

/**
 * Create server-managed wallet with Smart Account support
 * 
 * Returns both:
 * - ownerAddress (EOA) - for backwards compatibility
 * - smartAccountAddress (Safe) - for gasless transactions
 */
export const createServerWallet = async (network: NetworkType = 'base-mainnet') => {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('🔐 Creating Smart Account Wallet');
    console.log('='.repeat(70));

    // Step 1: Generate EOA private key
    const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
    console.log('✅ Step 1: EOA private key generated');

    // Step 2: Derive EOA address
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const eoaAddress = account.address;
    console.log('✅ Step 2: EOA address:', eoaAddress);

    // Step 3: Calculate Smart Account address
    console.log('🤖 Step 3: Calculating Smart Account address...');
    const smartAccountAddress = await getSmartAccountAddress(privateKey, network);
    console.log('✅ Step 3: Smart Account address:', smartAccountAddress);

    // Step 4: Encrypt private key
    const encryptedWalletData = encryptPrivateKey(privateKey);
    console.log('✅ Step 4: Private key encrypted');

    const wallet = {
      ownerAddress: eoaAddress,
      smartAccountAddress: smartAccountAddress,
      network,
      walletId: null,
      encryptedSeed: null,
      encryptedWalletData,
      isReal: true
    };

    console.log('='.repeat(70));
    console.log('✅ Smart Account Wallet Created');
    console.log('   EOA Address:', eoaAddress);
    console.log('   Smart Account:', smartAccountAddress);
    console.log('   Network:', network);
    console.log('   Gasless transactions: ENABLED ✅');
    console.log('='.repeat(70) + '\n');

    return wallet;
  } catch (error: any) {
    console.error('❌ Wallet creation failed:', error.message);
    throw new Error(`Failed to create wallet: ${error.message}`);
  }
};

/**
 * ============= BALANCE FUNCTIONS =============
 */

/**
 * Get ETH balance for an address
 */
export const getWalletBalance = async (
  address: string | null,
  network: NetworkType = 'base-mainnet'
) => {
  if (!address) {
    return {
      balance: '0.000000',
      balanceInWei: '0',
      currency: 'ETH',
      isReal: false
    };
  }

  try {
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const balance = await publicClient.getBalance({
      address: address as `0x${string}`,
    });

    const balanceInEth = (Number(balance) / 1e18).toFixed(6);

    console.log(`💰 ETH Balance for ${address}: ${balanceInEth} ETH`);

    return {
      balance: balanceInEth,
      balanceInWei: balance.toString(),
      currency: 'ETH',
      isReal: true
    };
  } catch (error: any) {
    console.error('❌ Error fetching ETH balance:', error.message);
    return {
      balance: '0.000000',
      balanceInWei: '0',
      currency: 'ETH',
      isReal: false
    };
  }
};

/**
 * Get USDC balance for an address
 * IMPORTANT: Checks Smart Account address by default
 */
export const getUSDCBalance = async (
  address: string | null,
  network: NetworkType = 'base-mainnet'
): Promise<{ balance: string; balanceInWei: string; currency: string; isReal: boolean }> => {
  if (!address) {
    return {
      balance: '0.00',
      balanceInWei: '0',
      currency: 'USDC',
      isReal: false
    };
  }

  try {
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const usdcAddress = network === 'base-mainnet' ? USDC_ADDRESS_MAINNET : USDC_ADDRESS_SEPOLIA;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const balance = await publicClient.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    // USDC has 6 decimals
    const balanceInUsdc = (Number(balance) / 1e6).toFixed(2);

    console.log(`💵 USDC Balance for ${address}: ${balanceInUsdc} USDC`);

    return {
      balance: balanceInUsdc,
      balanceInWei: balance.toString(),
      currency: 'USDC',
      isReal: true
    };
  } catch (error: any) {
    console.error('❌ Error fetching USDC balance:', error.message);
    return {
      balance: '0.00',
      balanceInWei: '0',
      currency: 'USDC',
      isReal: false
    };
  }
};

/**
 * ============= HELPER FUNCTIONS =============
 */

/**
 * Get Smart Account address from encrypted wallet data
 * Useful for controllers that need the Smart Account address
 */
export const getSmartAccountFromEncrypted = async (
  encryptedWalletData: string,
  network: NetworkType = 'base-mainnet'
): Promise<string> => {
  try {
    const privateKey = decryptPrivateKey(encryptedWalletData);
    return await getSmartAccountAddress(privateKey, network);
  } catch (error: any) {
    throw new Error(`Failed to get Smart Account: ${error.message}`);
  }
};

/**
 * ============= LEGACY TRANSACTION FUNCTIONS =============
 * These are kept for backwards compatibility but should use paymasterService for USDC
 */

/**
 * Send ETH transaction (not gasless)
 * For USDC, use paymasterService.sendUSDCWithPaymaster instead
 */
export const sendTransaction = async (
  userId: string,
  encryptedWalletData: string,
  toAddress: string,
  amount: string,
  network: NetworkType = 'base-mainnet'
) => {
  console.log('⚠️  Using legacy sendTransaction - consider using paymasterService for gasless');
  throw new Error('Direct ETH transfers not supported. Use paymasterService for USDC transfers.');
};

/**
 * Send ERC20 token (not gasless)
 * For USDC, use paymasterService.sendUSDCWithPaymaster instead
 */
export const sendToken = async (
  userId: string,
  encryptedWalletData: string,
  tokenAddress: string,
  toAddress: string,
  amount: string,
  decimals: number = 6,
  network: NetworkType = 'base-mainnet'
) => {
  console.log('⚠️  Using legacy sendToken - consider using paymasterService for gasless');
  throw new Error('Direct token transfers not supported. Use paymasterService for gasless USDC transfers.');
};

/**
 * ============= EXPORTS =============
 */
export default {
  createServerWallet,
  getWalletBalance,
  getUSDCBalance,
  getSmartAccountFromEncrypted
};