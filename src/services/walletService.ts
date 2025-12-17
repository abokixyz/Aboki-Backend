// ============= src/services/walletService.ts (COMPLETE & FIXED) =============
import { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import crypto from 'crypto';

/**
 * ============= CONFIGURATION =============
 */
export type NetworkType = 'base-mainnet' | 'base-sepolia';

// USDC Contract Addresses
const USDC_ADDRESS_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ADDRESS_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// Validate encryption key on startup
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

if (!WALLET_ENCRYPTION_KEY) {
  console.error('❌ CRITICAL: WALLET_ENCRYPTION_KEY must be set in .env!');
  throw new Error('WALLET_ENCRYPTION_KEY environment variable is required');
}

// Type assertion since we've validated it exists
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
 * This matches the format expected by paymasterService.ts
 */
function encryptPrivateKey(privateKey: string): string {
  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'base64');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Combine IV + encrypted data and return as base64
    const combined = Buffer.concat([iv, encrypted]);
    return combined.toString('base64');
  } catch (error: any) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt private key (for internal use)
 * Format: BASE64(IV + ENCRYPTED_DATA)
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
 * ============= WALLET CREATION =============
 */

/**
 * Create server-managed wallet with encrypted private key storage
 * 
 * IMPORTANT: This stores the PRIVATE KEY (encrypted), not just addresses
 * This allows the server to sign transactions on behalf of users
 * 
 * @returns Wallet object with encrypted private key
 */
export const createServerWallet = async () => {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('🔐 Creating New Wallet with Encrypted Private Key Storage');
    console.log('='.repeat(70));

    // Step 1: Generate a secure random private key
    const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
    console.log('✅ Step 1: Private key generated (32 random bytes)');

    // Step 2: Derive Ethereum address from private key
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    console.log('✅ Step 2: Address derived:', account.address);

    // Step 3: Encrypt the private key before storing
    const encryptedWalletData = encryptPrivateKey(privateKey);
    console.log('✅ Step 3: Private key encrypted (BASE64 format)');
    console.log('   Encrypted length:', encryptedWalletData.length, 'chars');

    // Step 4: Return wallet object
    const wallet = {
      ownerAddress: account.address,
      smartAccountAddress: account.address,
      network: 'base-mainnet' as NetworkType,
      walletId: null,
      encryptedSeed: null,
      encryptedWalletData,  // ← ENCRYPTED PRIVATE KEY
      isReal: true
    };

    console.log('='.repeat(70));
    console.log('✅ Wallet Created Successfully');
    console.log('   Address:', account.address);
    console.log('   Network: base-mainnet');
    console.log('   Private Key: ENCRYPTED ✅');
    console.log('   Can sign transactions: YES ✅');
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
    const publicClient = createPublicClient({
      chain,
      transport: http()
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

    const publicClient = createPublicClient({
      chain,
      transport: http()
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
 * ============= TRANSACTION FUNCTIONS =============
 */

/**
 * Send ETH transaction
 * Note: For USDC transfers, use paymasterService.sendUSDCWithPaymaster instead
 */
export const sendTransaction = async (
  userId: string,
  encryptedWalletData: string,
  toAddress: string,
  amount: string,
  network: NetworkType = 'base-mainnet'
) => {
  try {
    console.log(`\n💸 Sending ${amount} ETH to ${toAddress}`);

    // Decrypt private key
    const privateKey = decryptPrivateKey(encryptedWalletData);
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    console.log(`   From: ${account.address}`);
    console.log(`   To: ${toAddress}`);
    console.log(`   Network: ${network}`);

    // Setup clients
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: parseEther(amount),
    });

    console.log(`   Transaction sent: ${txHash}`);
    console.log(`   Waiting for confirmation...`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash
    });

    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    return {
      success: true,
      transactionHash: txHash,
      amount,
      to: toAddress,
      from: account.address,
      status: 'complete',
      explorerUrl
    };
  } catch (error: any) {
    console.error('❌ ETH transfer failed:', error.message);
    throw new Error(`ETH transfer failed: ${error.message}`);
  }
};

/**
 * Send ERC20 token (including USDC)
 * Note: For gas-sponsored USDC transfers, use paymasterService.sendUSDCWithPaymaster
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
  try {
    console.log(`\n💸 Sending ${amount} tokens to ${toAddress}`);
    console.log(`   Token: ${tokenAddress}`);

    // Decrypt private key
    const privateKey = decryptPrivateKey(encryptedWalletData);
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Setup clients
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    // Encode transfer function
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, BigInt(amount)]
    });

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: tokenAddress as `0x${string}`,
      data: transferData,
    });

    console.log(`   Transaction sent: ${txHash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash
    });

    console.log(`✅ Token transfer confirmed`);

    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    return {
      success: true,
      transactionHash: txHash,
      amount,
      to: toAddress,
      from: account.address,
      tokenAddress,
      status: 'complete',
      explorerUrl
    };
  } catch (error: any) {
    console.error('❌ Token transfer failed:', error.message);
    throw new Error(`Token transfer failed: ${error.message}`);
  }
};

/**
 * Execute batch transactions
 */
export const executeBatchTransaction = async (
  userId: string,
  encryptedWalletData: string,
  calls: Array<{ to: string; value: bigint; data: string }>,
  network: NetworkType = 'base-mainnet'
) => {
  try {
    console.log(`\n📦 Executing batch transaction with ${calls.length} calls`);

    // Decrypt private key
    const privateKey = decryptPrivateKey(encryptedWalletData);
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Setup clients
    const chain = network === 'base-mainnet' ? base : baseSepolia;
    const rpcUrl = network === 'base-mainnet'
      ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

    // Execute calls sequentially (for simplicity)
    const txHashes: string[] = [];

    for (const call of calls) {
      const txHash = await walletClient.sendTransaction({
        to: call.to as `0x${string}`,
        value: call.value,
        data: call.data as `0x${string}`,
      });
      txHashes.push(txHash);
    }

    console.log(`✅ Batch transaction complete`);

    return {
      success: true,
      transactionHash: txHashes[0], // Return first tx hash
      status: 'complete'
    };
  } catch (error: any) {
    console.error('❌ Batch transaction failed:', error.message);
    throw new Error(`Batch transaction failed: ${error.message}`);
  }
};

/**
 * Get transaction history
 * Note: This is a placeholder - implement with block explorer API
 */
export const getTransactionHistory = async (address: string) => {
  // TODO: Implement using Basescan API or similar
  return [];
};

/**
 * ============= EXPORTS =============
 */
export default {
  createServerWallet,
  getWalletBalance,
  getUSDCBalance,
  sendTransaction,
  sendToken,
  executeBatchTransaction,
  getTransactionHistory
};