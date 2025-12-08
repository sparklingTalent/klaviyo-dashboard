import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Register.css';

function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [klaviyoApiKey, setKlaviyoApiKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const { API_BASE } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/clients`);
      const result = await response.json();
      
      if (result.success && result.data) {
        setClients(result.data);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setClientsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, email, password, klaviyoApiKey })
      });

      const result = await response.json();

      if (result.success) {
        setSuccess('Registration successful! Redirecting to login...');
        fetchClients();
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="container">
        <div className="register-container">
          <h1>Create Account</h1>
          <p className="subtitle">Register a new client for Klaviyo Dashboard</p>
          
          {error && <div className="error show">{error}</div>}
          {success && <div className="success show">{success}</div>}
          
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
              />
              <div className="help-text">Minimum 6 characters</div>
            </div>
            
            <div className="form-group">
              <label htmlFor="klaviyoApiKey">Klaviyo Private API Key</label>
              <input
                type="text"
                id="klaviyoApiKey"
                value={klaviyoApiKey}
                onChange={(e) => setKlaviyoApiKey(e.target.value)}
                required
                placeholder="pk_... or sk_..."
              />
              <div className="help-text">Your Klaviyo API key (starts with pk_ or sk_)</div>
            </div>
            
            <button type="submit" disabled={loading}>
              {loading ? 'Registering...' : 'Register'}
            </button>
          </form>
          
          <div className="login-link">
            Already have an account? <Link to="/">Login here</Link>
          </div>
        </div>

        <div className="clients-container">
          <h2 className="clients-title">Registered Clients</h2>
          {clientsLoading ? (
            <div className="loading-clients">Loading clients...</div>
          ) : clients.length > 0 ? (
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(client => {
                  const date = new Date(client.createdAt);
                  return (
                    <tr key={client.id}>
                      <td>{client.username}</td>
                      <td className="email">{client.email}</td>
                      <td className="date">
                        {date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="no-clients">No clients registered yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Register;

