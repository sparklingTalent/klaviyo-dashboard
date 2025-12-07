const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Klaviyo API Configuration
const KLAVIYO_API_KEY = 'pk_45934442c04bbdf4152ff210e2330a3275';
const KLAVIYO_BASE_URL = 'https://a.klaviyo.com/api';

// Check if using public key (limited permissions)
const isPublicKey = KLAVIYO_API_KEY.startsWith('pk_');
if (isPublicKey) {
  console.warn('⚠️  WARNING: Using public API key. Metrics and reporting may not be available.');
  console.warn('⚠️  For full functionality, use a Private API Key (starts with "sk_")');
}

// Helper function to get date 30 days ago
function getLast30Days() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString()
  };
}

// Endpoint to fetch campaigns
app.get('/api/campaigns', async (req, res) => {
  try {
    const { start, end } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log('Fetching campaigns created after:', startTimestamp);
    
    // Fetch email campaigns from Klaviyo
    const emailResponse = await axios.get(`${KLAVIYO_BASE_URL}/campaigns/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
    const campaigns = [...emailCampaigns, ...smsCampaigns];

    console.log(`Found ${emailCampaigns.length} email campaigns and ${smsCampaigns.length} SMS campaigns`);

    
    // Get the Placed Order metric ID once (needed for all campaign metrics)
    let placedOrderMetricId = null;
    try {
      console.log('Fetching metrics list...');
      const metricsListResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        }
      });

      const metrics = metricsListResponse.data?.data || [];
      console.log(`Found ${metrics.length} total metrics`);
      
      // Find Placed Order metric
      const placedOrderMetric = metrics.find(m => 
        m.attributes?.name === 'Placed Order' || 
        m.attributes?.name === 'placed_order' ||
        m.attributes?.name?.toLowerCase().includes('placed order')
      );
      
      if (placedOrderMetric) {
        placedOrderMetricId = placedOrderMetric.id;
        console.log(`✓ Using Placed Order metric ID: ${placedOrderMetricId}`);
      } else {
        // Try to use any order-related metric
        const orderMetric = metrics.find(m => 
          m.attributes?.name?.toLowerCase().includes('order')
        );
        if (orderMetric) {
          placedOrderMetricId = orderMetric.id;
          console.log(`✓ Using order metric: ${orderMetric.attributes.name} (${placedOrderMetricId})`);
        } else {
          console.log('Available metrics:', metrics.map(m => m.attributes?.name).join(', '));
          console.log('Warning: Could not find order metric. Campaign metrics may be limited.');
        }
      }
    } catch (error) {
      console.log('Warning: Could not fetch metrics list:', error.response?.data?.errors?.[0]?.detail || error.message);
      console.log('Full error:', error.response?.data || error.message);
    }
    
    // Fetch metrics for each campaign
    const campaignsWithMetrics = [];
    
    for (let i = 0; i < campaigns.length; i++) {
      const campaign = campaigns[i];
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
                  'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
                  'revision': '2024-10-15',
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
                }
              }
            );

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
          console.log(`  Skipping metrics (no conversion metric ID available)`);
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

// Endpoint to fetch campaign metrics by status filter
app.get('/api/campaigns/by-status', async (req, res) => {
  try {
    const { status } = req.query; // e.g., "Confirmed Shipment"
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log(`Fetching events with status: ${status}`);
    
    // Map Shopify status to Klaviyo metric names
    const metricMap = {
      'Confirmed Shipment': 'Fulfilled Order',
      'Cancelled Order': 'Cancelled Order',
      'Checkout Started': 'Started Checkout',
      'Fulfilled Order': 'Fulfilled Order',
      'Fulfilled Partial Order': 'Fulfilled Order',
      'Ordered Product': 'Ordered Product',
      'Placed Order': 'Placed Order',
      'Refunded Order': 'Refunded Order'
    };
    
    const metricName = metricMap[status] || 'Placed Order';
    
    // First, get the metric ID for this metric name
    const metricsResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      }
    });
    
    const metrics = metricsResponse.data?.data || [];
    const targetMetric = metrics.find(m => 
      m.attributes?.name === metricName ||
      m.attributes?.name?.toLowerCase() === metricName.toLowerCase()
    );
    
    if (!targetMetric) {
      return res.json({
        success: false,
        error: `Metric "${metricName}" not found in your account`,
        availableMetrics: metrics.map(m => m.attributes?.name)
      });
    }
    
    console.log(`Using metric ID: ${targetMetric.id} for "${metricName}"`);
    
    // Now fetch events for this metric
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(metric_id,"${targetMetric.id}"),greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties',
        'include': 'attributions'
      }
    });

    const events = response.data.data || [];
    
    // Process events to extract attribution data
    const processedEvents = events.map(event => {
      const attrs = event.attributes || {};
      return {
        id: event.id,
        type: event.type,
        attributes: {
          datetime: attrs.datetime,
          event_properties: attrs.event_properties || {},
          metric_id: targetMetric.id // Use the metric ID we already know from the filter
        },
        // Extract campaign attribution if available
        campaignId: attrs.event_properties?.['$attributed_campaign'] || 
                   attrs.event_properties?.campaign_id ||
                   attrs.event_properties?.['Campaign ID'] || null
      };
    });

    res.json({
      success: true,
      data: processedEvents,
      total: processedEvents.length,
      metricName: metricName,
      metricId: targetMetric.id
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
app.get('/api/campaigns/:campaignId/values', async (req, res) => {
  try {
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
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
  console.log(`Server running on http://localhost:${PORT}`);
});

// Helper endpoint to get all available metrics (for debugging)
app.get('/api/metrics', async (req, res) => {
  try {
    const response = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
app.get('/api/campaigns/:campaignId/attribution', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log(`Fetching attribution for campaign: ${campaignId}`);
    
    // Get Placed Order events attributed to this campaign
    const response = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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