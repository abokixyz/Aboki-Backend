// ============= src/services/paymasterService.ts (FIXED) =============

import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import crypto from 'crypto';
import { NetworkType } from './walletService';

// ============= ENVIRONMENT VARIABLES =============
const PAYMASTER_URL = process.env.CDP_PAYMASTER_URL || 'https://api.developer.coinbase.com/rpc/v1/base/paymaster';
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID || '';           // ✅ Your CDP Key ID
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET || '';   // ✅ Your CDP Secret Key (FIXED!)
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || '';

// Validate required environment variables
if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
  console.warn('⚠️ WARNING: CDP_API_KEY_ID and CDP_API_KEY_SECRET not configured');
}

if (!WALLET_ENCRYPTION_KEY) {
  console.warn('⚠️ WARNING: WALLET_ENCRYPTION_KEY not configured');
}

// ============= USDC CONTRACT =============
const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
] as const;

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ============= TYPE DEFINITIONS =============
interface PaymasterResponse {
  jsonrpc: string;
  id: number;
  result?: {
    paymasterAndData?: string;
    preVerificationGas?: string;
    verificationGasLimit?: string;
    callGasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

// ============= UTILITY FUNCTIONS =============

function getChain(network: NetworkType) {
  return network === 'base-mainnet' ? base : baseSepolia;
}

function getRpcUrl(network: NetworkType): string {
  return network === 'base-mainnet'
    ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
}

function decryptPrivateKey(encryptedKey: string): string {
  if (!WALLET_ENCRYPTION_KEY) {
    throw new Error('WALLET_ENCRYPTION_KEY environment variable not set');
  }

  try {
    const encrypted = Buffer.from(encryptedKey, 'base64');
    const iv = encrypted.slice(0, 16);
    const encryptedData = encrypted.slice(16);
    
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(WALLET_ENCRYPTION_KEY, 'base64'),
      iv
    );
    
    let decrypted = decipher.update(encryptedData, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    console.log('✅ User private key decrypted successfully');
    return decrypted;
  } catch (error) {
    console.error('❌ Failed to decrypt private key:', error);
    throw new Error('Decryption failed - verify WALLET_ENCRYPTION_KEY is correct');
  }
}

function hexToBigInt(hex: string | undefined): bigint | undefined {
  if (!hex) return undefined;
  try {
    return BigInt(hex);
  } catch {
    console.warn(`⚠️ Failed to convert hex to bigint: ${hex}`);
    return undefined;
  }
}

async function getPaymasterSponsorship(
  userAddress: string,
  transactionData: `0x${string}`
): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
}> {
  // Validate CDP credentials
  if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
    throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET not configured in .env');
  }

  console.log(`\n🔧 Requesting gas sponsorship from CDP Paymaster...`);
  console.log(`   User Address: ${userAddress}`);

  try {
    const paymasterRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'pm_getPaymasterData',
      params: [
        {
          from: userAddress,
          to: USDC_ADDRESS,
          data: transactionData,
          value: '0x0'
        }
      ]
    };

