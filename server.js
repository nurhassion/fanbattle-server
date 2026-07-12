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
      payments.forEach(p => seenPaymentIds.add(p.payment_id));
      isFirstRun = false;
      return;
    }

    for (const p of payments) {
      if (p.status === 'Credit' && !seenPaymentIds.has(p.payment_id)) {
        seenPaymentIds.add(p.payment_id);

        const purposeRaw = p.purpose || '';
        let side = null;
        if (/^R:/i.test(purposeRaw.trim())) side = 'right';
        else if (/^L:/i.test(purposeRaw.trim())) side = 'left';

        if (!side) {
          console.log('⚠️ Could not determine side for payment, skipping:', purposeRaw);
          continue;
        }

        const event = {
          name: p.buyer_name || 'Anonymous',
          side: side,
          amount: parseFloat(p.amount),
          purpose: purposeRaw
        };

        latestEvents.push(event);
        console.log('🎉 New payment detected:', event);
      }
    }
  } catch (err) {
    console.error('Error fetching payments:', err.message);
  }
}

setInterval(fetchRecentPayments, POLL_INTERVAL_MS);
fetchRecentPayments();

app.get('/events', (req, res) => {
  const eventsToSend = [...latestEvents];
  latestEvents = [];
  res.json({ events: eventsToSend });
});

app.get('/', (req, res) => {
  res.send('Fan Battle Live automation server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
