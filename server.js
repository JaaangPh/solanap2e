require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');
const { initDatabase, getUser, getAllUsers, getUserByEmail, saveUser, addPickPurchase, getUserPicks, usePickAttempt, getPickAttempts, setSecurityPin, getSecurityPin, verifySecurityPin, hasSecurityPin, setCurrentSessionId, getCurrentSessionId, isValidSession, clearSessionId } = require('./db');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('⚠️ Google OAuth client credentials are not fully configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
}

// â”€â”€â”€ Session & Passport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(cookieSession({
  name: 'solana-session',
  keys: [process.env.SESSION_SECRET || 'solana-secret-key'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: isProduction,
  proxy: isProduction,
  httpOnly: true,
  sameSite: isProduction ? 'none' : 'lax'
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

function getAuthCallbackURL(req) {
  if (process.env.GOOGLE_CALLBACK_URL && process.env.GOOGLE_CALLBACK_URL.trim()) {
    return process.env.GOOGLE_CALLBACK_URL.replace(/\/+$/g, '').trim();
  }

  const forwardedProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  const forwardedHost = (req.headers['x-forwarded-host'] || req.headers.host || req.get('host') || '').toString().trim();
  const protocol = isProduction
    ? (forwardedProto || 'https')
    : req.protocol;
  const host = forwardedHost.replace(/\/+$/g, '') || (process.env.VERCEL_URL || '').replace(/\/+$/g, '');

  return `${protocol}://${host}/auth/google/callback`;
}

// â”€â”€â”€ Passport Google OAuth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const googleId = profile.id;
    let user = getUser(googleId);

    if (!user) {
      const mnemonic = bip39.generateMnemonic(128);
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
      const keypair = Keypair.fromSeed(derived.key);
      const secretKeyBase58 = bs58.encode(Buffer.from(keypair.secretKey));

      user = {
        googleId,
        name: profile.displayName,
        email: profile.emails?.[0]?.value || '',
        avatar: profile.photos?.[0]?.value || '',
        walletPublicKey: keypair.publicKey.toBase58(),
        walletPrivateKey: secretKeyBase58,
        seedPhrase: mnemonic,
        createdAt: new Date().toISOString(),
      };
      saveUser(user);
      console.log(`âœ… New user: ${user.email} â†’ wallet ${user.walletPublicKey}`);
    } else {
      console.log(`ðŸ”„ Returning user: ${user.email} â†’ wallet ${user.walletPublicKey}`);
      user.name = profile.displayName || user.name;
      user.avatar = profile.photos?.[0]?.value || user.avatar;
      saveUser(user);
    }

    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.googleId));
passport.deserializeUser((googleId, done) => {
  const user = getUser(googleId);
  if (!user) {
    console.warn(`⚠️ deserializeUser: no user found for googleId=${googleId}`);
    return done(null, false); // forces re-login instead of silent loop
  }
  done(null, user);
});

app.use((req, res, next) => {
  if (req.isAuthenticated() && !req.user && req.session?.passport?.user) {
    req.user = getUser(req.session.passport.user);
  }
  next();
});

// â"€â"€â"€ Session Validation Middleware (enforce single-session per device) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const validateSession = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Check if this session ID is still valid (device login enforcement)
  const storedSessionId = getCurrentSessionId(req.user.googleId);
  const currentSessionId = req.session.sessionId || null;
  if (storedSessionId && storedSessionId !== currentSessionId) {
    console.log(`🔐 Session mismatch for ${req.user.email}: stored=${storedSessionId}, current=${currentSessionId}`);
    // Logout this old session
    req.logout((err) => {
      if (err) console.error('Logout error:', err);
      return res.status(401).json({ error: 'Session expired. You logged in from another device. Please login again.' });
    });
    return;
  }
  
  next();
};

const ADMIN_EMAIL = 'ghostnetwork30@gmail.com';
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

app.use('/admin.html', validateSession, (req, res, next) => {
  if (!req.user || req.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.redirect('/dashboard?error=forbidden');
  }
  next();
});

// â”€â”€â”€ Auth Routes

app.get('/auth/google', (req, res, next) => {
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    callbackURL: getAuthCallbackURL(req)
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', {
    failureRedirect: '/?error=auth_failed',
    callbackURL: getAuthCallbackURL(req)
  })(req, res, next);
},
  (req, res) => {
    // Ensure cookie-session has a stable session ID
    if (!req.session.sessionId) {
      req.session.sessionId = crypto.randomBytes(16).toString('hex');
    }

    // Store current session ID to enforce single-session per device
    setCurrentSessionId(req.user.googleId, req.session.sessionId);
    console.log(`📱 Session ID stored for ${req.user?.email}: ${req.session.sessionId}`);
    
    res.redirect('/dashboard');
  }
);

app.get('/auth/logout', (req, res) => {
  if (req.user) {
    clearSessionId(req.user.googleId);
    console.log(`🚪 Session cleared for ${req.user?.email}`);
  }
  req.logout(() => res.redirect('/'));
});

