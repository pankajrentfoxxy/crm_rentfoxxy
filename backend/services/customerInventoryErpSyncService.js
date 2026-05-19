const axios = require('axios');
const pool = require('../config/db');

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.rentfoxxy.com/rentfoxxy-api';
const ERP_TOKEN = process.env.ERP_API_TOKEN || '';
const ERP_AUTH_HEADER = (process.env.ERP_AUTH_HEADER || 'bearer').toLowerCase();
const ERP_MAX_RETRIES = parseInt(process.env.ERP_MAX_RETRIES || '5', 10);
/** Comma-separated. Append `sales` if your ERP uses that path instead of `sale`. */
const ASSET_TYPES = [...new Set(
    (process.env.ERP_ASSET_TYPES || 'rental,sale,demo')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
)];

const CUSTOMER_SYNC_INTERVAL_MS = parseInt(process.env.CUSTOMER_INVENTORY_SYNC_INTERVAL_MS || '21600000', 10);
const ERP_CUSTOMER_ID_MIN = parseInt(process.env.ERP_CUSTOMER_ID_MIN || '1', 10);
const ERP_CUSTOMER_ID_MAX = parseInt(process.env.ERP_CUSTOMER_ID_MAX || '600', 10);

let customerSyncInterval = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getHttpConfig = () => {
    const headers = { Accept: 'application/json' };
    if (ERP_AUTH_HEADER === 'x-api-token') {
        headers['X-API-TOKEN'] = ERP_TOKEN;
    } else {
        headers.Authorization = ERP_TOKEN.startsWith('Bearer ') ? ERP_TOKEN : `Bearer ${ERP_TOKEN}`;
    }
    const config = { headers, timeout: 60000 };
    if (ERP_AUTH_HEADER === 'query') {
        config.params = { api_token: ERP_TOKEN };
    }
    return config;
};

const requestWithRetry = async (url) => {
    let attempt = 0;
    while (attempt <= ERP_MAX_RETRIES) {
        try {
            return await axios.get(url, getHttpConfig());
        } catch (error) {
            const status = error.response?.status;
            if (status === 401) {
                const body = error.response?.data;
                const msg = typeof body === 'object' ? JSON.stringify(body) : String(body || '');
                throw new Error(`ERP 401 Unauthorized. URL: ${url}. Response: ${msg.slice(0, 200)}`);
            }
            if (status === 404) throw error;
            if (status !== 429 || attempt === ERP_MAX_RETRIES) throw error;
            const retryAfterSeconds = Number(error.response?.headers?.['retry-after'] || 0);
            const backoffMs = retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : Math.min(1000 * (2 ** attempt), 15000);
            await sleep(backoffMs);
            attempt++;
        }
    }
    throw new Error('ERP retry loop exhausted');
};

const parseArrayPayload = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.data)) return payload.data.data;
    if (Array.isArray(payload?.customers)) return payload.customers;
    return [];
};

const parsePagination = (payload) => {
    const pageInfo = payload?.pagination || payload?.meta || {};
    // Laravel often puts current_page / last_page on the root object (not under meta).
    const currentPage = Number(
        pageInfo.current_page ||
            pageInfo.page ||
            payload?.current_page ||
            1
    );
    const lastPage = Number(
        pageInfo.last_page ||
            pageInfo.total_pages ||
            payload?.last_page ||
            payload?.lastPage ||
            (payload?.meta && payload.meta.last_page) ||
            1
    );
    return {
        currentPage: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1,
        lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : 1
    };
};

const fetchAllPages = async (endpoint) => {
    const allRows = [];
    let page = 1;
    let lastPage = 1;
    do {
        const url = `${ERP_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`;
        try {
            const { data } = await requestWithRetry(url);
            const rows = parseArrayPayload(data);
            allRows.push(...rows);
            const pageMeta = parsePagination(data);
            lastPage = pageMeta.lastPage;
        } catch (e) {
            if (e.response?.status === 404) break;
            throw e;
        }
        page++;
    } while (page <= lastPage);
    return allRows;
};

const extractCustomerId = (row) => {
    if (!row || typeof row !== 'object') return null;
    const id = row.id ?? row.customer_id ?? row.customerId;
    if (id === undefined || id === null) return null;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
};

/**
 * Try ERP customer list endpoints (first match wins).
 */
const discoverCustomerIdsFromErp = async () => {
    const endpoints = ['/customers', '/customer-list', '/customers-list', '/all-customers'];
    for (const ep of endpoints) {
        try {
            const rows = await fetchAllPages(ep);
            const ids = rows.map(extractCustomerId).filter((x) => x !== null);
            if (ids.length > 0) return [...new Set(ids)].sort((a, b) => a - b);
        } catch (_) {
            /* try next */
        }
    }
    return [];
};

