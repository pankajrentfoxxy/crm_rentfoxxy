import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, Panel, SearchSelect, Select,
} from '../../../../components/carret';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import {
  createSparePartsCatalogItem, fetchSparePartsCatalog, updateSparePartsCatalogItem,
} from '../../../vendor-management/vendorManagementApi';

/**
 * Spare parts catalog — the master list spare-part POs pick from (Brand → Part
 * on each PO line). Same API as the old Asset Configuration → Spare Parts →
 * Catalog tab (/vendor-management/spare-parts-catalog, sections
 * parts_procurement / vendor_management).
 */
const errMsg = (e, fallback) => e?.response?.data?.message || e?.message || fallback;
const blank = () => ({ id: null, name: '', category: '', part_type: '', default_brand: '', specifications: '' });

export default function AssetConfigSpareCatalogPanel({ canCreate, canEdit }) {
  const [filters, setFilters] = useState({});
  const search = useDebouncedValue((filters.search || '').trim(), 320);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData((d) => (d ? { ...d, rows: null } : null));
    fetchSparePartsCatalog({ search: search || undefined, category: filters.category || undefined })
      .then(({ data: d }) => setData({ rows: d.data || [], categories: d.categories || [], brands: d.brands || [] }))
      .catch((e) => { setData({ rows: [], categories: [], brands: [] }); toast.error(errMsg(e, 'Could not load the catalog')); });
  }, [search, filters.category]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.category) { toast.error('Part name and category are required'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        part_type: form.part_type.trim() || null,
        default_brand: form.default_brand.trim() || null,
        default_model: null,
        specifications: form.specifications.trim() || null,
      };
      if (form.id) await updateSparePartsCatalogItem(form.id, payload); else await createSparePartsCatalogItem(payload);
      toast.success(form.id ? 'Catalog item saved' : 'Spare part added to the catalog');
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e, 'Save failed')); } finally { setBusy(false); }
  };

  const categories = data?.categories || [];
  const brands = data?.brands || [];
  const columns = [
    { key: 'n', header: 'Part', render: (r) => r.name, sub: (r) => r.specifications || null },
    { key: 'c', header: 'Category', render: (r) => r.category_label || r.category },
    { key: 't', header: 'Type', render: (r) => r.part_type || <span className="text-ink-3">—</span> },
    { key: 'b', header: 'Part brand', render: (r) => r.default_brand || <span className="text-ink-3">Any</span> },
    { key: 's', header: 'Stock', numeric: true, render: (r) => r.stock_qty ?? 0 },
    {
      key: 'x',
      header: '',
      render: (r) => (canEdit ? (
        <Button
          variant="quiet"
          onClick={() => setForm({
            id: r.id, name: r.name || '', category: r.category || '', part_type: r.part_type || '',
            default_brand: r.default_brand || '', specifications: r.specifications || '',
          })}
        >
          Edit
        </Button>
      ) : null),
    },
  ];

  return (
    <div className="c-stack">
      <Panel
        toolbar={(
          <FilterBar
            filters={[
              { key: 'search', label: 'Search', type: 'search', placeholder: 'Search parts' },
              { key: 'category', label: 'Category', options: categories.map((c) => ({ value: c.value, label: c.label })) },
            ]}
            values={filters}
            onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
            onClear={() => setFilters({})}
            count={data?.rows ? `${data.rows.length} parts` : ''}
            right={canCreate ? <Button variant="primary" onClick={() => setForm(blank())}>Add spare part</Button> : null}
          />
        )}
      >
        {!data?.rows ? <EmptyState title="Loading…" /> : (
          <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} empty={<EmptyState title="No parts in the catalog" />} />
        )}
      </Panel>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit catalog part' : 'Add spare part'}
        footer={<Button variant="primary" disabled={busy || !form?.name?.trim() || !form?.category} onClick={save}>Save</Button>}
      >
        {form && (
          <div className="c-stack">
            <Field label="Part name" required>
              <Input value={form.name} placeholder="e.g. 16 GB DDR4 RAM" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <FormGrid cols={2}>
              <Field label="Category" required>
                <Select value={form.category} placeholder="Choose…" options={categories.map((c) => ({ value: c.value, label: c.label }))} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Field>
              <Field label="Type">
                <Input value={form.part_type} placeholder="DDR4, NVMe…" onChange={(e) => setForm({ ...form, part_type: e.target.value })} />
              </Field>
            </FormGrid>
            <Field label="Part brand" hint="Leave empty for any / universal.">
              <SearchSelect
                value={form.default_brand}
                placeholder="Any / universal"
                options={[{ value: '', label: 'Any / universal' }, ...brands.map((b) => ({ value: b.name, label: b.name }))]}
                onChange={(e) => setForm({ ...form, default_brand: e.target.value })}
              />
            </Field>
            <Field label="Specifications">
              <Input value={form.specifications} placeholder="Capacity, connector, compatible models…" onChange={(e) => setForm({ ...form, specifications: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