// â”€â”€â”€ API Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/me', validateSession, (req, res) => {
  const { googleId, walletPublicKey, name, email, avatar, createdAt, seedPhrase, walletPrivateKey } = req.user;
  res.json({
    googleId, walletPublicKey, name, email, avatar, createdAt,
    network: process.env.SOLANA_NETWORK || 'mainnet-beta',
    seedPhrase, walletPrivateKey,
    storeWallet: process.env.STORE_WALLET_ADDRESS || 'YOUR_STORE_WALLET_ADDRESS_HERE'
  });
});

// â"€â"€â"€ Security PIN Management (cross-device) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/has-security-pin', validateSession, (req, res) => {
  const hasPinSet = hasSecurityPin(req.user.googleId);
  res.json({ hasPinSet });
});

app.post('/api/set-security-pin', express.json(), validateSession, (req, res) => {
  const { pinCode } = req.body;
  if (!pinCode || !/^\d{6}$/.test(pinCode)) {
    return res.status(400).json({ error: 'Invalid PIN. Must be 6 digits.' });
  }
  
  try {
    setSecurityPin(req.user.googleId, pinCode);
    res.json({ success: true, message: 'Security PIN saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verify-security-pin', express.json(), validateSession, (req, res) => {
  const { pinCode } = req.body;
  if (!pinCode || !/^\d{6}$/.test(pinCode)) {
    return res.status(400).json({ error: 'Invalid PIN format' });
  }
  
  try {
    const isValid = verifySecurityPin(req.user.googleId, pinCode);
    if (!isValid) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }
    res.json({ success: true, message: 'PIN verified' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// â"€â"€â"€ Marketplace Configuration â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/marketplace-config', (req, res) => {
  res.json({
    storeWallet: process.env.STORE_WALLET_ADDRESS || 'YOUR_STORE_WALLET_ADDRESS_HERE',
    picks: {
      rock: { name: 'ROCK', price: 0.3 },
      paper: { name: 'PAPER', price: 0.3 },
      scissors: { name: 'SCISSORS', price: 0.3 }
    }
  });
});

// â"€â"€â"€ Picks Management â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/my-picks', validateSession, (req, res) => {
  const picks = getUserPicks(req.user.googleId);
  const formattedPicks = [];
  
  Object.keys(picks).forEach(pickType => {
    const pick = picks[pickType];
    formattedPicks.push({
      type: pickType,
      name: pickType.toUpperCase(),
      purchasedAt: pick.purchasedAt,
      attemptsUsed: pick.attemptsToday,
      attemptsRemaining: 20 - pick.attemptsToday,
      totalAttempts: 20
    });
  });
  
  res.json({ picks: formattedPicks, hasPicks: formattedPicks.length > 0 });
});

app.post('/api/purchase-pick', express.json(), validateSession, (req, res) => {
  const { pickType } = req.body;
  if (!pickType || !['rock', 'paper', 'scissors'].includes(pickType)) {
    return res.status(400).json({ error: 'Invalid pick type' });
  }
  
  const result = addPickPurchase(req.user.googleId, pickType);
  
  if (result) {
    // Update user data in current session
    const user = getUser(req.user.googleId);
    req.user.picks = user.picks;
    res.json({ success: true, pick: result });
  } else {
    res.status(500).json({ error: 'Failed to purchase pick' });
  }
});

app.post('/api/use-pick-attempt', express.json(), validateSession, (req, res) => {
  const { pickType } = req.body;
  if (!pickType) return res.status(400).json({ error: 'Missing pick type' });
  
  const pick = getUserPicks(req.user.googleId)[pickType];
  if (!pick) return res.status(404).json({ error: 'Pick not found' });
  
  if (pick.attemptsToday >= 20) {
    return res.status(403).json({ error: 'No attempts remaining for today' });
  }
  
  const result = usePickAttempt(req.user.googleId, pickType);
  
  if (result) {
    const remaining = 20 - result.attemptsToday;
    res.json({ success: true, attemptsUsed: result.attemptsToday, attemptsRemaining: remaining });
  } else {
    res.status(500).json({ error: 'Failed to use attempt' });
  }
});

app.get('/api/check-arena-access', validateSession, (req, res) => {
  const picks = getUserPicks(req.user.googleId);
  const totalAttemptsRemaining = Object.values(picks).reduce((sum, pick) => {
    const remaining = Math.max(0, 20 - (pick.attemptsToday || 0));
    return sum + remaining;
  }, 0);
  const canAccessArena = totalAttemptsRemaining > 0;

  res.json({ canAccessArena, totalAttemptsRemaining, picks });
});

app.get('/admin', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  if (!req.user || req.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.redirect('/dashboard?error=forbidden');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  if (!req.user || req.user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.redirect('/dashboard?error=forbidden');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/check', validateSession, adminOnly, (req, res) => {
  res.json({ isAdmin: true });
});

app.get('/api/admin/users', validateSession, adminOnly, (req, res) => {
  const users = getAllUsers();
  const safeUsers = Object.fromEntries(
    Object.entries(users).map(([googleId, user]) => [
      googleId,
      {
        googleId: user.googleId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        createdAt: user.createdAt,
        picks: user.picks || {},
        currentSessionId: user.currentSessionId,
        lastLoginTime: user.lastLoginTime
      }
    ])
  );
  res.json({ users: safeUsers });
});

app.post('/api/admin/give-picks', express.json(), validateSession, adminOnly, (req, res) => {
  const { email, picks } = req.body;
  if (!email || !picks || !Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: 'Email and pick selections are required' });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: `User not found for email ${email}` });
  }

  if (!user.picks) {
    user.picks = {};
  }

  picks.forEach((pickType) => {
    if (!pickType || typeof pickType !== 'string') return;
    if (!user.picks[pickType]) {
      user.picks[pickType] = {
        type: pickType,
        purchasedAt: new Date().toISOString(),
        attemptsToday: 0,
        lastResetDate: new Date().toISOString().split('T')[0]
      };
    }
  });

  saveUser(user);
  res.json({ success: true, message: `Added picks to ${email}`, picks: Object.keys(user.picks) });
});

app.get('/api/balance/:address', async (req, res) => {
  try {
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const rpcUrl = network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.testnet.solana.com';

    const connection = new Connection(rpcUrl, 'confirmed');
    const pubkey = new PublicKey(req.params.address);
    const balance = await connection.getBalance(pubkey);
    res.json({ balance: balance / LAMPORTS_PER_SOL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/blockhash', async (req, res) => {
  try {
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const rpcUrl = network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.testnet.solana.com';

    const connection = new Connection(rpcUrl, 'confirmed');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    res.json({ blockhash, lastValidBlockHeight, rpcUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prepare-deposit', express.json(), async (req, res) => {
  try {
    const { fromPubkey, toPubkey, lamports } = req.body;
    if (!fromPubkey || !toPubkey || !lamports) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const rpcUrl = network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.testnet.solana.com';

    const connection = new Connection(rpcUrl, 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: new PublicKey(fromPubkey)
    }).add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(fromPubkey),
        toPubkey: new PublicKey(toPubkey),
        lamports
      })
    );

    const serialized = transaction.serialize({ requireAllSignatures: false });
    res.json({
      transaction: serialized.toString('base64'),
      rpcUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-transaction', express.json(), async (req, res) => {
  try {
    const { transaction } = req.body;
    if (!transaction) return res.status(400).json({ error: 'Missing transaction' });

    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const rpcUrl = network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.testnet.solana.com';

    const connection = new Connection(rpcUrl, 'confirmed');
    const txBuffer = Buffer.from(transaction, 'base64');
    const tx = Transaction.from(txBuffer);

    const signature = await connection.sendRawTransaction(tx.serialize());
    res.json({ signature });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/price/:currency?', async (req, res) => {
  try {
    const currency = req.params.currency || 'usd';
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=${currency}`
    );
    const data = await response.json();
    res.json({ price: data.solana?.[currency] || 0, currency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Page Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/dashboard.html', (req, res) => {
  return res.redirect('/dashboard');
});

app.get('/arena.html', validateSession, (req, res) => {
  return res.redirect('/arena');
});

app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/dashboard.html');
});

app.get('/arena', validateSession, (req, res) => {
  const storedSessionId = getCurrentSessionId(req.user.googleId);
  const currentSessionId = req.session?.sessionId || null;
  if (storedSessionId && storedSessionId !== currentSessionId) {
    console.log(`🔐 Arena access denied: session mismatch for ${req.user.email}`);
    return res.redirect('/?error=session_expired');
  }

  const picks = getUserPicks(req.user.googleId);
  const totalAttemptsRemaining = Object.values(picks).reduce((sum, pick) => {
    const remaining = Math.max(0, 20 - (pick.attemptsToday || 0));
    return sum + remaining;
  }, 0);

  if (Object.keys(picks).length === 0) {
    console.log(`❌ Arena access denied: no picks for ${req.user.email}`);
    return res.redirect('/dashboard?error=no_picks');
  }

  if (totalAttemptsRemaining <= 0) {
    console.log(`❌ Arena access denied: no remaining attempts for ${req.user.email}`);
    return res.redirect('/dashboard?error=no_attempts');
  }

  res.sendFile(__dirname + '/public/arena.html');
});

app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/profile.html');
});

app.get('/settings', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/settings.html');
});

app.get('/security', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/security.html');
});

app.get('/securityy', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.redirect('/security');
});

app.get('/marketplace', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/marketplace.html');
});

app.get('/leaderboard', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  res.sendFile(__dirname + '/public/leaderboard.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startServer() {
  try {
    await initDatabase();
  } catch (error) {
    console.error('Database initialization failed:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`\nðŸš€ Server running at http://localhost:${PORT}`);
    console.log(`ðŸ“¡ Solana network: ${process.env.SOLANA_NETWORK || 'mainnet-beta'}\n`);
  });
}

startServer();