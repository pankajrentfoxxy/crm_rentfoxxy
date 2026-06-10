const axios = require('axios');
const pool = require('../config/db');

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.rentfoxxy.com/rentfoxxy-api';
const ERP_TOKEN = process.env.ERP_API_TOKEN || '';
const ERP_SYNC_INTERVAL_MS = parseInt(process.env.ERP_SYNC_INTERVAL_MS || '120000', 10);
const ERP_MAX_RETRIES = parseInt(process.env.ERP_MAX_RETRIES || '5', 10);
/** Bulk pagination sync is off by default — it hammers ERP with one request per page. */
const ERP_INVENTORY_BULK_SYNC_ENABLED =
    process.env.ERP_INVENTORY_BULK_SYNC_ENABLED === '1' ||
    process.env.ERP_INVENTORY_BULK_SYNC_ENABLED === 'true';
/** Comma-separated ERP query params for single QC lookup (see MyApiController::qcOrdersApi). */
const ERP_QC_LOOKUP_PARAMS = (process.env.ERP_QC_LOOKUP_PARAMS || process.env.ERP_QC_LOOKUP_QUERY || 'serial_number,unique_product_serial')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
/** Optional cap when filtered lookup misses (0 = no page scan). */
const ERP_SINGLE_QC_MAX_PAGES = parseInt(process.env.ERP_SINGLE_QC_MAX_PAGES || '0', 10);

let syncInterval = null;
const brandNameCache = new Map();

const normalizeText = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text.length ? text : null;
};

const pickFirst = (record, keys) => {
    if (!record || typeof record !== 'object') return null;
    for (const key of keys) {
        const value = normalizeText(record[key]);
        if (value) return value;
    }
    return null;
};

const parseArrayPayload = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.data)) return payload.data.data;
    if (Array.isArray(payload?.result)) return payload.result;
    if (Array.isArray(payload?.results)) return payload.results;
    return [];
};

const parsePagination = (payload) => {
    const pageInfo = payload?.pagination || payload?.meta || {};
    const currentPage = Number(pageInfo.current_page || pageInfo.page || 1);
    const lastPage = Number(pageInfo.last_page || pageInfo.total_pages || 1);
    return {
        currentPage: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1,
        lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : 1
    };
};

// ERP_AUTH_HEADER: 'bearer' (default) | 'x-api-token' | 'query'
const ERP_AUTH_HEADER = (process.env.ERP_AUTH_HEADER || 'bearer').toLowerCase();

