const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = requireJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const USERS_FILE_PATH = process.env.USERS_FILE_PATH || path.join(__dirname, 'users.json');

function requireJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || !secret.trim()) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    return secret;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Simple in-memory database (in production, use a real database)
let users = [];
let userIdCounter = 1;

// Load users from file if exists
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE_PATH, 'utf8');
        const userData = JSON.parse(data);
        users = userData.users || [];
        userIdCounter = userData.counter || 1;
        console.log(`📚 Loaded ${users.length} users from database`);
    } catch (error) {
        console.log('📚 No existing user database found, starting fresh');
    }
}

// Save users to file
async function saveUsers() {
    try {
        await fs.writeFile(USERS_FILE_PATH, JSON.stringify({
            users,
            counter: userIdCounter
        }, null, 2));
    } catch (error) {
        console.error('❌ Failed to save users:', error);
    }
}

// Email service
async function sendEmail(emailData) {
    if (!RESEND_API_KEY) {
        return { success: false, skipped: true, error: 'RESEND_API_KEY is not configured' };
    }

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(emailData);
        
        const options = {
            hostname: 'api.resend.com',
            port: 443,
            path: '/emails',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve({ success: true, id: result.id, data: result });
                    } else {
                        resolve({ success: false, error: result, statusCode: res.statusCode });
                    }
                } catch (error) {
                    resolve({ success: false, error: error.message });
                }
            });
        });

        req.on('error', (error) => {
            reject({ success: false, error: error.message });
        });

        req.write(postData);
        req.end();
    });
}

function createAuthToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function toPublicUser(user) {
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

// Welcome email template
function generateWelcomeEmail(parentName, childName, childAge) {
    return {
        from: 'SpellBloc <onboarding@resend.dev>',
        subject: `🎉 Welcome to SpellBloc, ${childName}!`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Welcome to SpellBloc!</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; text-align: center; border-radius: 15px; margin-bottom: 30px; }
                    .content { background: #f8f9fa; padding: 30px; border-radius: 15px; margin-bottom: 20px; }
                    .emoji { font-size: 2em; margin: 10px; }
                    .button { display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; margin: 20px 0; font-weight: bold; }
                    .features { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 25px 0; }
                    .feature { background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .stats { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 25px; border-radius: 10px; text-align: center; margin: 20px 0; }
                    .footer { text-align: center; color: #666; font-size: 0.9em; margin-top: 30px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🎮 Welcome to SpellBloc!</h1>
                    <p>Where learning spelling is an adventure!</p>
                </div>
                
                <div class="content">
                    <h2>Hello ${parentName}! 👋</h2>
                    <p>Thank you for creating a SpellBloc account for <strong>${childName}</strong>! We're so excited to help your ${childAge}-year-old embark on their magical spelling journey.</p>
                    
                    <div class="stats">
                        <h3>🎯 Perfect for Age ${childAge}</h3>
                        <p>Our AI has automatically selected the best learning level for ${childName}, with age-appropriate words and challenges.</p>
                    </div>
                    
                    <div class="features">
                        <div class="feature">
                            <div class="emoji">🧠</div>
                            <h3>AI-Powered Learning</h3>
                            <p>Adapts to ${childName}'s learning style</p>
                        </div>
                        <div class="feature">
                            <div class="emoji">🏆</div>
                            <h3>Achievement Badges</h3>
                            <p>Earn rewards for every milestone</p>
                        </div>
                        <div class="feature">
                            <div class="emoji">📊</div>
                            <h3>Progress Tracking</h3>
                            <p>Watch ${childName}'s skills grow</p>
                        </div>
                        <div class="feature">
                            <div class="emoji">🌍</div>
                            <h3>Multi-Language</h3>
                            <p>Learn spelling in 5 languages</p>
                        </div>
                    </div>
                    
                    <h3>🚀 What's Next?</h3>
                    <ul>
                        <li><strong>Start Playing:</strong> ${childName} can begin with age-appropriate words</li>
                        <li><strong>Earn Badges:</strong> Collect achievements for spelling success</li>
                        <li><strong>Track Progress:</strong> Receive weekly email reports</li>
                        <li><strong>Have Fun:</strong> Learning spelling has never been this exciting!</li>
                    </ul>
                    
                    <div style="text-align: center;">
                        <a href="https://wordbloc.vercel.app" class="button">🎮 Start ${childName}'s Adventure!</a>
                    </div>
                </div>
                
                <div class="footer">
                    <p><strong>🎉 Welcome to the SpellBloc family!</strong></p>
                    <p>We'll send you progress updates and achievement notifications to help you celebrate ${childName}'s learning milestones.</p>
                    <p><small>Questions? Reply to this email - we're here to help!</small></p>
                </div>
            </body>
            </html>
        `,
        text: `
Welcome to SpellBloc, ${childName}!

Hello ${parentName}!

Thank you for creating a SpellBloc account for ${childName}! We're excited to help your ${childAge}-year-old learn spelling.

Perfect for Age ${childAge}:
Our AI has selected the best learning level for ${childName}, with age-appropriate words and challenges.

Features:
• AI-Powered Learning - Adapts to ${childName}'s style
• Achievement Badges - Earn rewards for milestones  
• Progress Tracking - Watch skills grow
• Multi-Language - Learn in 5 languages

What's Next:
1. Start Playing - Begin with age-appropriate words
2. Earn Badges - Collect achievements for success
3. Track Progress - Receive weekly email reports
4. Have Fun - Learning spelling is exciting!

Start playing: https://wordbloc.vercel.app

Welcome to the SpellBloc family!
We'll send you progress updates and achievement notifications.

Questions? Reply to this email - we're here to help!
        `
    };
}

// Routes

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Signup endpoint
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { parentName, parentEmail, password, childName, childAge } = req.body;
        
        // Validate input
        if (!parentName || !parentEmail || !password || !childName || !childAge) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }
        
        // Check if user already exists
        const existingUser = users.find(user => user.email === parentEmail);
        if (existingUser) {
            return res.status(400).json({ message: 'An account with this email already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const user = {
            id: userIdCounter++,
            parentName,
            email: parentEmail,
            password: hashedPassword,
            childName,
            childAge,
            createdAt: new Date().toISOString(),
            emailPreferences: {
                welcome: true,
                achievements: true,
                progress: true,
                milestones: true,
                weekly: true
            }
        };
        
        users.push(user);
        await saveUsers();
        
        // Generate JWT token
        const token = createAuthToken(user);
        
        // Send welcome email
        console.log(`📧 Sending welcome email to ${parentEmail}...`);
        try {
            const welcomeEmailData = generateWelcomeEmail(parentName, childName, childAge);
            welcomeEmailData.to = [parentEmail];
            
            const emailResult = await sendEmail(welcomeEmailData);
            
            if (emailResult.success) {
                console.log(`✅ Welcome email sent successfully! Email ID: ${emailResult.id}`);
            } else {
                console.log(`❌ Welcome email failed:`, emailResult.error);
            }
        } catch (emailError) {
            console.log(`❌ Welcome email error:`, emailError);
        }
        
        // Return user data (without password)
        const userWithoutPassword = toPublicUser(user);
        
        res.status(201).json({
            message: 'Account created successfully! Welcome email sent.',
            user: userWithoutPassword,
            token
        });
        
        console.log(`✅ New user created: ${parentName} (${parentEmail}) with child ${childName}, age ${childAge}`);
        
    } catch (error) {
        console.error('❌ Signup error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        
        // Find user
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Generate JWT token
        const token = createAuthToken(user);
        
        // Return user data (without password)
        const userWithoutPassword = toPublicUser(user);
        
        res.json({
            message: 'Login successful',
            user: userWithoutPassword,
            token
        });
        
        console.log(`✅ User logged in: ${user.parentName} (${email})`);
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Verify session endpoint (protected route)
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.userId && u.email === req.user.email);
    if (!user) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }

    res.json({ user: toPublicUser(user) });
});

// Get user profile (protected route)
app.get('/api/auth/profile', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.userId);
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(toPublicUser(user));
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Test email endpoint
app.post('/api/test-email', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        
        const testEmailData = {
            from: 'SpellBloc <onboarding@resend.dev>',
            to: [email],
            subject: '🧪 SpellBloc Backend Test Email',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px;">
                        <h1>✅ Backend Email Test Successful!</h1>
                        <p>Your SpellBloc backend server is working perfectly!</p>
                    </div>
                    <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin-top: 20px;">
                        <h2>🎮 SpellBloc Backend Status</h2>
                        <ul>
                            <li>✅ Express server running</li>
                            <li>✅ Resend API connected</li>
                            <li>✅ Email templates working</li>
                            <li>✅ Authentication system ready</li>
                        </ul>
                        <p>Your SpellBloc authentication and email system is ready for users!</p>
                    </div>
                </div>
            `,
            text: 'SpellBloc Backend Test - Email system working perfectly!'
        };
        
        const result = await sendEmail(testEmailData);
        
        if (result.success) {
            res.json({ 
                message: 'Test email sent successfully!', 
                emailId: result.id 
            });
        } else {
            res.status(500).json({ 
                message: 'Failed to send test email', 
                error: result.error 
            });
        }
        
    } catch (error) {
        console.error('❌ Test email error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get all users (for debugging - remove in production)
app.get('/api/users', authenticateToken, (req, res) => {
    if (process.env.ENABLE_DEBUG_USERS !== 'true') {
        return res.status(404).json({ message: 'Not found' });
    }

    const usersWithoutPasswords = users.map(toPublicUser);
    res.json({
        count: users.length,
        users: usersWithoutPasswords
    });
});

// Start server
async function startServer() {
    await loadUsers();
    
    return app.listen(PORT, () => {
        console.log('🚀 SpellBloc Backend Server Started!');
        console.log('=====================================');
        console.log(`📡 Server running on: http://localhost:${PORT}`);
        console.log(`🔐 Login page: http://localhost:${PORT}/login`);
        console.log(`👥 Users in database: ${users.length}`);
        console.log(`📧 Email system: Ready with Resend API`);
        console.log('=====================================');
        console.log('');
        console.log('🧪 Test endpoints:');
        console.log(`   POST http://localhost:${PORT}/api/test-email`);
        console.log(`   GET  http://localhost:${PORT}/api/users`);
        console.log('');
        console.log('🎮 Ready for SpellBloc users!');
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.loadUsers = loadUsers;
module.exports.saveUsers = saveUsers;
module.exports.requireJwtSecret = requireJwtSecret;
module.exports.__setUsersForTest = (nextUsers, nextCounter = 1) => {
    users = nextUsers;
    userIdCounter = nextCounter;
};
module.exports.__getUsersForTest = () => users;
