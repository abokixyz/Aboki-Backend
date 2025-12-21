// ============= src/services/paymasterService.ts (UPDATED - ADD ABOKI INTEGRATION) =============
/**
 * Paymaster Service - Gasless Transactions via Smart Account
 * 
 * Main functions:
 * - sendUSDCWithPaymaster() - Send USDC with Coinbase sponsorship (gasless)
 * - executeAbokiCreateOrder() - Create Aboki order gaslessly (NEW)
 * 
 * Gas fees are sponsored by Coinbase Paymaster
 * Uses Safe 1.4.1 Smart Accounts
 */

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
const ABOKI_CONTRACT_ADDRESS = process.env.ABOKI_CONTRACT_ADDRESS || '';

if (!WALLET_ENCRYPTION_KEY) {
  throw new Error('❌ CRITICAL: WALLET_ENCRYPTION_KEY must be set in .env');
}

if (!COINBASE_PAYMASTER_URL) {
  throw new Error('❌ CRITICAL: COINBASE_PAYMASTER_URL must be set in .env');
}

if (!ABOKI_CONTRACT_ADDRESS) {
  throw new Error('❌ CRITICAL: ABOKI_CONTRACT_ADDRESS must be set in .env');
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
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
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

const ABOKI_ABI = [
  {
    name: 'createOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_rate', type: 'uint256' },
      { name: '_refundAddress', type: 'address' },
      { name: '_liquidityProvider', type: 'address' }
    ],
    outputs: [{ name: 'orderId', type: 'uint256' }]
  }
] as const;

// ============= UTILITY FUNCTIONS =============

/**
 * Get RPC URL based on network
 */
function getRpcUrl(network: NetworkType): string {
  return network === 'base-mainnet'
    ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
}

/**
 * Decrypt private key using AES-256-CBC
 */
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

// ============= MAIN FUNCTIONS =============

/**
 * @function sendUSDCWithPaymaster
 * @desc     Send USDC with Coinbase Paymaster (GASLESS)
 * 
 * Creates a Safe 1.4.1 Smart Account and sends USDC without paying gas.
 * Gas fees are sponsored by Coinbase Paymaster.
 * 
 * @param    encryptedUserPrivateKey - User's encrypted private key
 * @param    toAddress - Recipient address
 * @param    amountUSDC - Amount in USDC (string, e.g., "100")
 * @param    network - 'base-mainnet' or 'base-sepolia'
 * @returns  Object with transaction details and gasSponsored flag
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
      gasSponsored: true,
      userAddress: smartAccountAddress
    };
  } catch (error: any) {
    console.error(`\n${'═'.repeat(70)}`);
    console.error(`❌ GASLESS TRANSFER FAILED`);
    console.error(`${'═'.repeat(70)}`);
    console.error(`Error: ${error.message}`);
    
    if (error.message?.includes('insufficient funds')) {
      console.error(`\n💡 TIP: This might be a Smart Account deployment issue.`);
      console.error(`   - Make sure the Smart Account has been deployed`);
      console.error(`   - Or ensure Coinbase paymaster supports deployment + execution`);
    }
    
    console.error(`${'═'.repeat(70)}\n`);
    
    throw new Error(`Transfer failed: ${error.message}`);
  }
}

/**
 * @function executeAbokiCreateOrder
 * @desc     Create an order on Aboki contract via gasless Smart Account
 * 
 * User's Smart Account calls Aboki.createOrder() to send USDC to admin LP.
 * Gas fees are sponsored by Coinbase Paymaster.
 * 
 * @param    encryptedUserPrivateKey - User's encrypted private key
 * @param    smartAccountAddress - User's Smart Account address
 * @param    amountUSDC - Amount of USDC to send (string, e.g., "100")
 * @param    exchangeRate - Exchange rate (e.g., "411.25")
 * @param    liquidityProviderAddress - Admin wallet to receive USDC
 * @param    network - 'base-mainnet' or 'base-sepolia'
 * @returns  Object with transaction hash and details
 */
