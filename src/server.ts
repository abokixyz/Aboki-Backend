// ============= src/server.ts =============
/**
 * Express Server Configuration
 * 
 * Main entry point for the API
 * Configures middleware, routes, error handling, and services
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/database';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';
import { startPollingService } from './services/lencoPollingService';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import inviteRoutes from './routes/inviteRoutes';
import walletRoutes from './routes/walletRoutes';
import onrampRoutes from './routes/onrampRoutes';
import offrampRoutes from './routes/offrampRoutes';
import transferRoutes from './routes/transferRoutes';

// Initialize express app
const app: Application = express();

// ============= MIDDLEWARE =============

// Enhanced CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-lenco-signature'],
  exposedHeaders: ['Content-Length', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Handle OPTIONS preflight requests
app.options('*', cors(corsOptions));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============= DATABASE =============

// Connect to MongoDB
connectDB();

// ============= SERVICES =============

// Start Lenco polling service for offramp transaction status updates
// This polls Lenco API for pending/settling transactions since webhook access is unavailable
startPollingService();

// ============= DOCUMENTATION =============

// Swagger JSON endpoint with CORS headers
app.get('/api-docs/swagger.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(swaggerSpec);
});

// Swagger documentation UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    url: '/api-docs/swagger.json',
    persistAuthorization: true,
    displayOperationId: true
  },
  customCss: '.swagger-ui .topbar { display: none }'
}));

// ============= HEALTH CHECK =============

/**
 * Health Check Endpoint
 * Returns API status and available endpoints
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Aboki API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      invites: '/api/invites',
      wallet: '/api/wallet',
      onramp: '/api/onramp',
      offramp: '/api/offramp',
      transfer: '/api/transfer',
      docs: '/api-docs'
    }
  });
});

// ============= API ROUTES =============

/**
 * Auth Routes
 * @route /api/auth
 * - POST /register - Register new user
 * - POST /login - Login user
 * - POST /refresh - Refresh JWT token
 */
app.use('/api/auth', authRoutes);

/**
 * User Routes
 * @route /api/users
 * - GET / - Get user profile
 * - PUT / - Update user profile
 * - GET /transactions - Get user transactions
 */
app.use('/api/users', userRoutes);

/**
 * Invite Routes
 * @route /api/invites
 * - POST / - Create invite
 * - GET / - Get invites
 * - POST /redeem - Redeem invite
 */
app.use('/api/invites', inviteRoutes);

/**
 * Wallet Routes
 * @route /api/wallet
 * - POST /create - Create Smart Account
 * - GET /balance - Get wallet balance
 * - POST /import - Import wallet
 */
app.use('/api/wallet', walletRoutes);

/**
 * Onramp Routes (NGN → USDC)
 * @route /api/onramp
 * - GET /rate - Get onramp rate
 * - POST /initiate - Initiate onramp
 * - GET /verify/:reference - Verify payment
 * - GET /history - Get transaction history
 * - POST /webhook - Monnify webhook
 */
app.use('/api/onramp', onrampRoutes);

/**
 * Offramp Routes (USDC → NGN)
 * @route /api/offramp
 * - GET / - Offramp endpoint info
 * - GET /rate - Get offramp rate
 * - POST /verify-account - Verify bank account
 * - POST /initiate - Initiate offramp
 * - POST /confirm-transfer - Confirm blockchain transfer
 * - GET /status/:reference - Get transaction status
 * - GET /history - Get transaction history
 * - POST /webhook/lenco - Lenco webhook
 * - POST /beneficiaries - Add beneficiary
 * - GET /beneficiaries - Get beneficiaries
 * - DELETE /beneficiaries/:id - Delete beneficiary
 * - PUT /beneficiaries/:id/default - Set default beneficiary
 * - GET /frequent-accounts - Get frequent accounts
 * 
 * Polling Service:
 * - Automatically polls Lenco API every 30 seconds for pending/settling transactions
 * - Updates transaction status without webhook access
 * - Handles timeouts after 30 minutes
 */
app.use('/api/offramp', offrampRoutes);

/**
 * Transfer Routes (USDC transfer)
 * @route /api/transfer
 * - POST /send - Send USDC
 * - GET /history - Get transfer history
 */
app.use('/api/transfer', transferRoutes);

// ============= 404 HANDLER =============

/**
 * 404 Not Found Handler
 * Must be AFTER all route definitions
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method,
    message: 'This endpoint does not exist. Check /api-docs for available routes.',
    availableRoutes: [
      'GET  /',
      'GET  /api/auth',
      'GET  /api/users',
      'GET  /api/invites',
      'GET  /api/wallet',
      'GET  /api/onramp',
      'GET  /api/offramp',
      'GET  /api/transfer',
      'GET  /api-docs'
    ]
  });
});

// ============= ERROR HANDLER =============

/**
 * Global Error Handler
 * Catches all errors and returns standardized response
 * Must be LAST middleware
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Error:', err.message);
  console.error('Stack:', err.stack);

  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    path: req.path
  });
});

// ============= SERVER START =============

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.listen(PORT, () => {
  const apiUrl = process.env.API_BASE_URL || `http://localhost:${PORT}`;

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 ABOKI API SERVER                                         ║
║                                                                ║
║   Status:      ✅ Running                                      ║
║   Port:        ${PORT}                                           ║
║   Environment: ${NODE_ENV}                                      ║
║   URL:         ${apiUrl}                                ║
║                                                                ║
║   📚 API Documentation: ${apiUrl}/api-docs            ║
║   🔐 Auth Endpoints:    ${apiUrl}/api/auth            ║
║   👥 User Endpoints:    ${apiUrl}/api/users           ║
║   🎫 Invite Endpoints:  ${apiUrl}/api/invites         ║
║   💰 Wallet Endpoints:  ${apiUrl}/api/wallet          ║
║   💳 Onramp Endpoints:  ${apiUrl}/api/onramp          ║
║   💸 Offramp Endpoints: ${apiUrl}/api/offramp         ║
║   🔄 Transfer Endpoints: ${apiUrl}/api/transfer        ║
║                                                                ║
║   ✅ All Routes Registered                                    ║
║   ✅ MongoDB Connected                                        ║
║   ✅ CORS Enabled                                             ║
║   ✅ Swagger Docs Available                                   ║
║   ✅ Lenco Polling Service Started                            ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

export default app;