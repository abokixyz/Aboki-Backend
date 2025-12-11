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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
connectDB();

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/wallet', walletRoutes);  // ← WALLET ROUTES

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
  ║   📚 API Documentation: http://localhost:${PORT}/api-docs  ║
  ║   🔐 Auth Endpoints:    http://localhost:${PORT}/api/auth  ║
  ║   👥 User Endpoints:    http://localhost:${PORT}/api/users ║
  ║   🎫 Invite Endpoints:  http://localhost:${PORT}/api/invites ║
  ║   💰 Wallet Endpoints:  http://localhost:${PORT}/api/wallet ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
});

export default app;