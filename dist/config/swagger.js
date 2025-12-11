"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ============= src/config/swagger.ts =============
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const options = {
    definition: {
        openapi: '3.1.0',
        info: {
            title: 'Express MongoDB API with CDP Wallets & Authentication',
            version: '2.0.0',
            description: `
# Express MongoDB API with Coinbase Developer Platform (CDP) Wallets

This API provides complete user management with blockchain wallet integration and JWT authentication.

## 🚀 Features
- 🔐 **JWT Authentication** - Secure signup, login, and protected routes
- 📧 **Invite Code System** - Controlled user registration
- 💼 **Automatic Wallet Creation** - Base blockchain wallet created on signup
- 👥 **User Management** - Complete CRUD operations
- 💰 **Wallet Operations** - Balance checking and wallet info
- 🔗 **Smart Account Integration** - ERC-4337 compatible smart accounts
- 🔑 **Password Security** - Bcrypt hashing with salt

## 🔐 Authentication Flow

### 1. Signup
\`\`\`bash
POST /api/auth/signup
# Requires: name, username, email, password, inviteCode
# Returns: User object + JWT token + Wallet addresses
\`\`\`

### 2. Login
\`\`\`bash
POST /api/auth/login
# Requires: email, password
# Returns: User object + JWT token
\`\`\`

### 3. Access Protected Routes
\`\`\`bash
# Include token in Authorization header
Authorization: Bearer <your-jwt-token>
\`\`\`

## 💡 Quick Start

1. **Create default invite code**: \`POST /api/invites/default\`
2. **Signup**: \`POST /api/auth/signup\` with invite code
3. **Save the JWT token** from response
4. **Use token** for protected endpoints

## 🔗 Blockchain Integration
- **Network**: Base (Ethereum L2)
- **Wallet Type**: CDP Smart Accounts (ERC-4337)
- **Balance**: Currently mock data - integrate Base RPC for production
- **RPC URLs**: 
  - Base Mainnet: https://mainnet.base.org
  - Base Sepolia: https://sepolia.base.org

## 📝 API Endpoints Overview

### Authentication
- \`POST /api/auth/signup\` - Register new user
- \`POST /api/auth/login\` - Login user
- \`GET /api/auth/me\` - Get current user profile
- \`PUT /api/auth/update-password\` - Change password
- \`POST /api/auth/logout\` - Logout user

### Users
- \`GET /api/users\` - Get all users
- \`GET /api/users/:id\` - Get user by ID
- \`GET /api/users/:id/wallet\` - Get user's wallet
- \`GET /api/users/:id/wallet/balance\` - Get wallet balance
- \`PUT /api/users/:id\` - Update user (protected)
- \`DELETE /api/users/:id\` - Delete user (protected)

### Invite Codes
- \`POST /api/invites/default\` - Create default code
- \`GET /api/invites\` - Get all invite codes
- \`GET /api/invites/available\` - Get unused codes
- \`GET /api/invites/:code\` - Get specific code
- \`POST /api/invites/:code/validate\` - Validate code
- \`POST /api/invites\` - Create custom code
- \`DELETE /api/invites/:code\` - Delete code

## 🔒 Security Notes
- Passwords are hashed with bcrypt (10 salt rounds)
- JWT tokens expire after 30 days (configurable)
- Protected routes require valid JWT token
- Invite codes prevent unauthorized signups
      `,
            contact: {
                name: 'API Support',
                email: 'support@example.com',
                url: 'https://example.com/support'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: 'http://localhost:5000',
                description: 'Development server'
            },
            {
                url: 'https://api.example.com',
                description: 'Production server (configure as needed)'
            }
        ],
        tags: [
            {
                name: 'Authentication',
                description: 'User authentication endpoints (signup, login, password management)'
            },
            {
                name: 'Users',
                description: 'User management and wallet operations'
            },
            {
                name: 'Invite Codes',
                description: 'Invite code generation, validation, and management'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter JWT token obtained from /api/auth/signup or /api/auth/login. Format: Bearer <token>'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    required: ['name', 'username', 'email', 'password', 'inviteCode'],
                    properties: {
                        _id: {
                            type: 'string',
                            description: 'Auto-generated MongoDB ObjectId',
                            example: '507f1f77bcf86cd799439011'
                        },
                        name: {
                            type: 'string',
                            description: 'Full name of the user',
                            minLength: 2,
                            maxLength: 100,
                            example: 'John Doe'
                        },
                        username: {
                            type: 'string',
                            description: 'Unique username (stored in lowercase, alphanumeric + underscores only)',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-z0-9_]+$',
                            example: 'johndoe'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address (must be unique)',
                            example: 'john.doe@example.com'
                        },
                        inviteCode: {
                            type: 'string',
                            description: 'Invite code used during registration',
                            example: 'DEFAULT2024'
                        },
                        wallet: {
                            $ref: '#/components/schemas/Wallet'
                        },
                        createdInviteCodes: {
                            type: 'array',
                            description: 'List of invite codes created by this user',
                            items: {
                                $ref: '#/components/schemas/InviteCode'
                            }
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'User account creation timestamp',
                            example: '2024-12-09T10:30:00.000Z'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last update timestamp',
                            example: '2024-12-09T10:30:00.000Z'
                        }
                    }
                },
                Wallet: {
                    type: 'object',
                    description: 'Coinbase CDP wallet information on Base network',
                    required: ['ownerAddress', 'smartAccountAddress', 'network'],
                    properties: {
                        ownerAddress: {
                            type: 'string',
                            description: 'CDP owner account address (EOA - Externally Owned Account)',
                            pattern: '^0x[a-fA-F0-9]{40}$',
                            example: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
                        },
                        smartAccountAddress: {
                            type: 'string',
                            description: 'CDP smart account address (ERC-4337 compatible)',
                            pattern: '^0x[a-fA-F0-9]{40}$',
                            example: '0x1234567890abcdef1234567890abcdef12345678'
                        },
                        network: {
                            type: 'string',
                            description: 'Blockchain network identifier',
                            enum: ['base', 'base-sepolia'],
                            default: 'base',
                            example: 'base'
                        }
                    }
                },
                InviteCode: {
                    type: 'object',
                    required: ['code', 'isLifetime'],
                    properties: {
                        _id: {
                            type: 'string',
                            description: 'Auto-generated MongoDB ObjectId',
                            example: '507f1f77bcf86cd799439011'
                        },
                        code: {
                            type: 'string',
                            description: 'Unique invite code (uppercase alphanumeric)',
                            minLength: 6,
                            maxLength: 20,
                            pattern: '^[A-Z0-9]+$',
                            example: 'DEFAULT2024'
                        },
                        isUsed: {
                            type: 'boolean',
                            description: 'Whether the code has been used for registration',
                            default: false,
                            example: false
                        },
                        isLifetime: {
                            type: 'boolean',
                            description: 'Whether the code never expires',
                            default: false,
                            example: true
                        },
                        usedBy: {
                            type: 'string',
                            description: 'User ID who used the code (null if unused)',
                            example: '507f1f77bcf86cd799439011',
                            nullable: true
                        },
                        createdBy: {
                            type: 'string',
                            description: 'User ID who created the code (null if system-generated)',
                            example: '507f1f77bcf86cd799439011',
                            nullable: true
                        },
                        expiresAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Expiration date (null for lifetime codes)',
                            example: '2025-12-31T23:59:59.000Z',
                            nullable: true
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Code creation timestamp',
                            example: '2024-12-09T10:30:00.000Z'
                        }
                    }
                },
                SignupRequest: {
                    type: 'object',
                    required: ['name', 'username', 'email', 'password', 'inviteCode'],
                    properties: {
                        name: {
                            type: 'string',
                            minLength: 2,
                            maxLength: 100,
                            description: 'Full name',
                            example: 'John Doe'
                        },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            description: 'Unique username (alphanumeric and underscores)',
                            example: 'johndoe'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'Email address',
                            example: 'john.doe@example.com'
                        },
                        password: {
                            type: 'string',
                            format: 'password',
                            minLength: 6,
                            description: 'Password (will be hashed)',
                            example: 'SecurePass123!'
                        },
                        inviteCode: {
                            type: 'string',
                            description: 'Valid invite code for registration',
                            example: 'DEFAULT2024'
                        }
                    }
                },
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address',
                            example: 'john.doe@example.com'
                        },
                        password: {
                            type: 'string',
                            format: 'password',
                            description: 'User password',
                            example: 'SecurePass123!'
                        }
                    }
                },
                AuthResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: true
                        },
                        message: {
                            type: 'string',
                            example: 'Login successful'
                        },
                        data: {
                            type: 'object',
                            properties: {
                                user: {
                                    $ref: '#/components/schemas/User'
                                },
                                token: {
                                    type: 'string',
                                    description: 'JWT authentication token (valid for 30 days)',
                                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NGQxMjM0NTY3ODkwYWJjZGVmMTIzNCIsImlhdCI6MTYzMzAzMjAwMCwiZXhwIjoxNjM1NjI0MDAwfQ.abc123xyz'
                                }
                            }
                        }
                    }
                },
                UpdatePasswordRequest: {
                    type: 'object',
                    required: ['currentPassword', 'newPassword'],
                    properties: {
                        currentPassword: {
                            type: 'string',
                            format: 'password',
                            description: 'Current password',
                            example: 'OldPass123!'
                        },
                        newPassword: {
                            type: 'string',
                            format: 'password',
                            minLength: 6,
                            description: 'New password (minimum 6 characters)',
                            example: 'NewSecurePass456!'
                        }
                    }
                },
                CreateUserDTO: {
                    type: 'object',
                    required: ['name', 'username', 'email', 'password', 'inviteCode'],
                    properties: {
                        name: {
                            type: 'string',
                            minLength: 2,
                            maxLength: 100,
                            example: 'John Doe'
                        },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            example: 'johndoe'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            example: 'john.doe@example.com'
                        },
                        password: {
                            type: 'string',
                            format: 'password',
                            minLength: 6,
                            description: 'User password (will be hashed)',
                            example: 'SecurePass123!'
                        },
                        inviteCode: {
                            type: 'string',
                            description: 'Valid invite code for registration',
                            example: 'DEFAULT2024'
                        }
                    }
                },
                UpdateUserDTO: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            minLength: 2,
                            maxLength: 100,
                            example: 'John Smith'
                        },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            example: 'johnsmith'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            example: 'john.smith@example.com'
                        }
                    }
                },
                CreateInviteCodeRequest: {
                    type: 'object',
                    required: ['code'],
                    properties: {
                        code: {
                            type: 'string',
                            minLength: 6,
                            maxLength: 20,
                            description: 'Unique invite code (will be converted to uppercase)',
                            example: 'WELCOME2024'
                        },
                        isLifetime: {
                            type: 'boolean',
                            default: false,
                            description: 'Whether the code never expires',
                            example: false
                        },
                        expiresAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Expiration date (required if isLifetime is false)',
                            example: '2025-12-31T23:59:59.000Z'
                        },
                        createdBy: {
                            type: 'string',
                            description: 'User ID who created the code (optional)',
                            example: '507f1f77bcf86cd799439011'
                        }
                    }
                },
                SuccessResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: true
                        },
                        message: {
                            type: 'string',
                            example: 'Operation completed successfully'
                        },
                        data: {
                            type: 'object',
                            description: 'Response data (varies by endpoint)'
                        }
                    }
                },
                ErrorResponse: {
                    type: 'object',
                    required: ['success', 'error'],
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        error: {
                            type: 'string',
                            description: 'Error message',
                            example: 'Invalid invite code'
                        }
                    }
                },
                WalletBalance: {
                    type: 'object',
                    properties: {
                        address: {
                            type: 'string',
                            description: 'Owner wallet address',
                            example: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
                        },
                        smartAccountAddress: {
                            type: 'string',
                            description: 'Smart account address',
                            example: '0x1234567890abcdef1234567890abcdef12345678'
                        },
                        network: {
                            type: 'string',
                            example: 'base'
                        },
                        balance: {
                            type: 'string',
                            description: 'Balance in ETH',
                            example: '0.245678 ETH'
                        },
                        balanceInWei: {
                            type: 'string',
                            description: 'Balance in Wei (smallest unit)',
                            example: '245678000000000000'
                        },
                        message: {
                            type: 'string',
                            example: 'Note: This is a mock balance. Integrate with Base RPC for real balance.'
                        }
                    }
                }
            },
            responses: {
                BadRequest: {
                    description: 'Bad Request - Invalid input data',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            examples: {
                                invalidInput: {
                                    summary: 'Invalid input',
                                    value: {
                                        success: false,
                                        error: 'Please provide name, username, email, password, and invite code'
                                    }
                                },
                                usedInviteCode: {
                                    summary: 'Used invite code',
                                    value: {
                                        success: false,
                                        error: 'This invite code has already been used'
                                    }
                                },
                                emailTaken: {
                                    summary: 'Email already registered',
                                    value: {
                                        success: false,
                                        error: 'Email already registered'
                                    }
                                },
                                usernameTaken: {
                                    summary: 'Username already taken',
                                    value: {
                                        success: false,
                                        error: 'Username already taken'
                                    }
                                }
                            }
                        }
                    }
                },
                Unauthorized: {
                    description: 'Unauthorized - Authentication required or invalid credentials',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            examples: {
                                noToken: {
                                    summary: 'No token provided',
                                    value: {
                                        success: false,
                                        error: 'Not authorized to access this route. Please provide a valid token.'
                                    }
                                },
                                invalidToken: {
                                    summary: 'Invalid token',
                                    value: {
                                        success: false,
                                        error: 'Not authorized to access this route. Invalid token.'
                                    }
                                },
                                invalidCredentials: {
                                    summary: 'Invalid login credentials',
                                    value: {
                                        success: false,
                                        error: 'Invalid credentials'
                                    }
                                }
                            }
                        }
                    }
                },
                NotFound: {
                    description: 'Resource not found',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            examples: {
                                userNotFound: {
                                    summary: 'User not found',
                                    value: {
                                        success: false,
                                        error: 'User not found'
                                    }
                                },
                                inviteNotFound: {
                                    summary: 'Invite code not found',
                                    value: {
                                        success: false,
                                        error: 'Invite code not found'
                                    }
                                }
                            }
                        }
                    }
                },
                ServerError: {
                    description: 'Internal Server Error',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                error: 'Server Error'
                            }
                        }
                    }
                }
            }
        }
    },
    apis: ['./src/routes/*.ts', './src/controllers/*.ts']
};
exports.default = (0, swagger_jsdoc_1.default)(options);
