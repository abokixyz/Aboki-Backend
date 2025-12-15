// ============= src/services/adminWalletService.ts (NEW) =============
import { createWalletClient, http, parseUnits, formatUnits, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { NetworkType } from './walletService';

// Admin wallet configuration
const ADMIN_WALLET_ADDRESS = process.env.ADMIN_WALLET_ADDRESS || '';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_WALLET_PRIVATE_KEY || '';

// Smart contract configuration
const ABOKI_CONTRACT_ADDRESS = process.env.ABOKI_CONTRACT_ADDRESS || '';
const CONTRACT_NETWORK = (process.env.ABOKI_CONTRACT_NETWORK || 'base-mainnet') as NetworkType;

// USDC Contract Addresses
const USDC_ADDRESS_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ADDRESS_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// ERC20 ABI (Fixed allowance function)
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
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }
] as const;

// Aboki Contract ABI (only what we need)
const ABOKI_ABI = [
  {
    inputs: [
      { name: "_token", type: "address" },
      { name: "_amount", type: "uint256" },
      { name: "_rate", type: "uint256" },
      { name: "_refundAddress", type: "address" },
      { name: "_liquidityProvider", type: "address" }
    ],
    name: "createOrder",
    outputs: [{ name: "orderId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_orderId", type: "uint256" }
    ],
    name: "getOrderInfo",
    outputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "rate", type: "uint256" },
      { name: "creator", type: "address" },
      { name: "refundAddress", type: "address" },
      { name: "liquidityProvider", type: "address" },
      { name: "isFulfilled", type: "bool" },
      { name: "isRefunded", type: "bool" },
      { name: "timestamp", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function",
  }
] as const;

/**
 * Get chain configuration based on network
 */
const getChainConfig = (network: NetworkType) => {
  const chain = network === 'base-mainnet' ? base : baseSepolia;
  const usdcAddress = network === 'base-mainnet' ? USDC_ADDRESS_MAINNET : USDC_ADDRESS_SEPOLIA;
  return { chain, usdcAddress };
};

/**
 * Initialize admin wallet client
 */
const getAdminWalletClient = (network: NetworkType) => {
  if (!ADMIN_PRIVATE_KEY || !ADMIN_WALLET_ADDRESS) {
    throw new Error('Admin wallet not configured. Please set ADMIN_WALLET_ADDRESS and ADMIN_WALLET_PRIVATE_KEY');
  }

  const { chain } = getChainConfig(network);
  const account = privateKeyToAccount(`0x${ADMIN_PRIVATE_KEY.replace('0x', '')}` as `0x${string}`);

  return createWalletClient({
    account,
    chain,
    transport: http(),
  });
};

/**
 * Get public client for reading blockchain data
 */
const getPublicClient = (network: NetworkType) => {
  const { chain } = getChainConfig(network);
  return createPublicClient({
    chain,
    transport: http(),
  });
};

/**
 * Check admin wallet USDC balance
 */
export const getAdminUSDCBalance = async (network: NetworkType = 'base-mainnet') => {
  try {
    const { usdcAddress } = getChainConfig(network);
    const publicClient = getPublicClient(network);

    const balance = await publicClient.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ADMIN_WALLET_ADDRESS as `0x${string}`],
    });

    const balanceInUsdc = Number(balance) / 1e6;

    console.log(`💰 Admin USDC Balance: ${balanceInUsdc.toFixed(2)} USDC`);

    return {
      balance: balanceInUsdc,
      balanceInWei: balance.toString(),
      address: ADMIN_WALLET_ADDRESS,
      network
    };
  } catch (error: any) {
    console.error('❌ Error checking admin balance:', error.message);
    throw new Error(`Failed to check admin balance: ${error.message}`);
  }
};

/**
 * Approve USDC spending by the Aboki contract
 */
const approveUSDCSpending = async (
  amount: bigint,
  network: NetworkType = 'base-mainnet'
) => {
  try {
    if (!ABOKI_CONTRACT_ADDRESS) {
      throw new Error('Aboki contract address not configured');
    }

    const { usdcAddress } = getChainConfig(network);
    const walletClient = getAdminWalletClient(network);
    const publicClient = getPublicClient(network);

    // Check current allowance (now with correct args: owner, spender)
    const currentAllowance = await publicClient.readContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [
        ADMIN_WALLET_ADDRESS as `0x${string}`,
        ABOKI_CONTRACT_ADDRESS as `0x${string}`
      ],
    });

    console.log(`📊 Current allowance: ${Number(currentAllowance) / 1e6} USDC`);

    // If allowance is sufficient, no need to approve again
    if (currentAllowance >= amount) {
      console.log('✅ Sufficient allowance already exists');
      return { success: true, txHash: null };
    }

    console.log(`🔐 Approving ${Number(amount) / 1e6} USDC for Aboki contract...`);

    // Approve spending
    const hash = await walletClient.writeContract({
      address: usdcAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ABOKI_CONTRACT_ADDRESS as `0x${string}`, amount],
    });

    console.log(`📝 Approval TX Hash: ${hash}`);
    console.log('   Waiting for confirmation...');

    // Wait for transaction confirmation
    await publicClient.waitForTransactionReceipt({ hash });

    console.log('✅ Approval confirmed');

    return { success: true, txHash: hash };
  } catch (error: any) {
    console.error('❌ Approval failed:', error.message);
    throw new Error(`Failed to approve USDC: ${error.message}`);
  }
};

