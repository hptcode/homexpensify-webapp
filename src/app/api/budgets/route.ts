import { NextResponse } from 'next/server';
import { and, eq, gte, lte, isNull, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { budgets, categories, subcategories, transactions, transactionLines } from '@/db/schema';
import { getAuthContext } from '@/auth/current-user';

// Budgets are either:
//  - kind='limit' + categoryId: compare category spend in the period vs amount
//  - kind='goal' (no category): compare NET cash flow (income - expense) in the period vs amount
// Period 'monthly' = current calendar month (PDT); 'yearly' = current calendar year (PDT, YTD).

function pdtParts(now: Date) {
  const y = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(now));
  const m = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', month: '2-digit' }).format(now));
  return { y, m };
}

export async function GET(req: Request) {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const hid = ctx.householdId;

  const cats = await db.select({ id: categories.id, name: categories.name, direction: categories.direction })
    .from(categories).where(and(eq(categories.householdId, hid), isNull(categories.deletedAt)));
  const subs = await db.select({ id: subcategories.id, direction: subcategories.direction })
    .from(subcategories).where(and(eq(subcategories.householdId, hid), isNull(subcategories.deletedAt)));
  const catDir = new Map(cats.map((c) => [c.id, c.direction]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const subRows = await db.select({ id: subcategories.id, name: subcategories.name, categoryId: subcategories.categoryId }).from(subcategories).where(and(eq(subcategories.householdId, hid), isNull(subcategories.deletedAt)));
  const subName = new Map(subRows.map((x) => [x.id, x.name]));
  const subCategory = new Map(subRows.map((x) => [x.id, x.categoryId]));
  const subDir = new Map(subs.map((s) => [s.id, s.direction]));

  const now = new Date();
  const { y: curY, m: curM } = pdtParts(now);

  // Optional ?month=YYYY-MM (PDT calendar). Defaults to the current month.
  const reqMonth = new URL(req.url).searchParams.get('month');
  let selY = curY, selM = curM, selected = false;
  if (reqMonth && /^\d{4}-\d{2}$/.test(reqMonth)) {
    const [yy, mm] = reqMonth.split('-').map(Number);
    if (yy >= 2000 && yy <= 2100 && mm >= 1 && mm <= 12) { selY = yy; selM = mm; selected = true; }
  }
  const yearFrom = new Date(Date.UTC(selY, 0, 1, 0, 0, 0));
  const yearTo = new Date(Date.UTC(selY, 11, 31, 23, 59, 59));

  const txns = await db.select({ id: transactions.id, direction: transactions.direction, transactedAt: transactions.transactedAt })
    .from(transactions)
    .where(and(eq(transactions.householdId, hid), isNull(transactions.deletedAt), gte(transactions.transactedAt, yearFrom), lte(transactions.transactedAt, yearTo)));
  const ids = txns.map((t) => t.id);
  const lines = ids.length
    ? await db.select({ categoryId: transactionLines.categoryId, subcategoryId: transactionLines.subcategoryId, amount: transactionLines.amount, transactionId: transactionLines.transactionId })
      .from(transactionLines)
      .where(and(eq(transactionLines.householdId, hid), isNull(transactionLines.deletedAt), inArray(transactionLines.transactionId, ids)))
    : [];

  const tMap = new Map(txns.map((t) => [t.id, t]));
  const isSelMonth = (t: { transactedAt: Date }) => {
    const d = t.transactedAt;
    return d.getUTCFullYear() === selY && (d.getUTCMonth() + 1) === selM;
  };
  const isThroughSelMonth = (t: { transactedAt: Date }) => {
    const d = t.transactedAt;
    return d.getUTCFullYear() === selY && (d.getUTCMonth() + 1) <= selM;
  };

  // Per-category spend, per selected month and YTD-through-selected-month.
  const catMonthSpend = new Map<string, number>();
  const catYtdSpend = new Map<string, number>();
  const subMonthSpend = new Map<string, number>();
  const subYtdSpend = new Map<string, number>();
  // Net cash flow (from lines) per selected month and YTD-through-selected.
  let monthNet = 0, ytdNet = 0;
  for (const l of lines) {
    const t = tMap.get(l.transactionId);
    if (!t) continue;
    const d = (l.subcategoryId && subDir.get(l.subcategoryId)) ? subDir.get(l.subcategoryId)! : (catDir.get(l.categoryId) ?? (t.direction));
    const signed = d === 'income' ? -l.amount : l.amount;
    catMonthSpend.set(l.categoryId, (catMonthSpend.get(l.categoryId) ?? 0) + (isSelMonth(t) ? signed : 0));
    catYtdSpend.set(l.categoryId, (catYtdSpend.get(l.categoryId) ?? 0) + (isThroughSelMonth(t) ? signed : 0));
    if (l.subcategoryId) {
      subMonthSpend.set(l.subcategoryId, (subMonthSpend.get(l.subcategoryId) ?? 0) + (isSelMonth(t) ? signed : 0));
      subYtdSpend.set(l.subcategoryId, (subYtdSpend.get(l.subcategoryId) ?? 0) + (isThroughSelMonth(t) ? signed : 0));
    }
    // Net cash flow: income adds (+amount), expense subtracts (-amount). Flipped from spend sign.
    if (isSelMonth(t)) monthNet += -signed;
    if (isThroughSelMonth(t)) ytdNet += -signed;
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(selY, selM - 1, 1)));

  const rows = await db.select()
    .from(budgets).where(eq(budgets.householdId, hid));

  const result = rows
    .map((b) => {
      const isYearly = b.period === 'yearly';
      let actual: number;
      let label: string;
      let periodLabel: string;
      if (b.kind === 'goal') {
        actual = isYearly ? ytdNet : monthNet;
        label = 'Saved';
        periodLabel = isYearly ? `YTD through ${monthLabel}` : monthLabel;
      } else {
        const spend = b.subcategoryId
          ? (isYearly ? (subYtdSpend.get(b.subcategoryId) ?? 0) : (subMonthSpend.get(b.subcategoryId) ?? 0))
          : (isYearly ? (catYtdSpend.get(b.categoryId!) ?? 0) : (catMonthSpend.get(b.categoryId!) ?? 0));
        actual = spend;
        label = 'Spent';
        periodLabel = isYearly ? `YTD through ${monthLabel}` : monthLabel;
      }
      // For limits: pct of amount used (over = bad). For goals: pct of goal reached (under = bad).
      const denom = b.amount > 0 ? b.amount : 1;
      const usedPct = Math.round((actual / denom) * 100);
      const pct = b.kind === 'goal' ? usedPct : Math.max(0, usedPct);
      const remaining = b.amount - actual;
      // yearly accrual hint: amount/12 (minor units)
      const accrualPerMonth = isYearly ? Math.round(b.amount / 12) : 0;
      const monthsElapsed = isYearly ? selM : 1;
      const totalMonths = 12;
      const pacePct = isYearly ? Math.round((monthsElapsed / totalMonths) * 100) : 100;
      const onTrack = isYearly ? (b.kind === 'goal' ? actual >= (b.amount * monthsElapsed / totalMonths) : actual <= (b.amount * monthsElapsed / totalMonths)) : true;
      return {
        id: b.id,
        kind: b.kind,
        period: b.period,
        categoryId: b.categoryId ?? null,
        subcategoryId: b.subcategoryId ?? null,
        category: b.categoryId ? (catName.get(b.categoryId) ?? '(unknown)') : null,
        subcategory: b.subcategoryId ? (subName.get(b.subcategoryId) ?? '(unknown)') : null,
        categoryDirection: b.categoryId ? (catDir.get(b.categoryId) ?? 'expense') : null,
        label,
        periodLabel,
        selectedMonth: selected,
        amount: b.amount,
        actual,
        remaining,
        pct,
        over: b.kind === 'limit' ? actual > b.amount : false,
        behind: b.kind === 'goal' ? actual < b.amount : false,
        accrualPerMonth,
        monthsElapsed,
        totalMonths,
        pacePct,
        onTrack,
      };
    })
    // Sort: limits first by pct desc, then goals at bottom by pct desc
    .sort((a, b) => {
      if (a.kind === 'goal' && b.kind !== 'goal') return 1;
      if (a.kind !== 'goal' && b.kind === 'goal') return -1;
      return b.pct - a.pct;
    });

  return NextResponse.json({ budgets: result, selectedMonth: selected ? `${selY}-${String(selM).padStart(2, '0')}` : null });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'only the household owner can set budgets' }, { status: 403 });
  const { categoryId, subcategoryId, kind, period, amount } = await req.json();
  const k = kind === 'goal' ? 'goal' : 'limit';
  const p = period === 'yearly' ? 'yearly' : 'monthly';
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    return NextResponse.json({ error: 'a non-negative integer amount (cents) is required' }, { status: 400 });
  }
  if (k === 'limit') {
    if (!categoryId) return NextResponse.json({ error: 'a category is required for a spending limit' }, { status: 400 });
    if (subcategoryId) {
      const [sub] = await db.select({ id: subcategories.id }).from(subcategories).where(and(eq(subcategories.id, subcategoryId), eq(subcategories.categoryId, categoryId), eq(subcategories.householdId, ctx.householdId), isNull(subcategories.deletedAt))).limit(1);
      if (!sub) return NextResponse.json({ error: 'subcategory not found for this category' }, { status: 404 });
    }
    const [cat] = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.householdId, ctx.householdId), isNull(categories.deletedAt)))
      .limit(1);
    if (!cat) return NextResponse.json({ error: 'category not found' }, { status: 404 });
  }

  if (k === 'limit') {
    const existing = await db.select({ id: budgets.id }).from(budgets)
      .where(and(eq(budgets.householdId, ctx.householdId), eq(budgets.categoryId, categoryId), subcategoryId ? eq(budgets.subcategoryId, subcategoryId) : isNull(budgets.subcategoryId))).limit(1);
    if (existing.length) {
      const [u] = await db.update(budgets).set({ amount, period: p, updatedAt: new Date() })
        .where(eq(budgets.id, existing[0].id)).returning();
      return NextResponse.json({ budget: u });
    }
    const [ins] = await db.insert(budgets).values({ householdId: ctx.householdId, categoryId, subcategoryId: subcategoryId || null, kind: k, period: p, amount }).returning();
    return NextResponse.json({ budget: ins });
  } else {
    // goal: one per household is fine; allow multiple but upsert on (period) for simplicity
    const existing = await db.select({ id: budgets.id }).from(budgets)
      .where(and(eq(budgets.householdId, ctx.householdId), eq(budgets.kind, 'goal'), eq(budgets.period, p))).limit(1);
    if (existing.length) {
      const [u] = await db.update(budgets).set({ amount, updatedAt: new Date() })
        .where(eq(budgets.id, existing[0].id)).returning();
      return NextResponse.json({ budget: u });
    }
    const [ins] = await db.insert(budgets).values({ householdId: ctx.householdId, kind: k, period: p, amount }).returning();
    return NextResponse.json({ budget: ins });
  }
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext(req);
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (ctx.role !== 'owner') return NextResponse.json({ error: 'only the household owner can manage budgets' }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.householdId, ctx.householdId)));
  return NextResponse.json({ ok: true });
}
