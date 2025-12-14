// ============= src/services/walletService.ts (UPDATED) =============
import { CdpClient } from '@coinbase/cdp-sdk';
import { parseEther, formatEther, encodeFunctionData, createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import crypto from 'crypto';

/**
 * Encryption utilities for wallet data
 */
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

const encrypt = (text: string): string => {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const decrypt = (encryptedText: string): string => {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * Supported networks - EXPORTED for use in controllers
 */
export type NetworkType = 'base-mainnet' | 'base-sepolia' | 'ethereum-sepolia';

// USDC Contract Addresses
const USDC_ADDRESS_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ADDRESS_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// ERC20 ABI for balance checking
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Initialize CDP Client (no credentials needed)
 */
const initializeCDP = (): CdpClient | null => {
  try {
    const cdp = new CdpClient();
    console.log('✅ CDP Client initialized successfully');
    return cdp;
  } catch (error: any) {
    console.error('❌ Error initializing CDP Client:', error.message);
    return null;
  }
};

/**
 * Create server-managed smart wallet using CDP SDK
 * Following the pattern from working examples
 */
export const createServerWallet = async () => {
  const cdp = initializeCDP();

  if (!cdp) {
    console.log('📝 CDP not available - creating mock wallet');
    return createMockWallet();
  }

  try {
    console.log('🔐 Creating CDP smart wallet on Base...');

    // Step 1: Create owner account
    const owner = await cdp.evm.createAccount({});
    console.log('✅ Owner account created:', owner.address);

    // Step 2: Create smart account
    const smartAccount = await cdp.evm.createSmartAccount({
      owner,
    });
    console.log('✅ Smart account created:', smartAccount.address);

    // Step 3: Store wallet data (encrypted)
    const walletData = {
      ownerAddress: owner.address,
      smartAccountAddress: smartAccount.address,
    };

    const encryptedWalletData = encrypt(JSON.stringify(walletData));

    console.log('✅ CDP wallet created successfully');

    return {
      ownerAddress: owner.address,
      smartAccountAddress: smartAccount.address,
      network: 'base-mainnet' as NetworkType,
      walletId: smartAccount.address,
      encryptedSeed: null,
      encryptedWalletData,
      isReal: true
    };
  } catch (error: any) {
    console.error('❌ Error creating CDP wallet:', error.message);
    console.error('   Full error:', error);
    console.log('📝 Falling back to mock wallet');
    return createMockWallet();
  }
};

/**
 * Mock wallet fallback
 */
const createMockWallet = () => {
  const address = `0x${crypto.randomBytes(20).toString('hex')}`;
  
  return {
    ownerAddress: address,
    smartAccountAddress: address,
    network: 'base-mainnet' as NetworkType,
    walletId: null,
    encryptedSeed: null,
    encryptedWalletData: null,
    isReal: false
  };
};

/**
 * Get ETH balance using viem
 */
export const getWalletBalance = async (
  smartAccountAddress: string | null,
  network: NetworkType = 'base-mainnet'
) => {
  if (!smartAccountAddress) {
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
      transport: http(),
    });

    const balance = await publicClient.getBalance({
      address: smartAccountAddress as `0x${string}`,
    });

    const balanceInEth = (Number(balance) / 1e18).toFixed(6);

    console.log(`📊 ETH Balance for ${smartAccountAddress}: ${balanceInEth} ETH`);

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
 * Get USDC balance using viem
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
      transport: http(),
    });

    const balance = await publicClient.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    // USDC has 6 decimals
    const balanceInUsdc = (Number(balance) / 1e6).toFixed(2);

    console.log(`📊 USDC Balance for ${address}: ${balanceInUsdc} USDC`);

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
 * Send ETH transaction using CDP smart account
 */
export const sendTransaction = async (
  userId: string,
  encryptedWalletData: string,
  toAddress: string,
  amount: string,
  network: NetworkType = 'base-mainnet'
) => {
  const cdp = initializeCDP();

  if (!cdp || !encryptedWalletData) {
    throw new Error('CDP not configured or wallet data not found');
  }

  try {
    console.log(`💸 Sending ${amount} ETH to ${toAddress}`);

    const walletData = JSON.parse(decrypt(encryptedWalletData));

    const owner = await cdp.evm.createAccount({});
    const smartAccount = await cdp.evm.createSmartAccount({
      owner,
    });

    console.log(`   From: ${smartAccount.address}`);
    console.log(`   To: ${toAddress}`);
    console.log(`   Amount: ${amount} ETH`);
    console.log(`   Network: ${network}`);

    const result = await cdp.evm.sendUserOperation({
      smartAccount,
      network: network as any,
      calls: [
        {
          to: toAddress as `0x${string}`,
          value: parseEther(amount),
          data: '0x' as `0x${string}`,
        },
      ],
    });

    console.log('📝 UserOp Hash:', result.userOpHash);
    console.log('   Waiting for confirmation...');

    const userOperation = await cdp.evm.waitForUserOperation({
      smartAccountAddress: smartAccount.address,
      userOpHash: result.userOpHash,
    });

    if (userOperation.status !== 'complete') {
      throw new Error(`Transaction failed: ${userOperation.status}`);
    }

    console.log('✅ Transaction confirmed!');
    console.log('   TX Hash:', userOperation.transactionHash);

    let explorerUrl = '';
    if (network === 'base-mainnet') {
      explorerUrl = `https://basescan.org/tx/${userOperation.transactionHash}`;
    } else if (network === 'base-sepolia') {
      explorerUrl = `https://sepolia.basescan.org/tx/${userOperation.transactionHash}`;
    } else if (network === 'ethereum-sepolia') {
      explorerUrl = `https://sepolia.etherscan.io/tx/${userOperation.transactionHash}`;
    }

    return {
      success: true,
      transactionHash: userOperation.transactionHash,
      amount,
      to: toAddress,
      from: smartAccount.address,
      status: userOperation.status,
      explorerUrl
    };
  } catch (error: any) {
    console.error('❌ Transaction failed:', error.message);
    throw new Error(`Transaction failed: ${error.message}`);
  }
};

/**
 * Send ERC20 token transfer
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
  const cdp = initializeCDP();

  if (!cdp || !encryptedWalletData) {
    throw new Error('CDP not configured or wallet data not found');
  }

  try {
    console.log(`💸 Sending ${amount} tokens to ${toAddress}`);
    console.log(`   Token: ${tokenAddress}`);
    console.log(`   Network: ${network}`);

    const walletData = JSON.parse(decrypt(encryptedWalletData));

    const owner = await cdp.evm.createAccount({});
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    const ERC20_TRANSFER_ABI = [
      {
        inputs: [
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "transfer",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;

    const transferData = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, BigInt(amount)],
    });

    const result = await cdp.evm.sendUserOperation({
      smartAccount,
      network: network as any,
      calls: [
        {
          to: tokenAddress as `0x${string}`,
          value: 0n,
          data: transferData,
        },
      ],
    });

    console.log('📝 UserOp Hash:', result.userOpHash);
    console.log('   Waiting for confirmation...');

    const userOperation = await cdp.evm.waitForUserOperation({
      smartAccountAddress: smartAccount.address,
      userOpHash: result.userOpHash,
    });

    if (userOperation.status !== 'complete') {
      throw new Error(`Transaction failed: ${userOperation.status}`);
    }

    console.log('✅ Token transfer successful!');
    console.log('   TX Hash:', userOperation.transactionHash);

    return {
      success: true,
      transactionHash: userOperation.transactionHash,
      amount,
      to: toAddress,
      from: smartAccount.address,
      tokenAddress,
      status: userOperation.status
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
  const cdp = initializeCDP();

  if (!cdp || !encryptedWalletData) {
    throw new Error('CDP not configured or wallet data not found');
  }

  try {
    console.log(`📦 Executing batch transaction with ${calls.length} calls`);

    const walletData = JSON.parse(decrypt(encryptedWalletData));

    const owner = await cdp.evm.createAccount({});
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    const result = await cdp.evm.sendUserOperation({
      smartAccount,
      network: network as any,
      calls: calls.map(call => ({
        to: call.to as `0x${string}`,
        value: call.value,
        data: call.data as `0x${string}`,
      })),
    });

    console.log('📝 UserOp Hash:', result.userOpHash);

    const userOperation = await cdp.evm.waitForUserOperation({
      smartAccountAddress: smartAccount.address,
      userOpHash: result.userOpHash,
    });

    if (userOperation.status !== 'complete') {
      throw new Error(`Batch transaction failed: ${userOperation.status}`);
    }

    console.log('✅ Batch transaction successful!');

    return {
      success: true,
      transactionHash: userOperation.transactionHash,
      status: userOperation.status
    };
  } catch (error: any) {
    console.error('❌ Batch transaction failed:', error.message);
    throw new Error(`Batch transaction failed: ${error.message}`);
  }
};

/**
 * Get transaction history
 */
export const getTransactionHistory = async (smartAccountAddress: string) => {
  return [];
};

// Export everything including NetworkType
export default {
  createServerWallet,
  getWalletBalance,
  getUSDCBalance,
  sendTransaction,
  sendToken,
  executeBatchTransaction,
  getTransactionHistory
};