"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransactionHistory = exports.executeBatchTransaction = exports.sendToken = exports.sendTransaction = exports.getUSDCBalance = exports.getWalletBalance = exports.createServerWallet = void 0;
// ============= src/services/walletService.ts =============
const cdp_sdk_1 = require("@coinbase/cdp-sdk");
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Encryption utilities for wallet data
 */
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || crypto_1.default.randomBytes(32).toString('hex');
const encrypt = (text) => {
    const key = crypto_1.default.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
};
const decrypt = (encryptedText) => {
    const key = crypto_1.default.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};
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
];
/**
 * Initialize CDP Client (no credentials needed)
 */
const initializeCDP = () => {
    try {
        const cdp = new cdp_sdk_1.CdpClient();
        console.log('✅ CDP Client initialized successfully');
        return cdp;
    }
    catch (error) {
        console.error('❌ Error initializing CDP Client:', error.message);
        return null;
    }
};
/**
 * Create server-managed smart wallet using CDP SDK
 * Following the pattern from working examples
 */
const createServerWallet = async () => {
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
            network: 'base-mainnet',
            walletId: smartAccount.address,
            encryptedSeed: null,
            encryptedWalletData,
            isReal: true
        };
    }
    catch (error) {
        console.error('❌ Error creating CDP wallet:', error.message);
        console.error('   Full error:', error);
        console.log('📝 Falling back to mock wallet');
        return createMockWallet();
    }
};
exports.createServerWallet = createServerWallet;
/**
 * Mock wallet fallback
 */
const createMockWallet = () => {
    const address = `0x${crypto_1.default.randomBytes(20).toString('hex')}`;
    return {
        ownerAddress: address,
        smartAccountAddress: address,
        network: 'base',
        walletId: null,
        encryptedSeed: null,
        encryptedWalletData: null,
        isReal: false
    };
};
/**
 * Get ETH balance using viem
 */
const getWalletBalance = async (smartAccountAddress, network = 'base-mainnet') => {
    if (!smartAccountAddress) {
        return {
            balance: '0.000000',
            balanceInWei: '0',
            currency: 'ETH',
            isReal: false
        };
    }
    try {
        const chain = network === 'base-mainnet' ? chains_1.base : chains_1.baseSepolia;
        const publicClient = (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)(),
        });
        const balance = await publicClient.getBalance({
            address: smartAccountAddress,
        });
        const balanceInEth = (Number(balance) / 1e18).toFixed(6);
        console.log(`📊 ETH Balance for ${smartAccountAddress}: ${balanceInEth} ETH`);
        return {
            balance: balanceInEth,
            balanceInWei: balance.toString(),
            currency: 'ETH',
            isReal: true
        };
    }
    catch (error) {
        console.error('❌ Error fetching ETH balance:', error.message);
        return {
            balance: '0.000000',
            balanceInWei: '0',
            currency: 'ETH',
            isReal: false
        };
    }
};
exports.getWalletBalance = getWalletBalance;
/**
 * Get USDC balance using viem
 */
const getUSDCBalance = async (address, network = 'base-mainnet') => {
    if (!address) {
        return {
            balance: '0.00',
            balanceInWei: '0',
            currency: 'USDC',
            isReal: false
        };
    }
    try {
        const chain = network === 'base-mainnet' ? chains_1.base : chains_1.baseSepolia;
        const usdcAddress = network === 'base-mainnet' ? USDC_ADDRESS_MAINNET : USDC_ADDRESS_SEPOLIA;
        const publicClient = (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)(),
        });
        const balance = await publicClient.readContract({
            address: usdcAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
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
    }
    catch (error) {
        console.error('❌ Error fetching USDC balance:', error.message);
        return {
            balance: '0.00',
            balanceInWei: '0',
            currency: 'USDC',
            isReal: false
        };
    }
};
exports.getUSDCBalance = getUSDCBalance;
/**
 * Send ETH transaction using CDP smart account
 */
const sendTransaction = async (userId, encryptedWalletData, toAddress, amount, network = 'base-mainnet') => {
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
            network: network,
            calls: [
                {
                    to: toAddress,
                    value: (0, viem_1.parseEther)(amount),
                    data: '0x',
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
        }
        else if (network === 'base-sepolia') {
            explorerUrl = `https://sepolia.basescan.org/tx/${userOperation.transactionHash}`;
        }
        else if (network === 'ethereum-sepolia') {
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
    }
    catch (error) {
        console.error('❌ Transaction failed:', error.message);
        throw new Error(`Transaction failed: ${error.message}`);
    }
};
exports.sendTransaction = sendTransaction;
/**
 * Send ERC20 token transfer
 */
const sendToken = async (userId, encryptedWalletData, tokenAddress, toAddress, amount, decimals = 6, network = 'base-mainnet') => {
    const cdp = initializeCDP();
    if (!cdp || !encryptedWalletData) {
        throw new Error('CDP not configured or wallet data not found');
    }
    try {
        console.log(`💸 Sending ${amount} tokens to ${toAddress}`);
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
        ];
        const transferData = (0, viem_1.encodeFunctionData)({
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [toAddress, BigInt(amount)],
        });
        const result = await cdp.evm.sendUserOperation({
            smartAccount,
            network: network,
            calls: [
                {
                    to: tokenAddress,
                    value: 0n,
                    data: transferData,
                },
            ],
        });
        console.log('📝 UserOp Hash:', result.userOpHash);
        const userOperation = await cdp.evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: result.userOpHash,
        });
        if (userOperation.status !== 'complete') {
            throw new Error(`Transaction failed: ${userOperation.status}`);
        }
        console.log('✅ Token transfer successful!');
        return {
            success: true,
            transactionHash: userOperation.transactionHash,
            amount,
            to: toAddress,
            from: smartAccount.address,
            tokenAddress,
            status: userOperation.status
        };
    }
    catch (error) {
        console.error('❌ Token transfer failed:', error.message);
        throw new Error(`Token transfer failed: ${error.message}`);
    }
};
exports.sendToken = sendToken;
/**
 * Execute batch transactions
 */
const executeBatchTransaction = async (userId, encryptedWalletData, calls, network = 'base-mainnet') => {
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
            network: network,
            calls: calls.map(call => ({
                to: call.to,
                value: call.value,
                data: call.data,
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
    }
    catch (error) {
        console.error('❌ Batch transaction failed:', error.message);
        throw new Error(`Batch transaction failed: ${error.message}`);
    }
};
exports.executeBatchTransaction = executeBatchTransaction;
/**
 * Get transaction history
 */
const getTransactionHistory = async (smartAccountAddress) => {
    return [];
};
exports.getTransactionHistory = getTransactionHistory;
exports.default = {
    createServerWallet: exports.createServerWallet,
    getWalletBalance: exports.getWalletBalance,
    getUSDCBalance: exports.getUSDCBalance,
    sendTransaction: exports.sendTransaction,
    sendToken: exports.sendToken,
    executeBatchTransaction: exports.executeBatchTransaction,
    getTransactionHistory: exports.getTransactionHistory
};
