const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
require('dotenv').config();

const DB_PATH = path.join(__dirname, 'users.json');
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
const useFirebase = Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_DATABASE_URL);
let firebaseDB = null;
let memoryDB = { users: {} };

// â"€â"€â"€ Encryption/Decryption for Sensitive Fields â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || '4a7d9f2e1b8c5a3f6e0d4b7a9c2f5e8b1d4a7f0c3e6b9d2a5f8c1e4b7a0d3f69', 'hex');

if (useFirebase) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || process.env.FIREBASE_CERT_URL
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    firebaseDB = admin.database();
    loadFirebaseDB().catch(err => console.error('Firebase initial load failed:', err.message));
    console.log('✅ Firebase initialized');
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
  }
}

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData) {
  if (!encryptedData || !encryptedData.includes(':')) return null;
  try {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error.message);
    return null;
  }
}

function initDB() {
  if (isProduction || useFirebase) return; // Skip local file operations on Vercel or when Firebase is configured
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}

function readDB() {
  if (useFirebase && firebaseDB) {
    return memoryDB;
  }
  if (isProduction) {
    return memoryDB; // Use in-memory store on Vercel
  }
  initDB();
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

async function loadFirebaseDB() {
  if (!firebaseDB) return;
  try {
    const snapshot = await firebaseDB.ref('users').once('value');
    memoryDB = { users: snapshot.val() || {} };
    console.log('✅ Firebase data loaded into memory');
  } catch (error) {
    console.error('Firebase load error:', error.message);
  }
}

async function writeFirebaseDB(data) {
  if (!firebaseDB) return;
  try {
    await firebaseDB.ref('users').set(data.users || {});
  } catch (error) {
    console.error('Firebase write error:', error.message);
  }
}

async function initDatabase() {
  if (useFirebase && firebaseDB) {
    await loadFirebaseDB();
  }
}

function writeDB(data) {
  if (useFirebase && firebaseDB) {
    memoryDB = data;
    writeFirebaseDB(data).catch(err => console.error('Async Firebase write failed:', err));
    return;
  }

  if (isProduction) {
    memoryDB = data; // Store in memory on Vercel if not using Firebase
    return;
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getUser(googleId) {
  const db = readDB();
  let user = db.users[googleId] || null;
  
  if (user) {
    // Decrypt sensitive fields
    if (user.walletPublicKey) {
      user.walletPublicKey = decrypt(user.walletPublicKey) || user.walletPublicKey;
    }
    if (user.walletPrivateKey) {
      user.walletPrivateKey = decrypt(user.walletPrivateKey) || user.walletPrivateKey;
    }
    if (user.securityPin) {
      user.securityPin = decrypt(user.securityPin) || user.securityPin;
    }
  }
  
  return user;
}

function getAllUsers() {
  const db = readDB();
  const users = {};
  Object.keys(db.users).forEach((googleId) => {
    const user = getUser(googleId);
    if (user) {
      users[googleId] = user;
    }
  });
  return users;
}

function getUserByEmail(email) {
  if (!email) return null;
  const lowerEmail = email.toLowerCase();
  return Object.values(getAllUsers()).find((user) => user.email && user.email.toLowerCase() === lowerEmail) || null;
}

function saveUser(user) {
  const db = readDB();
  
  // Create a copy to avoid modifying the original object
  const userToSave = { ...user };
  
  // Encrypt sensitive fields before saving
  if (userToSave.walletPublicKey) {
    userToSave.walletPublicKey = encrypt(userToSave.walletPublicKey);
  }
  if (userToSave.walletPrivateKey) {
    userToSave.walletPrivateKey = encrypt(userToSave.walletPrivateKey);
  }
  if (userToSave.securityPin) {
    userToSave.securityPin = encrypt(userToSave.securityPin);
  }
  
  db.users[user.googleId] = userToSave;
  writeDB(db);
  return user; // Return the original unencrypted user object
}

// Add pick purchase for user
function addPickPurchase(googleId, pickType) {
  const user = getUser(googleId);
  if (!user) return null;
  
  if (!user.picks) user.picks = {};
  if (!user.picks[pickType]) {
    user.picks[pickType] = {
      type: pickType,
      purchasedAt: new Date().toISOString(),
      attemptsToday: 0,
      lastResetDate: new Date().toISOString().split('T')[0]
    };
  }
  
  saveUser(user);
  return user.picks[pickType];
}

// Get user's purchased picks
function getUserPicks(googleId) {
  const user = getUser(googleId);
  if (!user || !user.picks) return {};
  
  // Reset daily attempts if date changed
  const today = new Date().toISOString().split('T')[0];
  const picks = user.picks;
  
  Object.keys(picks).forEach(pickType => {
    if (picks[pickType].lastResetDate !== today) {
      picks[pickType].attemptsToday = 0;
      picks[pickType].lastResetDate = today;
    }
  });
  
  if (Object.keys(picks).some(key => picks[key].lastResetDate !== today)) {
    saveUser(user);
  }
  
  return picks;
}

// Use attempt for a pick
function usePickAttempt(googleId, pickType) {
  const user = getUser(googleId);
  if (!user || !user.picks || !user.picks[pickType]) return null;
  
  const today = new Date().toISOString().split('T')[0];
  if (user.picks[pickType].lastResetDate !== today) {
    user.picks[pickType].attemptsToday = 0;
    user.picks[pickType].lastResetDate = today;
  }
  
  if (user.picks[pickType].attemptsToday < 20) {
    user.picks[pickType].attemptsToday++;
    saveUser(user);
    return user.picks[pickType];
  }
  
  return null; // No attempts left
}

// Get remaining attempts for a pick
function getPickAttempts(googleId, pickType) {
  const picks = getUserPicks(googleId);
  if (!picks[pickType]) return 0;
  
  const today = new Date().toISOString().split('T')[0];
  if (picks[pickType].lastResetDate !== today) {
    picks[pickType].attemptsToday = 0;
  }
  
  return 20 - picks[pickType].attemptsToday;
}

// Set security PIN for user (cross-device)
function setSecurityPin(googleId, pinCode) {
  const user = getUser(googleId); // This decrypts sensitive fields
  if (!user) return null;
  
  // Store PIN as base64 encoded then let saveUser() encrypt it
  user.securityPin = btoa(pinCode);
  saveUser(user); // This will encrypt the PIN
  return true;
}

// Get security PIN for user
function getSecurityPin(googleId) {
  const user = getUser(googleId); // This decrypts the PIN
  if (!user || !user.securityPin) return null;
  
  return atob(user.securityPin);
}

// Verify security PIN
function verifySecurityPin(googleId, pinCode) {
  const stored = getSecurityPin(googleId);
  return stored === pinCode;
}

// Check if user has security PIN set
function hasSecurityPin(googleId) {
  const user = getUser(googleId);
  return !!(user && user.securityPin);
}

// Store current session ID for single-session enforcement (auto-logout on other devices)
function setCurrentSessionId(googleId, sessionId) {
  const user = getUser(googleId);
  if (!user) return null;
  
  user.currentSessionId = sessionId;
  user.lastLoginTime = new Date().toISOString();
  saveUser(user);
  return true;
}

// Get current session ID for user
function getCurrentSessionId(googleId) {
  const user = getUser(googleId);
  return user?.currentSessionId || null;
}

// Verify if provided session ID is the current valid session for user
function isValidSession(googleId, sessionId) {
  const currentSessionId = getCurrentSessionId(googleId);
  return currentSessionId === sessionId;
}

// Clear session ID (for logout)
function clearSessionId(googleId) {
  const user = getUser(googleId);
  if (!user) return null;
  
  user.currentSessionId = null;
  saveUser(user);
  return true;
}

module.exports = { 
  initDatabase,
  getUser, 
  getAllUsers,
  getUserByEmail,
  saveUser, 
  addPickPurchase, 
  getUserPicks, 
  usePickAttempt, 
  getPickAttempts,
  setSecurityPin,
  getSecurityPin,
  verifySecurityPin,
  hasSecurityPin,
  setCurrentSessionId,
  getCurrentSessionId,
  isValidSession,
  clearSessionId
};
