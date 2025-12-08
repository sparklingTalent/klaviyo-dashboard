const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Klaviyo API Configuration
const KLAVIYO_API_KEY = 'pk_5d482f880975d2a203a16afff3530fa2ce';
const KLAVIYO_BASE_URL = 'https://a.klaviyo.com/api';

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
function extractRevenue(props) {
  if (!props) return 0;

  // Klaviyo provides revenue in $value for Placed Order events
  if (props['$value'] !== undefined && props['$value'] !== null) {
    return Number(props['$value']) || 0;
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

// Extract campaign ID from event - prioritize $attributed_campaign
function extractCampaignId(event, included = []) {
  const attrs = event.attributes || {};
  const eventProps = attrs.event_properties || {};
  
  // Method 1: $message_interaction (same as campaign ID - MOST RELIABLE)
  if (eventProps['$message_interaction']) {
    return eventProps['$message_interaction'];
  }
  
  // Method 2: $attributed_campaign (reliable for attribution)
  if (eventProps['$attributed_campaign']) {
    return eventProps['$attributed_campaign'];
  }
  
  // Method 3: $attributed_message (also reliable)
  if (eventProps['$attributed_message']) {
    return eventProps['$attributed_message'];
  }
  
  // Method 4: Other campaign fields (fallback)
  if (eventProps['$message']) {
    return eventProps['$message'];
  }
  
  if (eventProps['campaign_id'] || eventProps['Campaign ID']) {
    return eventProps['campaign_id'] || eventProps['Campaign ID'];
  }
  
  // Method 4: From relationships (last resort)
  const relationships = event.relationships || {};
  if (relationships.attributions) {
    const attributionIds = relationships.attributions.data || [];
    for (const attrRef of attributionIds) {
      const attribution = included.find(inc => inc.id === attrRef.id && inc.type === 'attribution');
      if (attribution && attribution.attributes) {
        return attribution.attributes.attributed_message || 
               attribution.attributes.campaign_id ||
               attribution.attributes.message_id;
      }
    }
  }
  
  if (relationships.campaign) {
    return relationships.campaign.data?.id;
  }
  
  return null;
}

// Endpoint to fetch campaigns with metrics from Events API
app.get('/api/campaigns', async (req, res) => {
  try {
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log('Fetching campaigns created after:', startTimestamp);
    
    // Fetch email campaigns
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

    // Fetch SMS campaigns
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
      console.log('No SMS campaigns:', error.message);
      smsResponse = { data: { data: [] } };
    }

    const emailCampaigns = emailResponse.data.data || [];
    const smsCampaigns = smsResponse.data.data || [];
    const campaigns = [...emailCampaigns, ...smsCampaigns];

    console.log(`Found ${emailCampaigns.length} email + ${smsCampaigns.length} SMS campaigns`);

    // Get Placed Order metric ID
    console.log('Fetching metrics...');
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
      m.attributes?.name?.toLowerCase().includes('placed order')
    );
    
    if (!placedOrderMetric) {
      console.log('Warning: Placed Order metric not found');
      console.log(campaigns);
      return res.json({
        success: true,
        data: campaigns.map(c => ({
          id: c.id,
          name: c.attributes.name,
          status: c.attributes.status,
          sendDate: c.attributes.send_time || c.attributes.created_at,
          messageType: smsCampaigns.find(s => s.id === c.id) ? 'sms' : 'email',
          recipients: 0,
          opens: 0,
          clicks: 0,
          revenue: 0,
          conversions: 0
        })),
        total: campaigns.length
      });
    }
    
    console.log(`✓ Using Placed Order metric ID: ${placedOrderMetric.id}`);
    // Fetch ALL Placed Order events from last 30 days using Events API (high rate limit!)
    console.log('Fetching Placed Order events from Events API...');
    
    // Fetch all events with pagination
    let allEvents = [];
    let nextCursor = null;
    
    do {
      const params = {
        'filter': `equals(metric_id,"${placedOrderMetric.id}"),greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties',
        'page[size]': 200
      };
      
      if (nextCursor) {
        params['page[cursor]'] = nextCursor;
      }
      
      const eventsResponse = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          'revision': '2024-10-15',
          'Accept': 'application/json'
        },
        params: params
      });
      
      const events = eventsResponse.data.data || [];
      allEvents = allEvents.concat(events);
     
      console.log("total events", events.length);
      // Check for next page
      const links = eventsResponse.data.links;
      nextCursor = links?.next ? new URL(links.next).searchParams.get('page[cursor]') : null;
      
      console.log(`  Fetched ${events.length} events (total so far: ${allEvents.length})`);
      
    } while (nextCursor);
    
    let events = allEvents;
    let eventRevenueWithID = {}
    console.log("events", events[0]);
    const totalRevenue = events.reduce((acc, event) => {
        const eventProps = event.attributes?.event_properties || {};
        const value = eventProps['$value'];
        eventRevenueWithID[event.id] = value;
        if (value !== undefined && value !== null) {
          const revenue = Number(value);
          if (!isNaN(revenue) && revenue > 0) {
            return acc + revenue;
          }
        }
        return acc;
      }, 0).toFixed(2);
    console.log(`✓ Found ${events.length} Placed Order events (fetched with pagination)`);

    // Filter events to only include those with campaign or flow attribution
    const filteredEvents = events.filter(event => {
      const eventProps = event.attributes?.event_properties || {};
      const relationships = event.relationships || {};
      
      // Check for campaign attribution
      const hasCampaign = !!(
        eventProps['$message_interaction'] ||
        eventProps['$attributed_campaign'] ||
        eventProps['$attributed_message'] ||
        eventProps['$message'] ||
        eventProps['campaign_id'] ||
        eventProps['Campaign ID'] ||
        relationships.attributions?.data?.length > 0 ||
        relationships.campaign?.data?.id
      );
      
      // Check for flow attribution
      const hasFlow = !!(
        eventProps['$attributed_flow'] ||
        eventProps['flow_id'] ||
        eventProps['Flow ID'] ||
        relationships.flow?.data?.id
      );
      
      return hasCampaign || hasFlow;
    });
    
    console.log(`✓ Filtered to ${filteredEvents.length} events with campaign or flow attribution (from ${events.length} total)`);
    
    // Use filtered events
    events = filteredEvents;
    

    
    // Build attribution map: campaign_id -> {revenue, conversions}
    const campaignAttribution = {};
    let eventsWithRevenue = 0;
    let eventsWithAttribution = 0;
    let eventsAttributedToCampaigns = 0;
    
    events.forEach(event => {
      const eventProps = event.relationships.metric || {};
      console.log("event props", eventProps);
      const campaignId = event.attributes?.event_properties?.['$message_interaction'] || {};
      const revenue = extractRevenue(eventProps);
      console.log("111revenue: ", revenue, campaignId);
      if (revenue > 0) {
        eventsWithRevenue++;
      }
      
      if (campaignId) {
        eventsWithAttribution++;
        // Check if this campaign ID matches any of our campaigns
        const isCampaignInList = campaigns.some(c => c.id === campaignId);
        if (isCampaignInList) {
          eventsAttributedToCampaigns++;
        }
        
        if (!campaignAttribution[campaignId]) {
          campaignAttribution[campaignId] = { revenue: 0, conversions: 0 };
        }
        
        campaignAttribution[campaignId].revenue += revenue;
        campaignAttribution[campaignId].conversions += 1;
      }
    });
    
    console.log(`\n[Attribution Summary]`);
    console.log(`  Total Placed Order events: ${events.length}`);
    console.log(`  Events with revenue ($value): ${eventsWithRevenue}`);
    console.log(`  Events with attribution: ${eventsWithAttribution}`);
    console.log(`  Events attributed to campaigns in list: ${eventsAttributedToCampaigns}`);
    console.log(`  Total revenue: €${totalRevenue}`);
    console.log(`  Unique campaigns with attribution: ${Object.keys(campaignAttribution).length}\n`);
    
    // Now get email engagement metrics (opens, clicks) from Events API
    console.log('Fetching email engagement events...');
    
    // Get Opened Email and Clicked Email metric IDs
    const openedEmailMetric = metrics.find(m => 
      m.attributes?.name === 'Opened Email' || 
      m.attributes?.name?.toLowerCase().includes('opened email') ||
      m.attributes?.name?.toLowerCase().includes('open')
    );
    const clickedEmailMetric = metrics.find(m => 
      m.attributes?.name === 'Clicked Email' || 
      m.attributes?.name?.toLowerCase().includes('clicked email') ||
      m.attributes?.name?.toLowerCase().includes('click')
    );
    
    if (openedEmailMetric) {
      console.log(`Found Opened Email metric: ${openedEmailMetric.attributes.name} (${openedEmailMetric.id})`);
    }
    if (clickedEmailMetric) {
      console.log(`Found Clicked Email metric: ${clickedEmailMetric.attributes.name} (${clickedEmailMetric.id})`);
    }
    
    // Fetch Opened Email events
    let openEvents = [];
    if (openedEmailMetric) {
      try {
        // Fetch all opened email events with pagination
        let allOpenEvents = [];
        let nextCursor = null;
        
        do {
          const params = {
            'filter': `equals(metric_id,"${openedEmailMetric.id}"),greater-than(datetime,${startTimestamp})`,
            'fields[event]': 'event_properties',
            'page[size]': 100
          };
          
          if (nextCursor) {
            params['page[cursor]'] = nextCursor;
          }
          
          const openResponse = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
            headers: {
              'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
              'revision': '2024-10-15',
              'Accept': 'application/json'
            },
            params: params
          });
          
          const events = openResponse.data.data || [];
          allOpenEvents = allOpenEvents.concat(events);
          
          // Check for next page
          const links = openResponse.data.links;
          nextCursor = links?.next ? new URL(links.next).searchParams.get('page[cursor]') : null;
          
          console.log(`  Fetched ${events.length} open events (total so far: ${allOpenEvents.length})`);
        } while (nextCursor);
        
        // Filter events to only include those with campaign or flow attribution
        const filteredOpenEvents = allOpenEvents.filter(event => {
          const eventProps = event.attributes?.event_properties || {};
          const relationships = event.relationships || {};
          
          // Check for campaign attribution
          const hasCampaign = !!(
            eventProps['$attributed_campaign'] ||
            eventProps['$attributed_message'] ||
            eventProps['$message_interaction'] ||
            eventProps['$message'] ||
            eventProps['campaign_id'] ||
            eventProps['Campaign ID'] ||
            relationships.attributions?.data?.length > 0 ||
            relationships.campaign?.data?.id
          );
          
          // Check for flow attribution
          const hasFlow = !!(
            eventProps['$attributed_flow'] ||
            eventProps['flow_id'] ||
            eventProps['Flow ID'] ||
            relationships.flow?.data?.id
          );
          
          return hasCampaign || hasFlow;
        });
        
        openEvents = filteredOpenEvents;
        console.log(`✓ Found ${allOpenEvents.length} Opened Email events (fetched with pagination)`);
        console.log(`✓ Filtered to ${openEvents.length} events with campaign or flow attribution`);
        
       
      } catch (error) {
        console.log('Could not fetch open events:', error.message);
      }
    }
    
    // Fetch Clicked Email events
    let clickEvents = [];
    if (clickedEmailMetric) {
      try {
        // Fetch all clicked email events with pagination
        let allClickEvents = [];
        let nextCursor = null;
        
        do {
          const params = {
            'filter': `equals(metric_id,"${clickedEmailMetric.id}"),greater-than(datetime,${startTimestamp})`,
            'fields[event]': 'event_properties',
            'page[size]': 200
          };
          
          if (nextCursor) {
            params['page[cursor]'] = nextCursor;
          }
          
          const clickResponse = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
            headers: {
              'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
              'revision': '2024-10-15',
              'Accept': 'application/json'
            },
            params: params
          });
          
          const events = clickResponse.data.data || [];
          allClickEvents = allClickEvents.concat(events);
          
          // Check for next page
          const links = clickResponse.data.links;
          nextCursor = links?.next ? new URL(links.next).searchParams.get('page[cursor]') : null;
          
          console.log(`  Fetched ${events.length} click events (total so far: ${allClickEvents.length})`);
        } while (nextCursor);
        
        // Filter events to only include those with campaign or flow attribution
        const filteredClickEvents = allClickEvents.filter(event => {
          const eventProps = event.attributes?.event_properties || {};
          const relationships = event.relationships || {};
          
          // Check for campaign attribution
          const hasCampaign = !!(
            eventProps['$attributed_campaign'] ||
            eventProps['$attributed_message'] ||
            eventProps['$message_interaction'] ||
            eventProps['$message'] ||   
            eventProps['campaign_id'] ||
            eventProps['Campaign ID'] ||
            relationships.attributions?.data?.length > 0 ||
            relationships.campaign?.data?.id
          );
          
          // Check for flow attribution
          const hasFlow = !!(
            eventProps['$attributed_flow'] ||
            eventProps['flow_id'] ||
            eventProps['Flow ID'] ||
            relationships.flow?.data?.id
          );
          
          return hasCampaign || hasFlow;
        });
        
        clickEvents = filteredClickEvents;
        console.log("click events", clickEvents[0]);
          const eventProps = event.attributes?.event_properties || {};
        console.log(`✓ Found ${allClickEvents.length} Clicked Email events (fetched with pagination)`);
        console.log(`✓ Filtered to ${clickEvents.length} events with campaign or flow attribution`);
      } catch (error) {
        console.log('Could not fetch click events:', error.message);
      }
    }
    console.log("event ID: ", openEvents[0].attributes?.event_properties?.['$event_id'].split(':')[2]);
    // Build engagement maps
    const campaignOpens = {};
    const campaignClicks = {};
    const campaignRecipients = {};
    console.log("open events", openEvents[0]);
    const campaignOpenRevenue = {};
    openEvents.forEach(event => {
      const eventProps = event.attributes?.event_properties || {};
      const eventID = event.id;

      const value = eventRevenueWithID[eventID] || 0;   
      if (value) {
        console.log("value isn't ", value, eventID);
      }
      const campaignId = event.attributes?.event_properties?.['$message_interaction'] || {};
      if (campaignId) {
        campaignOpens[campaignId] = (campaignOpens[campaignId] || 0) + 1;
        if (value !== undefined && value !== null) {
          const revenue = Number(value);
          if (!isNaN(revenue) && revenue > 0) {
            campaignOpenRevenue[campaignId] = (campaignOpenRevenue[campaignId] || 0) + revenue;
          }
        }
      }
    });
    
    // Calculate revenue from click events per campaign
    const campaignClickRevenue = {};
    
    clickEvents.forEach(event => {
      const campaignId = event.attributes?.event_properties?.['$message_interaction'];
      const eventProps = event.attributes?.event_properties || {};
      const value = eventProps['$value'];
      
      if (campaignId) {
        // Count clicks
        campaignClicks[campaignId] = (campaignClicks[campaignId] || 0) + 1;
        
        // Sum revenue from click events that have $value
        if (value !== undefined && value !== null) {
          const revenue = Number(value);
          if (!isNaN(revenue) && revenue > 0) {
            campaignClickRevenue[campaignId] = (campaignClickRevenue[campaignId] || 0) + revenue;
          }
        }
      }
    });
    
    // Estimate recipients from unique profiles that opened
    const campaignProfiles = {};
    openEvents.forEach(event => {
      const campaignId = event.attributes?.event_properties?.['$message_interaction'];
      const profileId = event.relationships?.profile?.data?.id;
      if (campaignId && profileId) {
        if (!campaignProfiles[campaignId]) {
          campaignProfiles[campaignId] = new Set();
        }
        campaignProfiles[campaignId].add(profileId);
      }
    });
    
    Object.keys(campaignProfiles).forEach(campaignId => {
      campaignRecipients[campaignId] = campaignProfiles[campaignId].size;
    });
    
    // Build final campaign data
    const campaignsWithMetrics = campaigns.map(campaign => {
      const attributes = campaign.attributes;
      const attribution = campaignAttribution[campaign.id];
      
      // Calculate total revenue: Placed Order revenue + Click event revenue
      const placedOrderRevenue = attribution ? attribution.revenue : 0;
      const clickRevenue = campaignClickRevenue[campaign.id] || 0;
      const totalAttributedRevenue = placedOrderRevenue + clickRevenue + campaignOpenRevenue[campaign.id] || 0;
      console.log("total revenue", totalAttributedRevenue);
      const campaignData = {
        id: campaign.id,
        name: attributes.name || 'Unnamed Campaign',
        status: attributes.status || 'unknown',
        sendDate: attributes.send_time || attributes.scheduled_at || attributes.created_at,
        createdAt: attributes.created_at,
        updatedAt: attributes.updated_at,
        messageType: smsCampaigns.find(c => c.id === campaign.id) ? 'sms' : 'email',
        recipients: campaignRecipients[campaign.id] || 0,
        opens: campaignOpens[campaign.id] || 0,
        clicks: campaignClicks[campaign.id] || 0,
        revenue: totalAttributedRevenue,
        conversions: attribution ? attribution.conversions : 0
      };
      
      if (attribution) {
        console.log(`  "${campaignData.name}": ${campaignData.opens} opens, ${campaignData.clicks} clicks, €${attribution.revenue.toFixed(2)} revenue, ${attribution.conversions} conversions`);
      }
      
      return campaignData;
    });

    console.log(`\n✓ Returning ${campaignsWithMetrics.length} campaigns with full metrics\n`);

    res.json({
      success: true,
      data: campaignsWithMetrics,
      total: campaignsWithMetrics.length
    });

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

// Endpoint to fetch events by order status (for filtering)
app.get('/api/campaigns/by-status', async (req, res) => {
  try {
    const { status } = req.query;
    const { start } = getLast30Days();
    const startTimestamp = new Date(start).toISOString();
    
    console.log(`\nFetching events for status: ${status}`);
    
    // Map status to metric name
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
    
    // Get metric ID
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
        error: `Metric "${metricName}" not found`
      });
    }
    
    console.log(`Using metric: ${metricName} (${targetMetric.id})`);
    
    // Fetch events
    const eventsResponse = await axios.get(`${KLAVIYO_BASE_URL}/events/`, {
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision': '2024-10-15',
        'Accept': 'application/json'
      },
      params: {
        'filter': `equals(metric_id,"${targetMetric.id}"),greater-than(datetime,${startTimestamp})`,
        'fields[event]': 'datetime,event_properties'
      }
    });

    const events = eventsResponse.data.data || [];
    
    console.log(`Found ${events.length} ${metricName} events`);
    
    // Process events
    const processedEvents = events.map(event => {
      const eventProps = event.attributes?.event_properties || {};
      const campaignId = extractCampaignId(event, []);
      const revenue = extractRevenue(eventProps);
      
      return {
        id: event.id,
        type: event.type,
        attributes: {
          datetime: event.attributes?.datetime,
          event_properties: eventProps
        },
        campaignId: campaignId,
        revenue: revenue
      };
    });

    // Calculate summary
    const totalRevenue = processedEvents.reduce((sum, e) => sum + e.revenue, 0);
    const eventsWithCampaign = processedEvents.filter(e => e.campaignId).length;
    
    console.log(`  Events with campaign: ${eventsWithCampaign}`);
    console.log(`  Total revenue: €${totalRevenue.toFixed(2)}\n`);

    res.json({
      success: true,
      data: processedEvents,
      total: processedEvents.length,
      metricName: metricName,
      metricId: targetMetric.id
    });

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}\n`);
});