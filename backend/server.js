const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const redis = require('redis');
const winston = require('winston');
const Sentry = require('@sentry/node');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const { router: paymentRoutes } = require('./routes/payments');
const gameRoutes = require('./routes/game');
const achievementRoutes = require('./routes/achievements');
const certificateRoutes = require('./routes/certificates');
const leaderboardRoutes = require('./routes/leaderboard');
const dashboardRoutes = require('./routes/dashboard');
const teacherRoutes = require('./routes/teacher');
const analyticsRoutes = require('./routes/analytics');

// Import middleware
const authMiddleware = require('./middleware/auth');
const validationMiddleware = require('./middleware/validation');
const coppaMiddleware = require('./middleware/coppa');
const errorHandler = require('./middleware/errorHandler');

// Import services
const blockchainService = require('./services/blockchainService');
const walletService = require('./services/walletService');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Sentry for error tracking
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    app.use(Sentry.Handlers.requestHandler());
}

// Configure Winston logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'spellbloc-backend' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Redis client for sessions and caching
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis connection refused');
            return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

redisClient.on('error', (err) => {
    logger.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
    logger.info('Connected to Redis');
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'", "https://api.spellbloc.com", "wss://"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://spellbloc.com',
            'https://www.spellbloc.com',
            'https://app.spellbloc.com',
            process.env.FRONTEND_URL
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // requests per window
    message: {
        error: 'Too many requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        error: 'Too many authentication attempts, please try again later.',
    },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());

// Session configuration
app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || 'spellbloc-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    },
}));

// Logging middleware
app.use(morgan('combined', {
    stream: {
        write: (message) => logger.info(message.trim())
    }
}));

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Check database connection
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        await prisma.$queryRaw`SELECT 1`;
        await prisma.$disconnect();

        // Check Redis connection
        await redisClient.ping();

        // Check blockchain connection
        const blockchainHealth = await blockchainService.checkHealth();

        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                redis: 'connected',
                blockchain: blockchainHealth ? 'connected' : 'disconnected',
            },
            version: process.env.npm_package_version || '1.0.0',
        });
    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
        });
    }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/game', authMiddleware.authenticate, gameRoutes);
app.use('/api/achievements', authMiddleware.authenticate, achievementRoutes);
app.use('/api/certificates', authMiddleware.authenticate, certificateRoutes);
app.use('/api/leaderboard', authMiddleware.authenticate, leaderboardRoutes);
app.use('/api/dashboard', authMiddleware.authenticate, dashboardRoutes);
app.use('/api/teacher', authMiddleware.authenticate, authMiddleware.requireRole('teacher'), teacherRoutes);
app.use('/api/analytics', authMiddleware.authenticate, analyticsRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static('public'));
    
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
}

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
    });
});

// Sentry error handler (must be before other error handlers)
if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    
    try {
        await redisClient.quit();
        logger.info('Redis connection closed');
    } catch (error) {
        logger.error('Error closing Redis connection:', error);
    }
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    
    try {
        await redisClient.quit();
        logger.info('Redis connection closed');
    } catch (error) {
        logger.error('Error closing Redis connection:', error);
    }
    
    process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

// Initialize services
async function initializeServices() {
    try {
        // Initialize blockchain service
        await blockchainService.initialize();
        logger.info('Blockchain service initialized');

        // Initialize wallet service
        await walletService.initialize();
        logger.info('Wallet service initialized');

        logger.info('All services initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize services:', error);
        process.exit(1);
    }
}

// Start server
async function startServer() {
    try {
        await redisClient.connect();
        await initializeServices();
        
        app.listen(PORT, () => {
            logger.info(`SpellBloc Backend Server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Health check: http://localhost:${PORT}/health`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app;