const getHttpConfig = () => {
    const headers = { Accept: 'application/json' };
    if (ERP_AUTH_HEADER === 'x-api-token') {
        headers['X-API-TOKEN'] = ERP_TOKEN;
    } else {
        headers.Authorization = ERP_TOKEN.startsWith('Bearer ') ? ERP_TOKEN : `Bearer ${ERP_TOKEN}`;
    }
    const config = { headers, timeout: 30000 };
    if (ERP_AUTH_HEADER === 'query') {
        config.params = { api_token: ERP_TOKEN };
    }
    return config;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const fetchAllPages = async (endpoint) => {
    const allRows = [];
    let page = 1;
    let lastPage = 1;
    do {
        const url = `${ERP_BASE_URL}${endpoint}?page=${page}`;
        const { data } = await requestWithRetry(url);
        const rows = parseArrayPayload(data);
        allRows.push(...rows);
        const pageMeta = parsePagination(data);
        lastPage = pageMeta.lastPage;
        page++;
    } while (page <= lastPage);
    return allRows;
};

const buildErpUrl = (endpoint, queryParams = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && String(value).length) {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return qs ? `${ERP_BASE_URL}${endpoint}?${qs}` : `${ERP_BASE_URL}${endpoint}`;
};

const fetchQcPassedPage = async (page = 1, extraParams = {}) => {
    const { data } = await requestWithRetry(
        buildErpUrl('/qc-orders/passed', { page, ...extraParams })
    );
    const rows = parseArrayPayload(data);
    const pageMeta = parsePagination(data);
    return { rows, ...pageMeta };
};

/** Targeted ERP search — e.g. /qc-orders/passed?page=1&serial_number=G5QBM33 */
const fetchQcPassedFiltered = async (filterParams) => {
    const { data } = await requestWithRetry(
        buildErpUrl('/qc-orders/passed', { page: 1, limit: 25, ...filterParams })
    );
    return parseArrayPayload(data);
};

const fetchQCPassedOrders = async () => fetchAllPages('/qc-orders/passed');

const qcRecordMatchesTarget = (record, targetUpper) => {
    const machine = normalizeText(record.unique_product_serial)?.toUpperCase();
    const serial = normalizeText(record.serial_number)?.toUpperCase();
    const recordId = normalizeText(record.id)?.toUpperCase();
    const productId = normalizeText(record.product_id)?.toUpperCase();
    return (
        machine === targetUpper ||
        serial === targetUpper ||
        recordId === targetUpper ||
        productId === targetUpper
    );
};

/** Targeted QC lookup — uses ERP filters (serial_number, unique_product_serial) instead of full pagination. */
const findQcRecordForIdentifier = async (identifier) => {
    const target = normalizeText(identifier);
    if (!target) return null;
    const targetUpper = target.toUpperCase();

    for (const param of ERP_QC_LOOKUP_PARAMS) {
        try {
            const rows = await fetchQcPassedFiltered({ [param]: target });
            if (!rows.length) continue;
            const hit = rows.find((r) => qcRecordMatchesTarget(r, targetUpper));
            if (hit) return hit;
            // ERP already filtered by exact param — trust a single result
            if (rows.length === 1) return rows[0];
        } catch (error) {
            console.warn(`QC lookup via ${param} failed:`, error.message);
        }
    if (ERP_QC_LOOKUP_QUERY) {
        const res = await fetchQcPassedPage(1, { [ERP_QC_LOOKUP_QUERY]: target });
        console.log('rows', res);
        const hit = res?.rows.find((r) => qcRecordMatchesTarget(r, targetUpper));
        if (hit) return hit;
    }

    try {
        const productDetails = await fetchProductDetail(target);
        if (productDetails) {
            const machineNumber = pickFirst(productDetails, [
                'unique_product_serial',
                'machine_number',
                'machineNumber',
                'ttspl_id',
                'TTSPL_id'
            ]);
            const serialNumber = pickFirst(productDetails, ['serial_number', 'serialNo', 'serial']);
            if (machineNumber || serialNumber) {
                return {
                    product_id: pickFirst(productDetails, ['id', 'product_id', 'product_details_id']) || target,
                    unique_product_serial: machineNumber || target,
                    serial_number: serialNumber || machineNumber,
                    ...productDetails
                };
            }
        }
    } catch {
        // Not a product id — continue to optional page scan.
    }

    const maxPages = Number.isFinite(ERP_SINGLE_QC_MAX_PAGES) && ERP_SINGLE_QC_MAX_PAGES > 0
        ? ERP_SINGLE_QC_MAX_PAGES
        : 0;
    if (maxPages > 0) {
        let page = 1;
        let lastPage = 1;
        do {
            const { rows, lastPage: lp } = await fetchQcPassedPage(page);
            lastPage = Math.min(lp, maxPages);
            const hit = rows.find((r) => qcRecordMatchesTarget(r, targetUpper));
            if (hit) return hit;
            page++;
        } while (page <= lastPage);
    }

    return null;
};
}
const fetchProductDetail = async (productId) => {
    if (!productId) return null;
    const { data } = await requestWithRetry(`${ERP_BASE_URL}/get-product-detail/${productId}`);
    return data?.data && typeof data.data === 'object' ? data.data : null;
};

const fetchBrandName = async (brandId) => {
    const normalizedBrandId = normalizeText(brandId);
    if (!normalizedBrandId) return null;
    if (brandNameCache.has(normalizedBrandId)) {
        return brandNameCache.get(normalizedBrandId);
    }

    try {
        const { data } = await requestWithRetry(`${ERP_BASE_URL}/get-brand-detail/${normalizedBrandId}`);
        const brandName = normalizeText(data?.data?.name);
        brandNameCache.set(normalizedBrandId, brandName);
        return brandName;
    } catch {
        // Keep sync resilient if brand lookup fails for any single record.
        brandNameCache.set(normalizedBrandId, null);
        return null;
    }
};

const buildPurchaseOrderMap = (purchaseOrders) => {
    const map = new Map();
    for (const record of purchaseOrders) {
        const ids = [
            pickFirst(record, ['id', 'purchase_order_id', 'qc_order_id', 'qc_id', 'order_id']),
            record.qc_order_id,
            record.qc_id,
            record.purchase_order_id,
            record.order_id,
            record.id
        ].filter((v) => v !== undefined && v !== null && v !== '');
        for (const id of [...new Set(ids.map((v) => String(v)))]) {
            if (!map.has(id)) map.set(id, record);
        }
    }
    return map;
};

const parseAssetsDetails = (raw) => {
    if (!raw) return {};
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return {};
        }
    }
    if (!parsed || typeof parsed !== 'object') return {};

    const first = (key) => {
        const value = parsed[key];
        if (Array.isArray(value)) return normalizeText(value[0]);
        return normalizeText(value);
    };

    return {
        brand: first('brand') || first('Brand'),
        model: first('model') || first('Model'),
        processor: first('processor') || first('Processor'),
        generation: first('generation') || first('Generation'),
        ram: first('ram') || first('RAM'),
        storage: first('storage') || first('Storage'),
        gpu: first('gpu') || first('GPU'),
        screen_size: first('screen_size') || first('Screen_size')
    };
};

