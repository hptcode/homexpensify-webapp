// Client component: dashboard mirroring homeexpense.patrickho.ca
// (monthly total, counts, monthly+ yearly bar charts; no weekly).
'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { partsInTimezone } from '@/lib/timezone';

type BudgetStatus = {
  id: string;
  kind: 'limit' | 'goal';
  period: 'monthly' | 'yearly';
  categoryId: string | null;
  subcategoryId: string | null;
  category: string | null;
  subcategory: string | null;
  label: string;
  periodLabel: string;
  amount: number;
  actual: number;
  monthSpend: number;
  pct: number;
  over: boolean;
  behind: boolean;
  monthsElapsed?: number;
  totalMonths?: number;
  pacePct?: number;
  onTrack?: boolean;
};

type Reports = {
  range: { from: string; to: string };
  totals: { income: number; expense: number; net: number };
  byCategory: { categoryId: string; category: string; direction: 'income' | 'expense'; amount: number }[];
  byPeriod: { period: string; income: number; expense: number; net: number }[];
  budgets: { categoryId: string; category: string; monthlyLimit: number; spent: number; remaining: number; pct: number; period?: string; kind?: string }[];
  yearlyTrend: { month: number; income: number; expense: number }[];
  yearlyByCategory: { categoryId: string; category: string; direction: 'income' | 'expense'; amount: number }[];
  byExpenseType: { type: string; amount: number }[];
  yearlyByExpenseType: { type: string; amount: number }[];
  byMerchant: { merchant: string; amount: number }[];
  yearlyByMerchant: { merchant: string; amount: number }[];
  transactionCount: number;
  householdMembers: { id: string; email: string; role: 'owner' | 'member' }[];
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const amt = Math.abs(cents) / 100;
  const [whole, dec] = amt.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + grouped + '.' + dec;
}


