"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyTransactions = exports.sendTransaction = exports.getMyBalance = exports.getMyWallet = void 0;
const User_1 = __importDefault(require("../models/User"));
const walletService_1 = require("../services/walletService");
// USDC Contract Address on Base Mainnet
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/**
 * @desc    Get my wallet details
 * @route   GET /api/wallet
 * @access  Private (uses JWT token)
 */
const getMyWallet = async (req, res) => {
    try {
        // req.user is set by protect middleware
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        if (!user.wallet) {
            res.status(404).json({
                success: false,
                error: 'Wallet not found'
            });
            return;
        }
        // Get ETH balance
        const ethBalance = await (0, walletService_1.getWalletBalance)(user.wallet.smartAccountAddress || user.wallet.ownerAddress, user.wallet.network || 'base-mainnet');
        // Get USDC balance
        const usdcBalance = await (0, walletService_1.getUSDCBalance)(user.wallet.smartAccountAddress || user.wallet.ownerAddress, user.wallet.network || 'base-mainnet');
        res.status(200).json({
            success: true,
            data: {
                ownerAddress: user.wallet.ownerAddress,
                smartAccountAddress: user.wallet.smartAccountAddress,
                network: user.wallet.network,
                userName: user.name,
                username: user.username,
                ethBalance: ethBalance.balance,
                usdcBalance: usdcBalance.balance,
                balances: {
                    ETH: ethBalance,
                    USDC: usdcBalance
                }
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching wallet:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMyWallet = getMyWallet;
/**
 * @desc    Get my wallet balance (ETH + USDC)
 * @route   GET /api/wallet/balance
 * @access  Private (uses JWT token)
 */
const getMyBalance = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        if (!user.wallet) {
            res.status(404).json({
                success: false,
                error: 'Wallet not found'
            });
            return;
        }
        const address = user.wallet.smartAccountAddress || user.wallet.ownerAddress;
        const network = user.wallet.network || 'base-mainnet';
        // Get both ETH and USDC balances
        const ethBalance = await (0, walletService_1.getWalletBalance)(address, network);
        const usdcBalance = await (0, walletService_1.getUSDCBalance)(address, network);
        res.status(200).json({
            success: true,
            data: {
                ownerAddress: user.wallet.ownerAddress,
                smartAccountAddress: user.wallet.smartAccountAddress,
                network: user.wallet.network,
                ethBalance: ethBalance.balance,
                usdcBalance: usdcBalance.balance,
                balances: {
                    ETH: ethBalance,
                    USDC: usdcBalance
                }
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching balance:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMyBalance = getMyBalance;
/**
 * @desc    Send transaction (ETH or USDC)
 * @route   POST /api/wallet/send
 * @access  Private (uses JWT token)
 */
const sendTransaction = async (req, res) => {
    try {
        const { toAddress, amount, token = 'USDC', network } = req.body;
        // Validate inputs
        if (!toAddress || !amount) {
            res.status(400).json({
                success: false,
                error: 'Please provide toAddress and amount'
            });
            return;
        }
        // Validate amount
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            res.status(400).json({
                success: false,
                error: 'Invalid amount'
            });
            return;
        }
        // Validate token
        if (!['ETH', 'USDC'].includes(token.toUpperCase())) {
            res.status(400).json({
                success: false,
                error: 'Token must be either ETH or USDC'
            });
            return;
        }
        // Get user with wallet data
        const user = await User_1.default.findById(req.user?.id).select('+wallet.encryptedWalletData');
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        if (!user.wallet || !user.wallet.encryptedWalletData) {
            res.status(400).json({
                success: false,
                error: 'Wallet not configured for transactions'
            });
            return;
        }
        const networkToUse = network || user.wallet.network || 'base-mainnet';
        console.log(`💸 Processing ${token} transaction for ${user.username}`);
        console.log(`   From: ${user.wallet.smartAccountAddress}`);
        console.log(`   To: ${toAddress}`);
        console.log(`   Amount: ${amount} ${token}`);
        console.log(`   Network: ${networkToUse}`);
        let result;
        if (token.toUpperCase() === 'ETH') {
            // Send ETH
            result = await (0, walletService_1.sendTransaction)(user._id.toString(), user.wallet.encryptedWalletData, toAddress, amount, networkToUse);
        }
        else {
            // Send USDC
            // Convert amount to USDC wei (6 decimals)
            const amountInWei = (parseFloat(amount) * 1e6).toString();
            result = await (0, walletService_1.sendToken)(user._id.toString(), user.wallet.encryptedWalletData, USDC_ADDRESS, toAddress, amountInWei, 6, // USDC has 6 decimals
            networkToUse);
        }
        res.status(200).json({
            success: true,
            message: `${token} sent successfully`,
            data: {
                ...result,
                token
            }
        });
    }
    catch (error) {
        console.error('❌ Transaction error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Transaction failed'
        });
    }
};
exports.sendTransaction = sendTransaction;
/**
 * @desc    Get my transaction history
 * @route   GET /api/wallet/transactions
 * @access  Private (uses JWT token)
 */
const getMyTransactions = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        if (!user.wallet || !user.wallet.smartAccountAddress) {
            res.status(200).json({
                success: true,
                data: [],
                message: 'No transactions available'
            });
            return;
        }
        // TODO: Integrate with Basescan API to get real transaction history
        const transactions = [];
        res.status(200).json({
            success: true,
            count: transactions.length,
            data: transactions,
            message: transactions.length === 0
                ? 'No transactions found. Use Basescan API for full history.'
                : undefined
        });
    }
    catch (error) {
        console.error('❌ Error fetching transactions:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMyTransactions = getMyTransactions;
exports.default = {
    getMyWallet: exports.getMyWallet,
    getMyBalance: exports.getMyBalance,
    sendTransaction: exports.sendTransaction,
    getMyTransactions: exports.getMyTransactions
};