const productIdsMatch = (product, qcRecord) => {
    const qcIds = [
        normalizeText(qcRecord.product_id),
        normalizeText(qcRecord.product_details_id)
    ].filter(Boolean);
    const productIds = [
        normalizeText(product.id),
        normalizeText(product.product_id),
        normalizeText(product.product_details_id),
        normalizeText(product.item_id)
    ].filter(Boolean);
    return qcIds.some((q) => productIds.some((p) => String(q) === String(p)));
};

const normalizeForMatch = (v) => {
    const s = normalizeText(v);
    if (!s) return '';
    return s.replace(/[\s\-_]/g, '').toUpperCase();
};

const productMatchesMachine = (product, machineNumber, serialNumber) => {
    const mn = normalizeForMatch(machineNumber);
    const sn = normalizeForMatch(serialNumber);
    if (!mn && !sn) return false;
    const productIds = [
        product.unique_product_serial, product.machine_number, product.machineNumber,
        product.serial_number, product.serialNumber
    ].map(normalizeForMatch).filter(Boolean);
    if (mn && productIds.includes(mn)) return true;
    if (sn && productIds.includes(sn)) return true;
    return false;
};

const resolvePurchaseDetailsForQc = (qcRecord, purchaseRecord) => {
    if (!purchaseRecord) return { ...qcRecord };

    const products = Array.isArray(purchaseRecord.product_details) ? purchaseRecord.product_details : [];
    const machineNumber = pickFirst(qcRecord, ['unique_product_serial', 'machine_number', 'machineNumber']);
    const serialNumber = pickFirst(qcRecord, ['serial_number', 'serialNo', 'serial']);

    // 1. Match by product_id / product_details_id (most reliable)
    let matchedProduct = products.find((p) => productIdsMatch(p, qcRecord));
    // 2. Match by machine_number or serial_number (normalized, ignores spaces/dashes)
    if (!matchedProduct && (machineNumber || serialNumber)) {
        matchedProduct = products.find((p) => productMatchesMachine(p, machineNumber, serialNumber));
    }
    // 3. Only use products[0] when PO has exactly ONE product (single-laptop order)
    if (!matchedProduct && products.length === 1) {
        matchedProduct = products[0];
    }
    if (!matchedProduct) {
        matchedProduct = {};
    }

    const assets = parseAssetsDetails(purchaseRecord.assets_details);

    // Merge: PO level < assets < matched product < QC record (QC overrides)
    return {
        ...purchaseRecord,
        ...assets,
        ...matchedProduct,
        ...qcRecord
    };
};

const chooseFinalValue = (incoming, existingValue, fallback = null) => {
    const incomingValue = normalizeText(incoming);
    if (incomingValue && incomingValue.toLowerCase() !== 'unknown') return incomingValue;
    const existingNormalized = normalizeText(existingValue);
    if (existingNormalized) return existingNormalized;
    return fallback;
};

