import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Ensure API_BASE always includes /api
let apiBase = window.__API_BASE__ || '/api';
// If it's a full URL (starts with http) and doesn't end with /api, append it
if (apiBase.startsWith('http')) {
  // Remove trailing slash if present
  apiBase = apiBase.replace(/\/$/, '');
  // Append /api if not already present
  if (!apiBase.endsWith('/api')) {
    apiBase = `${apiBase}/api`;
  }
}
const API_BASE = apiBase;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  });

  const login = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const isAuthenticated = () => {
    return !!token;
  };

  const getAuthHeaders = () => {
    if (!token) return {};
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const authenticatedFetch = async (url, options = {}) => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...options.headers
      }
    });

    if (response.status === 401) {
      logout();
      window.location.href = '/';
      throw new Error('Session expired');
    }

    return response;
  };

  return (
    <AuthContext.Provider value={{
      token,
      user,
      login,
      logout,
      isAuthenticated,
      getAuthHeaders,
      authenticatedFetch,
      API_BASE
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

