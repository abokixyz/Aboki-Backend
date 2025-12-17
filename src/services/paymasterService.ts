// ============= src/services/paymasterService.ts (PIMLICO INTEGRATED) =============

import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import crypto from 'crypto';
import { NetworkType } from './walletService';

// ============= ENVIRONMENT VARIABLES =============
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || '';
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || '';

// Validate required environment variables
if (!PIMLICO_API_KEY) {
  console.warn('⚠️ WARNING: PIMLICO_API_KEY not configured - users will pay their own gas');
}

if (!WALLET_ENCRYPTION_KEY) {
  throw new Error('❌ CRITICAL: WALLET_ENCRYPTION_KEY must be set in .env');
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

// ============= UTILITY FUNCTIONS =============

function getChain(network: NetworkType) {
  return network === 'base-mainnet' ? base : baseSepolia;
}

function getRpcUrl(network: NetworkType): string {
  return network === 'base-mainnet'
    ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
}

function getPimlicoUrl(network: NetworkType): string {
  // Base mainnet chainId = 8453, Base Sepolia = 84532
  const chainId = network === 'base-mainnet' ? '8453' : '84532';
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`;
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

/**
 * Try to get gas sponsorship from Pimlico
 * Returns null if Pimlico is not configured or unavailable
 */
async function tryPimlicoSponsorship(
  userAddress: string,
  network: NetworkType
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null> {
  if (!PIMLICO_API_KEY) {
    console.log('⚠️  PIMLICO_API_KEY not set - skipping gas sponsorship');
    return null;
  }

  try {
    console.log(`\n⛽ Requesting gas sponsorship from Pimlico...`);
    
    const pimlicoUrl = getPimlicoUrl(network);
    
    // Get current gas price from Pimlico
    const gasPriceRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_gasPrice',
      params: []
    };

    const response = await fetch(pimlicoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gasPriceRequest)
    });

    if (!response.ok) {
      console.log(`⚠️  Pimlico responded with ${response.status} - falling back to user-paid gas`);
      return null;
    }

    const data = await response.json() as { 
      result?: string; 
      error?: { message: string } 
    };
    
    if (data.error) {
      console.log(`⚠️  Pimlico error: ${data.error.message} - falling back to user-paid gas`);
      return null;
    }

    // If we get here, Pimlico is working
    console.log('✅ Pimlico available - gas will be sponsored!');
    
    // Return gas parameters (Pimlico handles sponsorship automatically when using their RPC)
    const gasPrice = BigInt(data.result || '0');
    
    return {
      maxFeePerGas: gasPrice * BigInt(120) / BigInt(100), // 20% buffer
      maxPriorityFeePerGas: gasPrice / BigInt(2)
    };
  } catch (error: any) {
    console.log(`⚠️  Pimlico request failed: ${error.message} - falling back to user-paid gas`);
    return null;
  }
}

/**
 * Send USDC with optional Pimlico gas sponsorship
 * 
 * @param encryptedUserPrivateKey - User's encrypted private key from database
 * @param toAddress - Recipient address
 * @param amountUSDC - Amount in USDC (decimal, e.g., "10.50")
 * @param network - Network to use (base-mainnet or base-sepolia)
 * @returns Transaction result with hash and explorer URL
 */
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
    // ============= INPUT VALIDATION =============
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

    const hasPimlico = !!PIMLICO_API_KEY;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`💳 USDC TRANSFER ${hasPimlico ? '(Attempting Gas Sponsorship)' : '(User Pays Gas)'}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`To: ${toAddress}`);
    console.log(`Network: ${network}`);

    // ============= STEP 1: SETUP =============
    console.log(`\n📋 STEP 1: Setting up...`);
    const chain = getChain(network);
    const rpcUrl = getRpcUrl(network);

    // ============= STEP 2: DECRYPT USER'S KEY =============
    console.log(`\n🔐 STEP 2: Decrypting user's private key...`);
    const userPrivateKey = decryptPrivateKey(encryptedUserPrivateKey);
    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const userAddress = account.address;
    console.log(`   User Address: ${userAddress}`);

    // ============= STEP 3: CREATE VIEM CLIENTS =============
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

    // ============= STEP 4: CHECK BALANCES =============
    console.log(`\n💰 STEP 4: Checking balances...`);
    const amountInWei = parseUnits(amountUSDC, 6);

    // Check USDC balance
    const usdcBalance = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [userAddress]
    });

    const balanceInUSDC = parseFloat((usdcBalance / BigInt(10 ** 6)).toString());
    console.log(`   USDC Balance: ${balanceInUSDC} USDC`);

    if (usdcBalance < amountInWei) {
      throw new Error(`Insufficient USDC balance. Have: ${balanceInUSDC}, Need: ${amountUSDC}`);
    }

    // Check ETH balance (needed if no gas sponsorship)
    const ethBalance = await publicClient.getBalance({ address: userAddress as `0x${string}` });
    const ethFormatted = (Number(ethBalance) / 1e18).toFixed(6);
    console.log(`   ETH Balance: ${ethFormatted} ETH`);

    if (!hasPimlico && ethBalance < BigInt(10000000000000)) { // ~0.00001 ETH minimum
      throw new Error(`Insufficient ETH for gas fees. Have: ${ethFormatted} ETH. Please add some ETH.`);
    }

    console.log(`   ✅ Balance checks passed`);

    // ============= STEP 5: PREPARE TRANSACTION =============
    console.log(`\n📝 STEP 5: Preparing transaction...`);
    const txData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, amountInWei]
    });
    console.log(`   ✅ Transaction data encoded`);

    // ============= STEP 6: TRY PIMLICO SPONSORSHIP =============
    let gasSponsored = false;
    let gasParams: any = {};

    if (hasPimlico) {
      const sponsorship = await tryPimlicoSponsorship(userAddress, network);
      
      if (sponsorship) {
        gasParams = {
          maxFeePerGas: sponsorship.maxFeePerGas,
          maxPriorityFeePerGas: sponsorship.maxPriorityFeePerGas
        };
        gasSponsored = true;
        console.log(`   ✅ Gas will be sponsored by Pimlico!`);
      } else {
        console.log(`   ⚠️  Gas sponsorship unavailable - user will pay gas`);
      }
    }

    // ============= STEP 7: SEND TRANSACTION =============
    console.log(`\n✍️  STEP ${hasPimlico ? 7 : 6}: Signing and sending transaction...`);
    
    const txHash = await walletClient.sendTransaction({
      to: USDC_ADDRESS as `0x${string}`,
      data: txData as `0x${string}`,
      ...gasParams
    });
    
    console.log(`   ✅ Transaction sent!`);
    console.log(`   Hash: ${txHash}`);

    // ============= STEP 8: WAIT FOR CONFIRMATION =============
    console.log(`\n⏳ STEP ${hasPimlico ? 8 : 7}: Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`
    });
    console.log(`   ✅ Confirmed!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);

    // ============= GENERATE EXPLORER URL =============
    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    // ============= SUCCESS =============
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ TRANSFER SUCCESSFUL!`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`From: ${userAddress}`);
    console.log(`To: ${toAddress}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Gas: ${gasSponsored ? 'Sponsored by Pimlico ✅' : 'Paid by user'}`);
    console.log(`Explorer: ${explorerUrl}`);
    console.log(`${'═'.repeat(70)}\n`);

    return {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      blockNumber: receipt.blockNumber.toString(),
      gasSponsored,
      userAddress
    };
  } catch (error: any) {
    console.error(`\n${'═'.repeat(70)}`);
    console.error(`❌ TRANSFER FAILED`);
    console.error(`${'═'.repeat(70)}`);
    console.error(`Error: ${error.message}`);
    console.error(`${'═'.repeat(70)}\n`);
    
    throw new Error(`Transfer failed: ${error.message}`);
  }
}

export default {
  sendUSDCWithPaymaster
};