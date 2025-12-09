import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Dashboard.css';

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
  const [loading, setLoading] = useState({
    campaigns: true,
    flows: false,
    summary: false
  });
  const [error, setError] = useState('');
  const hasFetchedRef = useRef(false);

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
          // Set campaigns and flows from the response
          setCampaigns(result.campaigns || []);
          setFlows(result.flows || []);
          
          // Calculate campaign and flow table revenue
          const campaignTableRevenue = (result.campaigns || []).reduce((sum, campaign) => {
            return sum + (campaign.revenue || 0);
          }, 0);
          
          const flowTableRevenue = (result.flows || []).reduce((sum, flow) => {
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
          
          // Set summary
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
  }, []);

  return (
    <div className="dashboard-container">
      <div className="container">
        <div className="header">
          <h1>Campaign Attribution Dashboard</h1>
          <div className="user-info">
            <span>{user?.email}</span>
            <button className="logout-btn" onClick={logout}>Logout</button>
          </div>
        </div>

        {error && <div className="error" style={{ display: 'block' }}>{error}</div>}
        
        {/* Summary Cards */}
        <div className="summary-cards">
          <div className="summary-card">
            <div className="summary-card-title">Total Revenue</div>
            <div className="summary-card-value">
              {loading.summary ? '...' : `€${summary.totalRevenue.toFixed(2)}`}
            </div>
            <div className="summary-card-subtitle">Last 30 Days</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-title">Total Campaigns</div>
            <div className="summary-card-content">
              <div className="summary-card-left">
                <div className="summary-card-value">{summary.campaignCount}</div>
                <div className="summary-card-subtitle">Active Campaigns</div>
              </div>
              <div className="summary-card-right">
                <div className="summary-card-revenue">€{summary.campaignRevenue.toFixed(2)}</div>
                <div className="summary-card-percentage">{summary.campaignPercentage}% of total</div>
              </div>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-card-title">Total Flows</div>
            <div className="summary-card-content">
              <div className="summary-card-left">
                <div className="summary-card-value">{summary.flowCount}</div>
                <div className="summary-card-subtitle">Active Flows</div>
              </div>
              <div className="summary-card-right">
                <div className="summary-card-revenue">€{summary.flowRevenue.toFixed(2)}</div>
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
            <CampaignTable campaigns={campaigns} />
          )}
        </div>
        
        <div className="table-section" style={{ marginTop: '48px' }}>
          <h2 className="table-title">Flows (Last 30 Days)</h2>
          {loading.flows ? (
            <div className="loading">Loading flows...</div>
          ) : (
            <FlowTable flows={flows} />
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignTable({ campaigns }) {
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
                  <span className="revenue">€{campaign.revenue.toFixed(2)}</span>
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

function FlowTable({ flows }) {
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
                  <span className="revenue">€{flow.revenue.toFixed(2)}</span>
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

