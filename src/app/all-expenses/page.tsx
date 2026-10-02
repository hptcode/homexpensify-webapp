// Client component: every transaction LINE for a selected month or whole year.
// Defaults to the current month (PDT). Each row has Edit (opens Add Expense pre-filled)
// and Delete (removes the whole transaction from the DB).
// "Total" mode: instead of line entries, show grouped totals of the filtered
// selections — specific subcategory/merchant → one total row; no filter →
// per-category totals; whole year → per-month totals.
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Row = {
  id: string;
  transactionId: string;
  transactedAt: string;
  merchant: string | null;
  direction: 'income' | 'expense';
  category: string;
  categoryDirection: 'income' | 'expense';
  subcategory: string;
  amount: number; // cents
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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

export default function AllExpenses() {
  const now = new Date();
  const pdt = (opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...opt }).format(now);
  const [year, setYear] = useState(Number(pdt({ year: 'numeric' })));
  const [month, setMonth] = useState<string>(String(Number(pdt({ month: 'numeric' })))); // current month by default
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [catFilter, setCatFilter] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [totalMode, setTotalMode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function load(y = year, m = month) {
    setBusy(true); setError('');
    try {
      const q = `/api/expenses?year=${y}${m ? `&month=${m}` : ''}`;
      const res = await fetch(q);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to load'); return; }
      const d = await res.json();
      setRows(d.rows ?? []); setTotal(d.total ?? 0); setIncomeTotal(d.incomeTotal ?? 0);
    } catch { setError('Failed to load'); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function editRow(r: Row) {
    router.push(`/transactions?edit=${r.transactionId}`);
  }
  async function deleteRow(r: Row) {
    if (!confirm(`Delete this transaction (${r.merchant || 'entry'} — ${money(r.amount)})? This cannot be undone.`)) return;
    const res = await fetch(`/api/transactions/${r.transactionId}`, { method: 'DELETE' });
    if (res.ok) { await load(); }
    else { const d = await res.json().catch(() => ({})); setError(d.error || 'Delete failed'); }
  }

  let filtered = catFilter ? rows.filter((r) => r.category === catFilter) : rows;
  if (subFilter) filtered = filtered.filter((r) => (r.subcategory || '-') === subFilter);
  if (merchantFilter) filtered = filtered.filter((r) => (r.merchant || '-') === merchantFilter);
  const expenseRows = filtered.filter((r) => r.categoryDirection === 'expense');
  const incomeRows = filtered.filter((r) => r.categoryDirection === 'income');
  // Net totals: expense-category items add (positive), refunds/credits subtract (negative)
  const totalExpByCat = expenseRows.reduce((s, r) => s + (r.direction === 'expense' ? r.amount : -r.amount), 0);
  const totalIncByCat = incomeRows.reduce((s, r) => s + (r.direction === 'income' ? r.amount : -r.amount), 0);
  // Helper: show correct sign based on effective direction (refund subcategories = credit in expense section)
  const sign = (r: any) => r.direction === 'income' ? '+' : '-';
  // Signed cents per line — expense-category items add (positive = spend), refunds
  // go negative; income mirror-image. Keeps refund/credit conventions consistent.
  const eff = (r: Row) => r.categoryDirection === 'expense'
    ? (r.direction === 'expense' ? r.amount : -r.amount)
    : (r.direction === 'income' ? r.amount : -r.amount);
  const signedSum = (rs: Row[]) => rs.reduce((s, r) => s + eff(r), 0);

  // ---- Total (grouped) mode ----
  type SumRow = { label: string; cents: number; isExpenseSection: boolean };
  let expSummary: SumRow[] = [];
  let incSummary: SumRow[] = [];
  if (totalMode) {
    if (!month) {
      // Whole year: one row per month of the filtered selections
      const byMonthE = new Map<number, number>();
      const byMonthI = new Map<number, number>();
      for (const r of filtered) {
        const m = Number((r.transactedAt || '').slice(5, 7));
        const map = r.categoryDirection === 'expense' ? byMonthE : byMonthI;
        map.set(m, (map.get(m) || 0) + eff(r));
      }
      expSummary = [...byMonthE].sort((a, b) => a[0] - b[0]).map(([m, c]) => ({ label: MONTHS[m - 1], cents: c, isExpenseSection: true }));
      incSummary = [...byMonthI].sort((a, b) => a[0] - b[0]).map(([m, c]) => ({ label: MONTHS[m - 1], cents: c, isExpenseSection: false }));
    } else if (subFilter || merchantFilter) {
      // Specific filter selected: one total row for that selection
      const label = subFilter ? `Subcategory: ${subFilter}` : `Merchant: ${merchantFilter}`;
      const expRows = filtered.filter((r) => r.categoryDirection === 'expense');
      const incRows = filtered.filter((r) => r.categoryDirection === 'income');
      if (expRows.length > 0) expSummary = [{ label, cents: signedSum(expRows), isExpenseSection: true }];
      if (incRows.length > 0) incSummary = [{ label, cents: signedSum(incRows), isExpenseSection: false }];
    } else {
      // No specific filter: one total row per category
      const byCat = new Map<string, number>();
      const dirOf = new Map<string, string>();
      for (const r of filtered) {
        byCat.set(r.category, (byCat.get(r.category) || 0) + eff(r));
        dirOf.set(r.category, r.categoryDirection);
      }
      expSummary = [...byCat].filter(([c]) => dirOf.get(c) === 'expense').sort((a, b) => a[0].localeCompare(b[0])).map(([c, cents]) => ({ label: c, cents, isExpenseSection: true }));
      incSummary = [...byCat].filter(([c]) => dirOf.get(c) === 'income').sort((a, b) => a[0].localeCompare(b[0])).map(([c, cents]) => ({ label: c, cents, isExpenseSection: false }));
    }
  }
  // Display sign follows effective direction, matching the detail tables:
  // expense section: spend '-', refund '+'; income section: '+', payout '-'.
  const sumSign = (s: SumRow) => (s.cents < 0 ? (s.isExpenseSection ? '+' : '-') : (s.isExpenseSection ? '-' : '+'));
  const sumLabelHeader = !totalMode ? 'Date' : (!month ? 'Month' : 'Category');
  const sumSecondHeader = !totalMode ? 'Merchant' : (subFilter ? 'Subcategory' : merchantFilter ? 'Merchant' : 'Total');
  const years = Array.from({ length: 10 }, (_, i) => now.getUTCFullYear() - 4 + i);

  return (
    <div>
      <div className="card wide">
        <h2>All Expenses</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label>Year</label>
            <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); load(y, month); }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label>Month</label>
            <select value={month} onChange={(e) => { const m = e.target.value; setMonth(m); load(year, m); }}>
              <option value="">Whole year</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Category</label>
            <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setSubFilter(''); }} style={{ width: 'auto' }}>
              <option value="">All categories</option>
              {[...new Set(rows.map((r) => r.category))].sort().map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div>
            <label>Subcategory</label>
            <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All subcategories</option>
              {[...new Set(rows.filter((r) => !catFilter || r.category === catFilter).map((r) => r.subcategory || '-'))].sort().map((sub) => <option key={sub} value={sub}>{sub}</option>)}
            </select>
          </div>
          <div>
            <label>Merchant</label>
            <select value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All merchants</option>
              {[...new Set(rows.map((r) => r.merchant || '-'))].sort().map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={totalMode} onChange={(e) => setTotalMode(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
            <span style={{ fontWeight: 600 }}>Total</span>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Total expenses</span>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#fdba74', lineHeight: 1, marginLeft: 10 }}>{money(totalExpByCat)}</span>
          </div>
          <div>
            <span style={{ fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Total income</span>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#86efac', lineHeight: 1, marginLeft: 10 }}>{money(totalIncByCat)}</span>
          </div>
          <span className="muted" style={{ fontSize: 14 }}>· {filtered.length} line {filtered.length === 1 ? 'entry' : 'entries'} {catFilter ? `(filtered from ${rows.length})` : ''}</span>
        </div>
      </div>

      <div className="card wide" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>{totalMode ? 'Expenses (totals)' : 'Expenses'}</h3>
        {!totalMode && expenseRows.length === 0 && <p className="muted">No expenses for this period.</p>}
        {totalMode && expSummary.length === 0 && <p className="muted">No expense totals for this period.</p>}
        {(!totalMode ? expenseRows.length > 0 : expSummary.length > 0) && (
          <table className="exp-table">
            <thead>
              <tr>
                <th>{sumLabelHeader}</th>
                {totalMode && subFilter && <th>Subcategory</th>}
                {totalMode && merchantFilter && <th>Merchant</th>}
                {!totalMode && <><th>Merchant</th><th>Category</th><th>Subcategory</th></>}
                <th style={{ textAlign: 'right' }}>{totalMode ? 'Total' : 'Amount'}</th>
                {!totalMode && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!totalMode && expenseRows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.transactedAt)}</td>
                  <td>{r.merchant || '—'}</td>
                  <td>{r.category}</td>
                  <td>{r.subcategory || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{sign(r)}{money(r.amount)}</td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => editRow(r)}>Edit</button>
                    <button className="btn secondary" onClick={() => deleteRow(r)}>Delete</button>
                  </td>
                </tr>
              ))}
              {totalMode && expSummary.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  {subFilter && <td>{subFilter}</td>}
                  {merchantFilter && <td>{merchantFilter}</td>}
                  <td style={{ textAlign: 'right' }}>{sumSign(s)}{money(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>{totalMode ? 'Income (totals)' : 'Income'}</h3>
        {!totalMode && incomeRows.length === 0 && <p className="muted">No income entries for this period.</p>}
        {totalMode && incSummary.length === 0 && <p className="muted">No income totals for this period.</p>}
        {(!totalMode ? incomeRows.length > 0 : incSummary.length > 0) && (
          <table className="exp-table">
            <thead>
              <tr>
                <th>{sumLabelHeader}</th>
                {totalMode && subFilter && <th>Subcategory</th>}
                {totalMode && merchantFilter && <th>Merchant</th>}
                {!totalMode && <><th>Merchant</th><th>Category</th><th>Subcategory</th></>}
                <th style={{ textAlign: 'right', color: '#2563eb' }}>{totalMode ? 'Total' : 'Amount'}</th>
                {!totalMode && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!totalMode && incomeRows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.transactedAt)}</td>
                  <td>{r.merchant || '—'}</td>
                  <td>{r.category}</td>
                  <td>{r.subcategory || '—'}</td>
                  <td style={{ textAlign: 'right', color: '#2563eb' }}>{sign(r)}{money(r.amount)}</td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => editRow(r)}>Edit</button>
                    <button className="btn secondary" onClick={() => deleteRow(r)}>Delete</button>
                  </td>
                </tr>
              ))}
              {totalMode && incSummary.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  {subFilter && <td>{subFilter}</td>}
                  {merchantFilter && <td>{merchantFilter}</td>}
                  <td style={{ textAlign: 'right', color: '#2563eb' }}>{sumSign(s)}{money(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
