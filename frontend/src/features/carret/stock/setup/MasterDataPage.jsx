import React from 'react';
import { useSearchParams } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import { EmptyState, Tabs } from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import MasterDataLaptopsView from './MasterDataLaptopsView';
import MasterDataVendorView from './MasterDataVendorView';
import MasterDataReturnsView from './MasterDataReturnsView';

/**
 * Stock → Master data. One page for the three old reports, each tab behind the
 * section its API enforces (backend/routes/inventoryManagement.js):
 *   Laptops           /inventory-management/master-data         inventory_master_data
 *   Vendor purchases  /inventory-management/vendor-master-data  inventory_vendor_master_data
 *   Returns           /inventory-management/return-master-data  inventory_return_master_data
 * Stock → Assets answers "where is this laptop"; these answer "what did we
 * buy, from whom, at what price, what does it earn, what came back" — prices,
 * per-customer and per-vendor summaries, floor stage counts, Excel export.
 * Filters live in the URL (?view=…&…), so a drill-down survives reload/back.
 */
const VIEWS = [
  { key: 'laptops', label: 'Laptops', section: 'inventory_master_data' },
  { key: 'vendor', label: 'Vendor purchases', section: 'inventory_vendor_master_data' },
  { key: 'returns', label: 'Returns', section: 'inventory_return_master_data' },
];

export default function MasterDataPage() {
  const { canView } = usePermission();
  const [sp, setSp] = useSearchParams();
  const allowed = VIEWS.filter((v) => canView(v.section));
  const asked = sp.get('view');
  const view = allowed.find((v) => v.key === asked)?.key || allowed[0]?.key;

  // Each report owns its own filter keys, so switching clears the URL.
  const switchTo = (key) => setSp(new URLSearchParams({ view: key }), { replace: true });

  return (
    <DeskShell
      title="Master data"
      breadcrumb="Stock"
      subtitle="Every laptop from purchase to customer: prices, vendors, customers, returns — with drill-downs and Excel export."
    >
      <div className="c-stack">
        {allowed.length > 1 && <Tabs tabs={allowed.map(({ key, label }) => ({ key, label }))} value={view} onChange={switchTo} />}
        {!view && <EmptyState title="No master data you can open" body="Ask an admin for Master Data, Vendor Master Data or Return Master Data access." />}
        {view === 'laptops' && <MasterDataLaptopsView key="laptops" />}
        {view === 'vendor' && <MasterDataVendorView key="vendor" />}
        {view === 'returns' && <MasterDataReturnsView key="returns" />}
      </div>
    </DeskShell>
  );
}
