"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ============= src/server.ts =============
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const database_1 = __importDefault(require("./config/database"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = __importDefault(require("./config/swagger"));
// Load environment variables
dotenv_1.default.config();
// Import routes
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const inviteRoutes_1 = __importDefault(require("./routes/inviteRoutes"));
const walletRoutes_1 = __importDefault(require("./routes/walletRoutes"));
// Initialize express app
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Connect to MongoDB
(0, database_1.default)();
// Swagger documentation
app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.default));
// API Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/users', userRoutes_1.default);
app.use('/api/invites', inviteRoutes_1.default);
app.use('/api/wallet', walletRoutes_1.default); // ← WALLET ROUTES
// Health check
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'API is running',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            invites: '/api/invites',
            wallet: '/api/wallet',
            docs: '/api-docs'
        }
    });
});
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        availableRoutes: [
            '/api/auth',
            '/api/users',
            '/api/invites',
            '/api/wallet',
            '/api-docs'
        ]
    });
});
// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║                                                       ║
  ║   🚀 Server running on port ${PORT}                     ║
  ║                                                       ║
  ║   📚 API Documentation: http://localhost:${PORT}/api-docs  ║
  ║   🔐 Auth Endpoints:    http://localhost:${PORT}/api/auth  ║
  ║   👥 User Endpoints:    http://localhost:${PORT}/api/users ║
  ║   🎫 Invite Endpoints:  http://localhost:${PORT}/api/invites ║
  ║   💰 Wallet Endpoints:  http://localhost:${PORT}/api/wallet ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
});
exports.default = app;