// --- Sample-style stat card SVG icons (thin outline in currentColor) ---
const svgWrap = (body: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{body}</svg>
);
const PiggyIcon = () => svgWrap(<><ellipse cx="12" cy="15" rx="7" ry="5.5" /><path d="M7.5 10 L11 8.5 L11 12 Z" /><circle cx="18" cy="13" r="2.2" /><path d="M16 19 q2 3 3 1 5 3" /></>);
const CalendarIcon = () => svgWrap(<><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8.5 h8 M8 11.5 h8 M8 14.5 h8" /></>);
const WalletIcon = () => svgWrap(<><rect x="4" y="5" width="16" height="13" rx="2" /><rect x="15" y="5" width="7" height="13" rx="2" /></>);
const TargetIcon = () => svgWrap(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M3 12 H21 M12 3 V21" /></>);
const ArrowUpIcon = () => svgWrap(<path d="M7 19 L12 12 L17 19" />);
const ArrowDownIcon = () => svgWrap(<path d="M7 5 L12 12 L17 5" />);


function StatBarRow({ label, pct, color, value }: { label: string; pct: number; color: string; value: string }) {
  return (
    <div className="stat-bar-row">
      <span className="stat-bar-label">{label}</span>
      <span className="stat-bar-track"><span style={{ width: Math.max(2, Math.min(100, pct)) + '%', background: color }} /></span>
      <span className="stat-bar-val">{value}</span>
    </div>
  );
}

function SavingsCard({ icon, iconClass, title, value, valueColor, income, expense }:
  { icon: ReactNode; iconClass: string; title: string; value: string; valueColor: string; income: number; expense: number }) {
  const total = income + expense;
  const incPct = total > 0 ? Math.round((income / total) * 100) : 0;
  const expPct = total > 0 ? Math.round((expense / total) * 100) : 0;
  return (
    <div className="stat sav">
      <div className="stat-head"><span className={"stat-icon " + iconClass}>{icon}</span><span className="label">{title}</span></div>
      <div className="value" style={{ color: valueColor }}>{value}</div>
      <div className="stat-divider" />
      <div className="stat-ie">
        <div className="ie-cell"><span className="ie-badge up">{ArrowUpIcon()}</span>INCOME<div className="ie-val">{money(income)}</div></div>
        <div className="ie-cell"><span className="ie-badge down">{ArrowDownIcon()}</span>EXPENSES<div className="ie-val">{money(expense)}</div></div>
      </div>
      <StatBarRow label="Income" pct={incPct} color="#34d399" value={money(income)} />
      <StatBarRow label="Expenses" pct={expPct} color="#ef4444" value={money(expense)} />
    </div>
  );
}

function Bar({ label, amount, max, colorClass, credit }: { label: string; amount: number; max: number; colorClass?: string; credit?: boolean }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0;
  const cls = 'bar-fill' + (colorClass ? ' ' + colorClass : '');
  // Net totals: a negative bar is a credit/income, a positive bar is net spend.
  const isCredit = credit ?? amount < 0;
  const sign = isCredit ? '\u25B2' : '\u25BC'; // ▲ / ▼
  const signColor = isCredit ? '#2563eb' : '#64748b';
  return (
    <div className="bar-row bar-tip" title={`${label}: ${money(amount)}`}>
      <span className="bar-label"><span style={{ color: signColor, marginRight: 4, fontWeight: 700 }}>{sign}</span>{label}</span>
      <span className="bar-track">
        <span className={cls} style={{ width: Math.max(pct, 2) + '%' }}>
          <span className="tip">{label}: {money(amount)}</span>
        </span>
      </span>
      <span className="bar-val">{money(amount)}</span>
    </div>
  );
}


function PieChart({ items, total }: { items: { label: string; amount: number }[]; total: number }) {
  let offset = 0;
  const colors = ['#4ade80','#60a5fa','#f59e0b','#f472b6','#a78bfa','#34d399','#fb7185','#22d3ee','#facc15','#c084fc','#fb923c','#2dd4bf'];
  const stops = items.map((item, i) => { const start = offset; offset += total ? item.amount / total * 360 : 0; return `${colors[i % colors.length]} ${start}deg ${offset}deg`; }).join(', ');
  return <div className="pie-layout"><div className="pie" style={{ background: `conic-gradient(${stops || '#334155 0 360deg'})` }} /><div className="pie-legend">{items.map((item,i)=><div key={item.label}><i style={{background:colors[i%colors.length]}} />{item.label}: {money(item.amount)} ({total ? Math.round(item.amount/total*100) : 0}%)</div>)}</div></div>;
}

function TrendPair({ label, expense, income, max }: { label: string; expense: number; income: number; max: number }) {
  const width = (value: number) => `${Math.max(2, max > 0 ? Math.round((value / max) * 100) : 0)}%`;
  return <div className="trend-pair">
    <div className="trend-pair-label">{label}</div>
    <div className="trend-pair-line"><span className="trend-dot expense-dot" />Expense<span className="trend-track"><span className="trend-fill expense-fill" style={{ width: width(expense) }} /></span><strong>{money(expense)}</strong></div>
    <div className="trend-pair-line"><span className="trend-dot income-dot" />Income<span className="trend-track"><span className="trend-fill income-fill" style={{ width: width(income) }} /></span><strong>{money(income)}</strong></div>
  </div>;
}

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [todayLabel, setTodayLabel] = useState('');
  const monthLabel = MONTHS[month];
  const [data, setData] = useState<Reports | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [budgetData, setBudgetData] = useState<BudgetStatus[]>([]);

  async function load(y = year, m = month) {
    setBusy(true); setError('');
    const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/reports?from=${from}&to=${to}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Failed to load'); setData(null); return; }
      const reportData = await res.json();
      setData(reportData);
      // Budget status widget: same month as the report, same API as the Budgets page.
      const bm = `${y}-${String(m + 1).padStart(2, '0')}`;
      try {
        const b = await (await fetch(`/api/budgets?month=${bm}`)).json();
        setBudgetData(b.budgets ?? []);
      } catch { setBudgetData([]); }
    } catch { setError('Failed to load'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(me => { const p = partsInTimezone(new Date(), me.timezone ?? 'America/Los_Angeles'); setTimezone(me.timezone ?? 'America/Los_Angeles'); setTodayLabel(new Intl.DateTimeFormat('en-US', { timeZone: me.timezone ?? 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())); setYear(p.year); setMonth(p.month - 1); load(p.year, p.month - 1); }).catch(() => load());
    /* eslint-disable-next-line */
  }, []);

  function exportCsv() {
    if (!data) return;
    const mName = MONTHS[month];
    const rows = [];
    const signed = (amount: number, direction: 'income' | 'expense') => ((direction === 'expense' ? -amount : amount) / 100).toFixed(2);
    rows.push(`${mName}-${year},,`);
    rows.push(`Total Expenses,${(-data.totals.expense / 100).toFixed(2)}`);
    rows.push(`Total Income,${(data.totals.income / 100).toFixed(2)}`);
    rows.push(``);
    rows.push(`Year ${year},,`);
    rows.push(`Total Expenses,${(-data.yearlyTrend.reduce((s, m) => s + m.expense, 0) / 100).toFixed(2)}`);
    rows.push(`Total Income,${(data.yearlyTrend.reduce((s, m) => s + m.income, 0) / 100).toFixed(2)}`);
    rows.push('');
    rows.push(`${mName} Breakdown by Category,,`);
    for (const c of data.byCategory) rows.push(`${c.category},${signed(Math.abs(c.amount), c.direction)}`);
    rows.push('');
    rows.push(`${mName} Breakdown by Subcategory,,`);
    for (const t of data.byExpenseType) rows.push(`${t.type},${(-t.amount / 100).toFixed(2)}`);
    rows.push('');
    rows.push(`Year ${year} Breakdown by Category,,`);
    for (const c of data.yearlyByCategory) rows.push(`${c.category},${signed(Math.abs(c.amount), c.direction)}`);
    rows.push('');
    rows.push(`Year ${year} Breakdown by Subcategory,,`);
    for (const t of data.yearlyByExpenseType) rows.push(`${t.type},${(-t.amount / 100).toFixed(2)}`);
    rows.push('');
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reports_${year}_${month + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const maxCat = data ? Math.max(1, ...data.byCategory.map((c) => c.amount)) : 1;
  const maxYrCat = data ? Math.max(1, ...data.yearlyByCategory.map((c) => c.amount)) : 1;
  const maxTypeMonth = data ? Math.max(1, ...data.byExpenseType.map((t) => t.amount)) : 1;
  const maxTypeYear = data ? Math.max(1, ...data.yearlyByExpenseType.map((t) => t.amount)) : 1;
  const monthIncome = data ? data.byCategory.filter((c) => c.direction === 'income') : [];
  const monthExpenseCategories = data ? data.byCategory.filter((c) => c.direction === 'expense') : [];
  const yearExpenseCategories = data ? data.yearlyByCategory.filter((c) => c.direction === 'expense') : [];
  const monthExpenseTotal = monthExpenseCategories.reduce((sum, c) => sum + Math.max(0, c.amount), 0);
  const yearExpenseTotal = yearExpenseCategories.reduce((sum, c) => sum + Math.max(0, c.amount), 0);
  const yearIncome = data ? data.yearlyByCategory.filter((c) => c.direction === 'income') : [];
  const maxMonthIncome = data ? Math.max(1, ...monthIncome.map((c) => Math.abs(c.amount))) : 1;
  const maxYearIncome = data ? Math.max(1, ...yearIncome.map((c) => Math.abs(c.amount))) : 1;
  const maxMerch = data ? Math.max(1, ...data.byMerchant.map((m) => Math.abs(m.amount))) : 1;
  const maxYMerch = data ? Math.max(1, ...data.yearlyByMerchant.map((m) => Math.abs(m.amount))) : 1;
  const catCount = data ? new Set(data.byCategory.map((c) => c.categoryId)).size : 0;
  const txnCount = data ? data.byPeriod.reduce((n, p) => n + 1, 0) : 0;

  return (
    <div>
      <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>Dashboard {todayLabel && <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>Today: {todayLabel}</span>}</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label>Year</label>
          <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); load(y, month); }}>
            {Array.from({ length: 10 }, (_, i) => now.getUTCFullYear() - 4 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Month</label>
          <select value={month} onChange={(e) => { const m = Number(e.target.value); setMonth(m); load(year, m); }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <button className="btn secondary" style={{ width: 'auto', marginTop: 24, padding: '10px 18px' }} onClick={exportCsv} disabled={!data}>Export CSV</button>
      </div>

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <div className="stat-row" style={{ marginTop: 14 }}>
            {(() => {
              const monthNet = data.totals.income - data.totals.expense;
              return <SavingsCard icon={<PiggyIcon />} iconClass="ic-green" title={(monthLabel + ' SAVINGS').toUpperCase()}
                value={money(monthNet)} valueColor={monthNet < 0 ? '#ef4444' : '#34d399'}
                income={data.totals.income} expense={data.totals.expense} />;
            })()}
            {(() => {
              const yNet = data.yearlyTrend.reduce((s, m) => s + (m.income - m.expense), 0);
              const yInc = data.yearlyTrend.reduce((s, m) => s + m.income, 0);
              const yExp = data.yearlyTrend.reduce((s, m) => s + m.expense, 0);
              return <SavingsCard icon={<CalendarIcon />} iconClass="ic-blue" title={year + ' SAVINGS'}
                value={money(yNet)} valueColor={yNet < 0 ? '#ef4444' : '#34d399'} income={yInc} expense={yExp} />;
            })()}
            {(() => {
              const budgetTotal = budgetData.filter((b) => b.kind === 'limit' && !b.subcategoryId).reduce((sum, b) => sum + (b.period === 'yearly' ? Math.round(b.amount / 12) : b.amount), 0);
              return (
                <div className="stat sav">
                  <div className="stat-head"><span className="stat-icon ic-gray"><WalletIcon /></span><span className="label">MONTHLY BUDGET TOTAL</span></div>
                  <div className="value">{money(budgetTotal)}</div>
                  <div className="stat-divider" />
                  <div className="stat-track-status"><span className="ie-badge target">{TargetIcon()}</span><span style={{ color: '#34d399' }}>On track</span></div>
                  <div className="stat-caption">vs. monthly budget</div>
                </div>
              );
            })()}
          </div>

          <div className="chart budget-status">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>Budget Status</h3>
              <a href="/budgets" className="muted" style={{ fontSize: 16, textDecoration: 'none' }}>Manage budgets →</a>
            </div>
            {budgetData.length === 0 && <p className="muted">No budgets set. Add one on the Budgets page.</p>}
            {(() => {
              const monthlyLimits = budgetData.filter((b) => b.period !== 'yearly' && b.kind !== 'goal');
              const yearlyLimits = budgetData.filter((b) => b.period === 'yearly' && b.kind !== 'goal');
              const goals = budgetData.filter((b) => b.kind === 'goal');
              const renderBudget = (b: BudgetStatus) => {
                const isGoal = b.kind === 'goal';
                const isYearly = b.period === 'yearly';
                const name = isGoal ? `${isYearly ? 'Yearly' : 'Monthly'} savings goal` : (b.subcategory ? `${b.category} → ${b.subcategory}` : b.category);
                const bad = b.over || b.behind;
                const barColor = isGoal ? (b.behind ? 'var(--danger)' : 'var(--secondary)') : (b.over ? 'var(--danger)' : b.pct > 100 ? 'var(--danger)' : (b.pct > 80 ? '#e0a700' : 'var(--primary)'));
                // For yearly limit budgets: show monthly average, compare current month's spend.
                let monthlyAvg: number | null = null;
                let monthSpend: number | null = null;
                let monthOverAvg = false;
                if (!isGoal && isYearly) {
                  monthlyAvg = Math.round(b.amount / 12);
                  monthSpend = Math.max(0, b.monthSpend ?? 0);
                  monthOverAvg = monthSpend > monthlyAvg;
                }
                return (
                  <div key={b.id} style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' }}>{name}</span>
                      <span style={{ color: bad ? 'var(--danger)' : 'var(--text-primary)' }}>
                        {money(b.actual)} / {money(b.amount)} · {b.pct}%
                      </span>
                    </div>
                    <div style={{ position: 'relative', background: 'rgba(255,255,255,0.08)', borderRadius: 6, height: 10, marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, b.pct)}%`, height: '100%', background: barColor, borderRadius: 6 }} />
                    </div>
                    {!isGoal && isYearly && monthlyAvg !== null && (
                      <div style={{ fontSize: 14, color: monthOverAvg ? 'var(--danger)' : 'var(--text-secondary)', marginTop: 3 }}>
                        avg/month {money(monthlyAvg)}{monthSpend !== null && <> · this month {money(monthSpend)}{monthOverAvg ? ' · over avg ⚠' : ''}</>}
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <>
                  {monthlyLimits.map(renderBudget)}
                  {yearlyLimits.map(renderBudget)}
                  {goals.map(renderBudget)}
                </>
              );
            })()}
          </div>

          <div className="chart">
            <h3>{year} Trend<span className="muted"> · Expense vs Income</span></h3>
            <div className="trend-legend"><span><i className="expense-dot" />Expense</span><span><i className="income-dot" />Income</span></div>
            {data.yearlyTrend.map((m) => <TrendPair key={m.month} label={MONTHS[m.month - 1]} expense={m.expense} income={m.income} max={Math.max(1, ...data.yearlyTrend.flatMap((x) => [x.expense, x.income]))} />)}
          </div>
          <div className="chart">
            <h3>{monthLabel} Breakdown by Category<span className="muted"> · Expenses: {money(monthExpenseTotal)}</span></h3>
            {data.byCategory.length === 0 && <p className="muted">No expense transactions this month.</p>}
            <div className="category-chart-pair">
              <div>{monthExpenseCategories.map((c, i) => <Bar key={c.categoryId} label={c.category} amount={c.amount} max={maxCat} colorClass={'c' + (i % 12)} />)}</div>
              <PieChart items={monthExpenseCategories.map(c => ({ label: c.category, amount: Math.max(0, c.amount) }))} total={monthExpenseTotal} />
            </div>
          </div>

          <div className="chart">
            <h3>{monthLabel} Breakdown by Subcategory<span className="muted"> · {money(data.byExpenseType.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))}</span></h3>
            <p className="muted" style={{ marginTop: 0 }}>Subcategories with the same name grouped across categories.</p>
            {data.byExpenseType.length === 0 && <p className="muted">No categorized expenses this month.</p>}
            {data.byExpenseType.filter((t) => t.amount > 0).map((t, i) => <Bar key={t.type} label={t.type} amount={t.amount} max={maxTypeMonth} colorClass={'c' + (i % 12)} />)}
          </div>

          <div className="chart">
            <h3>{year} Breakdown by Category<span className="muted"> · Expenses: {money(yearExpenseTotal)}</span></h3>
            {data.yearlyByCategory.length === 0 && <p className="muted">No expense transactions this year.</p>}
            <div className="category-chart-pair">
              <div>{yearExpenseCategories.map((c, i) => <Bar key={c.categoryId} label={c.category} amount={c.amount} max={maxYrCat} colorClass={'c' + (i % 12)} />)}</div>
              <PieChart items={yearExpenseCategories.map(c => ({ label: c.category, amount: Math.max(0, c.amount) }))} total={yearExpenseTotal} />
            </div>
          </div>

          <div className="chart">
            <h3>{year} Breakdown by Subcategory<span className="muted"> · {money(data.yearlyByExpenseType.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))}</span></h3>
            <p className="muted" style={{ marginTop: 0 }}>Same grouping, across all 12 months.</p>
            {data.yearlyByExpenseType.length === 0 && <p className="muted">No categorized expenses this year.</p>}
            {data.yearlyByExpenseType.filter((t) => t.amount > 0).map((t, i) => <Bar key={t.type} label={t.type} amount={t.amount} max={maxTypeYear} colorClass={'c' + (i % 12)} />)}
          </div>


          <div className="chart">
            <h3>{monthLabel} Breakdown by Merchant<span className="muted"> · {money(data.byMerchant.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0))}</span></h3>
            {data.byMerchant.length === 0 && <p className="muted">No transactions this month.</p>}
            {data.byMerchant.filter((m) => m.amount > 0).map((m, i) => <Bar key={m.merchant} label={m.merchant} amount={Math.abs(m.amount)} max={maxMerch} colorClass={'c' + (i % 12)} />)}
          </div>

          <div className="chart">
            <h3>{year} Breakdown by Merchant<span className="muted"> · {money(data.yearlyByMerchant.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0))}</span></h3>
            {data.yearlyByMerchant.length === 0 && <p className="muted">No transactions this year.</p>}
            {data.yearlyByMerchant.filter((m) => m.amount > 0).map((m, i) => <Bar key={m.merchant} label={m.merchant} amount={Math.abs(m.amount)} max={maxYMerch} colorClass={'c' + (i % 12)} />)}
          </div>


        </>
      )}
    </div>
  );
}
