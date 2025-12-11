"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.updatePassword = exports.getMe = exports.login = exports.signup = void 0;
const User_1 = __importDefault(require("../models/User"));
const InviteCode_1 = __importDefault(require("../models/InviteCode"));
const walletService_1 = require("../services/walletService");
/**
 * Generate JWT Token
 */
const generateToken = (user) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '30d' });
};
/**
 * @desc    Register new user with invite code
 * @route   POST /api/auth/signup
 * @access  Public
 */
const signup = async (req, res) => {
    try {
        const { name, username, email, password, inviteCode } = req.body;
        console.log('📝 User signup attempt:', {
            username,
            email,
            inviteCode
        });
        // Validate required fields
        if (!name || !username || !email || !password || !inviteCode) {
            res.status(400).json({
                success: false,
                error: 'Please provide name, username, email, password, and invite code'
            });
            return;
        }
        // Check if user already exists
        const existingUser = await User_1.default.findOne({
            $or: [{ email }, { username: username.toLowerCase() }]
        });
        if (existingUser) {
            res.status(400).json({
                success: false,
                error: existingUser.email === email
                    ? 'Email already registered'
                    : 'Username already taken'
            });
            return;
        }
        // Validate invite code
        console.log('✅ Invite code validated:', inviteCode.toUpperCase());
        const invite = await InviteCode_1.default.findOne({
            code: inviteCode.toUpperCase()
        }).populate('createdBy', 'username');
        if (!invite) {
            res.status(400).json({
                success: false,
                error: 'Invalid invite code'
            });
            return;
        }
        if (invite.isUsed) {
            res.status(400).json({
                success: false,
                error: 'This invite code has already been used'
            });
            return;
        }
        // Check if code is expired
        if (!invite.isLifetime && invite.expiresAt && invite.expiresAt < new Date()) {
            res.status(400).json({
                success: false,
                error: 'This invite code has expired'
            });
            return;
        }
        // Create wallet
        console.log('🔐 Creating wallet...');
        const wallet = await (0, walletService_1.createServerWallet)();
        console.log('✅ Wallet created:', {
            ownerAddress: wallet.ownerAddress,
            smartAccountAddress: wallet.smartAccountAddress,
            network: wallet.network,
            isReal: wallet.isReal
        });
        // Create user
        const user = await User_1.default.create({
            name,
            username: username.toLowerCase(),
            email,
            password,
            inviteCode: invite.code,
            invitedBy: invite.createdBy || null, // Track who invited this user
            wallet,
            createdInviteCodes: []
        });
        console.log('✅ User created:', user._id);
        // Mark invite code as used
        invite.isUsed = true;
        invite.usedBy = user._id;
        await invite.save();
        console.log('✅ Invite code marked as used');
        // Auto-generate personal invite code for new user
        const personalInviteCode = `${username.toLowerCase()}inviteyou`.toUpperCase();
        console.log(`📨 Creating personal invite code: ${personalInviteCode}`);
        try {
            const newInviteCode = await InviteCode_1.default.create({
                code: personalInviteCode,
                isLifetime: true,
                createdBy: user._id,
                isUsed: false,
                expiresAt: null
            });
            // Add to user's created invite codes
            user.createdInviteCodes.push(newInviteCode._id);
            await user.save();
            console.log('✅ Personal invite code created:', personalInviteCode);
        }
        catch (inviteError) {
            // If invite code already exists, just log it (shouldn't happen with unique usernames)
            console.log('⚠️ Could not create personal invite code:', inviteError.message);
        }
        // Generate token
        const token = generateToken(user);
        // Return user without password
        const userResponse = await User_1.default.findById(user._id)
            .select('-password')
            .populate('createdInviteCodes', 'code isUsed usedBy');
        res.status(201).json({
            success: true,
            message: wallet.isReal
                ? 'Account created successfully with real CDP smart wallet on Base!'
                : 'Account created successfully (wallet creation pending)',
            data: {
                user: userResponse,
                token,
                inviteCode: personalInviteCode // Return the user's personal invite code
            }
        });
    }
    catch (error) {
        console.error('❌ Signup error:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map((err) => err.message);
            res.status(400).json({
                success: false,
                error: messages.join(', ')
            });
            return;
        }
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.signup = signup;
/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({
                success: false,
                error: 'Please provide email and password'
            });
            return;
        }
        const user = await User_1.default.findOne({ email }).select('+password');
        if (!user) {
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
            return;
        }
        const token = generateToken(user);
        const userResponse = await User_1.default.findById(user._id)
            .select('-password')
            .populate('createdInviteCodes', 'code isUsed usedBy');
        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: userResponse,
                token
            }
        });
    }
    catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.login = login;
/**
 * @desc    Get current user
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.user?.id)
            .select('-password')
            .populate('createdInviteCodes', 'code isUsed usedBy createdAt')
            .populate('invitedBy', 'username name email');
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: user
        });
    }
    catch (error) {
        console.error('❌ Error fetching user:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.getMe = getMe;
/**
 * @desc    Update password
 * @route   PUT /api/auth/update-password
 * @access  Private
 */
const updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            res.status(400).json({
                success: false,
                error: 'Please provide current and new password'
            });
            return;
        }
        const user = await User_1.default.findById(req.user?.id).select('+password');
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
            return;
        }
        user.password = newPassword;
        await user.save();
        const token = generateToken(user);
        res.status(200).json({
            success: true,
            message: 'Password updated successfully',
            data: { token }
        });
    }
    catch (error) {
        console.error('❌ Password update error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Server Error'
        });
    }
};
exports.updatePassword = updatePassword;
/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = async (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Logged out successfully. Please remove the token from client.'
    });
};
exports.logout = logout;
exports.default = {
    signup: exports.signup,
    login: exports.login,
    getMe: exports.getMe,
    updatePassword: exports.updatePassword,
    logout: exports.logout
};
