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

// Load environment variables FIRST
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

// Trust proxy - IMPORTANT for production behind reverse proxy
app.set('trust proxy', 1);

// Enhanced CORS configuration - CRITICAL FIX
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) {
      console.log('✅ CORS: Allowing request with no origin');
      return callback(null, true);
    }
    
    // Get allowed origins from env or use defaults
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : [
          'http://localhost:3000',
          'http://localhost:3001', 
          'http://localhost:5173',
          'https://aboki.xyz',
          'https://www.aboki.xyz',
          'https://app.aboki.xyz'
        ];
    
    console.log('🔍 CORS Check:', {
      requestOrigin: origin,
      allowedOrigins,
      isAllowed: allowedOrigins.includes(origin) || allowedOrigins.includes('*')
    });
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      console.log('✅ CORS: Origin allowed -', origin);
      callback(null, true);
    } else {
      console.log('❌ CORS: Origin blocked -', origin);
      callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'x-lenco-signature',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Additional CORS headers middleware (defense in depth)
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  
  if (origin) {
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : [
          'http://localhost:3000',
          'http://localhost:3001', 
          'http://localhost:5173',
          'https://aboki.xyz',
          'https://www.aboki.xyz',
          'https://app.aboki.xyz'
        ];
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, x-lenco-signature, Origin');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Body parsers - MUST come after CORS
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (helpful for debugging)
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
    origin: req.headers.origin,
    userAgent: req.headers['user-agent']?.substring(0, 50)
  });
  next();
});

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
    environment: process.env.NODE_ENV || 'development',
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

// CORS test endpoint
app.get('/api/cors-test', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'CORS is working correctly',
    origin: req.headers.origin,
    method: req.method,
    headers: req.headers
  });
});

// ============= API ROUTES =============

/**
 * Auth Routes
 * @route /api/auth
 */
app.use('/api/auth', authRoutes);

/**
 * User Routes
 * @route /api/users
 */
app.use('/api/users', userRoutes);

/**
 * Invite Routes
 * @route /api/invites
 */
app.use('/api/invites', inviteRoutes);

/**
 * Wallet Routes
 * @route /api/wallet
 */
app.use('/api/wallet', walletRoutes);

/**
 * Onramp Routes (NGN → USDC)
 * @route /api/onramp
 */
app.use('/api/onramp', onrampRoutes);

/**
 * Offramp Routes (USDC → NGN)
 * @route /api/offramp
 */
app.use('/api/offramp', offrampRoutes);

/**
 * Transfer Routes (USDC transfer)
 * @route /api/transfer
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
      'GET  /api/cors-test',
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

  // Handle CORS errors specifically
  if (err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      error: 'CORS Error',
      message: err.message,
      hint: 'Check if your origin is allowed in CORS_ORIGIN environment variable'
    });
  }

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
║   🧪 CORS Test:         ${apiUrl}/api/cors-test       ║
║                                                                ║
║   ✅ All Routes Registered                                    ║
║   ✅ MongoDB Connected                                        ║
║   ✅ CORS Enabled                                             ║
║   ✅ Swagger Docs Available                                   ║
║   ✅ Lenco Polling Service Started                            ║
║                                                                ║
║   CORS Origins: ${process.env.CORS_ORIGIN || 'localhost defaults'}
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

export default app;