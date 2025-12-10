import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Dashboard.css';

// Helper function to format currency
function formatCurrency(amount, currency = 'USD') {
  const currencySymbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CHF': 'CHF',
    'CAD': 'C$',
    'AUD': 'A$',
    'NZD': 'NZ$',
  
    // Middle East / Gulf
    'AED': 'AED',
    'SAR': 'SAR',
    'QAR': 'QAR',
    'BHD': 'BHD',
    'KWD': 'KWD',
    'OMR': 'OMR',
  
    // Americas
    'ARS': '$',
    'BOB': 'Bs.',
    'BRL': 'R$',
    'CLP': '$',
    'COP': '$',
    'CRC': '₡',
    'DOP': 'RD$',
    'GTQ': 'Q',
    'HNL': 'L',
    'MXN': '$',
    'NIO': 'C$',
    'PAB': 'B/.',
    'PEN': 'S/',
    'PYG': '₲',
    'UYU': '$U',
    'VES': 'Bs.',
  
    // Africa
    'ZAR': 'R',
    'EGP': 'E£',
    'KES': 'KSh',
    'NGN': '₦',
    'MAD': 'د.م.',
    'TND': 'د.ت',
    'UGX': 'USh',
    'GHS': '₵',
    'RWF': 'FRw',
  
    // Asia
    'CNY': '¥',
    'HKD': 'HK$',
    'TWD': 'NT$',
    'KRW': '₩',
    'INR': '₹',
    'IDR': 'Rp',
    'PHP': '₱',
    'THB': '฿',
    'VND': '₫',
    'MYR': 'RM',
    'SGD': 'S$',
    'PKR': '₨',
    'BDT': '৳',
    'LKR': 'Rs',
    'NPR': 'Rs',
    'MMK': 'K',
    'KHR': '៛',
    'LAK': '₭',
    'MNT': '₮',
    'KZT': '₸',
    'UZS': "so'm",
    'AZN': '₼',
    'AMD': '֏',
    'GEL': '₾',
    'IRR': '﷼',
    'IQD': 'ع.د',
    'ILS': '₪',
  
    // Europe
    'RUB': '₽',
    'UAH': '₴',
    'PLN': 'zł',
    'CZK': 'Kč',
    'HUF': 'Ft',
    'RON': 'lei',
    'BGN': 'лв',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'ISK': 'kr',
    'RSD': 'дин',
    'MKD': 'ден',
    'BAM': 'KM',
    'MDL': 'L',
    // HRK removed (Croatia uses EUR since 2023)
  
    // Caribbean & small nations
    'XCD': '$',
    'BBD': '$',
    'BSD': '$',
    'BMD': '$',
    'BZD': '$',
    'GYD': '$',
    'JMD': '$',
    'TTD': '$',
  
    // Pacific
    'FJD': '$',
    'PGK': 'K',
    'SBD': '$',
    'WST': 'T',
    'TOP': 'T$',
    'VUV': 'Vt',
  
    // CFA regions
    'XOF': 'CFA',
    'XAF': 'FCFA',
    'XPF': '₣'
  };
  
  
  const symbol = currencySymbols[currency] || currency + ' ';
  const formattedAmount = parseFloat(amount).toFixed(2);
  
  // For currencies like AED, CHF, put symbol before amount
  if (currency === 'AED' || currency === 'CHF' || currency === 'XOF' || currency === 'XAF' || currency === 'XPF') {
    return `${symbol}${formattedAmount}`;
  }
  
  // For most currencies, put symbol before amount
  return `${symbol}${formattedAmount}`;
}

