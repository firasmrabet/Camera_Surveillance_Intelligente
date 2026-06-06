#!/usr/bin/env node
require('dotenv').config();
const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node verify_caller_id.js +<countrycode><number>');
  process.exit(1);
}

(async () => {
  try {
    console.log('Requesting verification call for', phone);
    const res = await client.outgoingCallerIds.create({ phoneNumber: phone });
    console.log('Verification initiated. SID:', res.sid);
    console.log('You should receive a call at', phone, 'shortly. Answer it and note the code.');
  } catch (err) {
    console.error('Failed to initiate verification:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