export async function executeAbokiCreateOrder(
  encryptedUserPrivateKey: string,
  smartAccountAddress: string,
  amountUSDC: string,
  exchangeRate: number,
  liquidityProviderAddress: string,
  network: NetworkType = 'base-mainnet'
): Promise<{
  success: boolean;
  transactionHash: string;
  explorerUrl: string;
  blockNumber: string;
  gasSponsored: boolean;
  orderId: string;
}> {
  try {
    // ============= VALIDATION =============

    if (!encryptedUserPrivateKey || encryptedUserPrivateKey.trim() === '') {
      throw new Error('Encrypted private key is required');
    }

    if (!smartAccountAddress || !smartAccountAddress.startsWith('0x')) {
      throw new Error('Invalid Smart Account address');
    }

    if (!liquidityProviderAddress || !liquidityProviderAddress.startsWith('0x')) {
      throw new Error('Invalid liquidity provider address');
    }

    const amountNum = parseFloat(amountUSDC);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount');
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🎯 ABOKI CREATE ORDER (Gasless via Paymaster)`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Rate: ${exchangeRate} NGN/USDC`);
    console.log(`Smart Account: ${smartAccountAddress.slice(0, 10)}...`);
    console.log(`LP: ${liquidityProviderAddress.slice(0, 10)}...`);
    console.log(`Network: ${network}`);

    // ============= SETUP =============

    console.log(`\n📋 STEP 1: Setting up...`);
    const rpcUrl = getRpcUrl(network);
    const chain = network === 'base-mainnet' ? base : baseSepolia;

    // ============= DECRYPT KEY =============

    console.log(`\n🔐 STEP 2: Decrypting private key...`);
    const userPrivateKey = decryptPrivateKey(encryptedUserPrivateKey);
    const signer = privateKeyToAccount(userPrivateKey as `0x${string}`);
    console.log(`   EOA: ${signer.address}`);

    // ============= CREATE CLIENTS =============

    console.log(`\n🔧 STEP 3: Creating clients...`);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const pimlicoClient = createPimlicoClient({
      transport: http(COINBASE_PAYMASTER_URL),
      entryPoint: {
        address: ENTRYPOINT_ADDRESS_V07,
        version: '0.7',
      },
    });
    console.log(`   ✅ Clients ready`);

    // ============= CREATE SMART ACCOUNT =============

    console.log(`\n🤖 STEP 4: Setting up Smart Account...`);
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

    console.log(`   ✅ Smart Account: ${safeAccount.address}`);

    // ============= CHECK USDC BALANCE =============

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

    // ============= STEP 6: APPROVE USDC TO ABOKI =============

    console.log(`\n✅ STEP 6: Approving USDC for Aboki...`);

    const smartAccountClient = createSmartAccountClient({
      account: safeAccount,
      chain,
      bundlerTransport: http(COINBASE_PAYMASTER_URL),
      paymaster: pimlicoClient,
    });

    const approveTxData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'approve',
      args: [ABOKI_CONTRACT_ADDRESS as Address, amountInWei]
    });

    const approveTxHash = await smartAccountClient.sendTransaction({
      to: USDC_ADDRESS as Address,
      data: approveTxData as Hex,
      value: BigInt(0),
    });

    console.log(`   ✅ Approval tx: ${approveTxHash.slice(0, 20)}...`);

    // Wait for approval confirmation
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash as Hex });
    console.log(`   ✅ Approval confirmed`);

    // ============= STEP 7: CALL ABOKI.CREATEORDER =============

    console.log(`\n🎯 STEP 7: Calling Aboki.createOrder()...`);

    const rateInWei = BigInt(Math.floor(exchangeRate * 10 ** 6)); // Store rate with 6 decimals

    const createOrderTxData = encodeFunctionData({
      abi: ABOKI_ABI,
      functionName: 'createOrder',
      args: [
        USDC_ADDRESS as Address,                    // _token
        amountInWei,                                 // _amount
        rateInWei,                                   // _rate
        smartAccountAddress as Address,              // _refundAddress
        liquidityProviderAddress as Address          // _liquidityProvider
      ]
    });

    console.log(`   📍 Calling contract: ${ABOKI_CONTRACT_ADDRESS.slice(0, 10)}...`);
    console.log(`   💳 Sending ${amountUSDC} USDC`);
    console.log(`   🔄 Gas: SPONSORED by Coinbase Paymaster`);

    const orderTxHash = await smartAccountClient.sendTransaction({
      to: ABOKI_CONTRACT_ADDRESS as Address,
      data: createOrderTxData as Hex,
      value: BigInt(0),
    });

    console.log(`   ✅ Order tx: ${orderTxHash.slice(0, 20)}...`);

    // ============= STEP 8: WAIT FOR CONFIRMATION =============

    console.log(`\n⏳ STEP 8: Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: orderTxHash as Hex
    });

    console.log(`   ✅ Confirmed!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed} (Sponsored)`);

    // ============= GENERATE EXPLORER URL =============

    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${orderTxHash}`
      : `https://sepolia.basescan.org/tx/${orderTxHash}`;

    // ============= SUCCESS =============

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`✅ ABOKI ORDER CREATED!`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`From: ${smartAccountAddress}`);
    console.log(`Amount: ${amountUSDC} USDC`);
    console.log(`Rate: ${exchangeRate} NGN/USDC`);
    console.log(`To LP: ${liquidityProviderAddress.slice(0, 10)}...`);
    console.log(`Gas: ✨ SPONSORED by Coinbase (FREE)`);
    console.log(`Explorer: ${explorerUrl}`);
    console.log(`${'═'.repeat(70)}\n`);

    return {
      success: true,
      transactionHash: orderTxHash,
      explorerUrl,
      blockNumber: receipt.blockNumber.toString(),
      gasSponsored: true,
      orderId: '0' // Order ID would need to be extracted from logs if needed
    };
  } catch (error: any) {
    console.error(`\n${'═'.repeat(70)}`);
    console.error(`❌ ABOKI ORDER FAILED`);
    console.error(`${'═'.repeat(70)}`);
    console.error(`Error: ${error.message}`);
    console.error(`${'═'.repeat(70)}\n`);
    
    throw new Error(`Aboki order creation failed: ${error.message}`);
  }
}

export default {
  sendUSDCWithPaymaster,
  executeAbokiCreateOrder
};