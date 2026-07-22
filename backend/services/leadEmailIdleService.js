const getLeadEmailIngestion = () => require('./leadEmailIngestionService');

const IDLE_MAILBOX = process.env.LEAD_EMAIL_IDLE_MAILBOX || 'INBOX';
const SYNC_DEBOUNCE_MS = parseInt(process.env.LEAD_EMAIL_SYNC_DEBOUNCE_MS || '2000', 10);
const INITIAL_RECONNECT_MS = parseInt(process.env.LEAD_EMAIL_IDLE_RECONNECT_MS || '1000', 10);
const MAX_RECONNECT_MS = parseInt(process.env.LEAD_EMAIL_IDLE_MAX_RECONNECT_MS || '60000', 10);

let started = false;
let shuttingDown = false;
let idleConnected = false;
let client = null;
let debounceTimer = null;
let reconnectBackoffMs = INITIAL_RECONNECT_MS;
let resolveOnClose = null;

const log = (message) => console.log(`[LeadEmailIdle] ${message}`);
const logError = (message) => console.error(`[LeadEmailIdle] ${message}`);

const clearDebounceTimer = () => {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
};

const returnToIdleMailbox = async () => {
    if (!client || shuttingDown) return;
    await client.mailboxOpen(IDLE_MAILBOX);
    log(`Returned to ${IDLE_MAILBOX} — waiting in IDLE mode`);
};

const runDebouncedSync = () => {
    clearDebounceTimer();
    debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (shuttingDown || !client) return;

        try {
            log('Synchronization started');
            const { runLeadEmailSync } = getLeadEmailIngestion();
            await runLeadEmailSync({ client });
            log('Synchronization completed');
        } catch (error) {
            logError(`Synchronization error: ${error.message}`);
        }

        try {
            await returnToIdleMailbox();
        } catch (error) {
            logError(`Failed to reopen ${IDLE_MAILBOX} after sync: ${error.message}`);
        }
    }, SYNC_DEBOUNCE_MS);
};

const onExists = (data) => {
    log(`New email detected in ${IDLE_MAILBOX} (count: ${data.count}, was: ${data.prevCount})`);
    runDebouncedSync();
};

const onClientError = (error) => {
    logError(`IMAP connection error: ${error.message}`);
};

const onClientClose = () => {
    idleConnected = false;
    log('IMAP disconnected');
    if (resolveOnClose) {
        resolveOnClose();
        resolveOnClose = null;
    }
};

const detachClientListeners = () => {
    if (!client) return;
    client.removeListener('exists', onExists);
    client.removeListener('error', onClientError);
    client.removeListener('close', onClientClose);
};

const attachClientListeners = () => {
    client.on('exists', onExists);
    client.on('error', onClientError);
    client.on('close', onClientClose);
};

const cleanupClient = async () => {
    clearDebounceTimer();
    detachClientListeners();
    if (!client) return;

    try {
        await client.logout();
    } catch {
        // Ignore logout errors during cleanup.
    }
    client = null;
    idleConnected = false;
};

const maintainIdleConnection = async () => {
    const { createLeadEmailImapClient, runLeadEmailSync } = getLeadEmailIngestion();
    client = createLeadEmailImapClient();
    attachClientListeners();

    await client.connect();
    log('IMAP connected');

    await client.mailboxOpen(IDLE_MAILBOX);
    log(`Mailbox opened: ${IDLE_MAILBOX}`);
    log('Waiting in IDLE mode');

    idleConnected = true;
    reconnectBackoffMs = INITIAL_RECONNECT_MS;

    log('Synchronization started (startup catch-up)');
    await runLeadEmailSync({ client });
    log('Synchronization completed (startup catch-up)');
    await returnToIdleMailbox();

    await new Promise((resolve) => {
        resolveOnClose = resolve;
    });
};

const idleLoop = async () => {
    while (!shuttingDown) {
        try {
            await maintainIdleConnection();
        } catch (error) {
            idleConnected = false;
            logError(`Connection loop error: ${error.message}`);
        } finally {
            await cleanupClient();
            resolveOnClose = null;
        }

        if (shuttingDown) break;

        log(`Reconnection attempt in ${reconnectBackoffMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, reconnectBackoffMs));
        reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, MAX_RECONNECT_MS);
    }
};

const startLeadEmailIdleService = async () => {
    if (started) return;
    started = true;
    shuttingDown = false;

    const { isLeadEmailConfigured } = getLeadEmailIngestion();
    if (!isLeadEmailConfigured()) {
        log('Skipped: IMAP credentials are missing');
        started = false;
        return;
    }

    idleLoop().catch((error) => {
        logError(`Idle loop crashed: ${error.message}`);
    });
};

const stopLeadEmailIdleService = async () => {
    if (!started && !client) return;

    log('Graceful shutdown started');
    shuttingDown = true;
    clearDebounceTimer();

    if (resolveOnClose) {
        resolveOnClose();
        resolveOnClose = null;
    }

    await cleanupClient();
    started = false;
    log('Graceful shutdown completed');
};

const getLeadEmailIdleStatus = () => ({
    mode: 'idle',
    idleConnected,
    idleMailbox: IDLE_MAILBOX,
    syncDebounceMs: SYNC_DEBOUNCE_MS,
    workerRunning: started,
});

module.exports = {
    startLeadEmailIdleService,
    stopLeadEmailIdleService,
    getLeadEmailIdleStatus,
};
