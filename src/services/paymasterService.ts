// ============= src/services/paymasterService.ts (ALCHEMY GAS MANAGER) =============

import { createPublicClient, createWalletClient, http, parseUnits, encodeFunctionData, type Address, type Hex } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import crypto from 'crypto';
import { NetworkType } from './walletService';

// ============= ENVIRONMENT VARIABLES =============
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_GAS_POLICY_ID = process.env.ALCHEMY_GAS_POLICY_ID || '';
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || '';

if (!ALCHEMY_API_KEY) {
  console.warn('⚠️ WARNING: ALCHEMY_API_KEY not configured - users will pay gas');
}

if (!ALCHEMY_GAS_POLICY_ID) {
  console.warn('⚠️ WARNING: ALCHEMY_GAS_POLICY_ID not configured - gas sponsorship disabled');
}

if (!WALLET_ENCRYPTION_KEY) {
  throw new Error('❌ WALLET_ENCRYPTION_KEY must be set in .env');
}

// ============= CONFIGURATION =============
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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

// ============= UTILITY FUNCTIONS =============

function getRpcUrl(network: NetworkType): string {
  if (ALCHEMY_API_KEY) {
    return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  }
  return network === 'base-mainnet'
    ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
}

function decryptPrivateKey(encryptedKey: string): string {
  if (!WALLET_ENCRYPTION_KEY) {
    throw new Error('WALLET_ENCRYPTION_KEY not set');
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
    throw new Error('Decryption failed');
  }
}

/**
 * Request gas sponsorship from Alchemy
 */
async function requestAlchemySponsorship(
  userAddress: Address,
  txData: Hex,
  network: NetworkType
): Promise<{
  sponsored: boolean;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}> {
  if (!ALCHEMY_API_KEY || !ALCHEMY_GAS_POLICY_ID) {
    console.log('⚠️  Alchemy not configured - skipping gas sponsorship');
    return { sponsored: false };
  }

  try {
    console.log(`\n⛽ Requesting gas sponsorship from Alchemy...`);
    console.log(`   Policy ID: ${ALCHEMY_GAS_POLICY_ID.substring(0, 8)}...`);

    const rpcUrl = getRpcUrl(network);

    // Request sponsorship from Alchemy
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ALCHEMY_API_KEY}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_requestGasAndPaymasterAndData',
        params: [{
          policyId: ALCHEMY_GAS_POLICY_ID,
          entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
          userOp: {
            sender: userAddress,
            callData: txData,
          }
        }]
      })
    });

    const data = await response.json() as {
      result?: {
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
        paymasterAndData?: string;
      };
      error?: { message: string };
    };

    if (data.error) {
      console.log(`⚠️  Alchemy sponsorship unavailable: ${data.error.message}`);
      return { sponsored: false };
    }

    if (data.result?.maxFeePerGas) {
      console.log(`✅ Gas sponsorship approved by Alchemy!`);
      return {
        sponsored: true,
        maxFeePerGas: BigInt(data.result.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(data.result.maxPriorityFeePerGas || 0)
      };
    }

    return { sponsored: false };

  } catch (error: any) {
    console.log(`⚠️  Alchemy request failed: ${error.message}`);
    return { sponsored: false };
  }
}

/**
 * Send USDC with optional Alchemy gas sponsorship
 * Falls back to user-paid gas if sponsorship unavailable
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
    // ============= VALIDATION =============
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

    const hasAlchemy = !!(ALCHEMY_API_KEY && ALCHEMY_GAS_POLICY_ID);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`💳 USDC TRANSFER ${hasAlchemy ? '(Alchemy Gas Sponsorship)' : '(User Pays Gas)'}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`To: ${toAddress}`);
    console.log(`Network: ${network}`);

    // ============= SETUP =============
    console.log(`\n📋 STEP 1: Setting up...`);
    const rpcUrl = getRpcUrl(network);

    // ============= DECRYPT KEY =============
    console.log(`\n🔐 STEP 2: Decrypting user's private key...`);
    const userPrivateKey = decryptPrivateKey(encryptedUserPrivateKey);
    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const userAddress = account.address;
    console.log(`   User Address: ${userAddress}`);

    // ============= CREATE CLIENTS =============
    console.log(`\n🔧 STEP 3: Creating blockchain clients...`);
    const publicClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(rpcUrl)
    });
    console.log(`   ✅ Clients ready`);

    // ============= CHECK BALANCE =============
    console.log(`\n💰 STEP 4: Checking USDC balance...`);
    const amountInWei = parseUnits(amountUSDC, 6);

    const balance = await publicClient.readContract({
      address: USDC_ADDRESS as Address,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [userAddress as Address]
    });

    const balanceInUSDC = parseFloat((balance / BigInt(10 ** 6)).toString());
    console.log(`   Balance: ${balanceInUSDC} USDC`);

    if (balance < amountInWei) {
      throw new Error(`Insufficient USDC. Have: ${balanceInUSDC}, Need: ${amountUSDC}`);
    }
    console.log(`   ✅ Balance check passed`);

    // Check ETH if no sponsorship
    if (!hasAlchemy) {
      const ethBalance = await publicClient.getBalance({ address: userAddress as Address });
      const ethFormatted = (Number(ethBalance) / 1e18).toFixed(6);
      console.log(`   ETH Balance: ${ethFormatted} ETH`);
      
      if (ethBalance < BigInt(10000000000000)) {
        throw new Error(`Insufficient ETH for gas. Have: ${ethFormatted} ETH`);
      }
    }

    // ============= PREPARE TRANSACTION =============
    console.log(`\n📝 STEP 5: Preparing transaction...`);
    const txData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [toAddress as Address, amountInWei]
    });
    console.log(`   ✅ Transaction data encoded`);

    // ============= TRY ALCHEMY SPONSORSHIP =============
    let gasSponsored = false;
    let gasParams: any = {};

    if (hasAlchemy) {
      console.log(`\n⛽ STEP 6: Requesting Alchemy gas sponsorship...`);
      const sponsorship = await requestAlchemySponsorship(
        userAddress as Address,
        txData,
        network
      );
      
      if (sponsorship.sponsored && sponsorship.maxFeePerGas) {
        gasParams = {
          maxFeePerGas: sponsorship.maxFeePerGas,
          maxPriorityFeePerGas: sponsorship.maxPriorityFeePerGas
        };
        gasSponsored = true;
        console.log(`   ✅ Gas will be sponsored by Alchemy!`);
      } else {
        console.log(`   ⚠️  Sponsorship unavailable - user will pay gas`);
      }
    }

    // ============= SEND TRANSACTION =============
    const stepNum = hasAlchemy ? 7 : 6;
    console.log(`\n✍️  STEP ${stepNum}: Sending transaction...`);
    
    const txHash = await walletClient.sendTransaction({
      to: USDC_ADDRESS as Address,
      data: txData as Hex,
      ...gasParams
    });
    
    console.log(`   ✅ Transaction sent!`);
    console.log(`   Hash: ${txHash}`);

    // ============= WAIT FOR CONFIRMATION =============
    console.log(`\n⏳ STEP ${stepNum + 1}: Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as Hex
    });
    console.log(`   ✅ Confirmed!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);

    // ============= GENERATE EXPLORER URL =============
    const explorerUrl = `https://basescan.org/tx/${txHash}`;

    // ============= SUCCESS =============
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ TRANSFER SUCCESSFUL!`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`From: ${userAddress}`);
    console.log(`To: ${toAddress}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Gas: ${gasSponsored ? 'Sponsored by Alchemy ✅' : 'Paid by user'}`);
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