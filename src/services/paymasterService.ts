// ============= src/services/paymasterService.ts (UPDATED - GASLESS WITH COINBASE PAYMASTER) =============

import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseUnits, 
  encodeFunctionData, 
  type Address, 
  type Hex 
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createSmartAccountClient } from 'permissionless';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import crypto from 'crypto';
import { NetworkType } from './walletService';

// ============= ENVIRONMENT VARIABLES =============
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || '';
const COINBASE_PAYMASTER_URL = process.env.COINBASE_PAYMASTER_URL || '';

if (!WALLET_ENCRYPTION_KEY) {
  throw new Error('❌ CRITICAL: WALLET_ENCRYPTION_KEY must be set in .env');
}

if (!COINBASE_PAYMASTER_URL) {
  throw new Error('❌ CRITICAL: COINBASE_PAYMASTER_URL must be set in .env');
}

// ============= CONFIGURATION =============
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ENTRYPOINT_ADDRESS_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

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
 * Send USDC with Coinbase Paymaster (GASLESS)
 * Gas fees are sponsored by Coinbase
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

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`💳 GASLESS USDC TRANSFER (Coinbase Paymaster)`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`To: ${toAddress}`);
    console.log(`Network: ${network}`);

    // ============= SETUP =============
    console.log(`\n📋 STEP 1: Setting up...`);
    const rpcUrl = getRpcUrl(network);
    const chain = network === 'base-mainnet' ? base : baseSepolia;

    // ============= DECRYPT KEY =============
    console.log(`\n🔐 STEP 2: Decrypting user's private key...`);
    const userPrivateKey = decryptPrivateKey(encryptedUserPrivateKey);
    const signer = privateKeyToAccount(userPrivateKey as `0x${string}`);
    console.log(`   EOA Signer: ${signer.address}`);

    // ============= CREATE CLIENTS =============
    console.log(`\n🔧 STEP 3: Creating blockchain clients...`);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    // Create Pimlico/Paymaster client (Coinbase-compatible)
    const pimlicoClient = createPimlicoClient({
      transport: http(COINBASE_PAYMASTER_URL),
      entryPoint: {
        address: ENTRYPOINT_ADDRESS_V07,
        version: '0.7',
      },
    });
    console.log(`   ✅ Paymaster client configured`);

    // ============= CREATE SMART ACCOUNT =============
    console.log(`\n🤖 STEP 4: Setting up Smart Account (Safe)...`);
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

    const smartAccountAddress = safeAccount.address;
    console.log(`   Smart Account: ${smartAccountAddress}`);

    if (smartAccountAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Smart Account failed to initialize');
    }

    // ============= CHECK BALANCE =============
    console.log(`\n💰 STEP 5: Checking USDC balance...`);
    const amountInWei = parseUnits(amountUSDC, 6);

    const balance = await publicClient.readContract({
      address: USDC_ADDRESS as Address,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [smartAccountAddress as Address]
    });

    const balanceInUSDC = parseFloat((balance / BigInt(10 ** 6)).toString());
    console.log(`   Balance: ${balanceInUSDC} USDC`);

    if (balance < amountInWei) {
      throw new Error(`Insufficient USDC. Have: ${balanceInUSDC}, Need: ${amountUSDC}`);
    }
    console.log(`   ✅ Balance check passed`);

    // ============= CREATE SMART ACCOUNT CLIENT =============
    console.log(`\n🔗 STEP 6: Creating Smart Account Client...`);
    const smartAccountClient = createSmartAccountClient({
      account: safeAccount,
      chain,
      bundlerTransport: http(COINBASE_PAYMASTER_URL),
      paymaster: pimlicoClient,
    });
    console.log(`   ✅ Smart Account Client ready`);

    // ============= PREPARE TRANSACTION =============
    console.log(`\n📝 STEP 7: Preparing USDC transfer...`);
    const txData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [toAddress as Address, amountInWei]
    });
    console.log(`   ✅ Transaction data encoded`);

    // ============= SEND GASLESS TRANSACTION =============
    console.log(`\n✍️  STEP 8: Sending gasless transaction...`);
    console.log(`   🎉 Gas sponsored by Coinbase Paymaster!`);
    
    const txHash = await smartAccountClient.sendTransaction({
      to: USDC_ADDRESS as Address,
      data: txData as Hex,
      value: BigInt(0),
    });
    
    console.log(`   ✅ Transaction sent!`);
    console.log(`   Hash: ${txHash}`);

    // ============= WAIT FOR CONFIRMATION =============
    console.log(`\n⏳ STEP 9: Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as Hex
    });
    console.log(`   ✅ Confirmed!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed} (Sponsored)`);

    // ============= GENERATE EXPLORER URL =============
    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    // ============= SUCCESS =============
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ GASLESS TRANSFER SUCCESSFUL!`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`From: ${smartAccountAddress}`);
    console.log(`To: ${toAddress}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Gas: ✨ SPONSORED by Coinbase (FREE)`);
    console.log(`Explorer: ${explorerUrl}`);
    console.log(`${'═'.repeat(70)}\n`);

    return {
      success: true,
      transactionHash: txHash,
      explorerUrl,
      blockNumber: receipt.blockNumber.toString(),
      gasSponsored: true, // ✅ Gas is sponsored!
      userAddress: smartAccountAddress
    };
  } catch (error: any) {
    console.error(`\n${'═'.repeat(70)}`);
    console.error(`❌ GASLESS TRANSFER FAILED`);
    console.error(`${'═'.repeat(70)}`);
    console.error(`Error: ${error.message}`);
    
    // Check for common errors
    if (error.message?.includes('insufficient funds')) {
      console.error(`\n💡 TIP: This might be a Smart Account deployment issue.`);
      console.error(`   - Make sure the Smart Account has been deployed`);
      console.error(`   - Or ensure Coinbase paymaster supports deployment + execution`);
    }
    
    console.error(`${'═'.repeat(70)}\n`);
    
    throw new Error(`Transfer failed: ${error.message}`);
  }
}

export default {
  sendUSDCWithPaymaster
};