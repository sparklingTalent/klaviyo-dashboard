const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { registerClient, loginUser, getUserById, getAllUsers, verifyToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

const KLAVIYO_BASE_URL = 'https://a.klaviyo.com/api';

// Authentication middleware
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    const user = await getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, klaviyoApiKey } = req.body;
    
    if (!username || !email || !password || !klaviyoApiKey) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }
    
    const user = await registerClient(username, email, password, klaviyoApiKey);
    res.json({
      success: true,
      message: 'Client registered successfully',
      user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    const result = await loginUser(email, password);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email
    }
  });
});

// Endpoint to get all registered clients (public, no auth required for registration page)
app.get('/api/auth/clients', async (req, res) => {
  try {
    const clients = await getAllUsers();
    res.json({
      success: true,
      data: clients
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to get total revenue from all Placed Order events in last 30 days
app.get('/api/revenue/total', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { start, end } = getLast30Days();
    
    console.log('Fetching total revenue, campaigns, and flows using metric-aggregates API...');
    
    // Get all metrics
    const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });
    
    const metrics = metricsResponse.data?.data || [];
    const placedOrderMetric = metrics.find(m => 
      m.attributes?.name === 'Placed Order' ||
      m.attributes?.name === 'placed-order'
    );
    
    const sentEmailMetric = metrics.find(m => 
      m.attributes?.name === 'Sent Email' ||
      m.attributes?.name === 'sent-email'
    );
    
    if (!placedOrderMetric) {
      return res.json({
        success: false,
        error: 'Placed Order metric not found'
      });
    }
    
    const placedOrderMetricId = placedOrderMetric.id;
    const sentEmailMetricId = sentEmailMetric?.id;
    
    console.log(`Using Placed Order metric ID: ${placedOrderMetricId}`);
    if (sentEmailMetricId) {
      console.log(`Using Sent Email metric ID: ${sentEmailMetricId}`);
    }
    
    // Format dates for filter (remove milliseconds and ensure proper format)
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startStr = startDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const endStr = endDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    
    // Build date filters - datetime values should NOT be in quotes per Klaviyo API requirements
    const filters = [
      `greater-or-equal(datetime,${startStr})`,
      `less-than(datetime,${endStr})`
    ];
    
    // Process filters to ensure datetime values are not quoted
    const processedFilters = filters.map(filter => {
      let processed = filter;
      // Remove quotes (both double and single) from datetime values
      processed = processed.replace(/datetime,\s*"([^"]+)"/g, 'datetime,$1');
      processed = processed.replace(/datetime,\s*'([^']+)'/g, 'datetime,$1');
      // Remove any extra spaces around datetime values
      processed = processed.replace(/datetime,\s+/g, 'datetime,');
      processed = processed.replace(/datetime,\s*([^,)]+)\s*\)/g, 'datetime,$1)');
      return processed;
    });
    
    // Join filters with comma (Klaviyo API expects comma-separated string)
    const filterString = processedFilters.join(',');
    
    // 1. Get total revenue from Placed Order metric (MUST be fetched first)
    const revenueAggregateResponse = await axios.post(
      `${KLAVIYO_BASE_URL}/metric-aggregates/`,
      {
        data: {
          type: 'metric-aggregate',
          attributes: {
            metric_id: placedOrderMetricId,
            measurements: ['sum_value'],
            filter: filterString,
            timezone: 'UTC'
          }
        }
      },
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    // Extract total revenue using the proper response structure
    // Response structure: response.data.attributes.data (array of groups)
    let totalRevenue = 0;
    if (revenueAggregateResponse.data?.data?.attributes?.data) {
      revenueAggregateResponse.data.data.attributes.data.forEach(group => {
        const measurements = group?.measurements;
        const measurementKey = measurements?.sum_value ? 'sum_value' : null;
        
        if (measurementKey && measurements[measurementKey] !== undefined) {
          let value = 0;
          if (Array.isArray(measurements[measurementKey])) {
            // Sum all values in the array
            value = measurements[measurementKey].reduce((acc, val) => {
              const num = parseFloat(val);
              return acc + (isNaN(num) ? 0 : num);
            }, 0);
          } else {
            // Single value
            const num = parseFloat(measurements[measurementKey]);
            value = isNaN(num) ? 0 : num;
          }
          totalRevenue += value;
        }
      });
    }
    
    console.log(`Revenue Response: ${JSON.stringify(revenueAggregateResponse.data, null, 2)}`);
    console.log(`Total revenue: ${totalRevenue.toFixed(2)}`);
    
    // Fetch metric IDs early so they're available for both flow and campaign metrics
    let openedEmailMetricId = null;
    let clickedEmailMetricId = null;
    let receivedEmailMetricId = null;
    
    try {
      const metricsResponse = await axios.get(
        `${KLAVIYO_BASE_URL}/metrics/`,
        {
          headers: {
            'Authorization': `Klaviyo-API-Key ${userApiKey}`,
            'revision': '2024-10-15',
            'Accept': 'application/json'
          }
        }
      );
      
      // Find Opened Email metric
      const openedMetric = metricsResponse.data.data.find(
        m => m.attributes.name === 'Opened Email'
      );
      if (openedMetric?.id) {
        openedEmailMetricId = openedMetric.id;
        console.log(`Opened Email metric ID: ${openedEmailMetricId}`);
      }
      
      // Find Clicked Email metric
      const clickedMetric = metricsResponse.data.data.find(
        m => m.attributes.name === 'Clicked Email'
      );
      if (clickedMetric?.id) {
        clickedEmailMetricId = clickedMetric.id;
        console.log(`Clicked Email metric ID: ${clickedEmailMetricId}`);
      }
      
      // Find Received Email metric
      const receivedMetric = metricsResponse.data.data.find(
        m => m.attributes.name === 'Received Email'
      );
      if (receivedMetric?.id) {
        receivedEmailMetricId = receivedMetric.id;
        console.log(`Received Email metric ID: ${receivedEmailMetricId}`);
      }
    } catch (error) {
      console.log(`Error fetching metrics:`, error.response?.data || error.message);
    }
    
    // Get attributed flow revenue grouped by flow
    // Get attributed flow revenue grouped by flow
    let attributedFlowRevenue = {};
    
    try {
      const flowRevenueAggregateResponse = await axios.post(
        `${KLAVIYO_BASE_URL}/metric-aggregates/`,
        {
          data: {
            type: 'metric-aggregate',
            attributes: {
              metric_id: placedOrderMetricId,
              measurements: ['sum_value'],
              by: ['$attributed_flow'],
              filter: [
                ...processedFilters,
                `not(equals($attributed_flow,""))`
              ],
              timezone: 'UTC'
            }
          }
        },
        {
          headers: {
            'Authorization': `Klaviyo-API-Key ${userApiKey}`,
            'revision': '2024-10-15',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
      
      // Extract grouped flow revenue and count recipients (non-zero sum_value entries)
      console.log(`Flow Revenue Response: ${JSON.stringify(flowRevenueAggregateResponse.data, null, 2)}`);
      if (flowRevenueAggregateResponse.data?.data?.attributes?.data) {
        flowRevenueAggregateResponse.data.data.attributes.data.forEach(group => {
          const measurements = group?.measurements;
          const measurementKey = measurements?.sum_value ? 'sum_value' : null;
          
          if (measurementKey && measurements[measurementKey] !== undefined && group?.dimensions) {
            // Extract flow ID from dimensions - dimensions is an array, access first element
            const flowId = group.dimensions?.[0] || 'unknown';
            console.log(`Extracted flow ID from dimensions: ${flowId}, dimensions structure: ${JSON.stringify(group.dimensions)}`);
            
            let value = 0;
            if (Array.isArray(measurements[measurementKey])) {
              // Sum all values for revenue
              value = measurements[measurementKey].reduce((acc, val) => {
                const num = parseFloat(val);
                return acc + (isNaN(num) ? 0 : num);
              }, 0);
            } else {
              const num = parseFloat(measurements[measurementKey]);
              value = isNaN(num) ? 0 : num;
            }
            
            attributedFlowRevenue[flowId] = (attributedFlowRevenue[flowId] || 0) + value;
          }
        });
      }
      
      console.log(`Attributed Flow Revenue: ${JSON.stringify(attributedFlowRevenue, null, 2)}`);
    } catch (error) {
      console.log('Error fetching attributed flow revenue:', error.response?.data || error.message);
    }
    
    // Get flow conversions (count of Placed Order events) grouped by flow
    const flowConversionsFromRevenue = {}; // flowId -> conversions count
    try {
      const flowConversionsAggregateResponse = await axios.post(
        `${KLAVIYO_BASE_URL}/metric-aggregates/`,
        {
          data: {
            type: 'metric-aggregate',
            attributes: {
              metric_id: placedOrderMetricId,
              measurements: ['count'],
              by: ['$attributed_flow'],
              filter: [
                ...processedFilters,
                `not(equals($attributed_flow,""))`
              ],
              timezone: 'UTC'
            }
          }
        },
        {
          headers: {
            'Authorization': `Klaviyo-API-Key ${userApiKey}`,
            'revision': '2024-10-15',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
      
      // Extract flow conversions count
      if (flowConversionsAggregateResponse.data?.data?.attributes?.data) {
        flowConversionsAggregateResponse.data.data.attributes.data.forEach(group => {
          const measurements = group?.measurements;
          const count = measurements?.count;
          
          if (count !== undefined && group?.dimensions) {
            const flowId = group.dimensions?.[0] || 'unknown';
            let conversions = 0;
            
            if (Array.isArray(count)) {
              conversions = count.reduce((acc, val) => {
                const num = parseInt(val);
                return acc + (isNaN(num) ? 0 : num);
              }, 0);
            } else {
              const num = parseInt(count);
              conversions = isNaN(num) ? 0 : num;
            }
            
            flowConversionsFromRevenue[flowId] = (flowConversionsFromRevenue[flowId] || 0) + conversions;
          }
        });
      }
      
      console.log(`Flow Conversions: ${JSON.stringify(flowConversionsFromRevenue, null, 2)}`);
    } catch (error) {
      console.log('Error fetching flow conversions:', error.response?.data || error.message);
    }
    
    // Flow metrics (opens, clicks, recipients) will be fetched per flow in the flow table building section
    // Similar to how campaign revenue is fetched per campaign using equals($attributed_flow,"<flowId>")
    
    // Get attributed campaign revenue: collect message IDs per campaign, then sum per campaign
    let attributedCampaignRevenue = {};
    let filteredCampaigns = [];
    let campaignMetrics = {};
    
    // Message maps for opens/clicks/recipients - used by both campaigns AND flows
    // These are populated by 3 metric-aggregates calls and then used for local aggregation
    const messageOpensMap = {}; // messageId -> opens count
    const messageClicksMap = {}; // messageId -> clicks count
    const messageRecipientsMap = {}; // messageId -> recipients count
    
    try {
      // First, fetch campaigns to get message IDs
      const { start, end } = getLast30Days();
      const startTimestamp = new Date(start).toISOString();
      const endTimestamp = new Date(end).toISOString();
      
      // Fetch email campaigns (channel filter is required by API, filter for active status)
      const emailResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        },
        params: {
          'filter': `equals(messages.channel,'email'),greater-than(updated_at,${startTimestamp})`,
          'fields[campaign]': 'name,status,created_at,updated_at',
          'include': 'campaign-messages',
          'sort': '-updated_at'
        }
      });
      
      
      // Fetch SMS campaigns (channel filter is required by API, filter for active status)
      let smsResponse;
      try {
        smsResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
          headers: {
            'Authorization': `Klaviyo-API-Key ${userApiKey}`,
            'revision': '2024-10-15',
            'Accept': 'application/json'
          },
          params: {
            'filter': `equals(messages.channel,'sms'),greater-than(updated_at,${startTimestamp})`,
            'fields[campaign]': 'name,status,created_at,updated_at',
            'include': 'campaign-messages',
            'sort': '-updated_at'
          }
        });
      } catch (error) {
        smsResponse = { data: { data: [], included: [] } };
        console.log(`SMS Campaigns API Error: ${error.response?.data || error.message}`);
      }
      
      const emailCampaigns = emailResponse.data.data || [];
      const smsCampaigns = smsResponse.data.data || [];
      const allCampaigns = [...emailCampaigns, ...smsCampaigns];
      const included = [...(emailResponse.data.included || []), ...(smsResponse.data.included || [])];
      
      // Filter campaigns from last 30 days (reuse the filteredCampaigns variable declared at top)
      filteredCampaigns = allCampaigns.filter(campaign => {
        const campaignDate = new Date(campaign.attributes?.updated_at || campaign.attributes?.created_at);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return campaignDate >= thirtyDaysAgo;
      });
      
      // Map campaign ID to message IDs, message labels, and message type
      const campaignToMessageIds = {}; // Map campaign ID to array of message IDs
      const campaignToMessageLabels = {};
      const campaignToMessageType = {};
      const messageIdToCampaignId = {}; // Map message ID to campaign ID for local filtering
      
      filteredCampaigns.forEach(campaign => {
        const campaignId = campaign.id;
        const messageIds = [];
        const messageLabels = [];
        let messageType = null;
        
        // Get message IDs from relationships
        const messageRelationships = campaign.relationships?.campaign_messages?.data || [];
        const messageIdToLabel = {};
        
  
        // Build map of message ID to message label from included messages
        // Campaign messages don't have a status field - include all messages
        included.forEach(item => {
          if (item.type === 'campaign-message') {
            const messageCampaignId = item.relationships?.campaign?.data?.id;
            if (messageCampaignId === campaignId) {
              const messageId = item.id;
              // Use label field for filtering (e.g., "Gift Ideas - 9th Dec")
              const messageLabel = item.attributes?.label || item.attributes?.name || messageId;
              messageIdToLabel[messageId] = messageLabel;
              messageIdToCampaignId[messageId] = campaignId;
              
              // Get message type (channel: email, sms, etc.)
              // Campaign messages don't have a status field - use channel directly
              if (!messageType && item.attributes?.channel) {
                messageType = item.attributes.channel;
              }
            }
          }
        });
        
        // Collect message IDs and labels from relationships
        messageRelationships.forEach(rel => {
          if (rel.type === 'campaign-message') {
            const messageId = rel.id;
            const messageLabel = messageIdToLabel[messageId] || messageId;
            
            // Always include the message ID; fall back to the ID if label is missing
            messageIds.push(messageId);
            if (!messageLabels.includes(messageLabel)) {
              messageLabels.push(messageLabel);
            }
            
            // Ensure reverse mapping exists even when label was missing from included
            messageIdToCampaignId[messageId] = campaignId;
          }
        });
        
        console.log(`Campaign ${campaignId}: collected ${messageIds.length} message IDs`);
        
        // DO NOT fallback to campaignId - campaign IDs are NOT message IDs
        
        campaignToMessageIds[campaignId] = messageIds;
        campaignToMessageLabels[campaignId] = messageLabels;
        campaignToMessageType[campaignId] = messageType || 'unknown';
      });
      
      console.log(`Campaign to Message Labels mapping: ${JSON.stringify(campaignToMessageLabels, null, 2)}`);
      console.log(`Campaign to Message Type mapping: ${JSON.stringify(campaignToMessageType, null, 2)}`);
      
      // STEP 3: Make 3 TOTAL metric-aggregates API calls (opens, clicks, recipients) BEFORE the loop
      // NOTE: Metric IDs (openedEmailMetricId, clickedEmailMetricId, receivedEmailMetricId) 
      // are already fetched earlier, before flow metrics
      // Store results in maps: messageId -> count
      // NOTE: Maps are declared at higher scope (above this try block) so flows can access them
      
      // Fetch opens using metric-aggregates with by: [0] (ONLY date filters, NO campaign filter)
      if (openedEmailMetricId) {
        try {
          const opensPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: openedEmailMetricId,
                measurements: ['count'],
                by: ['$message'],
                filter: processedFilters, // Only date filters, NO campaign filter
                timezone: 'UTC'
              }
            }
          };
          
          const opensResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            opensPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Store opens per message ID
          if (opensResponse.data?.data?.attributes?.data) {
            opensResponse.data.data.attributes.data.forEach(group => {
              // Correct dimensions access: group.dimensions[0]
              const messageId = group?.dimensions?.[0];
              if (messageId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  messageOpensMap[messageId] = (messageOpensMap[messageId] || 0) + count;
                }
              }
            });
          }
          console.log(`Opens map: ${JSON.stringify(messageOpensMap, null, 2)}`);
        } catch (error) {
          console.log(`Error fetching opens:`, error.response?.data || error.message);
        }
      }
      
      // Fetch clicks using metric-aggregates with by: [0] (ONLY date filters, NO campaign filter)
      if (clickedEmailMetricId) {
        try {
          const clicksPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: clickedEmailMetricId,
                measurements: ['count'],
                by: ['$message'],
                filter: processedFilters, // Only date filters, NO campaign filter
                timezone: 'UTC'
              }
            }
          };
          
          const clicksResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            clicksPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Store clicks per message ID
          if (clicksResponse.data?.data?.attributes?.data) {
            clicksResponse.data.data.attributes.data.forEach(group => {
              // Correct dimensions access: group.dimensions[0]
              const messageId = group?.dimensions?.[0];
              if (messageId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  messageClicksMap[messageId] = (messageClicksMap[messageId] || 0) + count;
                }
              }
            });
          }
          console.log(`Clicks map: ${JSON.stringify(messageClicksMap, null, 2)}`);
        } catch (error) {
          console.log(`Error fetching clicks:`, error.response?.data || error.message);
        }
      }
      
      // Fetch recipients using metric-aggregates with by: [0] (ONLY date filters, NO campaign filter)
      if (receivedEmailMetricId) {
        try {
          const recipientsPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: receivedEmailMetricId,
                measurements: ['count'],
                by: ['$message'],
                filter: processedFilters, // Only date filters, NO campaign filter
                timezone: 'UTC'
              }
            }
          };
          
          const recipientsResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            recipientsPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Store recipients per message ID
          if (recipientsResponse.data?.data?.attributes?.data) {
            recipientsResponse.data.data.attributes.data.forEach(group => {
              // Correct dimensions access: group.dimensions[0]
              const messageId = group?.dimensions?.[0];
              if (messageId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  messageRecipientsMap[messageId] = (messageRecipientsMap[messageId] || 0) + count;
                }
              }
            });
          }
          console.log(`Recipients map: ${JSON.stringify(messageRecipientsMap, null, 2)}`);
        } catch (error) {
          console.log(`Error fetching recipients:`, error.response?.data || error.message);
        }
      }
      
      // STEP 4: For each campaign, fetch revenue and aggregate opens/clicks/recipients locally
      // Initialize campaignMetrics (reuse the variable declared at top)
      campaignMetrics = {}; // Store all metrics per campaign
      console.log(`Campaign to Message IDs: ${JSON.stringify(campaignToMessageIds, null, 2)}`);
      // FIX: Loop over campaignToMessageIds, not campaignToMessageLabels
      // NOTE: We still process campaigns even if they have no message IDs (for revenue)
      for (const [campaignId, messageIds] of Object.entries(campaignToMessageIds)) {
        // Don't skip campaigns with no message IDs - they can still have revenue
        // We'll just have 0 opens/clicks/recipients for them
        
        const messageType = campaignToMessageType[campaignId] || 'unknown';
        
        // Initialize campaign metrics
        campaignMetrics[campaignId] = {
          messageType: messageType,
          revenue: 0,
          recipients: 0, // From Received Email metric (for open/click rates)
          opens: 0,
          clicks: 0,
          conversions: 0, // Count of Placed Order events (for PLACED ORDER cell)
          openRate: 0,
          clickRate: 0
        };
        
        // 1. Fetch revenue using metric-aggregates (one call per campaign)
        // IMPORTANT: Revenue uses $attributed_message with campaign ID, NOT $message
        // $attributed_message returns the campaign ID for campaign sends
        const revenuePayload = {
          data: {
            type: 'metric-aggregate',
            attributes: {
              metric_id: placedOrderMetricId,
              measurements: ['sum_value'],
              by: ['$attributed_message'], // IMPORTANT: Revenue attribution uses $attributed_message
              filter: [...processedFilters, `equals($attributed_message,"${campaignId}")`],
              timezone: 'UTC'
            }
          }
        };
        
        try {
          const campaignRevenueResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            revenuePayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Extract revenue for this campaign with dimension validation
          let campaignRevenue = 0;
          const rows = campaignRevenueResponse.data?.data?.attributes?.data || [];
          console.log(`Campaign ${campaignId} revenue rows: ${JSON.stringify(rows, null, 2)}`);
          for (const row of rows) {
            // FIX: Dimensions can be an array when using by: ['$attributed_message']
            // The first element of the array is the $attributed_message value
            let attributedMessage = null;
            if (Array.isArray(row.dimensions)) {
              attributedMessage = row.dimensions[0];
            } else if (row.dimensions && typeof row.dimensions === 'object') {
              attributedMessage = row.dimensions["$attributed_message"];
            }
            
            if (attributedMessage !== campaignId) {
              console.log(`Warning: Skipping revenue row with $attributed_message="${attributedMessage}" (expected "${campaignId}")`);
              continue;
            }
            
            const val = row.measurements?.sum_value;
            if (val !== undefined) {
              if (Array.isArray(val)) {
                // Sum all values for revenue
                campaignRevenue += val.reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
              } else {
                campaignRevenue += parseFloat(val) || 0;
              }
            }
          }
          
          campaignMetrics[campaignId].revenue = campaignRevenue;
          attributedCampaignRevenue[campaignId] = campaignRevenue;
        } catch (error) {
          console.log(`Error fetching revenue for campaign ${campaignId}:`, error.response?.data || error.message);
        }
        
        // 1b. Fetch conversions (count of Placed Order events) for this campaign
        try {
          const campaignConversionsPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: placedOrderMetricId,
                measurements: ['count'],
                by: ['$attributed_message'],
                filter: [
                  ...processedFilters,
                  `equals($attributed_message,"${campaignId}")`
                ],
                timezone: 'UTC'
              }
            }
          };
          
          const campaignConversionsResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            campaignConversionsPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              }
            }
          );
          
          // Extract conversions count for this campaign
          let campaignConversions = 0;
          const conversionRows = campaignConversionsResponse.data?.data?.attributes?.data || [];
          for (const row of conversionRows) {
            let attributedMessage = null;
            if (Array.isArray(row.dimensions)) {
              attributedMessage = row.dimensions[0];
            } else if (row.dimensions && typeof row.dimensions === 'object') {
              attributedMessage = row.dimensions["$attributed_message"];
            }
            
            if (attributedMessage !== campaignId) continue;
            
            const count = row.measurements?.count;
            if (count !== undefined) {
              if (Array.isArray(count)) {
                campaignConversions += count.reduce((acc, v) => acc + (parseInt(v) || 0), 0);
              } else {
                campaignConversions += parseInt(count) || 0;
              }
            }
          }
          
          campaignMetrics[campaignId].conversions = campaignConversions;
        } catch (error) {
          console.log(`Error fetching conversions for campaign ${campaignId}:`, error.response?.data || error.message);
        }
        
        // 2. Aggregate opens, clicks, and recipients locally from the maps
        let opens = 0;
        let clicks = 0;
        let recipients = 0;
        
        // Sum metrics for all messages belonging to this campaign
        // NOTE: If messageIds is empty, check if campaignId itself is in the maps
        // (For some campaigns, the campaign ID IS the message ID)
        if (messageIds.length > 0) {
          for (const messageId of messageIds) {
            opens += messageOpensMap[messageId] || 0;
            clicks += messageClicksMap[messageId] || 0;
            recipients += messageRecipientsMap[messageId] || 0;
          }
        } else {
          // Fallback: Check if campaignId itself is a message ID (common for campaigns)
          opens += messageOpensMap[campaignId] || 0;
          clicks += messageClicksMap[campaignId] || 0;
          recipients += messageRecipientsMap[campaignId] || 0;
        }
        
        // Update campaign metrics
        campaignMetrics[campaignId].opens = opens;
        campaignMetrics[campaignId].clicks = clicks;
        campaignMetrics[campaignId].recipients = recipients; // From Received Email metric (for open/click rates)
        // conversions is already set from conversions API call above (for PLACED ORDER cell)
        
        // Calculate rates
        if (recipients > 0) {
          campaignMetrics[campaignId].openRate = (opens / recipients) * 100;
          campaignMetrics[campaignId].clickRate = (clicks / recipients) * 100;
        }
        
        console.log(`Campaign ${campaignId} - Metrics: ${JSON.stringify(campaignMetrics[campaignId], null, 2)}`);
      }
      
      console.log(`Campaign Metrics: ${JSON.stringify(campaignMetrics, null, 2)}`);
      
      console.log(`Attributed Campaign Revenue: ${JSON.stringify(attributedCampaignRevenue, null, 2)}`);
    } catch (error) {
      console.log('Error fetching attributed campaign revenue:', error.response?.data || error.message);
    }
    
    // 2. Get total campaigns count (same as /api/campaigns endpoint) - fetched second
    let totalCampaigns = 0;
    try {
      const { start } = getLast30Days();
      const startTimestamp = new Date(start).toISOString();
      
      // Fetch email campaigns (channel filter is required by API)
      const emailResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        },
        params: {
          'filter': `equals(messages.channel,'email'),greater-than(updated_at,${startTimestamp})`,
          'fields[campaign]': 'name,status,created_at,updated_at',
          'include': 'campaign-messages',
          'sort': '-updated_at'
        }
      });
      
      // Fetch SMS campaigns (channel filter is required by API)
      let smsResponse;
      try {
        smsResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
          headers: {
            'Authorization': `Klaviyo-API-Key ${userApiKey}`,
            'revision': '2024-10-15',
            'Accept': 'application/json'
          },
          params: {
            'filter': `equals(messages.channel,'sms'),greater-than(updated_at,${startTimestamp})`,
            'fields[campaign]': 'name,status,created_at,updated_at',
            'include': 'campaign-messages',
            'sort': '-updated_at'
          }
        });
      } catch (error) {
        smsResponse = { data: { data: [] } };
      }
      
      // Reuse filteredCampaigns and campaignMetrics from attributed revenue section
      // If they're not available, fetch and filter campaigns here
      if (filteredCampaigns.length === 0) {
        const emailCampaigns = emailResponse.data.data || [];
        const smsCampaigns = smsResponse.data.data || [];
        const allCampaigns = [...emailCampaigns, ...smsCampaigns];
        filteredCampaigns = allCampaigns.filter(campaign => {
          const campaignDate = new Date(campaign.attributes?.updated_at || campaign.attributes?.created_at);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return campaignDate >= thirtyDaysAgo;
        });
      }
      
      totalCampaigns = filteredCampaigns.length;
      console.log(`Total campaigns: ${totalCampaigns}`);
    } catch (error) {
      console.log('Error fetching campaigns count:', error.response?.data || error.message);
    }
    
    // 3. Get total flows count (same as /api/flows endpoint) - fetched third
    let totalFlows = 0;
    try {
      // Fetch all flows from Klaviyo
      const flowsResponse = await axios.get(`${KLAVIYO_BASE_URL}/flows/`, {
        headers: {
          "Authorization": `Klaviyo-API-Key ${userApiKey}`,
          "revision": "2024-10-15",
          "Accept": "application/json"
        }
      });
      
      const allFlows = flowsResponse.data.data || [];
      
      // Filter out draft flows only (same as /api/flows endpoint)
      const filteredFlows = allFlows.filter(flow => {
        const status = flow.attributes?.status || '';
        return status.toLowerCase() !== 'draft';
      });
      
      totalFlows = filteredFlows.length;
      console.log(`Total flows: ${totalFlows}`);
    } catch (error) {
      console.log('Error fetching flows count:', error.response?.data || error.message);
    }
    
    // 4. Build campaign table data (combine campaign info with metrics)
    const campaignsTable = [];
    try {
      // Use the filteredCampaigns and campaignMetrics we already have
      filteredCampaigns.forEach(campaign => {
        const campaignId = campaign.id;
        const attributes = campaign.attributes;
        const metrics = campaignMetrics[campaignId] || {
          messageType: 'unknown',
          revenue: 0,
          recipients: 0,
          opens: 0,
          clicks: 0,
          openRate: 0,
          clickRate: 0
        };
        
        campaignsTable.push({
          id: campaignId,
          name: attributes.name || 'Unnamed Campaign',
          status: attributes.status || 'unknown',
          sendDate: attributes.send_time || attributes.scheduled_at || attributes.created_at,
          createdAt: attributes.created_at,
          updatedAt: attributes.updated_at,
          messageType: metrics.messageType,
          recipients: metrics.recipients,
          opens: metrics.opens,
          clicks: metrics.clicks,
          revenue: metrics.revenue,
          conversions: metrics.conversions || 0, // Count of Placed Order events (for PLACED ORDER cell)
          openRate: metrics.openRate,
          clickRate: metrics.clickRate
        });
      });
    } catch (error) {
      console.log('Error building campaigns table:', error.message);
    }
    
    // 5. Build flow table data with metrics (opens, clicks, recipients)
    const flowsTable = [];
    try {
      // Step 1: Fetch all flows from Klaviyo
      const flowsResponse = await axios.get(`${KLAVIYO_BASE_URL}/flows/`, {
        headers: {
          "Authorization": `Klaviyo-API-Key ${userApiKey}`,
          "revision": "2024-10-15",
          "Accept": "application/json"
        }
      });
      
      const allFlows = flowsResponse.data.data || [];
      
      // Filter out draft flows
      const activeFlows = allFlows.filter(flow => {
        const status = flow.attributes?.status || '';
        return status.toLowerCase() !== 'draft';
      });
      
      // Step 2: Fetch flow-level metrics directly using by: ['$flow']
      // This gives us opens/clicks/recipients per flow ID directly
      const flowOpensMap = {}; // flowId → opens count
      const flowClicksMap = {}; // flowId → clicks count
      const flowRecipientsMap = {}; // flowId → recipients count
      
      // Fetch opens per flow using by: ['$flow']
      if (openedEmailMetricId) {
        try {
          const flowOpensPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: openedEmailMetricId,
                measurements: ['count'],
                by: ['$flow'],
                filter: [
                  ...processedFilters,
                  `not(equals($flow,""))`
                ],
                timezone: 'UTC'
              }
            }
          };
          
          const flowOpensResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            flowOpensPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Sum the count arrays for each flow
          if (flowOpensResponse.data?.data?.attributes?.data) {
            flowOpensResponse.data.data.attributes.data.forEach(group => {
              let flowId = null;
              if (Array.isArray(group.dimensions)) {
                flowId = group.dimensions[0];
              } else if (group.dimensions && typeof group.dimensions === 'object') {
                flowId = group.dimensions["$flow"];
              }
              
              if (flowId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    // Sum all values in the array (daily counts)
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  flowOpensMap[flowId] = (flowOpensMap[flowId] || 0) + count;
                }
              }
            });
          }
        } catch (error) {
          console.log(`Error fetching flow opens:`, error.response?.data || error.message);
        }
      }
      
      // Fetch clicks per flow using by: ['$flow']
      if (clickedEmailMetricId) {
        try {
          const flowClicksPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: clickedEmailMetricId,
                measurements: ['count'],
                by: ['$flow'],
                filter: [
                  ...processedFilters,
                  `not(equals($flow,""))`
                ],
                timezone: 'UTC'
              }
            }
          };
          
          const flowClicksResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            flowClicksPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Sum the count arrays for each flow
          if (flowClicksResponse.data?.data?.attributes?.data) {
            flowClicksResponse.data.data.attributes.data.forEach(group => {
              let flowId = null;
              if (Array.isArray(group.dimensions)) {
                flowId = group.dimensions[0];
              } else if (group.dimensions && typeof group.dimensions === 'object') {
                flowId = group.dimensions["$flow"];
              }
              
              if (flowId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  flowClicksMap[flowId] = (flowClicksMap[flowId] || 0) + count;
                }
              }
            });
          }
        } catch (error) {
          console.log(`Error fetching flow clicks:`, error.response?.data || error.message);
        }
      }
      
      // Fetch recipients per flow using by: ['$flow']
      if (receivedEmailMetricId) {
        try {
          const flowRecipientsPayload = {
            data: {
              type: 'metric-aggregate',
              attributes: {
                metric_id: receivedEmailMetricId,
                measurements: ['count'],
                by: ['$flow'],
                filter: [
                  ...processedFilters,
                  `not(equals($flow,""))`
                ],
                timezone: 'UTC'
              }
            }
          };
          
          const flowRecipientsResponse = await axios.post(
            `${KLAVIYO_BASE_URL}/metric-aggregates/`,
            flowRecipientsPayload,
            {
              headers: {
                'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                'revision': '2024-10-15',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          // Sum the count arrays for each flow
          if (flowRecipientsResponse.data?.data?.attributes?.data) {
            flowRecipientsResponse.data.data.attributes.data.forEach(group => {
              let flowId = null;
              if (Array.isArray(group.dimensions)) {
                flowId = group.dimensions[0];
              } else if (group.dimensions && typeof group.dimensions === 'object') {
                flowId = group.dimensions["$flow"];
              }
              
              if (flowId) {
                const measurements = group?.measurements;
                if (measurements?.count !== undefined) {
                  let count = 0;
                  if (Array.isArray(measurements.count)) {
                    count = measurements.count.reduce((acc, val) => acc + (parseInt(val) || 0), 0);
                  } else {
                    count = parseInt(measurements.count) || 0;
                  }
                  flowRecipientsMap[flowId] = (flowRecipientsMap[flowId] || 0) + count;
                }
              }
            });
          }
        } catch (error) {
          console.log(`Error fetching flow recipients:`, error.response?.data || error.message);
        }
      }
      
      console.log(`Flow Opens Map: ${JSON.stringify(flowOpensMap, null, 2)}`);
      console.log(`Flow Clicks Map: ${JSON.stringify(flowClicksMap, null, 2)}`);
      console.log(`Flow Recipients Map: ${JSON.stringify(flowRecipientsMap, null, 2)}`);
      console.log(`Attributed Flow Revenue: ${JSON.stringify(attributedFlowRevenue, null, 2)}`);
      
      // Step 3: Use the flow-level maps directly (no need to map to messages)
      for (const flow of activeFlows) {
        const flowId = flow.id;
        const attributes = flow.attributes;
        const flowRevenue = attributedFlowRevenue[flowId] || 0;
        
        // Get opens, clicks, and recipients from flow-level maps
        const opens = flowOpensMap[flowId] || 0;
        const clicks = flowClicksMap[flowId] || 0;
        const recipients = flowRecipientsMap[flowId] || 0; // From Received Email metric (for open/click rates)
        const conversions = flowConversionsFromRevenue[flowId] || 0; // Count of Placed Order events (for PLACED ORDER cell)
        
        // Calculate rates using recipients from Received Email metric
        let openRate = 0;
        let clickRate = 0;
        if (recipients > 0) {
          openRate = (opens / recipients) * 100;
          clickRate = (clicks / recipients) * 100;
        }
        
        flowsTable.push({
          id: flowId,
          name: attributes.name || 'Unnamed Flow',
          status: attributes.status || 'unknown',
          createdAt: attributes.created,
          updatedAt: attributes.updated,
          recipients: recipients, // From Received Email metric (for rates)
          opens: opens,
          clicks: clicks,
          revenue: flowRevenue,
          conversions: conversions, // Count of non-zero sum_value entries (for PLACED ORDER cell)
          openRate: openRate,
          clickRate: clickRate
        });
      }
    } catch (error) {
      console.log('Error building flows table:', error.response?.data || error.message);
    }
    
    console.log(`Total revenue: ${totalRevenue.toFixed(2)}, Total campaigns: ${totalCampaigns}, Total flows: ${totalFlows}`);
    console.log(`Campaigns table: ${campaignsTable.length} campaigns`);
    console.log(`Flows table: ${flowsTable.length} flows`);
    
    res.json({
      success: true,
      totalRevenue: totalRevenue,
      totalCampaigns: totalCampaigns,
      totalFlows: totalFlows,
      attributedCampaignRevenue: attributedCampaignRevenue,
      attributedFlowRevenue: attributedFlowRevenue,
      campaigns: campaignsTable,
      flows: flowsTable,
      timeframe: 'Last 30 days'
    });
  } catch (error) {
    console.error('Error fetching aggregate data:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Helper function to check if API key is public
function isPublicKey(apiKey) {
  return apiKey && apiKey.startsWith('pk_');
}

// Helper function to get date 30 days ago
function getLast30Days() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 31);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString()
  };
}

