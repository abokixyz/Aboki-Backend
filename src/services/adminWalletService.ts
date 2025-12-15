// ============= src/services/adminWalletService.ts (WITH GAS CHECKS) =============
import { createWalletClient, http, parseUnits, formatUnits, createPublicClient, formatEther } from 'viem';
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

// Gas configuration
const MIN_ETH_BALANCE = 0.001; // Minimum 0.001 ETH required for gas
const GAS_BUFFER_MULTIPLIER = 1.5; // 50% buffer for gas price fluctuations

// ERC20 ABI
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

// Aboki Contract ABI
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
 * Check admin wallet ETH balance (for gas fees)
 */
export const getAdminETHBalance = async (network: NetworkType = 'base-mainnet') => {
  try {
    const publicClient = getPublicClient(network);

    const balance = await publicClient.getBalance({
      address: ADMIN_WALLET_ADDRESS as `0x${string}`
    });

    const balanceInEth = Number(formatEther(balance));

    console.log(`⛽ Admin ETH Balance: ${balanceInEth.toFixed(6)} ETH`);

    return {
      balance: balanceInEth,
      balanceInWei: balance.toString(),
      address: ADMIN_WALLET_ADDRESS,
      network,
      sufficient: balanceInEth >= MIN_ETH_BALANCE
    };
  } catch (error: any) {
    console.error('❌ Error checking admin ETH balance:', error.message);
    throw new Error(`Failed to check admin ETH balance: ${error.message}`);
  }
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
 * Estimate gas for creating an order
 */
const estimateOrderGas = async (
  usdcAmount: number,
  rate: number,
  userWalletAddress: string,
  network: NetworkType = 'base-mainnet'
) => {
  try {
    const { usdcAddress } = getChainConfig(network);
    const walletClient = getAdminWalletClient(network);
    const publicClient = getPublicClient(network);

    const amountInWei = parseUnits(usdcAmount.toFixed(6), 6);

    // Estimate gas for the createOrder transaction
    const gasEstimate = await publicClient.estimateContractGas({
      address: ABOKI_CONTRACT_ADDRESS as `0x${string}`,
      abi: ABOKI_ABI,
      functionName: 'createOrder',
      args: [
        usdcAddress as `0x${string}`,
        amountInWei,
        BigInt(Math.floor(rate * 100)),
        ADMIN_WALLET_ADDRESS as `0x${string}`,
        userWalletAddress as `0x${string}`
      ],
      account: walletClient.account
    });

    // Get current gas price
    const gasPrice = await publicClient.getGasPrice();

    // Calculate total gas cost in ETH
    const gasCost = gasEstimate * gasPrice;
    const gasCostInEth = Number(formatEther(gasCost));

    // Add buffer for gas price fluctuations
    const gasCostWithBuffer = gasCostInEth * GAS_BUFFER_MULTIPLIER;

    console.log(`⛽ Gas Estimate:`);
    console.log(`   Gas Units: ${gasEstimate.toString()}`);
    console.log(`   Gas Price: ${formatEther(gasPrice)} ETH/gas`);
    console.log(`   Estimated Cost: ${gasCostInEth.toFixed(6)} ETH`);
    console.log(`   With Buffer (${GAS_BUFFER_MULTIPLIER}x): ${gasCostWithBuffer.toFixed(6)} ETH`);

    return {
      gasEstimate: gasEstimate.toString(),
      gasPrice: gasPrice.toString(),
      gasCostInEth,
      gasCostWithBuffer,
      sufficient: false // Will be set by caller
    };
  } catch (error: any) {
    console.error('❌ Gas estimation failed:', error.message);
    throw new Error(`Failed to estimate gas: ${error.message}`);
  }
};

/**
 * Comprehensive pre-flight checks before processing order
 */
export const performPreflightChecks = async (
  usdcAmount: number,
  rate: number,
  userWalletAddress: string,
  network: NetworkType = 'base-mainnet'
) => {
  console.log(`🔍 Performing pre-flight checks...`);

  // Check 1: USDC Balance
  const usdcBalance = await getAdminUSDCBalance(network);
  const hasEnoughUSDC = usdcBalance.balance >= usdcAmount;

  if (!hasEnoughUSDC) {
    console.error(`❌ Insufficient USDC: Need ${usdcAmount}, have ${usdcBalance.balance}`);
  }

  // Check 2: ETH Balance (for gas)
  const ethBalance = await getAdminETHBalance(network);
  const hasEnoughETH = ethBalance.sufficient;

  if (!hasEnoughETH) {
    console.error(`❌ Insufficient ETH for gas: Have ${ethBalance.balance.toFixed(6)} ETH, need at least ${MIN_ETH_BALANCE} ETH`);
  }

  // Check 3: Estimate gas and verify sufficient ETH
  let gasEstimate;
  let hasEnoughGas = false;

  try {
    gasEstimate = await estimateOrderGas(usdcAmount, rate, userWalletAddress, network);
    hasEnoughGas = ethBalance.balance >= gasEstimate.gasCostWithBuffer;
    gasEstimate.sufficient = hasEnoughGas;

    if (!hasEnoughGas) {
      console.error(`❌ Insufficient ETH for estimated gas:`);
      console.error(`   Need: ${gasEstimate.gasCostWithBuffer.toFixed(6)} ETH`);
      console.error(`   Have: ${ethBalance.balance.toFixed(6)} ETH`);
    }
  } catch (error: any) {
    console.warn(`⚠️ Could not estimate gas: ${error.message}`);
    // If gas estimation fails, still proceed if we have minimum ETH
    hasEnoughGas = hasEnoughETH;
  }

  const allChecksPassed = hasEnoughUSDC && hasEnoughETH && hasEnoughGas;

  console.log(`\n📋 Pre-flight Check Results:`);
  console.log(`   USDC Balance: ${hasEnoughUSDC ? '✅' : '❌'} (${usdcBalance.balance.toFixed(2)} USDC)`);
  console.log(`   ETH Balance: ${hasEnoughETH ? '✅' : '❌'} (${ethBalance.balance.toFixed(6)} ETH)`);
  console.log(`   Gas Estimate: ${hasEnoughGas ? '✅' : '❌'} (${gasEstimate?.gasCostWithBuffer.toFixed(6) || 'N/A'} ETH needed)`);
  console.log(`   Overall: ${allChecksPassed ? '✅ READY' : '❌ BLOCKED'}\n`);

  return {
    success: allChecksPassed,
    checks: {
      usdcBalance: {
        passed: hasEnoughUSDC,
        required: usdcAmount,
        available: usdcBalance.balance
      },
      ethBalance: {
        passed: hasEnoughETH,
        required: MIN_ETH_BALANCE,
        available: ethBalance.balance
      },
      gasEstimate: {
        passed: hasEnoughGas,
        estimated: gasEstimate?.gasCostWithBuffer || 0,
        available: ethBalance.balance
      }
    },
    gasEstimate
  };
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

    // Check current allowance
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
 * Create order through Aboki contract (WITH PRE-FLIGHT CHECKS)
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

    // CRITICAL: Perform comprehensive pre-flight checks
    const preflightResult = await performPreflightChecks(usdcAmount, rate, userWalletAddress, network);

    if (!preflightResult.success) {
      const errors = [];
      
      if (!preflightResult.checks.usdcBalance.passed) {
        errors.push(`Insufficient USDC: Need ${preflightResult.checks.usdcBalance.required} USDC, have ${preflightResult.checks.usdcBalance.available} USDC`);
      }
      
      if (!preflightResult.checks.ethBalance.passed) {
        errors.push(`Insufficient ETH for gas: Have ${preflightResult.checks.ethBalance.available.toFixed(6)} ETH, need at least ${MIN_ETH_BALANCE} ETH`);
      }
      
      if (!preflightResult.checks.gasEstimate.passed) {
        errors.push(`Insufficient ETH for estimated gas: Need ${preflightResult.checks.gasEstimate.estimated.toFixed(6)} ETH for gas`);
      }

      throw new Error(`Pre-flight checks failed: ${errors.join('; ')}`);
    }

    // Approve USDC spending
    await approveUSDCSpending(amountInWei, network);

    // Create order through contract
    console.log(`🎫 Creating order on contract...`);
    
    const hash = await walletClient.writeContract({
      address: ABOKI_CONTRACT_ADDRESS as `0x${string}`,
      abi: ABOKI_ABI,
      functionName: 'createOrder',
      args: [
        usdcAddress as `0x${string}`,
        amountInWei,
        BigInt(Math.floor(rate * 100)),
        ADMIN_WALLET_ADDRESS as `0x${string}`,
        userWalletAddress as `0x${string}`
      ],
    });

    console.log(`📝 Order TX Hash: ${hash}`);
    console.log('   Waiting for confirmation...');

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log('✅ Order created successfully!');
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Gas Cost: ${Number(formatEther(receipt.gasUsed * receipt.effectiveGasPrice)).toFixed(6)} ETH`);

    const explorerUrl = network === 'base-mainnet'
      ? `https://basescan.org/tx/${hash}`
      : `https://sepolia.basescan.org/tx/${hash}`;

    return {
      success: true,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
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
  getAdminETHBalance,
  performPreflightChecks,
  createAbokiOrder,
  verifyAdminWalletConfig
};