const parsePgTimestamp = (value) => {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const s = String(value).trim();
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const toOptionalInt = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};

const upsertExistingCustomerFromDetailPayload = async (detailBody) => {
    const customer =
        detailBody?.customer ||
        detailBody?.data?.customer ||
        (detailBody?.data && typeof detailBody.data === 'object' ? detailBody.data.customer || detailBody.data : null) ||
        detailBody;
    if (!customer || customer.id === undefined) {
        return { ok: false, reason: 'no_customer' };
    }
    const customerId = Number(customer.id);
    if (!Number.isFinite(customerId)) return { ok: false, reason: 'bad_id' };

    const billing = customer.billing_address ?? null;
    const shipping = customer.shipping_address ?? null;

    await pool.query(
        `INSERT INTO existing_customer (
            customer_id, customer_name, contact_person_name, contact_person_number,
            customer_number, email, billing_address, shipping_address, erp_raw, synced_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (customer_id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            contact_person_name = EXCLUDED.contact_person_name,
            contact_person_number = EXCLUDED.contact_person_number,
            customer_number = EXCLUDED.customer_number,
            email = EXCLUDED.email,
            billing_address = EXCLUDED.billing_address,
            shipping_address = EXCLUDED.shipping_address,
            erp_raw = EXCLUDED.erp_raw,
            synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP`,
        [
            customerId,
            customer.customer_name || null,
            customer.contact_person_name || null,
            customer.contact_person_number || null,
            customer.customer_number || null,
            customer.email || null,
            billing ? JSON.stringify(billing) : null,
            shipping ? JSON.stringify(Array.isArray(shipping) ? shipping : [shipping]) : null,
            JSON.stringify(detailBody)
        ]
    );

    return { ok: true, customerId };
};

const mapAssetRow = (row, assetKind, bucket) => {
    const lockRaw = row.locking_period;
    let locking = null;
    if (lockRaw !== undefined && lockRaw !== null && lockRaw !== '') {
        const n = Number(lockRaw);
        locking = Number.isFinite(n) ? Math.trunc(n) : null;
    }
    return {
        asset_kind: assetKind,
        asset_bucket: bucket,
        delivery_challan_id: toOptionalInt(row.delivery_challan_id),
        dc_number: row.dc_number ?? null,
        delivery_date: parsePgTimestamp(row.delivery_date),
        erp_serial_id: row.serial_id != null ? String(row.serial_id) : null,
        serial_number: row.serial_number ?? null,
        unique_serial_number: row.unique_serial_number ?? null,
        model_name: row.model_name ?? null,
        generation: row.generation ?? null,
        screen_size: row.screen_size ?? null,
        ram: row.ram != null ? String(row.ram) : null,
        storage: row.storage != null ? String(row.storage) : null,
        gpu: row.gpu ?? null,
        processor: row.processor ?? null,
        quotation_type: row.quotation_type ?? null,
        rate: row.rate != null ? String(row.rate) : null,
        locking_period: locking,
        delivery_status: row.delivery_status ?? null,
        delivery_type: row.delivery_type ?? null,
        courier_name: row.courier_name ?? null,
        awb_number: row.awb_number ?? null,
        sales_status: row.sales_status ?? null,
        documents: row.documents ?? null,
        erp_raw: row
    };
};

const toJsonbParam = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v;
    try {
        return JSON.stringify(v);
    } catch {
        return null;
    }
};

const insertAssetRows = async (customerId, rowsPayload) => {
    if (!rowsPayload?.length) return 0;
    let n = 0;
    let firstInsertErr = null;
    for (const r of rowsPayload) {
        const m = mapAssetRow(r.row, r.kind, r.bucket);
        try {
            await pool.query(
                `INSERT INTO customer_inventory (
                    customer_id, asset_kind, asset_bucket, delivery_challan_id, dc_number, delivery_date,
                    erp_serial_id, serial_number, unique_serial_number, model_name, generation, screen_size,
                    ram, storage, gpu, processor, quotation_type, rate, locking_period,
                    delivery_status, delivery_type, courier_name, awb_number, sales_status, documents, erp_raw,
                    synced_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17, $18, $19,
                    $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )`,
                [
                    customerId,
                    m.asset_kind,
                    m.asset_bucket,
                    m.delivery_challan_id,
                    m.dc_number,
                    m.delivery_date,
                    m.erp_serial_id,
                    m.serial_number,
                    m.unique_serial_number,
                    m.model_name,
                    m.generation,
                    m.screen_size,
                    m.ram,
                    m.storage,
                    m.gpu,
                    m.processor,
                    m.quotation_type,
                    m.rate,
                    m.locking_period,
                    m.delivery_status,
                    m.delivery_type,
                    m.courier_name,
                    m.awb_number,
                    m.sales_status,
                    toJsonbParam(m.documents),
                    toJsonbParam(m.erp_raw)
                ]
            );
            n++;
        } catch (err) {
            if (!firstInsertErr) {
                firstInsertErr = err;
                console.error(
                    `customer_inventory insert failed customer_id=${customerId} dc=${m.dc_number}:`,
                    err.message
                );
            }
        }
    }
    if (firstInsertErr && n === 0) {
        throw firstInsertErr;
    }
    return n;
};