// Revenue extraction function for Placed Order events
function extractRevenue(props, eventId = 'unknown') {
  if (!props) return 0;

  // Klaviyo provides revenue in $value for Placed Order events
  if (props['$value'] !== undefined && props['$value'] !== null) {
    const revenue = Number(props['$value']);
    return revenue;
  }

  // Fallback revenue fields
  const fallbackFields = ['value', 'Value', 'order_total', 'total_price', 'amount', 'revenue'];

  for (const field of fallbackFields) {
    if (props[field] !== undefined && props[field] !== null) {
      const numValue = Number(props[field]);
      if (!isNaN(numValue) && numValue > 0) {
        return numValue;
      }
    }
  }

  return 0;
}

// Helper function to get user's Klaviyo API key
function getUserApiKey(req) {
  return req.user.klaviyoApiKey;
}

// Endpoint to fetch campaigns - DEPRECATED: Use /api/revenue/total instead
app.get('/api/campaigns', authenticate, async (req, res) => {
  try {
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log('Fetching campaigns created after:', startTimestamp);
    
    const userApiKey = getUserApiKey(req);
    
    // Fetch email campaigns from Klaviyo
    const emailResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(messages.channel,'email'),greater-than(updated_at,${startTimestamp})`,
        'fields[campaign]': 'name,status,created_at,updated_at,scheduled_at,send_time,archived',
        'sort': '-updated_at'
      }
    });

    // Fetch SMS campaigns from Klaviyo
    let smsResponse;
    try {
      smsResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        },
        params: {
          'filter': `equals(messages.channel,'sms'),greater-than(updated_at,${startTimestamp})`,
          'fields[campaign]': 'name,status,created_at,updated_at,scheduled_at,send_time,archived',
          'sort': '-updated_at'
        }
      });
    } catch (error) {
      console.log('No SMS campaigns or error fetching SMS:', error.message);
      smsResponse = { data: { data: [] } };
    }

    const emailCampaigns = emailResponse.data.data || [];
    const smsCampaigns = smsResponse.data.data || [];
    
    // Remove duplicates by campaign ID
    const allCampaigns = [...emailCampaigns, ...smsCampaigns];
    const uniqueCampaignsMap = new Map();
    allCampaigns.forEach(campaign => {
      if (!uniqueCampaignsMap.has(campaign.id)) {
        uniqueCampaignsMap.set(campaign.id, campaign);
      }
    });
    const campaigns = Array.from(uniqueCampaignsMap.values());

    console.log(`Found ${emailCampaigns.length} email campaigns and ${smsCampaigns.length} SMS campaigns (${campaigns.length} unique)`);

    // Get Placed Order metric ID
    let placedOrderMetricId = null;
    try {
      const metricsListResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        }
      });

      const metrics = metricsListResponse.data?.data || [];
      const placedOrderMetric = metrics.find(m => 
        m.attributes?.name === 'Placed Order' || 
        m.attributes?.name?.toLowerCase().includes('placed order')
      );
      
      if (placedOrderMetric) {
        placedOrderMetricId = placedOrderMetric.id;
        console.log(`✓ Using Placed Order metric ID: ${placedOrderMetricId}`);
      } else {
        console.log('Warning: Could not find Placed Order metric. Campaign metrics may be limited.');
      }
    } catch (error) {
      console.log('Warning: Could not fetch metrics list:', error.message);
    }
    
    // Fetch metrics for each campaign
    const campaignsWithMetrics = [];
    const processedCampaignIds = new Set(); // Track processed campaigns to prevent duplicates
    
    for (let i = 0; i < campaigns.length; i++) {
      const campaign = campaigns[i];
      
      // Skip if already processed (prevent duplicate processing)
      if (processedCampaignIds.has(campaign.id)) {
        console.log(`Skipping duplicate campaign: ${campaign.id}`);
        continue;
      }
      processedCampaignIds.add(campaign.id);
      
      const attributes = campaign.attributes;
      
      // Determine message type from campaign data
      let messageType = 'email'; // default
      
      // Check if this is from SMS campaigns
      if (smsCampaigns.find(c => c.id === campaign.id)) {
        messageType = 'sms';
      }
      
      let campaignData = {
        id: campaign.id,
        name: attributes.name || 'Unnamed Campaign',
        status: attributes.status || 'unknown',
        sendDate: attributes.send_time || attributes.scheduled_at || attributes.created_at,
        createdAt: attributes.created_at,
        updatedAt: attributes.updated_at,
        messageType: messageType,
        recipients: 0,
        opens: 0,
        clicks: 0,
        revenue: 0,
        conversions: 0
      };

      console.log(`Processing campaign: ${campaignData.name} (${campaign.id}) - Status: ${campaignData.status}`);

      // Fetch real metrics for sent campaigns
      if (attributes.status === 'Sent' || attributes.status === 'sent') {
        if (placedOrderMetricId) {
          try {
            // Fetch all metrics in one request with conversion_metric_id
            const metricsResponse = await axios.post(
              `${KLAVIYO_BASE_URL}/campaign-values-reports/`,
              {
                data: {
                  type: 'campaign-values-report',
                  attributes: {
                    statistics: [
                      'recipients',
                      'opens',
                      'clicks',
                      'conversions',
                      'conversion_value',
                      'conversion_uniques'
                    ],
                    timeframe: {
                      key: 'this_year'
                    },
                    conversion_metric_id: placedOrderMetricId,
                    filter: `equals(campaign_id,"${campaign.id}")`
                  }
                }
              },
              {
                headers: {
                  'Authorization': `Klaviyo-API-Key ${userApiKey}`,
                  'revision': '2024-10-15',
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
                }
              }
            );
            console.log('Metrics response:', JSON.stringify(metricsResponse.data, null, 2));
            const results = metricsResponse.data?.data?.attributes?.results || [];
            if (results.length > 0) {
              const stats = results[0].statistics;
              campaignData.recipients = stats.recipients || 0;
              campaignData.opens = stats.opens || 0;
              campaignData.clicks = stats.clicks || 0;
              campaignData.revenue = stats.conversion_value || 0;
              campaignData.conversions = stats.conversion_uniques || stats.conversions || 0;

              console.log(`  ✓ Metrics: ${campaignData.recipients} recipients, ${campaignData.opens} opens, ${campaignData.clicks} clicks, €${campaignData.revenue.toFixed(2)} revenue, ${campaignData.conversions} conversions`);
            } else {
              console.log(`  No results returned for campaign`);
            }

          } catch (error) {
            console.log(`  Could not fetch metrics: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
          }
          
          // Add delay to avoid rate limiting
          // Rate limit is 1/s burst, 2/m steady (120 seconds for 2 requests)
          // Wait 31 seconds between requests to stay under 2/minute
          if (i < campaigns.length - 1) { // Don't wait after the last campaign
            const waitTime = 31;
            console.log(`  Waiting ${waitTime}s before next campaign (rate limit: 2/min)...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          }
        } else {
           console.log(`  Skipping metrics (no Placed Order metric ID available)`);
        }
      }

      campaignsWithMetrics.push(campaignData);
    }

    // Filter to only show campaigns from last 30 days based on updated_at
    const filteredCampaigns = campaignsWithMetrics.filter(campaign => {
      const campaignDate = new Date(campaign.updatedAt || campaign.createdAt);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return campaignDate >= thirtyDaysAgo;
    });

    console.log(`Returning ${filteredCampaigns.length} filtered campaigns`);

    res.json({
      success: true,
      data: filteredCampaigns,
      total: filteredCampaigns.length
    });

  } catch (error) {
    console.error('Error fetching campaigns:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch flows with metrics
app.get('/api/flows', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    console.log('Fetching all flows...');
    
    // Fetch all flows from Klaviyo
    const response = await axios.get(`${KLAVIYO_BASE_URL}/flows/`, {
      headers: {
        "Authorization": `Klaviyo-API-Key ${userApiKey}`,
        "revision": "2024-10-15",
        "Accept": "application/json"
      }
    });
    
    const allFlows = response.data.data || [];
    console.log(`Total flows fetched from API: ${allFlows.length}`);
    
    // Filter out draft flows only
    const beforeDraftFilter = allFlows.length;
    const filteredFlows = allFlows.filter(flow => {
      const status = flow.attributes?.status || '';
      return status.toLowerCase() !== 'draft';
    });
    
    console.log(`Filtered to ${filteredFlows.length} active flows (excluding ${beforeDraftFilter - filteredFlows.length} drafts)`);
    
    // Get Placed Order metric ID for revenue calculation
    let placedOrderMetricId = null;
    try {
      const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        }
      });
      
      const allMetrics = metricsResponse.data?.data || [];
      
      placedOrderMetricId = allMetrics.find(m => 
        m.attributes?.name === 'Placed Order' || 
        m.attributes?.name?.toLowerCase().includes('placed order')
      )?.id;
    } catch (error) {
      console.log('Warning: Could not fetch metrics list:', error.message);
    }
    
    // Initialize flow data structure
    const flowsWithMetrics = filteredFlows.map(flow => {
      const attributes = flow.attributes;
      return {
        id: flow.id,
        name: attributes.name || 'Unnamed Flow',
        status: attributes.status || 'unknown',
        createdAt: attributes.created,
        updatedAt: attributes.updated,
        recipients: 0,
        opens: 0,
        clicks: 0,
        revenue: 0,
        conversions: 0
      };
    });
    
    // Fetch metrics for each flow using flow-values-reports (for recipients, opens, clicks)
    for (let i = 0; i < filteredFlows.length; i++) {
      const flow = filteredFlows[i];
      
      try {
        console.log(`Fetching metrics for flow: ${flow.attributes.name} (${flow.id})`);
        
        // Fetch basic metrics (recipients, opens, clicks) from flow-values-reports
        const metricsResponse = await axios.post(
          `${KLAVIYO_BASE_URL}/flow-values-reports/`,
          {
            data: {
              type: 'flow-values-report',
              attributes: {
                statistics: [
                  'recipients',
                  'opens',
                  'clicks',
                  'conversions',
                      'conversion_value',
                      'conversion_uniques'
                ],
                timeframe: {
                  key: 'last_30_days'
                },
                conversion_metric_id: placedOrderMetricId,
                filter: `equals(flow_id,"${flow.id}")`
              }
            }
          },
          {
            headers: {
              'Authorization': `Klaviyo-API-Key ${userApiKey}`,
              'revision': '2024-10-15',
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('Metrics response:', JSON.stringify(metricsResponse.data, null, 2));
        const results = metricsResponse.data?.data?.attributes?.results || [];
        if (results.length > 0) {
          // Sum up all statistics across all flow messages (results are grouped by flow_message_id)
          const aggregatedStats = {
            recipients: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            conversion_value: 0,
            conversion_uniques: 0
          };
          
          results.forEach(result => {
            const stats = result.statistics || {};
            aggregatedStats.recipients += stats.recipients || 0;
            aggregatedStats.opens += stats.opens || 0;
            aggregatedStats.clicks += stats.clicks || 0;
            aggregatedStats.conversions += stats.conversions || 0;
            aggregatedStats.conversion_value += stats.conversion_value || 0;
            aggregatedStats.conversion_uniques += stats.conversion_uniques || 0;
          });
          
          const flowData = flowsWithMetrics.find(f => f.id === flow.id);
          if (flowData) {
            flowData.recipients = aggregatedStats.recipients;
            flowData.opens = aggregatedStats.opens;
            flowData.clicks = aggregatedStats.clicks;
            flowData.revenue = aggregatedStats.conversion_value;
            flowData.conversions = aggregatedStats.conversion_uniques || aggregatedStats.conversions;
            
            console.log(`  ✓ Metrics: ${flowData.recipients} recipients, ${flowData.opens} opens, ${flowData.clicks} clicks, €${flowData.revenue.toFixed(2)} revenue, ${flowData.conversions} conversions`);
          }
        } else {
          console.log(`  No results returned for flow`);
        }
        
      } catch (error) {
        console.log(`  Could not fetch basic metrics: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
      }
      
      // Add delay to avoid rate limiting
      if (i < filteredFlows.length - 1) {
        const waitTime = 31;
        console.log(`  Waiting ${waitTime}s before next flow (rate limit: 2/min)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
    
    
    console.log(`Returning ${flowsWithMetrics.length} flows with metrics`);
    
    res.json({
      success: true,
      data: flowsWithMetrics,
      total: flowsWithMetrics.length
    });
    
  } catch (error) {
    console.error('Error fetching flows:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch Placed Order events by campaign
app.get('/api/campaigns/by-status', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { status } = req.query;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    // Only support Placed Order
    if (status !== 'Placed Order') {
      return res.json({
        success: false,
        error: 'Only "Placed Order" status is supported'
      });
    }
    
    console.log('Fetching Placed Order events...');
    
    // Get Placed Order metric ID
    const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });
    
    const metrics = metricsResponse.data?.data || [];
    const placedOrderMetric = metrics.find(m => 
      m.attributes?.name === 'Placed Order' ||
      m.attributes?.name?.toLowerCase() === 'placed order'
    );
    
    if (!placedOrderMetric) {
      return res.json({
        success: false,
        error: 'Placed Order metric not found'
      });
    }
    
    console.log(`Using Placed Order metric ID: ${placedOrderMetric.id}`);
    
    // Fetch Placed Order events
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(metric_id,"${placedOrderMetric.id}"),greater-or-equal(datetime,${startTimestamp}, less-than(datetime,${endTimestamp}))`,
        'fields[event]': 'datetime,event_properties',
        'include': 'attributions'
      }
    });

    const events = response.data.data || [];
    const included = response.data.included || [];
    
    console.log(`Processing ${events.length} Placed Order events`);
    
    // Process events to extract attribution data
    const processedEvents = events.map(event => {
      const attrs = event.attributes || {};
      const relationships = event.relationships || {};
      const eventProps = attrs.event_properties || {};
      
      // Get campaign attribution
      let campaignId = null;
      
      // Method 1: From event properties
      campaignId = eventProps['$attributed_campaign'] || 
                   eventProps.campaign_id ||
                   eventProps['Campaign ID'];
      
      // Method 2: From relationships
      if (!campaignId && relationships.attributions) {
        const attributionIds = relationships.attributions.data || [];
        attributionIds.forEach(attrRef => {
          const attribution = included.find(inc => inc.id === attrRef.id && inc.type === 'attribution');
          if (attribution) {
            campaignId = attribution.attributes?.campaign_id || 
                        attribution.attributes?.message_id;
          }
        });
      }
      
      // Method 3: From direct campaign relationships
      if (!campaignId && relationships.campaign) {
        campaignId = relationships.campaign.data?.id;
      }
      
      // Extract revenue
      const revenue = extractRevenue(eventProps, event.id);
      
      return {
        id: event.id,
        type: event.type,
        attributes: {
          datetime: attrs.datetime,
          event_properties: eventProps,
          metric_id: placedOrderMetric.id
        },
        campaignId: campaignId,
        revenue: revenue
      };
    });

    // Calculate summary
    const totalRevenue = processedEvents.reduce((sum, event) => sum + (event.revenue || 0), 0);
    const eventsWithRevenue = processedEvents.filter(e => e.revenue > 0).length;
    const eventsWithCampaign = processedEvents.filter(e => e.campaignId).length;
    
    console.log(`\n[Summary] Placed Order Events`);
    console.log(`[Summary] Event Sample: ${processedEvents[0]}`);
    console.log(`[Summary] Total events: ${processedEvents.length}`);
    console.log(`[Summary] Events with revenue: ${eventsWithRevenue}`);
    console.log(`[Summary] Events with campaign attribution: ${eventsWithCampaign}`);
    console.log(`[Summary] Total revenue: ${totalRevenue.toFixed(2)}`);
    
    // Group by campaign
    const campaignStats = {};
    processedEvents.forEach(event => {
      if (event.campaignId) {
        if (!campaignStats[event.campaignId]) {
          campaignStats[event.campaignId] = { revenue: 0, events: 0 };
        }
        campaignStats[event.campaignId].revenue += (event.revenue || 0);
        campaignStats[event.campaignId].events += 1;
      }
    });
    
    Object.entries(campaignStats).forEach(([campaignId, stats]) => {
      console.log(`[Summary]   Campaign ${campaignId}: ${stats.revenue.toFixed(2)} revenue, ${stats.events} events`);
    });
    console.log('');

    res.json({
      success: true,
      data: processedEvents,
      total: processedEvents.length,
      metricName: 'Placed Order',
      metricId: placedOrderMetric.id
    });

  } catch (error) {
    console.error('Error fetching events:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch campaign values/metrics (aggregate data)
app.get('/api/campaigns/:campaignId/values', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { campaignId } = req.params;
    
    console.log(`Fetching values for campaign: ${campaignId}`);
    
    // Get campaign values using the reporting endpoint
    const valuesResponse = await axios.post(
      `${KLAVIYO_BASE_URL}/campaign-values-reports/`,
      {
        data: {
          type: 'campaign-values-report',
          attributes: {
            statistics: [
              'opens',
              'unique_opens', 
              'clicks',
              'unique_clicks',
              'bounces',
              'recipients'
            ],
            timeframe: {
              key: 'last_30_days'
            }
          },
          relationships: {
            campaigns: {
              data: [
                {
                  type: 'campaign',
                  id: campaignId
                }
              ]
            }
          }
        }
      },
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${userApiKey}`,
          'revision': '2024-10-15',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      data: valuesResponse.data
    });

  } catch (error) {
    console.error('Error fetching campaign values:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Helper endpoint to get all available metrics (for debugging)
app.get('/api/metrics', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const response = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });

    res.json({
      success: true,
      data: response.data.data || []
    });
  } catch (error) {
    console.error('Error fetching metrics:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch attribution data for a campaign
app.get('/api/campaigns/:campaignId/attribution', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { campaignId } = req.params;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log(`Fetching attribution for campaign: ${campaignId}`);
    
    // Get Placed Order events attributed to this campaign
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties'
      }
    });

    const events = response.data.data || [];
    
    // Calculate revenue and conversions from events
    let revenue = 0;
    let conversions = 0;
    
    events.forEach(event => {
      if (event.attributes?.event_properties?.value) {
        revenue += parseFloat(event.attributes.event_properties.value);
        conversions++;
      }
    });

    res.json({
      success: true,
      data: {
        revenue,
        conversions,
        events: events.length
      }
    });

  } catch (error) {
    console.error('Error fetching attribution:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch Placed Order events by flow
app.get('/api/flows/by-status', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { status } = req.query;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    // Only support Placed Order
    if (status !== 'Placed Order') {
      return res.json({
        success: false,
        error: 'Only "Placed Order" status is supported'
      });
    }
    
    console.log('Fetching Placed Order events for flows...');
    
    // Get Placed Order metric ID
    const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });
    
    const metrics = metricsResponse.data?.data || [];
    const placedOrderMetric = metrics.find(m => 
      m.attributes?.name === 'Placed Order' ||
      m.attributes?.name?.toLowerCase() === 'placed order'
    );
    
    if (!placedOrderMetric) {
      return res.json({
        success: false,
        error: 'Placed Order metric not found'
      });
    }
    
    console.log(`Using Placed Order metric ID: ${placedOrderMetric.id}`);
    
    // Fetch Placed Order events
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(metric_id,"${placedOrderMetric.id}"),greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties',
        'include': 'attributions'
      }
    });

    const events = response.data.data || [];
    const included = response.data.included || [];
    
    console.log(`Processing ${events.length} Placed Order events`);
    
    // Process events to extract attribution data
    const processedEvents = events.map(event => {
      const attrs = event.attributes || {};
      const relationships = event.relationships || {};
      const eventProps = attrs.event_properties || {};
      
      // Get flow attribution
      let flowId = null;
      
      // Method 1: From event properties
      flowId = eventProps['$attributed_flow'] || 
               eventProps.flow_id ||
               eventProps['Flow ID'];
      
      // Method 2: From relationships
      if (!flowId && relationships.attributions) {
        const attributionIds = relationships.attributions.data || [];
        attributionIds.forEach(attrRef => {
          const attribution = included.find(inc => inc.id === attrRef.id && inc.type === 'attribution');
          if (attribution) {
            flowId = attribution.attributes?.flow_id || 
                    attribution.attributes?.message_id;
          }
        });
      }
      
      // Method 3: From direct flow relationships
      if (!flowId && relationships.flow) {
        flowId = relationships.flow.data?.id;
      }
      
      // Extract revenue
      const revenue = extractRevenue(eventProps, event.id);
      
      return {
        id: event.id,
        type: event.type,
        attributes: {
          datetime: attrs.datetime,
          event_properties: eventProps,
          metric_id: placedOrderMetric.id
        },
        flowId: flowId,
        revenue: revenue
      };
    });

    // Calculate summary
    const totalRevenue = processedEvents.reduce((sum, event) => sum + (event.revenue || 0), 0);
    const eventsWithRevenue = processedEvents.filter(e => e.revenue > 0).length;
    
    console.log(`Total revenue: €${totalRevenue.toFixed(2)}, Events with revenue: ${eventsWithRevenue}`);

    res.json({
      success: true,
      data: processedEvents,
      total: processedEvents.length,
      summary: {
        totalRevenue,
        eventsWithRevenue
      }
    });

  } catch (error) {
    console.error('Error fetching flow events:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch attribution data for a flow
app.get('/api/flows/:flowId/attribution', authenticate, async (req, res) => {
  try {
    const userApiKey = getUserApiKey(req);
    const { flowId } = req.params;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log(`Fetching attribution for flow: ${flowId}`);
    
    // Get Placed Order metric ID
    const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });
    
    const metrics = metricsResponse.data?.data || [];
    const placedOrderMetric = metrics.find(m => 
      m.attributes?.name === 'Placed Order' ||
      m.attributes?.name?.toLowerCase() === 'placed order'
    );
    
    if (!placedOrderMetric) {
      return res.json({
        success: false,
        error: 'Placed Order metric not found'
      });
    }
    
    // Get Placed Order events attributed to this flow
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${userApiKey}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(metric_id,"${placedOrderMetric.id}"),greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties',
        'include': 'attributions'
      }
    });

    const events = response.data.data || [];
    const included = response.data.included || [];
    
    // Filter events attributed to this flow and calculate revenue
    let revenue = 0;
    let conversions = 0;
    const attributedEvents = [];
    
    events.forEach(event => {
      const eventProps = event.attributes?.event_properties || {};
      const relationships = event.relationships || {};
      
      // Check if event is attributed to this flow
      let isAttributed = false;
      
      // Method 1: From event properties
      const eventFlowId = eventProps['$attributed_flow'] || 
                         eventProps.flow_id ||
                         eventProps['Flow ID'];
      if (eventFlowId === flowId) {
        isAttributed = true;
      }
      
      // Method 2: From relationships
      if (!isAttributed && relationships.attributions) {
        const attributionIds = relationships.attributions.data || [];
        attributionIds.forEach(attrRef => {
          const attribution = included.find(inc => inc.id === attrRef.id && inc.type === 'attribution');
          if (attribution) {
            const attrFlowId = attribution.attributes?.flow_id || 
                              attribution.attributes?.message_id;
            if (attrFlowId === flowId) {
              isAttributed = true;
            }
          }
        });
      }
      
      // Method 3: From direct flow relationships
      if (!isAttributed && relationships.flow) {
        if (relationships.flow.data?.id === flowId) {
          isAttributed = true;
        }
      }
      
      if (isAttributed) {
        const eventRevenue = extractRevenue(eventProps, event.id);
        if (eventRevenue > 0) {
          revenue += eventRevenue;
          conversions++;
        }
        attributedEvents.push(event);
      }
    });

    res.json({
      success: true,
      data: {
        revenue,
        conversions,
        events: attributedEvents.length
      }
    });

  } catch (error) {
    console.error('Error fetching flow attribution:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

