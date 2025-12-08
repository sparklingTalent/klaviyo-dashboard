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
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Register a new client
async function registerClient(username, email, password, klaviyoApiKey) {
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
  
  // Create new user
  const newUser = {
    id: Date.now().toString(),
    username,
    email,
    password: hashedPassword,
    klaviyoApiKey,
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
  
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    klaviyoApiKey: user.klaviyoApiKey
  };
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
  verifyToken
};