function Dashboard() {
  const { user, logout, authenticatedFetch, API_BASE } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [flows, setFlows] = useState([]);
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    campaignRevenue: 0,
    flowRevenue: 0,
    campaignCount: 0,
    flowCount: 0,
    campaignPercentage: 0,
    flowPercentage: 0
  });
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState({
    campaigns: true,
    flows: false,
    summary: false
  });
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountKey, setNewAccountKey] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState(null);
  const hasFetchedRef = useRef(false);

  // Fetch accounts on mount
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const response = await authenticatedFetch(`${API_BASE}/klaviyo-accounts`);
        const result = await response.json();
        if (result.success) {
          setAccounts(result.accounts || []);
          const active = result.accounts?.find(acc => acc.isActive) || result.accounts?.[0];
          setActiveAccount(active);
        }
      } catch (error) {
        console.error('Error loading accounts:', error);
      }
    };
    loadAccounts();
  }, []);

  // Close account menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showAccountMenu && !event.target.closest('.account-switcher')) {
        setShowAccountMenu(false);
      }
    };

    if (showAccountMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showAccountMenu]);

  useEffect(() => {
    // Prevent duplicate calls
    if (hasFetchedRef.current) {
      return;
    }
    
    hasFetchedRef.current = true;
    
    // Fetch all data from single endpoint
    const loadData = async () => {
      try {
        setLoading(prev => ({ ...prev, campaigns: true, flows: true, summary: true }));
        
        const response = await authenticatedFetch(`${API_BASE}/revenue/total`);
        const result = await response.json();
        
        if (result.success) {
          // Filter campaigns: only show "Sent" status
          const sentCampaigns = (result.campaigns || []).filter(campaign => {
            const status = campaign.status || '';
            return status.toLowerCase() === 'sent';
          });
          
          // Filter flows: only show "Live" status
          const liveFlows = (result.flows || []).filter(flow => {
            const status = flow.status || '';
            return status.toLowerCase() === 'live';
          });
          
          // Set campaigns and flows from the response
          setCampaigns(sentCampaigns);
          setFlows(liveFlows);
          
          // Calculate campaign and flow table revenue (using filtered data)
          const campaignTableRevenue = sentCampaigns.reduce((sum, campaign) => {
            return sum + (campaign.revenue || 0);
          }, 0);
          
          const flowTableRevenue = liveFlows.reduce((sum, flow) => {
            return sum + (flow.revenue || 0);
          }, 0);
          
          // Calculate percentages
          const totalRevenue = result.totalRevenue || 0;
          const campaignPercentage = totalRevenue > 0 
            ? ((campaignTableRevenue / totalRevenue) * 100).toFixed(1)
            : '0.0';
          const flowPercentage = totalRevenue > 0 
            ? ((flowTableRevenue / totalRevenue) * 100).toFixed(1)
            : '0.0';
          
          // Set currency
          setCurrency(result.currency || 'USD');
          
          // Set summary (with percentages)
          setSummary({
            totalRevenue: totalRevenue,
            campaignRevenue: campaignTableRevenue,
            flowRevenue: flowTableRevenue,
            campaignCount: result.totalCampaigns || 0,
            flowCount: result.totalFlows || 0,
            campaignPercentage,
            flowPercentage
          });
        } else {
          setError('Failed to load data: ' + (result.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setError('Error loading data: ' + error.message);
      } finally {
        setLoading(prev => ({ ...prev, campaigns: false, flows: false, summary: false }));
      }
    };
    
    loadData();
  }, [activeAccount]);

  const handleSwitchAccount = async (accountId) => {
    if (!accountId) {
      setError('Please select a valid account');
      return;
    }
    
    // IMMEDIATELY reset all data and show loading state
    setCampaigns([]);
    setFlows([]);
    setSummary({
      totalRevenue: 0,
      campaignRevenue: 0,
      flowRevenue: 0,
      campaignCount: 0,
      flowCount: 0,
      campaignPercentage: '0.0',
      flowPercentage: '0.0'
    });
    setLoading({
      campaigns: true,
      flows: true,
      summary: true
    });
    setError(''); // Clear previous errors
    hasFetchedRef.current = false;
    
    try {
      const response = await authenticatedFetch(`${API_BASE}/klaviyo-accounts/${accountId}/switch`, {
        method: 'PUT'
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to switch account' }));
        throw new Error(errorData.error || 'Failed to switch account');
      }
      
      const result = await response.json();
      if (result.success) {
        setActiveAccount(result.account);
        // Update accounts list
        const updatedAccounts = accounts.map(acc => ({
          ...acc,
          isActive: acc.id === accountId
        }));
        setAccounts(updatedAccounts);
        
        // Fetch fresh data for the new account
        try {
          const dataResponse = await authenticatedFetch(`${API_BASE}/revenue/total`);
          const dataResult = await dataResponse.json();
          
          if (dataResult.success) {
            // Filter campaigns: only show "Sent" status
            const sentCampaigns = (dataResult.campaigns || []).filter(campaign => {
              const status = campaign.status || '';
              return status.toLowerCase() === 'sent';
            });
            
            // Filter flows: only show "Live" status
            const liveFlows = (dataResult.flows || []).filter(flow => {
              const status = flow.status || '';
              return status.toLowerCase() === 'live';
            });
            
            setCampaigns(sentCampaigns);
            setFlows(liveFlows);
            
            const campaignTableRevenue = sentCampaigns.reduce((sum, campaign) => {
              return sum + (campaign.revenue || 0);
            }, 0);
            
            const flowTableRevenue = liveFlows.reduce((sum, flow) => {
              return sum + (flow.revenue || 0);
            }, 0);
            
            // Calculate percentages
            const totalRevenue = dataResult.totalRevenue || 0;
            const campaignPercentage = totalRevenue > 0 
              ? ((campaignTableRevenue / totalRevenue) * 100).toFixed(1)
              : '0.0';
            const flowPercentage = totalRevenue > 0 
              ? ((flowTableRevenue / totalRevenue) * 100).toFixed(1)
              : '0.0';
            
            // Set currency
            setCurrency(dataResult.currency || 'USD');
            
            setSummary({
              totalRevenue: totalRevenue,
              campaignRevenue: campaignTableRevenue,
              flowRevenue: flowTableRevenue,
              campaignCount: dataResult.totalCampaigns || 0,
              flowCount: dataResult.totalFlows || 0,
              campaignPercentage,
              flowPercentage
            });
          } else {
            setError(dataResult.error || 'Failed to load data for the new account');
          }
        } catch (dataError) {
          console.error('Error reloading data after account switch:', dataError);
          setError('Failed to load data: ' + (dataError.message || 'Unknown error'));
        } finally {
          setLoading({
            campaigns: false,
            flows: false,
            summary: false
          });
        }
      } else {
        throw new Error(result.error || 'Failed to switch account');
      }
    } catch (error) {
      console.error('Error switching account:', error);
      setError('Failed to switch account: ' + (error.message || 'Unknown error'));
      // Reset dropdown to previous selection
      if (activeAccount) {
        const select = document.querySelector('.account-select');
        if (select) {
          select.value = activeAccount.id;
        }
      }
      // Reset loading state on error
      setLoading({
        campaigns: false,
        flows: false,
        summary: false
      });
    }
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newAccountKey.trim()) {
      setError('API key is required');
      return;
    }
    
    setAddingAccount(true);
    try {
      const response = await authenticatedFetch(`${API_BASE}/klaviyo-accounts`, {
        method: 'POST',
        body: JSON.stringify({
          accountName: newAccountName.trim() || 'New Account',
          apiKey: newAccountKey.trim()
        })
      });
      const result = await response.json();
      if (result.success) {
        setAccounts([...accounts, result.account]);
        setActiveAccount(result.account);
        setShowAddAccountModal(false);
        setNewAccountName('');
        setNewAccountKey('');
        // Reload data
        hasFetchedRef.current = false;
        window.location.reload();
      } else {
        setError(result.error || 'Failed to add account');
      }
    } catch (error) {
      console.error('Error adding account:', error);
      setError('Failed to add account: ' + error.message);
    } finally {
      setAddingAccount(false);
    }
  };

  const handleDeleteAccount = async (accountId) => {
    if (accounts.length <= 1) {
      setError('Cannot delete the only account. Please add another account first.');
      return;
    }
    
    if (!window.confirm(`Are you sure you want to delete "${accounts.find(acc => acc.id === accountId)?.name || 'this account'}"? This action cannot be undone.`)) {
      return;
    }
    
    setDeletingAccountId(accountId);
    try {
      const response = await authenticatedFetch(`${API_BASE}/klaviyo-accounts/${accountId}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (result.success) {
        const updatedAccounts = accounts.filter(acc => acc.id !== accountId);
        setAccounts(updatedAccounts);
        setShowAccountMenu(false);
        
        if (updatedAccounts.length > 0) {
          // If we deleted the active account, switch to the first remaining one
          if (activeAccount?.id === accountId) {
            await handleSwitchAccount(updatedAccounts[0].id);
          } else {
            setActiveAccount(activeAccount);
          }
        }
      } else {
        setError(result.error || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      setError('Failed to delete account: ' + (error.message || 'Unknown error'));
    } finally {
      setDeletingAccountId(null);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="container">
        <div className="header">
          <h1>Email Attribution Dashboard</h1>
          <div className="user-info">
            {accounts.length > 0 ? (
              <div className="account-switcher">
                <div className="account-select-wrapper">
                  <select 
                    value={activeAccount?.id || ''} 
                    onChange={(e) => handleSwitchAccount(e.target.value)}
                    className="account-select"
                  >
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} {account.isActive ? '(Active)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="account-menu-btn"
                    onClick={() => setShowAccountMenu(!showAccountMenu)}
                    title="Manage accounts"
                  >
                    ⋮
                  </button>
                </div>
                {showAccountMenu && (
                  <div className="account-menu">
                    <div className="account-menu-header">
                      <span>Manage Accounts</span>
                      <button 
                        className="close-menu-btn"
                        onClick={() => setShowAccountMenu(false)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="account-list">
                      {accounts.map(account => (
                        <div 
                          key={account.id} 
                          className={`account-item ${account.isActive ? 'active' : ''}`}
                        >
                          <div className="account-info">
                            <span className="account-name">{account.name}</span>
                            {account.isActive && <span className="active-badge">Active</span>}
                          </div>
                          <button
                            className="delete-account-btn"
                            onClick={() => handleDeleteAccount(account.id)}
                            disabled={deletingAccountId === account.id || accounts.length <= 1}
                            title={accounts.length <= 1 ? 'Cannot delete the only account' : 'Delete account'}
                          >
                            {deletingAccountId === account.id ? '...' : '🗑️'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="add-account-menu-btn"
                      onClick={() => {
                        setShowAccountMenu(false);
                        setShowAddAccountModal(true);
                      }}
                    >
                      + Add New Account
                    </button>
                  </div>
                )}
                <button 
                  className="add-account-btn" 
                  onClick={() => setShowAddAccountModal(true)}
                  title="Add new Klaviyo account"
                >
                  +
                </button>
              </div>
            ) : (
              <button 
                className="add-account-btn" 
                onClick={() => setShowAddAccountModal(true)}
                title="Add your first Klaviyo account"
              >
                + Add Klaviyo Account
              </button>
            )}
            <span>{user?.email}</span>
            <button className="logout-btn" onClick={logout}>Logout</button>
          </div>
        </div>

        {showAddAccountModal && (
          <div className="modal-overlay" onClick={() => setShowAddAccountModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Add Klaviyo Account</h2>
              <form onSubmit={handleAddAccount}>
                <div className="form-group">
                  <label>Account Name (optional)</label>
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="e.g., Production Account"
                  />
                </div>
                <div className="form-group">
                  <label>Klaviyo API Key *</label>
                  <input
                    type="text"
                    value={newAccountKey}
                    onChange={(e) => setNewAccountKey(e.target.value)}
                    placeholder="pk_..."
                    required
                  />
                </div>
                <div className="modal-actions">
                  <button 
                    type="button" 
                    className="cancel-btn"
                    onClick={() => {
                      setShowAddAccountModal(false);
                      setNewAccountName('');
                      setNewAccountKey('');
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="submit-btn" disabled={addingAccount}>
                    {addingAccount ? 'Adding...' : 'Add Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {error && <div className="error" style={{ display: 'block' }}>{error}</div>}
        
        {/* Summary Cards */}
        <div className="summary-cards">
          <div className="summary-card">
            <div className="summary-card-title">Total Email Revenue</div>
            <div className="summary-card-value">
              {loading.summary ? '...' : formatCurrency(summary.totalRevenue, currency)}
            </div>
            <div className="summary-card-subtitle">Last 30 Days</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-title">Total Campaigns</div>
            <div className="summary-card-content">
              <div className="summary-card-left">
                <div className="summary-card-value">{summary.campaignCount}</div>
                <div className="summary-card-subtitle">Sent Campaigns</div>
              </div>
              <div className="summary-card-right">
                <div className="summary-card-revenue">{formatCurrency(summary.campaignRevenue, currency)}</div>
                <div className="summary-card-percentage">{summary.campaignPercentage}% of total</div>
              </div>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-title">Total Flows</div>
            <div className="summary-card-content">
              <div className="summary-card-left">
                <div className="summary-card-value">{summary.flowCount}</div>
                <div className="summary-card-subtitle">Live Flows</div>
              </div>
              <div className="summary-card-right">
                <div className="summary-card-revenue">{formatCurrency(summary.flowRevenue, currency)}</div>
                <div className="summary-card-percentage">{summary.flowPercentage}% of total</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="table-section" style={{ marginTop: '48px' }}>
          <h2 className="table-title">Campaigns (Last 30 Days)</h2>
          {loading.campaigns ? (
            <div className="loading">Loading campaigns...</div>
          ) : (
            <CampaignTable campaigns={campaigns} currency={currency} />
          )}
        </div>
        
        <div className="table-section" style={{ marginTop: '48px' }}>
          <h2 className="table-title">Flows (Last 30 Days)</h2>
          {loading.flows ? (
            <div className="loading">Loading flows...</div>
          ) : (
            <FlowTable flows={flows} currency={currency} />
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignTable({ campaigns, currency = 'USD' }) {
  if (campaigns.length === 0) {
    return (
      <table>
        <tbody>
          <tr>
            <td colSpan="7" style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', fontWeight: 500 }}>
              No campaigns found in the last 30 days
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>CAMPAIGN</th>
          <th>MESSAGE TYPE</th>
          <th>STATUS</th>
          <th>SEND DATE</th>
          <th>OPEN RATE</th>
          <th>CLICK RATE</th>
          <th style={{ textAlign: 'right' }}>PLACED ORDER</th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map(campaign => {
          const sendDate = new Date(campaign.sendDate);
          const openRate = campaign.recipients > 0 
            ? ((campaign.opens / campaign.recipients) * 100).toFixed(2) 
            : '0.00';
          const clickRate = campaign.recipients > 0 
            ? ((campaign.clicks / campaign.recipients) * 100).toFixed(2) 
            : '0.00';
          
          const statusClass = campaign.status?.toLowerCase() === 'draft' ? 'status-draft' : 'status-sent';
          const statusText = campaign.status ? 
            campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1) : 
            'Sent';
          
          return (
            <tr key={campaign.id}>
              <td data-label="Campaign">
                <div className="campaign-name">{campaign.name}</div>
                <div className="campaign-subtitle">{campaign.name}</div>
              </td>
              <td data-label="Message Type">
                <span className={campaign.messageType === 'email' ? 'icon-email' : 'icon-automation'}>
                  {campaign.messageType || 'email'}
                </span>
              </td>
              <td data-label="Status">
                <span className={`status-badge ${statusClass}`}>
                  {statusText}
                </span>
              </td>
              <td data-label="Send Date">
                <div>
                  {sendDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>
                  {sendDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} GMT
                </div>
              </td>
              <td data-label="Open Rate">
                <div className="metric">
                  <span className="metric-value">{openRate}%</span>
                  <span className="metric-detail">({campaign.opens.toLocaleString()} recipients)</span>
                </div>
              </td>
              <td data-label="Click Rate">
                <div className="metric">
                  <span className="metric-value">{clickRate}%</span>
                  <span className="metric-detail">({campaign.clicks.toLocaleString()} recipients)</span>
                </div>
              </td>
              <td data-label="Placed Order">
                <div className="metric" style={{ alignItems: 'flex-end' }}>
                  <span className="revenue">{formatCurrency(campaign.revenue, currency)}</span>
                  <span className="revenue-detail">
                    ({campaign.conversions} recipient{campaign.conversions !== 1 ? 's' : ''})
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FlowTable({ flows, currency = 'USD' }) {
  if (flows.length === 0) {
    return (
      <table>
        <tbody>
          <tr>
            <td colSpan="6" style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', fontWeight: 500 }}>
              No flows found in the last 30 days
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>FLOW</th>
          <th>STATUS</th>
          <th>UPDATED</th>
          <th>OPEN RATE</th>
          <th>CLICK RATE</th>
          <th style={{ textAlign: 'right' }}>PLACED ORDER</th>
        </tr>
      </thead>
      <tbody>
        {flows.map(flow => {
          const updatedDate = new Date(flow.updatedAt);
          const openRate = flow.recipients > 0 
            ? ((flow.opens / flow.recipients) * 100).toFixed(2) 
            : '0.00';
          const clickRate = flow.recipients > 0 
            ? ((flow.clicks / flow.recipients) * 100).toFixed(2) 
            : '0.00';
          
          const statusClass = flow.status?.toLowerCase() === 'draft' ? 'status-draft' : 'status-sent';
          const statusText = flow.status ? 
            flow.status.charAt(0).toUpperCase() + flow.status.slice(1) : 
            'Active';
          
          return (
            <tr key={flow.id}>
              <td data-label="Flow">
                <div className="campaign-name">{flow.name}</div>
              </td>
              <td data-label="Status">
                <span className={`status-badge ${statusClass}`}>
                  {statusText}
                </span>
              </td>
              <td data-label="Updated">
                <div>
                  {updatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontWeight: 500 }}>
                  {updatedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} GMT
                </div>
              </td>
              <td data-label="Open Rate">
                <div className="metric">
                  <span className="metric-value">{openRate}%</span>
                  <span className="metric-detail">({flow.opens.toLocaleString()} recipients)</span>
                </div>
              </td>
              <td data-label="Click Rate">
                <div className="metric">
                  <span className="metric-value">{clickRate}%</span>
                  <span className="metric-detail">({flow.clicks.toLocaleString()} recipients)</span>
                </div>
              </td>
              <td data-label="Placed Order" style={{ textAlign: 'right' }}>
                <div className="metric" style={{ alignItems: 'flex-end' }}>
                  <span className="revenue">{formatCurrency(flow.revenue, currency)}</span>
                  <span className="revenue-detail">
                    ({flow.conversions} recipient{flow.conversions !== 1 ? 's' : ''})
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default Dashboard;