const upsertInventoryFromErpRecord = async ({ machineNumber, serialNumber, details }) => {
    const existingRes = await pool.query(
        `SELECT inventory_id, brand, model, processor, generation, ram, storage, gpu, screen_size
         FROM inventory
         WHERE machine_number = $1 OR serial_number = $2
         LIMIT 1`,
        [machineNumber, serialNumber]
    );

    const existing = existingRes.rows[0] || null;
    const brand = chooseFinalValue(
        pickFirst(details, ['brand_name', 'brand', 'Brand', 'manufacturer']),
        existing?.brand,
        'Unknown'
    );
    const model = chooseFinalValue(
        pickFirst(details, ['model', 'Model', 'model_name', 'product_name', 'preferred_model', 'name']),
        existing?.model,
        'Unknown'
    );
    const processor = chooseFinalValue(pickFirst(details, ['processor', 'Processor', 'cpu', 'CPU']), existing?.processor);
    const generation = chooseFinalValue(pickFirst(details, ['generation', 'Generation', 'gen', 'Gen']), existing?.generation);
    const ram = chooseFinalValue(pickFirst(details, ['ram', 'RAM', 'memory']), existing?.ram);
    const storage = chooseFinalValue(pickFirst(details, ['storage', 'Storage', 'ssd', 'hdd']), existing?.storage);
    const gpu = chooseFinalValue(pickFirst(details, ['gpu', 'GPU', 'graphics', 'graphic_card']), existing?.gpu);
    const screenSize = chooseFinalValue(pickFirst(details, ['screen_size', 'screenSize', 'display_size']), existing?.screen_size);

    if (existing) {
        const inventoryId = existing.inventory_id;
        await pool.query(
            `UPDATE inventory
             SET machine_number = $1,
                 serial_number = $2,
                 brand = $3,
                 model = $4,
                 processor = $5,
                 generation = $6,
                 ram = $7,
                 storage = $8,
                 gpu = $9,
                 screen_size = $10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE inventory_id = $11`,
            [machineNumber, serialNumber, brand, model, processor, generation, ram, storage, gpu, screenSize, inventoryId]
        );
        return false;
    }

    await pool.query(
        `INSERT INTO inventory (
            machine_number, serial_number, device_type,
            brand, model, processor, generation, ram, storage, gpu, screen_size,
            stock_type, status, stage
         ) VALUES (
            $1, $2, 'Laptop',
            $3, $4, $5, $6, $7, $8, $9, $10,
            'Cooling Period', 'In Stock', NULL
         )`,
        [machineNumber, serialNumber, brand, model, processor, generation, ram, storage, gpu, screenSize]
    );
    return true;
};

