const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Load users from file
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Save users to file
async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving users file:', error);
    throw new Error('Failed to save user data');
  }
}

// Register a new client
async function registerClient(username, email, password, klaviyoApiKey = null, accountName = null) {
  const users = await loadUsers();
  
  // Check if user already exists
  if (users.find(u => u.email === email)) {
    throw new Error('User with this email already exists');
  }
  
  if (users.find(u => u.username === username)) {
    throw new Error('Username already taken');
  }
  
  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Create new user with klaviyoAccounts array
  // Only add account if API key is provided
  const newUser = {
    id: Date.now().toString(),
    username,
    email,
    password: hashedPassword,
    klaviyoApiKey: klaviyoApiKey || null, // Keep for backward compatibility
    klaviyoAccounts: klaviyoApiKey ? [{
      id: Date.now().toString(),
      name: accountName || 'Default Account',
      apiKey: klaviyoApiKey,
      isActive: true,
      createdAt: new Date().toISOString()
    }] : [], // Empty array if no API key provided
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  await saveUsers(users);
  
  return {
    id: newUser.id,
    username: newUser.username,
    email: newUser.email
  };
}

// Login user
async function loginUser(email, password) {
  const users = await loadUsers();
  const user = users.find(u => u.email === email);
  
  if (!user) {
    throw new Error('Invalid email or password');
  }
  
  // Verify password
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    throw new Error('Invalid email or password');
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      username: user.username 
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email
    }
  };
}

// Get user by ID
async function getUserById(userId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);
  
  if (!user) {
    return null;
  }
  
  // Migrate old format to new format if needed
  if (!user.klaviyoAccounts && user.klaviyoApiKey) {
    user.klaviyoAccounts = [{
      id: `${userId}_${Date.now()}`,
      name: 'Default Account',
      apiKey: user.klaviyoApiKey,
      isActive: true,
      createdAt: user.createdAt || new Date().toISOString()
    }];
    await saveUsers(users);
  }
  
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    klaviyoApiKey: user.klaviyoApiKey, // Keep for backward compatibility
    klaviyoAccounts: user.klaviyoAccounts || []
  };
}

// Get active Klaviyo account for a user
async function getActiveKlaviyoAccount(userId) {
  const user = await getUserById(userId);
  if (!user) return null;
  
  const accounts = user.klaviyoAccounts || [];
  const activeAccount = accounts.find(acc => acc.isActive);
  
  // If no active account, return the first one or the legacy klaviyoApiKey
  if (activeAccount) {
    return activeAccount;
  }
  
  if (accounts.length > 0) {
    return accounts[0];
  }
  
  // Fallback to legacy klaviyoApiKey
  if (user.klaviyoApiKey) {
    return {
      id: 'legacy',
      name: 'Legacy Account',
      apiKey: user.klaviyoApiKey,
      isActive: true
    };
  }
  
  return null;
}

// Add a new Klaviyo account to a user
async function addKlaviyoAccount(userId, accountName, apiKey) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);
  
  if (!user) {
    throw new Error('User not found');
  }
  
  // Initialize klaviyoAccounts if it doesn't exist
  if (!user.klaviyoAccounts) {
    user.klaviyoAccounts = [];
  }
  
  // Check if API key already exists
  if (user.klaviyoAccounts.find(acc => acc.apiKey === apiKey)) {
    throw new Error('This API key is already added');
  }
  
  // Set all existing accounts to inactive
  user.klaviyoAccounts.forEach(acc => {
    acc.isActive = false;
  });
  
  // Add new account as active
  const newAccount = {
    id: `${userId}_${Date.now()}`,
    name: accountName || 'New Account',
    apiKey: apiKey,
    isActive: true,
    createdAt: new Date().toISOString()
  };
  
  user.klaviyoAccounts.push(newAccount);
  await saveUsers(users);
  
  return newAccount;
}

// Switch active Klaviyo account
async function switchKlaviyoAccount(userId, accountId) {
  try {
    const users = await loadUsers();
    const user = users.find(u => u.id === userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Migrate old format if needed
    if (!user.klaviyoAccounts && user.klaviyoApiKey) {
      user.klaviyoAccounts = [{
        id: `${userId}_${Date.now()}`,
        name: 'Default Account',
        apiKey: user.klaviyoApiKey,
        isActive: true,
        createdAt: user.createdAt || new Date().toISOString()
      }];
    }
    
    if (!user.klaviyoAccounts || user.klaviyoAccounts.length === 0) {
      throw new Error('No Klaviyo accounts found');
    }
    
    // Find the account to activate
    const accountToActivate = user.klaviyoAccounts.find(acc => acc.id === accountId);
    if (!accountToActivate) {
      throw new Error('Account not found');
    }
    
    // Set all accounts to inactive, then activate the selected one
    user.klaviyoAccounts.forEach(acc => {
      acc.isActive = (acc.id === accountId);
    });
    
    await saveUsers(users);
    
    return accountToActivate;
  } catch (error) {
    console.error('Error in switchKlaviyoAccount:', error);
    throw error;
  }
}

// Delete a Klaviyo account
async function deleteKlaviyoAccount(userId, accountId) {
  const users = await loadUsers();
  const user = users.find(u => u.id === userId);
  
  if (!user) {
    throw new Error('User not found');
  }
  
  if (!user.klaviyoAccounts || user.klaviyoAccounts.length === 0) {
    throw new Error('No Klaviyo accounts found');
  }
  
  // Can't delete if it's the only account
  if (user.klaviyoAccounts.length === 1) {
    throw new Error('Cannot delete the only account');
  }
  
  const accountIndex = user.klaviyoAccounts.findIndex(acc => acc.id === accountId);
  if (accountIndex === -1) {
    throw new Error('Account not found');
  }
  
  const wasActive = user.klaviyoAccounts[accountIndex].isActive;
  
  // Remove the account
  user.klaviyoAccounts.splice(accountIndex, 1);
  
  // If the deleted account was active, activate the first remaining account
  if (wasActive && user.klaviyoAccounts.length > 0) {
    user.klaviyoAccounts[0].isActive = true;
  }
  
  await saveUsers(users);
  
  return { success: true };
}

// Get all users (without sensitive data)
async function getAllUsers() {
  const users = await loadUsers();
  return users.map(user => ({
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt
  }));
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

module.exports = {
  registerClient,
  loginUser,
  getUserById,
  getAllUsers,
  verifyToken,
  getActiveKlaviyoAccount,
  addKlaviyoAccount,
  switchKlaviyoAccount,
  deleteKlaviyoAccount
};


