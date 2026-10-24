// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the TiltPiApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TiltPiApp } from './src/app.js';
import { ACTIONS, STATE_FILE } from './src/constants.js';
import { fileStorage } from './src/store.js';

const gladys = new GladysIntegration();
// The pace, the pause and the Tilts met are kept in /data, the one writable
// volume, so that a restart loop never reads faster than the interval nor
// publishes a reading twice.
const app = new TiltPiApp({ gladys, storage: fileStorage(STATE_FILE, { logger }) });

// --- Discovery: the Tilts already read (no extra call) --------------------------
gladys.onScanRequest(() => app.publishDiscovered({ force: true }));

// --- A device was created: send its last reading now (dated) -------------------
gladys.onDeviceCreated(() => app.publishStates());

// --- Configuration screen button -----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user -----------------------------------------
gladys.onConfigUpdated(async (config) => {
  logger.info('Configuration updated: restarting');
  await app.start(config);
});

// --- Connection lifecycle -------------------------------------------------------
// A reconnection keeps the pace and the pause; the status and the Discovery
// list are published again (Gladys keeps them in memory only).
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err?.message ?? err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.shutdown());

logger.info('Starting the Tilt Pi integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err?.message ?? err);
  process.exit(1);
});
