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

// Revenue extraction function for Placed Order events
function extractRevenue(props, eventId = 'unknown') {
  if (!props) return 0;

  // Klaviyo provides revenue in $value for Placed Order events
  if (props['$value'] !== undefined && props['$value'] !== null) {
    const revenue = Number(props['$value']);
    console.log(`[Revenue] Event ${eventId}: Found $value = ${revenue}`);
    return revenue;
  }

  // Fallback revenue fields
  const fallbackFields = ['value', 'Value', 'order_total', 'total_price', 'amount', 'revenue'];

  for (const field of fallbackFields) {
    if (props[field] !== undefined && props[field] !== null) {
      const numValue = Number(props[field]);
      if (!isNaN(numValue) && numValue > 0) {
        console.log(`[Revenue] Event ${eventId}: Found ${field} = ${numValue}`);
        return numValue;
      }
    }
  }

  return 0;
}

// Endpoint to fetch campaigns
app.get('/api/campaigns', async (req, res) => {
  try {
    const { start } = getLast30Days();
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

    // Get Placed Order metric ID
    let placedOrderMetricId = null;
    try {
      const metricsListResponse = await axios.get(`${KLAVIYO_BASE_URL}/metrics/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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

// Endpoint to fetch Placed Order events by campaign
app.get('/api/campaigns/by-status', async (req, res) => {
  try {
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
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
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
      
      if (revenue > 0 && campaignId) {
        console.log(`[Revenue] Event ${event.id}: Revenue = ${revenue}, Campaign = ${campaignId}`);
      }
      
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
