// Client component: add a transaction with multiple line items (merchant,
// category, subcategory, line type, amount per line), then show the just
// entered transaction (persisted, no auto-clear).
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dateInTimezone } from '@/lib/timezone';

type Sub = { id: string; name: string };
type Cat = { id: string; name: string; direction: 'income' | 'expense'; subcategories: Sub[] };
type LineItem = { categoryId: string; subcategoryId: string | null; amount: number };
type Txn = {
  id: string;
  direction: 'income' | 'expense';
  merchant: string | null;
  transactedAt: string;
  note?: string | null;
  lines?: LineItem[];
};
type Line = { categoryId: string; subcategoryId: string; amount: string };

function pdtToday(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const amt = Math.abs(cents) / 100;
  const [whole, dec] = amt.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + grouped + '.' + dec;
}
function fmtDate(iso: string): string {
  const ymd = (iso || '').slice(0, 10);
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString();
}

const emptyLine = (): Line => ({ categoryId: '', subcategoryId: '', amount: '' });

export default function Transactions() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [transactedAt, setTransactedAt] = useState(pdtToday());
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState('');
  const [merchants, setMerchants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showOnly, setShowOnly] = useState<Txn | null>(null);
  const [entryMode, setEntryMode] = useState<'transaction' | 'recurring'>('transaction');
  const [rules, setRules] = useState<any[]>([]);
  const router = useRouter();

  async function load() {
    const me = await (await fetch('/api/auth/me')).json();
    if (!new URLSearchParams(window.location.search).get('edit')) setTransactedAt(dateInTimezone(new Date(), me.timezone ?? 'America/Los_Angeles'));
    const c = await (await fetch('/api/categories')).json();
    const m = await (await fetch('/api/merchants')).json();
    setMerchants(m.merchants ?? []);
    const dirRank = (d: string) => (d === 'income' ? 1 : 0); // empty/undefined -> expense group
    const sorted = [...(c.categories ?? [])].sort((a, b) =>
      dirRank(a.direction) - dirRank(b.direction) || a.name.localeCompare(b.name))
      .map((cat) => ({ ...cat, subcategories: [...(cat.subcategories ?? [])].sort((a, b) =>
        dirRank(a.direction) - dirRank(b.direction) || a.name.localeCompare(b.name)) }));
    setCats(sorted);
    const rrRes = await fetch('/api/recurring-rules');
    const rr = await rrRes.json().catch(() => ({}));
    if (rrRes.ok) setRules(rr.rules ?? []);
    else setError('This item was from a recurring entry');
  }
  useEffect(() => {
    (async () => {
      await load();
      const editId = (typeof window !== 'undefined')
        ? new URLSearchParams(window.location.search).get('edit')
        : null;
      if (editId) {
        const d = await (await fetch(`/api/transactions/${editId}`)).json();
        if (!d.transaction) return;
        const txn = d.transaction;
        setEditingId(editId);
        setDirection(txn.direction);
        setMerchant(txn.merchant ?? '');
        setDescription(txn.note ?? '');
        setTransactedAt((txn.transactedAt || '').slice(0, 10));
        const ls = (txn.lines ?? []).map((l: any) => ({
          categoryId: l.categoryId,
          subcategoryId: l.subcategoryId ?? '',
          amount: (Math.abs(Number(l.amount)) / 100).toFixed(2),
        }));
        setLines(ls.length ? ls : [emptyLine()]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      // Load the most recent transaction for the "Last entry added" panel.
      try {
        const recent = await fetch('/api/transactions');
        const rd = await recent.json();
        const txns = rd.transactions ?? rd;
        if (Array.isArray(txns) && txns.length > 0) setShowOnly(txns[0]);
      } catch {}
    })();
  // eslint-disable-next-line
  }, []);

  function subsFor(catId: string): Sub[] {
    return cats.find((c) => c.id === catId)?.subcategories ?? [];
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  function removeLine(i: number) { setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const clean: { categoryId: string; subcategoryId: string | null; amount: number }[] = [];
    for (const l of lines) {
      if (!l.categoryId) { setError('Every line needs a category'); setBusy(false); return; }
      const cents = Math.round(parseFloat(l.amount || '0') * 100);
      if (!cents || cents <= 0) { setError('Every line needs an amount greater than 0'); setBusy(false); return; }
      clean.push({ categoryId: l.categoryId, subcategoryId: l.subcategoryId || null, amount: cents });
    }
    const payload = {
      direction,
      merchant: merchant || description || null,
      transactedAt,
      note: description || null,
      lines: clean.map((l) => ({ ...l, amount: String(l.amount) })),
    };
    const url = editingId ? `/api/transactions/${editingId}` : '/api/transactions';
    const res = await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saveId = editingId ? editingId : (await res.json()).id;
      setEditingId(null);
      setDirection('expense'); setMerchant(''); setDescription(''); setTransactedAt(pdtToday());
      setLines([emptyLine()]); setError('');
      await load();
      router.refresh();
      // Show the just-saved transaction (added or edited), then auto-clear in 10s.
      if (saveId) {
        const d = await (await fetch(`/api/transactions/${saveId}`)).json();
        if (d.transaction) {
          setShowOnly(d.transaction);
        }
      }
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        u.searchParams.delete('edit');
        window.history.replaceState({}, '', u.pathname);
      }
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Failed to save');
    }
    setBusy(false);
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  async function startEdit(t: Txn) {
    setShowOnly(null);
    const d = await (await fetch(`/api/transactions/${t.id}`)).json();
    const txn = d.transaction;
    if (!txn) return;
    setEditingId(t.id);
    setDirection(txn.direction);
    setMerchant(txn.merchant ?? '');
    setDescription(txn.note ?? '');
    setTransactedAt((txn.transactedAt || '').slice(0, 10));
    const ls: Line[] = (txn.lines ?? []).map((l: any) => ({
      categoryId: l.categoryId,
      subcategoryId: l.subcategoryId ?? '',
      amount: (Math.abs(Number(l.amount)) / 100).toFixed(2),
    }));
    setLines(ls.length ? ls : [emptyLine()]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function del(t: Txn) {
    if (!confirm('Delete this transaction?')) return;
    const res = await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' });
    if (res.ok) setShowOnly(null); else setError('Delete failed');
  }

  async function addCategoryForLine(i: number) {
    const name = window.prompt('New category name:');
    if (!name?.trim()) return;
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), direction }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || 'Could not add category'); return; }
    await load();
    if (d.category?.id) updateLine(i, { categoryId: d.category.id, subcategoryId: '' });
  }

  async function addSubcategoryForLine(i: number) {
    const categoryId = lines[i]?.categoryId;
    if (!categoryId) return;
    const name = window.prompt('New subcategory name:');
    if (!name?.trim()) return;
    const res = await fetch('/api/subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, name: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || 'Could not add subcategory'); return; }
    await load();
    if (d.subcategory?.id) updateLine(i, { subcategoryId: d.subcategory.id });
  }

  return (
    <div>
      <div className="entry-mode-buttons"><button type="button" className={entryMode === 'transaction' ? 'active' : ''} onClick={() => setEntryMode('transaction')}>Add Transaction</button><button type="button" className={entryMode === 'recurring' ? 'active' : ''} onClick={() => setEntryMode('recurring')}>Add Recurring</button></div>
      {entryMode === 'transaction' ? <div className="card wide add-expense-card">
        <h2>{editingId ? 'Edit Transaction' : 'Add New Expense/Income'}</h2>
        <form className="add-expense-form" onSubmit={submit}>
          <label>Type</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>

          <label>Merchant</label>
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Supermarket" list="merchant-list" />
          <datalist id="merchant-list">{merchants.map((m) => <option key={m} value={m} />)}</datalist>

          <label>Date</label>
          <input type="date" value={transactedAt} onChange={(e) => setTransactedAt(e.target.value)} />

          <h3 style={{ marginTop: 18, color: 'var(--primary)' }}>Line Items</h3>
          {lines.map((l, i) => {
            const subs = subsFor(l.categoryId);
            return (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Line {i + 1}</strong>
                  {lines.length > 1 && (
                    <button type="button" className="btn secondary" style={{ width: 'auto', padding: '4px 10px', marginTop: 0 }} onClick={() => removeLine(i)}>Remove</button>
                  )}
                </div>
                <label>Category</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={l.categoryId} onChange={(e) => updateLine(i, { categoryId: e.target.value, subcategoryId: '' })} style={{ flex: 1 }}>
                    <option value="">Select a category</option>
                    {cats.filter((c) => c.direction === direction).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" className="btn secondary" title="Add category" aria-label="Add category" style={{ width: 'auto', padding: '7px 11px', marginTop: 0 }} onClick={() => addCategoryForLine(i)}>+</button>
                </div>

                <label>Subcategory</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={l.subcategoryId} onChange={(e) => updateLine(i, { subcategoryId: e.target.value })} disabled={subs.length === 0} style={{ flex: 1 }}>
                    <option value="">{subs.length === 0 ? 'No subcategories' : 'None'}</option>
                    {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="btn secondary" title={l.categoryId ? 'Add subcategory' : 'Select a category first'} aria-label="Add subcategory" style={{ width: 'auto', padding: '7px 11px', marginTop: 0 }} onClick={() => addSubcategoryForLine(i)} disabled={!l.categoryId}>+</button>
                </div>

                <label>Amount ($)</label>
                <input type="number" step="0.01" value={l.amount} onChange={(e) => updateLine(i, { amount: e.target.value })} placeholder="0.00" />
              </div>
            );
          })}
          <button type="button" className="btn secondary" style={{ width: 'auto', padding: '10px 18px', marginTop: 8 }} onClick={addLine}>+ Add another line</button>

          <label style={{ marginTop: 14 }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional note" />

          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{editingId ? 'Update Transaction' : 'Add Expense'}</button>
          {editingId && <button className="btn secondary" type="button" onClick={() => { setEditingId(null); setLines([emptyLine()]); }}>Cancel</button>}
        </form>
      </div> : <RecurringEntry cats={cats} rules={rules} reload={load} />}

      {showOnly && entryMode === 'transaction' && (
        <div className="card wide" style={{ marginTop: 14 }}>
          <h3>Last entry added</h3>
          <p className="muted">Your most recent transaction.</p>
          <div style={{ margin: '6px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {showOnly.merchant || '—'} · {showOnly.direction === 'income' ? 'Income' : 'Expense'} · {fmtDate(showOnly.transactedAt)}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
              {(showOnly.lines ?? []).map((l, i) => {
                const cn = cats.find((c) => c.id === l.categoryId)?.name ?? '—';
                const sn = l.subcategoryId
                  ? (cats.find((c) => c.id === l.categoryId)?.subcategories.find((s) => s.id === l.subcategoryId)?.name ?? '')
                  : '';
                return (
                  <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{cn}{sn ? ' › ' + sn : ''}</span>
                    <span>{money(Number(l.amount))}</span>
                  </li>
                );
              })}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 8 }}>
              <span>Total</span>
              <span>{money((showOnly.lines ?? []).reduce((s, l) => s + Number(l.amount), 0))}</span>
            </div>
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => startEdit(showOnly)}>Edit</button>
            <button className="btn secondary" onClick={() => del(showOnly)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}


function RecurringEntry({ cats, rules, reload }: { cats: Cat[]; rules: any[]; reload: () => Promise<void> }) {
  const [cat, setCat] = useState(''); const [sub, setSub] = useState(''); const [freq, setFreq] = useState('monthly'); const [amount, setAmount] = useState(''); const [merchant, setMerchant] = useState(''); const [note, setNote] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [editing, setEditing] = useState<any>(null); const [error, setError] = useState('');
  const subs = cats.find(c => c.id === cat)?.subcategories ?? [];
  async function addCat() { const name=prompt('New category name:'); if(!name?.trim())return; const r=await fetch('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,direction:'expense'})}); const d=await r.json(); if(r.ok){await reload();setCat(d.category.id)}else setError(d.error||'Failed'); }
  async function addSub() { if(!cat)return; const name=prompt('New subcategory name:'); if(!name?.trim())return; const r=await fetch('/api/subcategories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({categoryId:cat,name})}); const d=await r.json(); if(r.ok){await reload();setSub(d.subcategory.id)}else setError(d.error||'Failed'); }
  async function save() {
    setError('');
    if (!cat || !amount) { setError('Category and amount required'); return; }
    try {
      const r = await fetch('/api/recurring-rules' + (editing ? '?id=' + editing.id : ''), {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: cat, subcategoryId: sub || null, frequency: freq, amount, merchant, note, anchorDate: start || undefined, endDate: end || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || `Save failed (${r.status})`); return; }
      if (!d.rule?.id) { setError('Save failed: server returned no rule'); return; }
      setEditing(null); setAmount(''); setMerchant(''); setNote(''); setStart(''); setEnd(''); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function edit(r:any){setEditing(r);setCat(r.categoryId);setSub(r.subcategoryId||'');setFreq(r.frequency);setAmount((r.amount/100).toFixed(2));setMerchant(r.merchant||'');setNote(r.note||'');setStart(r.anchorDate||'');setEnd(r.endDate||'')}
  return <div className="card wide recurring-entry">
    <h2>{editing ? 'Edit Recurring' : 'Add Recurring'}</h2>
    <div className="recurring-content">
      {error && <p className="error">{error}</p>}
      <div className="recurring-fields">
        <div><label>Category</label><span className="plus-field"><select value={cat} onChange={e => { setCat(e.target.value); setSub('') }}><option value="">Category</option>{cats.filter(c => c.direction === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" onClick={addCat}>+</button></span></div>
        <div><label>Subcategory</label><span className="plus-field"><select value={sub} disabled={!cat} onChange={e => setSub(e.target.value)}><option value="">None</option>{subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button type="button" disabled={!cat} onClick={addSub}>+</button></span></div>
        <div><label>Frequency</label><select value={freq} onChange={e => setFreq(e.target.value)}><option>daily</option><option>weekly</option><option>bi-weekly</option><option>monthly</option><option>yearly</option></select></div>
        <div><label>Amount</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div><label>Merchant</label><input value={merchant} onChange={e => setMerchant(e.target.value)} /></div>
        <div><label>Description</label><input value={note} onChange={e => setNote(e.target.value)} /></div>
        <div><label>Start date</label><input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div><label>End date</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
      </div>
      <button className="btn" style={{ width: 'auto' }} onClick={save}>{editing ? 'Save' : 'Add'}</button>
      {editing && <button className="btn secondary" style={{ width: 'auto', marginLeft: 8 }} onClick={() => setEditing(null)}>Cancel</button>}
    </div>
    <hr className="section-divider" />
    <h3>Current recurring expenses</h3>
    <div className="recurring-content">
      {rules.length === 0 && <p className="muted">No recurring expenses found.</p>}
      {rules.map(r => <div className="rule-row" key={r.id}>
        <div className="rule-main"><strong>{r.merchant || '(no merchant)'}</strong><span>Amount: ${(r.amount / 100).toFixed(2)}</span><span>{r.frequency}</span><span className="rule-enddate">End date: {r.endDate || '—'}</span></div>
        <div className="rule-actions"><span className="rule-desc">Description: {r.note || '—'}</span><button className="btn secondary" onClick={() => edit(r)}>Edit</button><button className="btn secondary" onClick={async () => { if (confirm('Delete this recurring rule?')) { if (editing && editing.id === r.id) { setEditing(null); setCat(''); setSub(''); setFreq('monthly'); setAmount(''); setMerchant(''); setNote(''); setStart(''); setEnd('') } await fetch('/api/recurring-rules?id=' + r.id, { method: 'DELETE' }); await reload() } }}>Delete</button></div>
      </div>)}
    </div>
  </div>
}