/**
 * Create order through Aboki contract
 * This transfers USDC from admin wallet → contract → user wallet
 */
export const createAbokiOrder = async (
  usdcAmount: number,
  rate: number,
  userWalletAddress: string,
  network: NetworkType = 'base-mainnet'
) => {
  try {
    if (!ABOKI_CONTRACT_ADDRESS) {
      throw new Error('Aboki contract address not configured. Please set ABOKI_CONTRACT_ADDRESS in .env');
    }

    const { usdcAddress } = getChainConfig(network);
    const walletClient = getAdminWalletClient(network);
    const publicClient = getPublicClient(network);

    // Convert USDC amount to wei (6 decimals)
    const amountInWei = parseUnits(usdcAmount.toFixed(6), 6);

    console.log(`📦 Creating Aboki order...`);
    console.log(`   USDC Amount: ${usdcAmount.toFixed(6)} USDC`);
    console.log(`   Rate: ₦${rate}`);
    console.log(`   User Wallet: ${userWalletAddress}`);
    console.log(`   Admin Wallet: ${ADMIN_WALLET_ADDRESS}`);
    console.log(`   Contract: ${ABOKI_CONTRACT_ADDRESS}`);

    // Step 1: Check admin balance
    const balance = await getAdminUSDCBalance(network);
    if (balance.balance < usdcAmount) {
      throw new Error(`Insufficient admin balance. Need ${usdcAmount} USDC, have ${balance.balance} USDC`);
    }

    // Step 2: Approve USDC spending
    await approveUSDCSpending(amountInWei, network);

    // Step 3: Create order through contract
    console.log(`🎫 Creating order on contract...`);
    
    const hash = await walletClient.writeContract({
      address: ABOKI_CONTRACT_ADDRESS as `0x${string}`,
      abi: ABOKI_ABI,
      functionName: 'createOrder',
      args: [
        usdcAddress as `0x${string}`,           // _token (USDC address)
        amountInWei,                             // _amount
        BigInt(Math.floor(rate * 100)),          // _rate (multiplied by 100 for precision)
        ADMIN_WALLET_ADDRESS as `0x${string}`,   // _refundAddress (admin wallet)
        userWalletAddress as `0x${string}`       // _liquidityProvider (user receives USDC)
      ],
    });

    console.log(`📝 Order TX Hash: ${hash}`);
    console.log('   Waiting for confirmation...');

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('✅ Order created successfully!');
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);

    // Extract orderId from logs (if needed)
    let orderId = null;
    if (receipt.logs && receipt.logs.length > 0) {
      // The OrderCreated event should contain the orderId
      console.log(`   Transaction logs: ${receipt.logs.length} events emitted`);
    }

    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${hash}`
      : `https://sepolia.basescan.org/tx/${hash}`;

    return {
      success: true,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      orderId,
      explorerUrl,
      details: {
        usdcAmount,
        rate,
        userWallet: userWalletAddress,
        adminWallet: ADMIN_WALLET_ADDRESS,
        contract: ABOKI_CONTRACT_ADDRESS
      }
    };
  } catch (error: any) {
    console.error('❌ Failed to create Aboki order:', error.message);
    throw new Error(`Failed to create order: ${error.message}`);
  }
};

/**
 * Verify configuration
 */
export const verifyAdminWalletConfig = () => {
  const issues = [];

  if (!ADMIN_WALLET_ADDRESS) {
    issues.push('ADMIN_WALLET_ADDRESS not set');
  }

  if (!ADMIN_PRIVATE_KEY) {
    issues.push('ADMIN_WALLET_PRIVATE_KEY not set');
  }

  if (!ABOKI_CONTRACT_ADDRESS) {
    issues.push('ABOKI_CONTRACT_ADDRESS not set');
  }

  if (issues.length > 0) {
    console.error('❌ Admin wallet configuration issues:');
    issues.forEach(issue => console.error(`   - ${issue}`));
    return false;
  }

  console.log('✅ Admin wallet configuration verified');
  console.log(`   Address: ${ADMIN_WALLET_ADDRESS}`);
  console.log(`   Contract: ${ABOKI_CONTRACT_ADDRESS}`);
  console.log(`   Network: ${CONTRACT_NETWORK}`);
  
  return true;
};

export default {
  getAdminUSDCBalance,
  createAbokiOrder,
  verifyAdminWalletConfig
};