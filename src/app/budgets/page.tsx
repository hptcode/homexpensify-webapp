// Owner-only: set monthly/yearly budgets (spending limit per category, or savings goal).
'use client';
import { useEffect, useState } from 'react';

type Cat = { id: string; name: string; direction: 'income' | 'expense' };
type Sub = { id: string; name: string; categoryId: string };
type Budget = {
  id: string;
  kind: 'limit' | 'goal';
  period: 'monthly' | 'yearly';
  categoryId: string | null;
  subcategoryId: string | null;
  category: string | null;
  subcategory: string | null;
  label: string;
  amount: number;
  actual: number;
  remaining: number;
  pct: number;
  over: boolean;
  behind: boolean;
  accrualPerMonth: number;
  periodLabel: string;
  selectedMonth: boolean;
};

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return sign + '$' + (Math.abs(cents) / 100).toFixed(2);
}

export default function Budgets() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // add form
  const [kind, setKind] = useState<'limit' | 'goal'>('limit');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  const [amount, setAmount] = useState('');
  // Selected comparison month (YYYY-MM in PDT). Empty = current month.
  const now = new Date();
  const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selMonth, setSelMonth] = useState('');
  const [showView, setShowView] = useState(false);
  // Build a list of the last 18 months for the dropdown, newest first (closest -> oldest).
  const monthOptions: string[] = [];
  for (let i = 0; i <= 17; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Close the View Budgets modal on Escape.
  useEffect(() => {
    if (!showView) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowView(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showView]);

  async function load(month?: string) {
    const mKey = month ?? selMonth;
    setBusy(true);
    try {
      const me = await (await fetch('/api/auth/me')).json();
      setRole(me.role);
      const c = await (await fetch('/api/categories')).json();
      const dirRank = (d: string) => (d === 'income' ? 1 : 0);
      setCats([...(c.categories ?? [])]
        .sort((a: any, b: any) => dirRank(a.direction) - dirRank(b.direction) || a.name.localeCompare(b.name))
        .map((x: any) => ({ id: x.id, name: x.name, direction: x.direction })));
      setSubs((c.categories ?? []).flatMap((x: any) => (x.subcategories ?? []).map((sub: any) => ({ id: sub.id, name: sub.name, categoryId: x.id }))));
      const q = mKey ? `/api/budgets?month=${mKey}` : '/api/budgets';
      const b = await (await fetch(q)).json();
      setBudgets(b.budgets ?? []);
    } catch {
      setError('Failed to load');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (role && role !== 'owner') {
    return <div className="card wide"><h2>Budgets</h2><p className="muted">Only the household owner can manage budgets.</p></div>;
  }

  async function addBudget() {
    setError('');
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError('Enter a valid amount (e.g. 500)'); return; }
    if (kind === 'limit' && !catId) { setError('Pick a category'); return; }
    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: kind === 'limit' ? catId : null, subcategoryId: kind === 'limit' ? (subId || null) : null, kind, period, amount: cents }),
    });
    if (res.ok) {
      setAmount('');
      setCatId('');
      setSubId('');
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Failed to save budget');
    }
  }

  async function removeBudget(id: string) {
    await fetch(`/api/budgets?id=${id}`, { method: 'DELETE' });
    await load();
  }

  const used = new Set(budgets.filter((b) => b.kind === 'limit' && b.categoryId).map((b) => b.categoryId));
  const available = cats.filter((c) => c.direction === 'expense');
  const usedSub = new Set(budgets.filter((b) => b.kind === 'limit' && b.categoryId && b.subcategoryId).map((b) => b.subcategoryId));
  const availableSubs = subs.filter((sub) => sub.categoryId === catId && !usedSub.has(sub.id));

  return (
    <div>
      <div className="card wide">
        <h2>Monthly &amp; Yearly Budgets</h2>
        <p className="muted">
          Set a spending <strong>limit</strong> per category (monthly or yearly), or a <strong>savings goal</strong> (measured against net cash flow). Yearly budgets absorb lump payments like insurance or property tax; the “≈ $/mo” hint shows your set-aside rate.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <label style={{ fontSize: 14 }}>Compare to month:</label>
          <select value={selMonth} onChange={(e) => { const v = e.target.value; setSelMonth(v); load(v); }} style={{ width: 'auto' }}>
            <option value="">{curMonthKey} (current)</option>
            {monthOptions.filter((mo) => mo !== curMonthKey).map((mo) => <option key={mo} value={mo}>{mo}</option>)}
          </select>
          <button className="btn secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowView(true)}>View Budgets</button>
        </div>

        {showView && (
          <div onClick={() => setShowView(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} className="card wide print-area" style={{ maxHeight: '80vh', overflow: 'auto', maxWidth: 520 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }} className="no-print">
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>All Budgets</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn secondary" style={{ width: 'auto' }} onClick={() => window.print()}>Print</button>
                  <button className="btn secondary" style={{ width: 'auto' }} onClick={() => setShowView(false)}>Close</button>
                </div>
              </div>
              {budgets.length === 0 && <p className="muted">No budgets set yet.</p>}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {budgets.map((b) => (
                  <li key={b.id} style={{ marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{b.kind === 'goal' ? `${b.period === 'yearly' ? 'Yearly' : 'Monthly'} savings goal` : (b.subcategory ? `${b.category} → ${b.subcategory}` : b.category)}</strong>
                      <span className="muted" style={{ fontSize: 14 }}>{b.label}: {money(b.actual)} / {money(b.amount)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: (b.over || b.behind) ? 'var(--danger)' : 'var(--text-secondary)', marginTop: 4 }}>
                      {b.periodLabel}{b.accrualPerMonth > 0 ? ` · ≈ ${money(b.accrualPerMonth)}/mo` : ''} · {b.pct}%
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {budgets.length === 0 && !busy && (
          <p className="muted" style={{ marginTop: 12 }}>No budgets yet. Add one below to start tracking.</p>
        )}

        {budgets.map((b) => {
          const isGoal = b.kind === 'goal';
          const title = isGoal ? `${b.period === 'yearly' ? 'Yearly' : 'Monthly'} savings goal` : (b.subcategory ? `${b.category} → ${b.subcategory}` : `${b.category}`);
          const barColor = isGoal ? (b.behind ? '#e0a700' : 'var(--primary)') : (b.over ? 'var(--danger)' : b.pct > 80 ? '#e0a700' : 'var(--primary)');
          const statusText = isGoal
            ? (b.behind ? `Behind by ${money(-b.remaining)}` : `On track (${money(b.actual)} saved)`)
            : (b.over ? `Over by ${money(-b.remaining)}` : `${money(b.remaining)} left`);
          return (
            <div key={b.id} style={{ marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <strong>{title}</strong>
                <span className="muted" style={{ fontSize: 14 }}>
                  {b.label}: {money(b.actual)} / {money(b.amount)}
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, height: 12, marginTop: 8, overflow: 'hidden' }}>
                <div
                  style={{ width: `${Math.min(100, b.pct)}%`, height: '100%', background: barColor, transition: 'width 0.3s ease' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13 }}>
                <span style={{ color: (b.over || b.behind) ? 'var(--danger)' : 'var(--text-secondary)' }}>
                  {statusText} · {b.pct}% · {b.periodLabel}{b.accrualPerMonth > 0 ? ` · ≈ ${money(b.accrualPerMonth)}/mo` : ''}
                </span>
                <button className="btn secondary" style={{ width: 'auto', padding: '4px 12px' }} onClick={() => removeBudget(b.id)}>Remove</button>
              </div>
            </div>
          );
        })}

        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

        <h3 style={{ marginTop: 22 }}>Add a Budget</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'limit' | 'goal')} style={{ width: 'auto' }}>
              <option value="limit">Spending limit</option>
              <option value="goal">Savings goal</option>
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value as 'monthly' | 'yearly')} style={{ width: 'auto' }}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {kind === 'limit' && (
              <select value={catId} onChange={(e) => setCatId(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
                <option value="">Select a category</option>
                {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {kind === 'limit' && catId && availableSubs.length > 0 && (
              <select value={subId} onChange={(e) => setSubId(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
                <option value="">Whole category (optional subcategory)</option>
                {availableSubs.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </select>
            )}
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={kind === 'goal' ? 'Goal (e.g. 6000)' : 'Limit (e.g. 500)'}
              onKeyDown={(e) => { if (e.key === 'Enter') addBudget(); }}
              style={{ width: 160 }}
            />
          </div>
          <div>
            <button className="btn" style={{ width: 'auto', padding: '10px 18px' }} onClick={addBudget}>Add Budget</button>
          </div>
        </div>
      </div>
    </div>
  );
}
