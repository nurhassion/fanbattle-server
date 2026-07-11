// Fan Battle Live — Automation Server
// Polls Instamojo for new payments and pushes them to the browser overlay live.

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());

// ====== FILL THESE IN (from Instamojo API & Plugins page) ======
const API_KEY = process.env.IM_API_KEY || 'PASTE_YOUR_PRIVATE_API_KEY_HERE';
const AUTH_TOKEN = process.env.IM_AUTH_TOKEN || 'PASTE_YOUR_PRIVATE_AUTH_TOKEN_HERE';
// =================================================================

const POLL_INTERVAL_MS = 5000; // check every 5 seconds
let seenPaymentIds = new Set();
let latestEvents = []; // events waiting to be delivered to the browser overlay
let isFirstRun = true;

async function fetchRecentPayments() {
  try {
    const res = await fetch('https://www.instamojo.com/api/1.1/payments/', {
      headers: {
        'X-Api-Key': API_KEY,
        'X-Auth-Token': AUTH_TOKEN
      }
    });
    const data = await res.json();

    if (!data.success) {
      console.error('Instamojo API error:', data.message || data);
      return;
    }

    const payments = data.payments || [];

    if (isFirstRun) {
      console.log(`Startup check: found ${payments.length} payment(s) on this account.`);
      if (payments.length > 0) {
        console.log('Most recent payment:', {
          id: payments[0].payment_id,
          amount: payments[0].amount,
          status: payments[0].status,
          purpose: payments[0].purpose
        });
        console.log('✅ API connection working — your test payment should appear above if it was ₹9.');
      }
      // Mark everything that already exists as "seen" so we don't re-announce old payments
      payments.forEach(p => seenPaymentIds.add(p.payment_id));
      isFirstRun = false;
      return;
    }

    // Look for brand-new, successful payments we haven't processed yet
    for (const p of payments) {
      if (p.status === 'Credit' && !seenPaymentIds.has(p.payment_id)) {
        seenPaymentIds.add(p.payment_id);

        // Determine which side (Left/Right) based on which Smart Page purpose/page it came from
        const purposeText = (p.purpose || '').toLowerCase();
        // NOTE: adjust this matching logic once we confirm exactly how "purpose" or
        // page reference appears in the payment data for Smart Pages
        let side = 'left';
        if (purposeText.includes('right')) side = 'right';
        if (purposeText.includes('left')) side = 'left';

        const event = {
          name: p.buyer_name || 'Anonymous',
          side: side,
          amount: parseFloat(p.amount),
          purpose: p.purpose
        };

        latestEvents.push(event);
        console.log('🎉 New payment detected:', event);
      }
    }
  } catch (err) {
    console.error('Error fetching payments:', err.message);
  }
}

// Start polling
setInterval(fetchRecentPayments, POLL_INTERVAL_MS);
fetchRecentPayments(); // run once immediately on startup

// The browser overlay (HTML file) will call this endpoint every couple of seconds
// to check "did anything new happen?"
app.get('/events', (req, res) => {
  const eventsToSend = [...latestEvents];
  latestEvents = []; // clear after sending
  res.json({ events: eventsToSend });
});

app.get('/', (req, res) => {
  res.send('Fan Battle Live automation server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
