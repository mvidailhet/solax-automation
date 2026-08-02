# solax-automation

Polls the SolaX Cloud Open API for one inverter and prints solar production
and house consumption to the console.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `SOLAX_CLIENT_ID`,
   `SOLAX_CLIENT_SECRET`, and `SOLAX_DEVICE_SN` from your SolaX Cloud
   developer account. The script obtains and refreshes its own access
   token automatically — no manual token copying needed.
3. `npm start`

## Test

`npm test`