const syncInventoryFromErp = async () => {
    if (!ERP_INVENTORY_BULK_SYNC_ENABLED) {
        console.warn('⚠️ ERP bulk inventory sync is disabled (set ERP_INVENTORY_BULK_SYNC_ENABLED=true to allow)');
        return {
            inserted: 0,
            updated: 0,
            skipped: 0,
            total: 0,
            disabled: true,
            error: 'Bulk ERP sync is disabled. Use single-item sync (POST /api/inventory/sync/:identifier).'
        };
    }

    if (!ERP_TOKEN) {
        console.warn('⚠️ ERP inventory sync skipped: ERP_API_TOKEN is missing');
        return { inserted: 0, updated: 0, skipped: 0, total: 0, error: 'ERP_API_TOKEN is missing' };
    }

    const qcPassedRecords = await fetchQCPassedOrders();

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const qcRecord of qcPassedRecords) {
        const id = pickFirst(qcRecord, ['id', 'qc_order_id', 'purchase_order_id', 'order_id']);
        const poId = pickFirst(qcRecord, ['po_id', 'purchase_order_id']);
        const serialNumber = pickFirst(qcRecord, ['serial_number', 'serialNo', 'serial']);
        const machineNumber = pickFirst(qcRecord, ['unique_product_serial', 'machine_number', 'machineNumber']);

        if (!id || !serialNumber || !machineNumber) {
            skipped++;
            continue;
        }

        const productId = pickFirst(qcRecord, ['product_id', 'id', 'serial_number_id']);
        const productDetails = await fetchProductDetail(productId);
        const brandName = await fetchBrandName(productDetails?.brand);
        const mergedDetails = {
            ...qcRecord,
            ...(productDetails || {}),
            brand_name: brandName
        };

        const wasInserted = await upsertInventoryFromErpRecord({
            machineNumber,
            serialNumber,
            details: mergedDetails
        });

        if (wasInserted) inserted++;
        else updated++;
    }

    if (process.env.NODE_ENV !== 'production') {
        console.log(`ERP inventory sync: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);
    }
    return { inserted, updated, skipped, total: qcPassedRecords.length };
};

const syncSingleInventoryFromErp = async (identifier) => {
    if (!ERP_TOKEN) {
        throw new Error('ERP_API_TOKEN is missing');
    }

    const target = normalizeText(identifier);
    if (!target) {
        throw new Error('Machine number / serial / ERP ID is required');
    }

    const qcRecord = await findQcRecordForIdentifier(target);

    if (!qcRecord) {
        return {
            found: false,
            message: `No QC passed record found for: ${target}. Check serial / TTSPL id (ERP filters: ${ERP_QC_LOOKUP_PARAMS.join(', ')}).`
        };
    }

    const serialNumber = pickFirst(qcRecord, ['serial_number', 'serialNo', 'serial']);
    const machineNumber = pickFirst(qcRecord, ['unique_product_serial', 'machine_number', 'machineNumber']);
    if (!serialNumber || !machineNumber) {
        return {
            found: true,
            synced: false,
            message: 'QC record found but missing machine/serial identifiers',
            qcRecordId: pickFirst(qcRecord, ['id', 'qc_order_id'])
        };
    }

    const productId = pickFirst(qcRecord, ['product_id', 'id', 'serial_number_id']);
    const productDetails = await fetchProductDetail(productId);
    const brandName = await fetchBrandName(productDetails?.brand);
    const mergedDetails = {
        ...qcRecord,
        ...(productDetails || {}),
        brand_name: brandName
    };

    const inserted = await upsertInventoryFromErpRecord({
        machineNumber,
        serialNumber,
        details: mergedDetails
    });

    return {
        found: true,
        synced: true,
        action: inserted ? 'inserted' : 'updated',
        machine_number: machineNumber,
        serial_number: serialNumber,
        brand: pickFirst(mergedDetails, ['brand_name', 'brand', 'Brand']) || 'Unknown',
        model: pickFirst(mergedDetails, ['model', 'Model', 'model_name', 'product_name']) || 'Unknown'
    };
};

const ensureInventoryColumns = async () => {
    await pool.query(`
        ALTER TABLE inventory
            ADD COLUMN IF NOT EXISTS generation VARCHAR(80),
            ADD COLUMN IF NOT EXISTS gpu VARCHAR(120),
            ADD COLUMN IF NOT EXISTS screen_size VARCHAR(40);
    `);
};

const startInventorySyncWorker = async () => {
    await ensureInventoryColumns();
    if (!ERP_INVENTORY_BULK_SYNC_ENABLED) {
        console.log('ERP inventory sync worker not started (bulk sync disabled)');
        return;
    }
    await syncInventoryFromErp();

    if (!syncInterval) {
        syncInterval = setInterval(() => {
            syncInventoryFromErp().catch((error) => {
                console.error('❌ ERP inventory sync failed:', error.message);
            });
        }, ERP_SYNC_INTERVAL_MS);
    }
};

const traceMachineNumberFromErp = async (machineNumber) => {
    if (!ERP_TOKEN) return { error: 'ERP_API_TOKEN is missing' };

    const mn = String(machineNumber || '').trim();
    const qcRecord = await findQcRecordForIdentifier(mn);

    if (!qcRecord) {
        return { found: false, message: `Machine number ${mn} not found in ERP QC Passed` };
    }

    const productId = pickFirst(qcRecord, ['product_id', 'id', 'serial_number_id', 'product_details_id']);
    const productDetails = await fetchProductDetail(productId);
    const brandName = await fetchBrandName(productDetails?.brand);
    const mergedDetails = {
        ...qcRecord,
        ...(productDetails || {}),
        brand_name: brandName
    };

    return {
        found: true,
        machineNumber: mn,
        qcRecord: {
            product_id: productId,
            serial_number: pickFirst(qcRecord, ['serial_number', 'serialNo']),
            model: pickFirst(qcRecord, ['model', 'Model']),
            brand: pickFirst(qcRecord, ['brand', 'Brand'])
        },
        productDetails: {
            id: productId,
            details: productDetails,
            brand_name: brandName
        },
        mergedDetails: {
            model: pickFirst(mergedDetails, ['model', 'Model', 'model_name']),
            brand: pickFirst(mergedDetails, ['brand_name', 'brand', 'Brand']),
            processor: pickFirst(mergedDetails, ['processor', 'Processor']),
            ram: pickFirst(mergedDetails, ['ram', 'RAM']),
            storage: pickFirst(mergedDetails, ['storage', 'Storage'])
        }
    };
};

module.exports = {
    startInventorySyncWorker,
    syncInventoryFromErp,
    syncSingleInventoryFromErp,
    traceMachineNumberFromErp
};
