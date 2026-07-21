const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const walletService = require('../services/walletService');
const { EntitlementService } = require('../services/entitlementService');
const winston = require('winston');

const router = express.Router();
const prisma = new PrismaClient();
const entitlementService = new EntitlementService({ prisma });

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'auth-routes' },
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/auth.log' })
    ]
});

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user exists
        let user = await prisma.user.findUnique({
            where: { googleId: profile.id }
        });

        if (user) {
            // Update last login
            user = await prisma.user.update({
                where: { id: user.id },
                data: { lastLogin: new Date() }
            });
            return done(null, user);
        }

        // Check if user exists with same email
        user = await prisma.user.findUnique({
            where: { email: profile.emails[0].value }
        });

        if (user) {
            // Link Google account to existing user
            user = await prisma.user.update({
                where: { id: user.id },
                data: { 
                    googleId: profile.id,
                    emailVerified: true,
                    lastLogin: new Date()
                }
            });
            return done(null, user);
        }

        // Create new user
        user = await prisma.user.create({
            data: {
                email: profile.emails[0].value,
                name: profile.displayName,
                googleId: profile.id,
                emailVerified: true,
                privacyConsent: true, // Assumed for OAuth users
                lastLogin: new Date()
            }
        });

        // Create wallet for new user
        try {
            await walletService.createParentWallet(user.id);
        } catch (walletError) {
            logger.error('Failed to create wallet for new Google user:', walletError);
        }

        logger.info(`New user registered via Google: ${user.email}`);
        return done(null, user);
    } catch (error) {
        logger.error('Google OAuth error:', error);
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        let user = await prisma.user.findUnique({
            where: { id },
            include: {
                children: true,
                wallet: true
            }
        });
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Helper function to generate JWT tokens
function generateTokens(user) {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h'
    });

    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    });

    return { accessToken, refreshToken };
}

// Register endpoint
router.post('/register', authLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('role').optional().isIn(['parent', 'teacher']),
    body('privacyConsent').equals('true'),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password, name, role = 'parent', privacyConsent } = req.body;

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(409).json({
                error: 'User already exists with this email'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                email,
                name,
                passwordHash,
                role: role.toUpperCase(),
                privacyConsent: privacyConsent === 'true',
                emailVerified: false
            }
        });

        // Create wallet for new user
        try {
            await walletService.createParentWallet(user.id);
        } catch (walletError) {
            logger.error('Failed to create wallet for new user:', walletError);
        }

        // Generate tokens
        const tokens = generateTokens(user);

        // Set refresh token as httpOnly cookie
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        logger.info(`New user registered: ${email}`);

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                emailVerified: user.emailVerified
            },
            accessToken: tokens.accessToken
        });
    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            error: 'Registration failed',
            message: 'An error occurred during registration'
        });
    }
});

// Login endpoint
router.post('/login', authLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                children: true,
                wallet: true
            }
        });

        if (!user || !user.passwordHash) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Generate tokens
        const tokens = generateTokens(user);

        // Set refresh token as httpOnly cookie
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        logger.info(`User logged in: ${email}`);

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                emailVerified: user.emailVerified,
                subscriptionType: user.subscriptionType,
                children: user.children.map(child => ({
                    id: child.id,
                    name: child.name,
                    age: child.age,
                    avatar: child.avatar
                }))
            },
            accessToken: tokens.accessToken
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed',
            message: 'An error occurred during login'
        });
    }
});

// Google OAuth routes
router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email']
}));

router.get('/google/callback', 
    passport.authenticate('google', { session: false }),
    async (req, res) => {
        try {
            const user = req.user;
            const tokens = generateTokens(user);

            // Set refresh token as httpOnly cookie
            res.cookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            // Redirect to frontend with access token
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/auth/callback?token=${tokens.accessToken}`);
        } catch (error) {
            logger.error('Google callback error:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/auth/error`);
        }
    }
);

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({
                error: 'Refresh token not provided'
            });
        }

        // Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        
        // Get user
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });

        if (!user) {
            return res.status(401).json({
                error: 'User not found'
            });
        }

        // Generate new tokens
        const tokens = generateTokens(user);

        // Set new refresh token
        res.cookie('refreshToken', tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({
            accessToken: tokens.accessToken
        });
    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(401).json({
            error: 'Invalid refresh token'
        });
    }
});