const firstDefinedArray = (...candidates) => {
    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }
    return [];
};

/**
 * Laravel / mobile APIs vary: root keys, under data, or camelCase.
 */
const normalizeAssetsPayload = (body) => {
    if (!body || typeof body !== 'object') return { live: [], passive: [] };

    const scan = (b) => {
        if (!b || typeof b !== 'object') return { live: [], passive: [] };
        const live = firstDefinedArray(
            b.live_assets,
            b.liveAssets,
            b.data && typeof b.data === 'object' ? b.data.live_assets : undefined,
            b.data && typeof b.data === 'object' ? b.data.liveAssets : undefined
        );
        const passive = firstDefinedArray(
            b.passive_assets,
            b.passiveAssets,
            b.data && typeof b.data === 'object' ? b.data.passive_assets : undefined,
            b.data && typeof b.data === 'object' ? b.data.passiveAssets : undefined
        );
        return { live, passive };
    };

    let { live, passive } = scan(body);

    if (live.length === 0 && passive.length === 0) {
        const nested = body.data;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            ({ live, passive } = scan(nested));
        }
    }

    if (live.length === 0 && passive.length === 0 && body.success && body.data && typeof body.data === 'object') {
        ({ live, passive } = scan(body.data));
    }

    return { live, passive };
};

const fetchAssetsForType = async (customerId, type) => {
    const url = `${ERP_BASE_URL}/customers/get-customer-details-with-his-assets/${customerId}/${type}`;
    const { data } = await requestWithRetry(url);
    const { live, passive } = normalizeAssetsPayload(data);
    const rows = [];
    for (const row of live) {
        if (row && typeof row === 'object') rows.push({ row, kind: type, bucket: 'live' });
    }
    for (const row of passive) {
        if (row && typeof row === 'object') rows.push({ row, kind: type, bucket: 'passive' });
    }
    return rows;
};

/**
 * Sync one customer: detail + all asset types. Returns counts / errors.
 */
const syncOneCustomerFromErp = async (customerId) => {
    if (!ERP_TOKEN) {
        throw new Error('ERP_API_TOKEN is missing');
    }
    const id = Number(customerId);
    if (!Number.isFinite(id)) {
        throw new Error('Invalid customer id');
    }

    let detailBody;
    try {
        const { data } = await requestWithRetry(`${ERP_BASE_URL}/customers-detail/${id}`);
        detailBody = data;
    } catch (e) {
        if (e.response?.status === 404) {
            return { customerId: id, skipped: true, reason: 'customer_detail_404' };
        }
        throw e;
    }

    const up = await upsertExistingCustomerFromDetailPayload(detailBody);
    if (!up.ok) {
        return { customerId: id, skipped: true, reason: up.reason };
    }

    let assetRows = [];
    const assetWarnings = [];
    for (const t of ASSET_TYPES) {
        try {
            const part = await fetchAssetsForType(id, t);
            assetRows = assetRows.concat(part);
        } catch (e) {
            const status = e.response?.status;
            const msg = status === 404 ? 'not_found' : (e.message || String(e));
            assetWarnings.push({ type: t, status: status || null, msg });
            if (status && status !== 404) {
                console.warn(
                    `ERP assets fetch customer ${id} type ${t}: ${status}`,
                    e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : ''
                );
            }
        }
    }

    await pool.query('DELETE FROM customer_inventory WHERE customer_id = $1', [id]);
    let inserted = 0;
    try {
        inserted = await insertAssetRows(id, assetRows);
    } catch (e) {
        console.error(`customer_inventory bulk insert failed customer ${id}:`, e.message);
        throw e;
    }

    return {
        customerId: id,
        skipped: false,
        assets_written: inserted,
        assets_fetched: assetRows.length,
        asset_warnings: assetWarnings.length ? assetWarnings : undefined
    };
};

