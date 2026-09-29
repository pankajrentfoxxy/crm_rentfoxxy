import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DateTime, Drawer, KeyValue, Notice, Section, StatusChip,
} from '../../../../components/carret';
import { errMsg, portalLoginAs, setPortalAccess } from './customersApi';
import { portalUrl } from './customerProfileShared';

/**
 * Customer record → Portal access (PATCH /customers/:id/portal-access, the
 * old page's API; section customers edit). Enable, reset password, send the
 * login email, disable; a super admin can open the portal as the customer
 * (read-only, logged, one hour).
 *
 * A generated password is shown once, to the admin who asked for it, and held
 * only in this component's state until the dialog closes. It is never logged
 * or written anywhere else here.
 */
const PORTAL = portalUrl();

function PasswordDrawer({ password, email, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); toast.success('Password copied'); } catch { toast.error('Copy it by hand'); }
  };
  return (
    <Drawer open={Boolean(password)} onClose={onClose} title="Portal password" footer={<Button variant="primary" onClick={onClose}>Done — I have shared it</Button>}>
      <div className="c-stack">
        <Notice tone="warn" title="Shown once">This password is not shown again. Share it with the customer now; they should change it after signing in.</Notice>
        <KeyValue
          cols={1}
          items={[
            { label: 'Portal', value: PORTAL },
            { label: 'Sign in with', value: email || 'the customer email' },
            { label: 'Temporary password', value: <span className="font-mono" style={{ fontSize: 'var(--d-lg)', userSelect: 'all' }}>{password}</span> },
          ]}
        />
        <div><Button onClick={copy}>Copy password</Button></div>
      </div>
    </Drawer>
  );
}

export default function PortalTab({ customer, canEdit, isSuperAdmin, onChanged }) {
  const [busy, setBusy] = useState('');
  const [password, setPassword] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'reset' | 'disable'
  const on = customer.portal_enabled === true;
  const id = customer.customer_id;

  const act = async (key, body, done) => {
    setBusy(key);
    try {
      const { data } = await setPortalAccess(id, body);
      if (data?.new_password) setPassword(data.new_password);
      toast.success(done);
      onChanged?.();
    } catch (e) { toast.error(errMsg(e, 'Portal update failed')); } finally { setBusy(''); }
  };

  const openAsCustomer = async () => {
    // Open the tab inside the click, before any await, or the browser blocks it as a pop-up.
    const tab = window.open('', '_blank');
    setBusy('as');
    try {
      const { data } = await portalLoginAs(id);
      if (!data?.token) throw new Error(data?.message || 'Could not start a portal session');
      // The token rides in the fragment, so it stays out of server logs and Referer headers.
      const url = `${portalUrl(data.portal_url)}/dashboard#token=${encodeURIComponent(data.token)}`;
      if (!tab) { toast.error('Allow pop-ups for this site to open the customer portal'); return; }
      tab.location = url;
      toast.success(`Portal opened as ${customer.company_name || customer.name} — read-only for ${data.ttl_minutes} min`);
    } catch (e) {
      if (tab) tab.close();
      toast.error(errMsg(e, 'Could not open the customer portal'));
    } finally { setBusy(''); }
  };

  return (
    <div className="c-stack">
      <Section title="Customer portal">
        <KeyValue
          cols={3}
          items={[
            { label: 'Status', value: <StatusChip status={on ? 'active' : 'inactive'} label={on ? 'Enabled' : 'Disabled'} /> },
            { label: 'Signs in with', value: customer.email || 'No email on the profile' },
            { label: 'Last sign-in', value: on ? (customer.portal_last_login ? <DateTime value={customer.portal_last_login} /> : 'Never') : '—' },
            { label: 'Portal address', value: PORTAL },
          ]}
        />
        {!on && <p className="text-ink-3" style={{ marginTop: '12px' }}>With the portal the customer sees their invoices and laptops and raises support tickets.</p>}
        {!customer.email && <div style={{ marginTop: '12px' }}><Notice tone="warn">Add an email to the profile before enabling the portal — it is the sign-in name.</Notice></div>}
        {canEdit && (
          <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '16px' }}>
            {!on ? (
              <Button variant="primary" disabled={Boolean(busy) || !customer.email} onClick={() => act('enable', { enabled: true }, 'Portal enabled')}>
                {busy === 'enable' ? 'Enabling…' : 'Enable portal'}
              </Button>
            ) : (
              <>
                <Button disabled={Boolean(busy)} onClick={() => setConfirm('reset')}>Reset password…</Button>
                <Button disabled={Boolean(busy) || !customer.email} onClick={() => act('email', { send_login_email: true }, 'Login email queued')}>
                  {busy === 'email' ? 'Sending…' : 'Send login email'}
                </Button>
                <Button variant="quiet" disabled={Boolean(busy)} onClick={() => setConfirm('disable')}>Disable portal…</Button>
              </>
            )}
          </div>
        )}
      </Section>

      {isSuperAdmin && (
        <Section title="Open the portal as this customer">
          <p className="text-ink-2">
            Opens the customer portal in a new tab exactly as {customer.company_name || customer.name} sees it, without their password.
            The session is read-only, ends after an hour and is logged against you. Raising tickets and changing the password stay off.
          </p>
          <div style={{ marginTop: '12px' }}>
            <Button disabled={Boolean(busy)} onClick={openAsCustomer}>{busy === 'as' ? 'Opening…' : 'Open portal as customer'}</Button>
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act('reset', { reset_password: true }, 'New password set')}
        title="Reset the portal password?"
        body="The customer's current password stops working and anyone signed in is signed out. You will see the new password once."
        confirmLabel="Reset password"
        tone="serious"
      />
      <ConfirmDialog
        open={confirm === 'disable'}
        onClose={() => setConfirm(null)}
        onConfirm={() => act('disable', { enabled: false }, 'Portal disabled')}
        title="Disable the customer portal?"
        body="The customer is signed out and cannot sign in until the portal is enabled again. Their password is kept."
        confirmLabel="Disable"
      />
      <PasswordDrawer password={password} email={customer.email} onClose={() => setPassword(null)} />
    </div>
  );
}