// Logout endpoint
router.post('/logout', (req, res) => {
    res.clearCookie('refreshToken');
    res.json({
        message: 'Logged out successfully'
    });
});

// Get current user
router.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                error: 'No token provided'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        let user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                children: {
                    include: {
                        wallet: true
                    }
                },
                wallet: true
            }
        });

        if (!user) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Session start is a chain re-check; persisted client values never grant premium.
        try { await entitlementService.syncUser(user.id); user = await prisma.user.findUnique({ where: { id: user.id }, include: { children: { include: { wallet: true } }, wallet: true } }); }
        catch (error) { logger.warn(`Entitlement sync skipped: ${error.message}`); }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                emailVerified: user.emailVerified,
                subscriptionType: user.subscriptionType,
                subscriptionExpiresAt: user.subscriptionExpiresAt,
                children: user.children.map(child => ({
                    id: child.id,
                    name: child.name,
                    age: child.age,
                    avatar: child.avatar,
                    currentLevel: child.currentLevel,
                    totalStars: child.totalStars,
                    walletAddress: child.wallet?.walletAddress
                })),
                walletAddress: user.wallet?.walletAddress
            }
        });
    } catch (error) {
        logger.error('Get user error:', error);
        res.status(401).json({
            error: 'Invalid token'
        });
    }
});

// Create child profile
router.post('/child', [
    body('name').trim().isLength({ min: 1, max: 100 }),
    body('age').isInt({ min: 2, max: 12 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { name, age, avatar, gradeLevel, languagePreference } = req.body;

        // Create child
        const child = await prisma.child.create({
            data: {
                parentId: decoded.userId,
                name,
                age,
                avatar,
                gradeLevel,
                languagePreference: languagePreference || 'en'
            }
        });

        // Create wallet for child
        try {
            await walletService.createChildWallet(child.id);
        } catch (walletError) {
            logger.error('Failed to create wallet for new child:', walletError);
        }

        logger.info(`New child profile created: ${name} (age ${age})`);

        res.status(201).json({
            message: 'Child profile created successfully',
            child: {
                id: child.id,
                name: child.name,
                age: child.age,
                avatar: child.avatar,
                currentLevel: child.currentLevel,
                totalStars: child.totalStars
            }
        });
    } catch (error) {
        logger.error('Create child error:', error);
        res.status(500).json({
            error: 'Failed to create child profile'
        });
    }
});

// Verify email endpoint
router.post('/verify-email', [
    body('token').notEmpty()
], async (req, res) => {
    try {
        const { token } = req.body;
        
        // In a real implementation, you would verify the email token
        // For now, we'll just mark the user as verified
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        await prisma.user.update({
            where: { id: decoded.userId },
            data: { emailVerified: true }
        });

        res.json({
            message: 'Email verified successfully'
        });
    } catch (error) {
        logger.error('Email verification error:', error);
        res.status(400).json({
            error: 'Invalid verification token'
        });
    }
});

// Password reset request
router.post('/forgot-password', [
    body('email').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await prisma.user.findUnique({
            where: { email }
        });

        // Always return success to prevent email enumeration
        res.json({
            message: 'If an account with that email exists, a password reset link has been sent.'
        });

        if (user) {
            // In a real implementation, send password reset email
            logger.info(`Password reset requested for: ${email}`);
        }
    } catch (error) {
        logger.error('Password reset error:', error);
        res.status(500).json({
            error: 'Failed to process password reset request'
        });
    }
});

module.exports = router;
