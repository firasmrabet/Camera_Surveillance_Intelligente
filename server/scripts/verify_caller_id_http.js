#!/usr/bin/env node
require('dotenv').config();
const https = require('https');
const querystring = require('querystring');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const phone = process.argv[2];

if (!accountSid || !authToken) {
  console.error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set in environment');
  process.exit(1);
}
if (!phone) {
  console.error('Usage: node verify_caller_id_http.js +<countrycode><number>');
  process.exit(1);
}

const postData = querystring.stringify({ PhoneNumber: phone });
const options = {
  hostname: 'api.twilio.com',
  port: 443,
  path: `/2010-04-01/Accounts/${accountSid}/OutgoingCallerIds.json`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  }
};

console.log('Requesting verification call for', phone);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Verification initiated. SID:', parsed.sid);
        console.log('You should receive a call at', phone, 'shortly. Answer it and note the code.');
      } else {
        console.error('Twilio API error', res.statusCode, parsed);
        process.exit(2);
      }
    } catch (err) {
      console.error('Failed to parse Twilio response:', err.message);
      console.error('Raw response:', data);
      process.exit(3);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(4);
});

req.write(postData);
req.end();
