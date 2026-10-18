// حدود كل خطة. عدّل الأرقام هنا فقط.
const PLANS = {
  free: { label: 'مجانية', apps: 1, builds: 3, formats: ['apk'] },
  basic: { label: 'أساسية', apps: 5, builds: 20, formats: ['apk', 'aab'] },
  pro: { label: 'احترافية', apps: 20, builds: 100, formats: ['apk', 'aab'] },
  expired: { label: 'منتهية', apps: 0, builds: 0, formats: [] },
};

// الخطة الفعلية: الخطط المدفوعة تنتهي بتاريخ، والمدير بلا قيود
function effectivePlan(u) {
  if (!u) return 'expired';
  if (u.role === 'admin') return 'pro';
  if (u.plan === 'free') return 'free';
  if (PLANS[u.plan] && u.plan_expires && u.plan_expires > Date.now()) return u.plan;
  return 'expired';
}

const limitsFor = (u) => PLANS[effectivePlan(u)];

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

module.exports = { PLANS, effectivePlan, limitsFor, monthStart };
