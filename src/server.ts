// ============= src/server.ts =============
import express, { Application, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/database';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import inviteRoutes from './routes/inviteRoutes';
import walletRoutes from './routes/walletRoutes';

// Initialize express app
const app: Application = express();

// Enhanced CORS configuration
app.use(cors({
  origin: '*', // Allow all origins for development/testing
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Requested-With']
}));

// Handle OPTIONS preflight requests
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
connectDB();

// Swagger JSON endpoint with CORS headers
app.get('/api-docs/swagger.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(swaggerSpec);
});

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    url: '/api-docs/swagger.json',
    persistAuthorization: true
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/', (req: Request, res: Response) => {
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
app.use((req: Request, res: Response) => {
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
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
  ║   📚 API Documentation: https://apis.aboki.xyz/api-docs  ║
  ║   🔐 Auth Endpoints:    https://apis.aboki.xyz/api/auth  ║
  ║   👥 User Endpoints:    https://apis.aboki.xyz/api/users ║
  ║   🎫 Invite Endpoints:  https://apis.aboki.xyz/api/invites ║
  ║   💰 Wallet Endpoints:  https://apis.aboki.xyz/api/wallet ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
});

export default app;