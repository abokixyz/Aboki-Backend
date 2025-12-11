"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.protect = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
/**
 * Protect routes - verify JWT token
 */
const protect = async (req, res, next) => {
    try {
        let token;
        // Check for token in Authorization header
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        // Make sure token exists
        if (!token) {
            res.status(401).json({
                success: false,
                error: 'Not authorized to access this route. Please provide a valid token.'
            });
            return;
        }
        try {
            // Verify token
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            // Check if user still exists
            const user = await User_1.default.findById(decoded.id).select('-password');
            if (!user) {
                res.status(401).json({
                    success: false,
                    error: 'User no longer exists'
                });
                return;
            }
            // Add user to request object
            req.user = {
                id: user._id.toString()
            };
            next();
        }
        catch (error) {
            res.status(401).json({
                success: false,
                error: 'Not authorized to access this route. Invalid token.'
            });
            return;
        }
    }
    catch (error) {
        console.error('❌ Auth middleware error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during authentication'
        });
    }
};
exports.protect = protect;
/**
 * Optional auth - doesn't fail if no token, but adds user if valid token exists
 */
const optionalAuth = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (!token) {
            return next();
        }
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            const user = await User_1.default.findById(decoded.id).select('-password');
            if (user) {
                req.user = {
                    id: user._id.toString()
                };
            }
        }
        catch (error) {
            // Invalid token, but we continue anyway
            console.log('Invalid token in optional auth, continuing...');
        }
        next();
    }
    catch (error) {
        console.error('❌ Optional auth middleware error:', error);
        next();
    }
};
exports.optionalAuth = optionalAuth;
