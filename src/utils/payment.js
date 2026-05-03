'use strict';

const crypto = require('crypto');

// Build a signed checkout URL for the payment service.
// Signature is computed over raw (decoded) values sorted alphabetically,
// then values are URL-encoded for the actual URL.
function buildCheckoutUrl(paymentServiceUrl, { appId, apiKey, amount, returnUrl, clientTransactionId }) {
  const params = {
    app_id: appId,
    amount: Number(amount).toFixed(2),
    client_transaction_id: clientTransactionId,
    return_url: returnUrl,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  };

  const sortedKeys = Object.keys(params).sort();
  const signingStr = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHmac('sha256', apiKey).update(signingStr).digest('hex');

  const urlParams = new URLSearchParams({ ...params, signature });
  return `${paymentServiceUrl}/checkout?${urlParams}`;
}

module.exports = { buildCheckoutUrl };