    const response = await fetch(PAYMASTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CDP_API_KEY_SECRET}`,    // ✅ FIXED: Using CDP_API_KEY_SECRET
        'X-CDP-Key-ID': CDP_API_KEY_ID
      },
      body: JSON.stringify(paymasterRequest)
    });

    const paymasterData = (await response.json()) as PaymasterResponse;

    if (!response.ok || paymasterData.error || !paymasterData.result) {
      const errorMsg = paymasterData.error?.message || 'Unknown paymaster error';
      console.error(`❌ Paymaster error (${response.status}):`, errorMsg);
      throw new Error(`Paymaster failed: ${errorMsg}`);
    }

    const result = paymasterData.result;

    if (!result.maxFeePerGas || !result.maxPriorityFeePerGas || !result.callGasLimit) {
      throw new Error('Paymaster response missing required gas parameters');
    }

    console.log(`✅ Gas sponsorship approved by CDP!`);
    console.log(`   Max Fee Per Gas: ${result.maxFeePerGas}`);
    console.log(`   Max Priority Fee: ${result.maxPriorityFeePerGas}`);
    console.log(`   Call Gas Limit: ${result.callGasLimit}`);

    return {
      maxFeePerGas: hexToBigInt(result.maxFeePerGas)!,
      maxPriorityFeePerGas: hexToBigInt(result.maxPriorityFeePerGas)!,
      callGasLimit: hexToBigInt(result.callGasLimit)!,
      verificationGasLimit: hexToBigInt(result.verificationGasLimit) || BigInt(100000),
      preVerificationGas: hexToBigInt(result.preVerificationGas) || BigInt(21000)
    };
  } catch (error: any) {
    console.error(`❌ Paymaster request failed:`, error.message);
    throw error;
  }
}

export async function sendUSDCWithPaymaster(
  encryptedUserPrivateKey: string,
  toAddress: string,
  amountUSDC: string,
  network: NetworkType = 'base-mainnet'
): Promise<{
  success: boolean;
  transactionHash: string;
  explorerUrl: string;
  blockNumber: string;
  gasSponsored: boolean;
  userAddress: string;
}> {
  try {
    // Input validation
    if (!encryptedUserPrivateKey || encryptedUserPrivateKey.trim() === '') {
      throw new Error('Encrypted private key is required');
    }

    if (!toAddress || !toAddress.startsWith('0x')) {
      throw new Error('Invalid recipient address');
    }

    const amountNum = parseFloat(amountUSDC);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount');
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`💳 SPONSORED USDC TRANSFER`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`To: ${toAddress}`);
    console.log(`Network: ${network}`);

    // Setup
    console.log(`\n📋 STEP 1: Setting up...`);
    const chain = getChain(network);
    const rpcUrl = getRpcUrl(network);

    // Decrypt user's key
    console.log(`\n🔐 STEP 2: Decrypting user's private key...`);
    const userPrivateKey = decryptPrivateKey(encryptedUserPrivateKey);
    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const userAddress = account.address;
    console.log(`   User Address: ${userAddress}`);

    // Create viem clients
    console.log(`\n🔧 STEP 3: Creating viem clients...`);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });
    console.log(`   ✅ Clients ready`);

    // Check balance
    console.log(`\n💰 STEP 4: Checking USDC balance...`);
    const amountInWei = parseUnits(amountUSDC, 6);

    const balance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [userAddress]
    });

    const balanceInUSDC = parseFloat((balance / BigInt(10 ** 6)).toString());
    console.log(`   Balance: ${balanceInUSDC} USDC`);

    if (balance < amountInWei) {
      throw new Error(
        `Insufficient USDC balance. Have: ${balanceInUSDC}, Need: ${amountUSDC}`
      );
    }
    console.log(`   ✅ Balance check passed`);

    // Prepare transaction
    console.log(`\n📝 STEP 5: Preparing transaction...`);
    const txData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, amountInWei]
    });
    console.log(`   ✅ Transaction data encoded`);

    // Request gas sponsorship
    console.log(`\n⛽ STEP 6: Requesting gas sponsorship from CDP...`);
    console.log(`   Using CDP credentials:`);
    console.log(`   - API Key ID: ${CDP_API_KEY_ID.substring(0, 20)}...`);
    console.log(`   - API Key Secret: ${CDP_API_KEY_SECRET.substring(0, 20)}...`);

    const gasParams = await getPaymasterSponsorship(userAddress, txData);

    // Sign & send transaction
    console.log(`\n✍️  STEP 7: Signing transaction with user's key...`);
    const txHash = await walletClient.sendTransaction({
      to: USDC_ADDRESS as `0x${string}`,
      data: txData as `0x${string}`,
      gas: gasParams.callGasLimit,
      maxFeePerGas: gasParams.maxFeePerGas,
      maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas
    });
    console.log(`   ✅ Transaction sent!`);
    console.log(`   Hash: ${txHash}`);

    // Wait for confirmation
    console.log(`\n⏳ STEP 8: Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`
    });
    console.log(`   ✅ Confirmed!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);

    // Generate explorer URL
    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    // Success
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ TRANSFER SUCCESSFUL!`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`From: ${userAddress}`);
    console.log(`To: ${toAddress}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Gas: Sponsored by CDP ✅`);
    console.log(`Explorer: ${explorerUrl}`);
    console.log(`${'═'.repeat(60)}\n`);

    return {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      blockNumber: receipt.blockNumber.toString(),
      gasSponsored: true,
      userAddress
    };
  } catch (error: any) {
    console.error(`\n${'═'.repeat(60)}`);
    console.error(`❌ TRANSFER FAILED`);
    console.error(`${'═'.repeat(60)}`);
    console.error(`Error: ${error.message}`);
    console.error(`${'═'.repeat(60)}\n`);
    
    throw new Error(`Sponsored transfer failed: ${error.message}`);
  }
}

export default {
  sendUSDCWithPaymaster
};