const collectCustomerIdsForFullSync = async () => {
    const ids = new Set();

    const fromApi = await discoverCustomerIdsFromErp();
    fromApi.forEach((x) => ids.add(x));

    try {
        const res = await pool.query('SELECT customer_id FROM existing_customer');
        res.rows.forEach((r) => ids.add(r.customer_id));
    } catch (_) {
        /* tables may not exist yet */
    }

    const mergeEnv = process.env.ERP_CUSTOMER_SYNC_MERGE_RANGE;
    const mergeIdRange =
        mergeEnv === '1' ||
        (mergeEnv !== '0' && fromApi.length === 0) ||
        (mergeEnv !== '0' && fromApi.length > 0 && fromApi.length < 50);

    if (mergeIdRange) {
        const min = Math.min(ERP_CUSTOMER_ID_MIN, ERP_CUSTOMER_ID_MAX);
        const max = Math.max(ERP_CUSTOMER_ID_MIN, ERP_CUSTOMER_ID_MAX);
        for (let i = min; i <= max; i++) ids.add(i);
    }

    return [...ids].sort((a, b) => a - b);
};

/**
 * Full sync all discovered / ranged customer IDs.
 */
const syncAllCustomersFromErp = async () => {
    if (!ERP_TOKEN) {
        return { error: 'ERP_API_TOKEN is missing', processed: 0, ok: 0, skipped: 0, failed: 0 };
    }

    const ids = await collectCustomerIdsForFullSync();
    let ok = 0;
    let skipped = 0;
    let failed = 0;

    for (const customerId of ids) {
        try {
            const r = await syncOneCustomerFromErp(customerId);
            if (r.skipped) skipped++;
            else ok++;
            await sleep(80);
        } catch (e) {
            failed++;
            console.error(`Customer ERP sync failed for ${customerId}:`, e.message);
        }
    }

    return {
        processed: ids.length,
        ok,
        skipped,
        failed
    };
};

const ensureCustomerTables = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS existing_customer (
            customer_id INTEGER PRIMARY KEY,
            customer_name VARCHAR(500),
            contact_person_name VARCHAR(300),
            contact_person_number VARCHAR(80),
            customer_number VARCHAR(80),
            email VARCHAR(320),
            billing_address JSONB,
            shipping_address JSONB,
            erp_raw JSONB,
            synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS customer_inventory (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES existing_customer (customer_id) ON DELETE CASCADE,
            asset_kind VARCHAR(20) NOT NULL,
            asset_bucket VARCHAR(20) NOT NULL DEFAULT 'live',
            delivery_challan_id BIGINT,
            dc_number VARCHAR(80),
            delivery_date TIMESTAMP WITH TIME ZONE,
            erp_serial_id VARCHAR(80),
            serial_number VARCHAR(120),
            unique_serial_number VARCHAR(120),
            model_name VARCHAR(300),
            generation VARCHAR(80),
            screen_size VARCHAR(80),
            ram VARCHAR(120),
            storage VARCHAR(200),
            gpu VARCHAR(200),
            processor VARCHAR(120),
            quotation_type VARCHAR(40),
            rate VARCHAR(80),
            locking_period INTEGER,
            delivery_status VARCHAR(80),
            delivery_type VARCHAR(120),
            courier_name VARCHAR(120),
            awb_number VARCHAR(120),
            sales_status VARCHAR(80),
            documents JSONB,
            erp_raw JSONB,
            synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
};

const startCustomerInventorySyncWorker = async () => {
    await ensureCustomerTables();

    const enableWorker = CUSTOMER_SYNC_INTERVAL_MS > 0;
    const startDelayMs = parseInt(process.env.CUSTOMER_INVENTORY_SYNC_START_DELAY_MS || '120000', 10);

    if (enableWorker) {
        setTimeout(() => {
            syncAllCustomersFromErp().catch((err) => {
                console.error('Initial customer inventory ERP sync failed:', err.message);
            });
        }, Math.max(0, startDelayMs));

        if (!customerSyncInterval) {
            customerSyncInterval = setInterval(() => {
                syncAllCustomersFromErp().catch((err) => {
                    console.error('Scheduled customer inventory ERP sync failed:', err.message);
                });
            }, CUSTOMER_SYNC_INTERVAL_MS);
        }
    }
};

module.exports = {
    syncOneCustomerFromErp,
    syncAllCustomersFromErp,
    startCustomerInventorySyncWorker,
    ensureCustomerTables
};
