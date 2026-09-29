import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../shells/DeskShell';
import { Button, Tabs } from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import PartUnitsTab from './stock/setup/PartUnitsTab';
import PartCatalogueTab from './stock/setup/PartCatalogueTab';
import PartFormDrawer from './stock/setup/PartFormDrawer';
import AddUnitsDrawer from './stock/setup/AddUnitsDrawer';
import PartRecordDrawer from './stock/setup/PartRecordDrawer';
import PartLabelPrintDrawer from './stock/setup/PartLabelPrintDrawer';
import {
  PART_REPAIR_WRITE_ROLES, PART_UNIT_WRITE_ROLES, errMsg, fetchParts, labelUnit,
} from './stock/setup/partsApi';

/**
 * Parts catalogue (Production → Parts). The old Parts Inventory page
 * (/inventory-management/parts) and the read-only new parts list were two
 * screens for one job; this is both:
 *   Units      — every tracked spare unit (shelf, fitted, which PO), labels.
 *   Catalogue  — the part master with stock, minimum and value.
 * A part opens its record: units and their actions, fitment tagging, usage,
 * consumable count. Add part / Add units / Print labels are on the page.
 *
 * Buttons follow what the API lets through: part add/edit = parts_inventory
 * create/edit; units = warehouse/admin/manager or parts_inventory/parts_approval
 * edit (routes/partRequests.js); send to vendor = part_vendor_repair
 * create/edit or the warehouse role list (partVendorRepairController).
 */
export default function PartsListPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'catalogue' ? 'catalogue' : 'units';
  const { hasPermission, user } = usePermission();
  const canCreatePart = hasPermission('parts_inventory', 'create');
  const canEditPart = hasPermission('parts_inventory', 'edit');
  const canWriteUnits = PART_UNIT_WRITE_ROLES.includes(user?.role)
    || hasPermission('parts_inventory', 'edit') || hasPermission('parts_approval', 'edit');
  const canSendToVendor = PART_REPAIR_WRITE_ROLES.includes(user?.role)
    || hasPermission('part_vendor_repair', 'edit') || hasPermission('part_vendor_repair', 'create');

  const [parts, setParts] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // { part } | {} for new
  const [addFor, setAddFor] = useState(null); // part | {} for any
  const [labels, setLabels] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadParts = useCallback(() => {
    fetchParts().then(({ data }) => setParts(data.parts || [])).catch((e) => { setParts([]); toast.error(errMsg(e)); });
  }, []);
  useEffect(() => { loadParts(); }, [loadParts]);
  const changed = useCallback(() => { loadParts(); setRefreshKey((k) => k + 1); }, [loadParts]);

  // The record reads the live row, so a count or edit shows at once.
  const openPart = useMemo(() => (parts || []).find((p) => p.part_id === openId) || null, [parts, openId]);
  const print = useCallback((units, partName) => setLabels(units.map((u) => labelUnit(u, partName))), []);

  return (
    <DeskShell
      title="Parts catalogue"
      breadcrumb="Produce"
      subtitle="Spare parts: the catalogue, every unit on the shelf or fitted, and its QR label."
      actions={(
        <div className="flex flex-wrap" style={{ gap: '8px' }}>
          {canWriteUnits && <Button onClick={() => setAddFor({})}>Add units</Button>}
          {canCreatePart && <Button variant="primary" onClick={() => setForm({})}>Add part</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <Tabs
          value={tab}
          onChange={(t) => setParams(t === 'units' ? {} : { tab: t }, { replace: true })}
          tabs={[
            { key: 'units', label: 'Units' },
            { key: 'catalogue', label: 'Catalogue', count: parts ? parts.filter((p) => !p.archived).length : null },
          ]}
        />
        {tab === 'units'
          ? <PartUnitsTab onOpenPart={setOpenId} onPrint={print} refreshKey={refreshKey} />
          : <PartCatalogueTab parts={parts} loading={parts === null} onOpenPart={setOpenId} canEditPart={canEditPart} />}
      </div>

      {/* Hidden, not closed, while its edit / add-units / label drawer is up:
          two dialogs would both take Esc and the focus trap. */}
      <PartRecordDrawer
        part={form || addFor || labels?.length ? null : openPart}
        onClose={() => setOpenId(null)}
        onChanged={changed}
        onEdit={(p) => setForm({ part: p })}
        onAddUnits={(p) => setAddFor(p)}
        onPrint={print}
        canEditPart={canEditPart}
        canWriteUnits={canWriteUnits}
        canSendToVendor={canSendToVendor}
      />
      <PartFormDrawer
        open={Boolean(form)}
        part={form?.part}
        parts={parts || []}
        onClose={() => setForm(null)}
        onSaved={(p, units) => {
          changed();
          if (units?.length) print(units, p.part_name);
        }}
      />
      <AddUnitsDrawer
        open={Boolean(addFor)}
        part={addFor?.part_id ? addFor : null}
        parts={parts || []}
        onClose={() => setAddFor(null)}
        onAdded={(created, p) => { changed(); if (created.length) print(created, p.part_name); }}
      />
      <PartLabelPrintDrawer
        open={Boolean(labels && labels.length)}
        units={labels || []}
        onClose={() => setLabels(null)}
        title={labels && labels.length === 1 ? 'Print QR label' : `Print ${labels ? labels.length : 0} QR labels`}
      />
    </DeskShell>
  );
}
