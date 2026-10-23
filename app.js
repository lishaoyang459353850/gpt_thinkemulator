/* =========================================================
   ValueCodex — local valuation simulator
   No external services. Deterministic core + simulated agent.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- constants ---------------- */
  const FORECAST_YEARS = 5;
  const MC_CAP = 32000;
  const HISTORY_KEY = 'valuecodex.history.v1';

  const MODELS = {
    codex: {
      name: 'GPT-5.1-Codex',
      short: 'Codex',
      badge: 'FLAGSHIP',
      color: '#edb568',
      desc: '工程化交叉校验，适合完整估值与压力测试',
      pathFactor: 1,
      tokenFactor: 1,
      pace: 1,
      voice: 'engineering',
      tone: 'cross',
      calibration: { label: '交叉校验', discount: 1.5, multipleWeight: 30 },
      headline: '工程化交叉校验'
    },
    o3: {
      name: 'o3',
      short: 'o3',
      badge: 'DEEP',
      color: '#b9a7f5',
      desc: '长链路深度推演，更关注尾部风险与终值',
      pathFactor: 1.7,
      tokenFactor: 1.45,
      pace: 0.82,
      voice: 'deep',
      tone: 'bearish',
      calibration: { label: '保守前移', discount: 7.5, multipleWeight: 15 },
      headline: '尾部风险优先'
    },
    gpt41: {
      name: 'GPT-4.1',
      short: '4.1',
      badge: 'BALANCED',
      color: '#8bceaa',
      desc: '快速稳健的基准分析，适合迭代假设',
      pathFactor: 0.72,
      tokenFactor: 0.8,
      pace: 1.16,
      voice: 'balanced',
      tone: 'neutral',
      calibration: { label: '基准对齐', discount: 0, multipleWeight: 20 },
      headline: '稳健基线'
    },
    mini: {
      name: 'GPT-4.1 mini',
      short: 'mini',
      badge: 'LIGHT',
      color: '#94b8d8',
      desc: '低开销速览，快速得到方向性区间',
      pathFactor: 0.38,
      tokenFactor: 0.45,
      pace: 1.45,
      voice: 'compact',
      tone: 'bullish',
      calibration: { label: '乐观速览', discount: -5, multipleWeight: 35 },
      headline: '乐观速览'
    }
  };

  const EFFORTS = {
    low: { label: '低', paths: 1600, stepIndexes: [0, 1, 5], tokenFactor: 0.55, note: '轻量抽样' },
    medium: { label: '中', paths: 5000, stepIndexes: [0, 1, 2, 5], tokenFactor: 1, note: '基准抽样' },
    high: { label: '高', paths: 12000, stepIndexes: [0, 1, 2, 3, 5], tokenFactor: 1.6, note: '完整抽样' },
    xhigh: { label: '极高', paths: 24000, stepIndexes: [0, 1, 2, 3, 4, 5], tokenFactor: 2.4, note: '压力抽样' }
  };

  /* 思考强度对「结果」的影响：额外抽样倍数、参考价折溢、混合权重偏移 */
  const EFFORT_CALIBRATION = {
    low: { label: '快速口径', discount: -3.5, multipleWeight: 35, aShare: 1, bShare: 0, sdFactor: 1.2 },
    medium: { label: '标准口径', discount: 0, multipleWeight: 25, aShare: 1, bShare: 0, sdFactor: 1 },
    high: { label: '交叉复核', discount: 1.5, multipleWeight: 20, aShare: 0.5, bShare: 0.5, sdFactor: 1 },
    xhigh: { label: '深度压测', discount: 3, multipleWeight: 15, aShare: 0.45, bShare: 0.55, sdFactor: 0.88 }
  };

  const PRESETS = {
    nova: {
      tone: '#edb568',
      company: { name: 'NovaCloud', ticker: 'NCLD', sector: '企业软件' },
      assumptions: {
        revenue: 1280, growth: 24, margin: 18, tax: 15, wacc: 9.6, terminal: 3,
        netCash: 860, shares: 64, marketPrice: 94, da: 3.2, capex: 4, nwc: 8,
        multiple: 7.2, uncertainty: 1
      },
      prompt: '对 NovaCloud 跑一份基准情景估值，重点看增长放缓后的现金流质量与终值依赖。'
    },
    helios: {
      tone: '#8bceaa',
      company: { name: 'Helios Energy', ticker: 'HLIO', sector: '新能源' },
      assumptions: {
        revenue: 4600, growth: 18, margin: 14, tax: 15, wacc: 10.5, terminal: 2.5,
        netCash: -1200, shares: 180, marketPrice: 39, da: 6, capex: 9.5, nwc: 10,
        multiple: 2.1, uncertainty: 1.15
      },
      prompt: '评估 Helios 在资本开支回落后的现金流，给出一个偏保守的公允价值区间。'
    },
    mori: {
      tone: '#b9a7f5',
      company: { name: 'Mori Foods', ticker: 'MORI', sector: '消费品牌' },
      assumptions: {
        revenue: 820, growth: 9, margin: 22, tax: 25, wacc: 8.8, terminal: 2.5,
        netCash: 320, shares: 40, marketPrice: 64, da: 2.5, capex: 3, nwc: 6,
        multiple: 3.8, uncertainty: 0.85
      },
      prompt: '用基准假设给 Mori 做估值，检查品牌溢价是否能支撑当前市价。'
    },
    arclight: {
      tone: '#94b8d8',
      company: { name: 'Arclight Semi', ticker: 'ARCL', sector: '半导体' },
      assumptions: {
        revenue: 2100, growth: 28, margin: 26, tax: 12, wacc: 11.2, terminal: 3.5,
        netCash: 540, shares: 95, marketPrice: 88, da: 7, capex: 9, nwc: 12,
        multiple: 5.4, uncertainty: 1.3
      },
      prompt: '推演 Arclight 的周期位置，压力测试 WACC 与利润率的组合对估值的影响。'
    }
  };

  const SECTOR_DEFAULTS = {
    '企业软件': { growth: 20, margin: 18, tax: 15, wacc: 9.8, terminal: 3, da: 3.2, capex: 4, nwc: 8, multiple: 6.5, uncertainty: 1 },
    '半导体': { growth: 24, margin: 24, tax: 12, wacc: 11, terminal: 3.2, da: 7, capex: 9, nwc: 12, multiple: 5.4, uncertainty: 1.3 },
    '新能源': { growth: 16, margin: 12, tax: 15, wacc: 10.2, terminal: 2.5, da: 6, capex: 10, nwc: 10, multiple: 2.2, uncertainty: 1.15 },
    '消费品牌': { growth: 8, margin: 20, tax: 25, wacc: 8.8, terminal: 2.5, da: 2.5, capex: 3, nwc: 6, multiple: 3.5, uncertainty: 0.85 },
    '医疗科技': { growth: 15, margin: 20, tax: 15, wacc: 9.6, terminal: 2.8, da: 3.5, capex: 4.5, nwc: 9, multiple: 4.8, uncertainty: 1.1 },
    '工业制造': { growth: 10, margin: 15, tax: 25, wacc: 9.4, terminal: 2.5, da: 5, capex: 5.5, nwc: 8, multiple: 2.8, uncertainty: 0.95 },
    '其他': { growth: 12, margin: 16, tax: 20, wacc: 9.8, terminal: 2.5, da: 4, capex: 4.5, nwc: 8, multiple: 3.2, uncertainty: 1 }
  };

  const DEFAULT_ASSUMPTIONS = {
    revenue: 800, growth: 12, margin: 16, tax: 20, wacc: 9.8, terminal: 2.5,
    netCash: 0, shares: 40, marketPrice: 72, da: 4, capex: 4.5, nwc: 8,
    multiple: 3.2, uncertainty: 1
  };

  const FIELD_GROUPS = [
    {
      tag: '01', title: '增长与盈利', subtitle: 'GROWTH',
      fields: [
        { key: 'revenue', label: '基期收入', unit: '¥M', min: 10, max: 30000, step: 10, digits: 0, hint: '最近一个完整财年的营业收入，单位人民币百万元。' },
        { key: 'growth', label: '未来 5 年增速', unit: '%', min: -10, max: 60, step: 0.5, digits: 1, hint: '第 1 年收入增速，随后按 0.68 的衰减系数向永续增速收敛。' },
        { key: 'margin', label: 'EBIT 利润率', unit: '%', min: -10, max: 60, step: 0.5, digits: 1, hint: '预测期内保持不变的经营利润率。' }
      ]
    },
    {
      tag: '02', title: '折现假设', subtitle: 'DISCOUNT',
      fields: [
        { key: 'wacc', label: 'WACC', unit: '%', min: 6, max: 20, step: 0.1, digits: 1, hint: '加权平均资本成本，也是自由现金流的折现率。' },
        { key: 'terminal', label: '永续增速', unit: '%', min: 0, max: 6, step: 0.1, digits: 1, hint: '第 5 年之后的长期名义增长假设。' }
      ]
    },
    {
      tag: '03', title: '资本结构', subtitle: 'CAPITAL',
      fields: [
        { key: 'netCash', label: '净现金', unit: '¥M', min: -30000, max: 30000, step: 10, digits: 0, hint: '现金及等价物减去有息负债。负数代表净负债。' },
        { key: 'shares', label: '流通股', unit: 'M', min: 0.1, max: 5000, step: 0.1, digits: 1, hint: '用于把股权价值换算成每股价值的稀释后股数。' },
        { key: 'marketPrice', label: '参考市价', unit: '¥', min: 0, max: 5000, step: 0.5, digits: 1, hint: '模拟市价，仅用于计算溢价/折价，不参与内在价值计算。' }
      ]
    }
  ];

  const ADVANCED_FIELDS = [
    { key: 'tax', label: '有效税率', unit: '%', min: 0, max: 40, step: 0.5, digits: 1, hint: 'EBIT 转化为 NOPAT 时使用的现金税率。' },
    { key: 'da', label: 'D&A / 收入', unit: '%', min: 0, max: 20, step: 0.1, digits: 1, hint: '折旧与摊销占收入比例，作为非现金费用加回。' },
    { key: 'capex', label: 'CapEx / 收入', unit: '%', min: 0, max: 30, step: 0.1, digits: 1, hint: '资本开支占收入比例。' },
    { key: 'nwc', label: 'NWC / 增量收入', unit: '%', min: 0, max: 50, step: 0.5, digits: 1, hint: '每一元新增收入需要投入的营运资本。' },
    { key: 'multiple', label: 'EV / Sales', unit: '×', min: 0, max: 25, step: 0.1, digits: 1, hint: '相对估值使用的企业价值/收入倍数。设为 0 时只使用 DCF。' }
  ];

  const FIELD_MAP = {};
  FIELD_GROUPS.forEach(function (group) {
    group.fields.forEach(function (field) { FIELD_MAP[field.key] = field; });
  });
  ADVANCED_FIELDS.forEach(function (field) { FIELD_MAP[field.key] = field; });

  const state = {
    presetId: 'nova',
    company: null,
    assumptions: null,
    model: 'codex',
    effort: 'high',
    lastReport: null,
    lastConfig: null,
    reportCache: {},
    isRunning: false,
    runToken: 0,
    activeBlock: null,
    timers: [],
    history: [],
    chatBusy: false,
    chatToken: 0,
    chatTimer: null,
    typingEl: null,
    modalMode: 'new',
    paletteOpen: false,
    paletteIndex: 0,
    paletteCommands: [],
    paletteReturnFocus: null
  };

  const els = {};
  let scenarioReturnFocus = null;

  /* ---------------- utilities ---------------- */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function svg(name, className) {
    return '<svg' + (className ? ' class="' + className + '"' : '') + ' aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function fmt(value, digits) {
    const d = digits == null ? 1 : digits;
    if (!Number.isFinite(value)) return '—';
    const normalized = Math.abs(value) < 0.05 && d > 0 ? 0 : value;
    return normalized.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtInt(value) {
    if (!Number.isFinite(value)) return '—';
    return Math.round(value).toLocaleString('en-US');
  }
  function fmtPct(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return fmt(value, digits == null ? 1 : digits) + '%';
  }
  function fmtSignedPct(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return (value > 0 ? '+' : '') + fmt(value, digits == null ? 1 : digits) + '%';
  }
  function fmtPrice(value, digits) {
    if (!Number.isFinite(value)) return '—';
    const d = digits == null ? 1 : digits;
    return (value < 0 ? '-¥' : '¥') + fmt(Math.abs(value), d);
  }
  function fmtMoneyM(value) {
    if (!Number.isFinite(value)) return '—';
    return (value < 0 ? '-¥' : '¥') + fmtInt(Math.abs(value)) + 'M';
  }
  function fmtMoneyCompact(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1000000) return sign + '¥' + fmt(abs / 1000000, 2) + 'T';
    if (abs >= 1000) return sign + '¥' + fmt(abs / 1000, 2) + 'B';
    return sign + '¥' + fmtInt(abs) + 'M';
  }
  function fmtTokens(value) {
    if (!Number.isFinite(value)) return '—';
    return (value / 1000).toFixed(1) + 'k';
  }
  function fmtTime(date) {
    return new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  function timeAgo(timestamp) {
    const diff = Math.max(0, Date.now() - Number(timestamp || 0));
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hours = Math.floor(min / 60);
    if (hours < 24) return hours + ' 小时前';
    return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }
  function parseNumber(value) {
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  function fieldValueLabel(key) {
    const field = FIELD_MAP[key];
    return field ? formatFieldValue(key, state.assumptions[key]) : '—';
  }
  function formatFieldValue(key, value) {
    const field = FIELD_MAP[key];
    if (!field) return String(value);
    return String(Number(Number(value).toFixed(field.digits == null ? 1 : field.digits)));
  }
  function paintRange(input) {
    if (!input) return;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const value = parseFloat(input.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
    input.style.setProperty('--fill', pct + '%');
  }
  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (err) { return null; }
  }
  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (err) { /* local-only app can still work */ }
  }
  function hashString(input) {
    let hash = 2166136261;
    const text = String(input);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normalSample(rng, mean, sd) {
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sd;
  }
  function percentile(sorted, p) {
    if (!sorted.length) return NaN;
    const index = clamp(p, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /* ---------------- valuation core ---------------- */
  function sanitizeAssumptions(raw) {
    const output = Object.assign({}, DEFAULT_ASSUMPTIONS, raw || {});
    Object.keys(FIELD_MAP).forEach(function (key) {
      const field = FIELD_MAP[key];
      let value = parseNumber(output[key]);
      if (!Number.isFinite(value)) value = DEFAULT_ASSUMPTIONS[key];
      output[key] = clamp(value, field.min, field.max);
      const digits = field.digits == null ? 1 : field.digits;
      output[key] = Number(output[key].toFixed(digits));
    });
    let uncertainty = parseNumber(output.uncertainty);
    if (!Number.isFinite(uncertainty)) uncertainty = 1;
    output.uncertainty = Number(clamp(uncertainty, 0.4, 2.2).toFixed(2));
    return output;
  }

  function computeDCF(input) {
    const a = input;
    const revenue0 = Math.max(1, a.revenue);
    let wacc = clamp(a.wacc / 100, 0.03, 0.35);
    let terminal = clamp(a.terminal / 100, -0.02, 0.1);
    if (wacc - terminal < 0.005) wacc = terminal + 0.005;
    const adjustedWacc = Math.abs(wacc * 100 - a.wacc) > 0.0001;
    let revenue = revenue0;
    let previousRevenue = revenue0;
    let pvFcf = 0;
    let finalFcf = 0;
    const years = [];

    for (let year = 1; year <= FORECAST_YEARS; year += 1) {
      const growth = terminal + (a.growth / 100 - terminal) * Math.pow(0.68, year - 1);
      revenue = revenue * (1 + growth);
      const ebit = revenue * (a.margin / 100);
      const nopat = ebit * (1 - a.tax / 100);
      const da = revenue * (a.da / 100);
      const capex = revenue * (a.capex / 100);
      const changeNwc = (revenue - previousRevenue) * (a.nwc / 100);
      const fcf = nopat + da - capex - changeNwc;
      const discount = 1 / Math.pow(1 + wacc, year);
      const pv = fcf * discount;
      pvFcf += pv;
      finalFcf = fcf;
      years.push({
        year: year,
        growth: growth * 100,
        revenue: revenue,
        ebit: ebit,
        fcf: fcf,
        pv: pv
      });
      previousRevenue = revenue;
    }

    const terminalValue = finalFcf * (1 + terminal) / (wacc - terminal);
    const pvTerminal = terminalValue / Math.pow(1 + wacc, FORECAST_YEARS);
    const enterpriseValue = pvFcf + pvTerminal;
    const equityValue = enterpriseValue + a.netCash;
    const perShare = equityValue / Math.max(0.1, a.shares);
    const tvShare = enterpriseValue > 0 ? (pvTerminal / enterpriseValue) * 100 : 0;
    const revenueCagr = (Math.pow(Math.max(1, revenue) / revenue0, 1 / FORECAST_YEARS) - 1) * 100;

    return {
      years: years,
      revenue0: revenue0,
      revenueFinal: revenue,
      finalFcf: finalFcf,
      pvFcf: pvFcf,
      pvTerminal: pvTerminal,
      terminalValue: terminalValue,
      enterpriseValue: enterpriseValue,
      equityValue: equityValue,
      perShare: perShare,
      tvShare: tvShare,
      revenueCagr: revenueCagr,
      waccUsed: wacc * 100,
      terminalUsed: terminal * 100,
      adjustedWacc: adjustedWacc
    };
  }

  function computeComps(a) {
    const perShare = (a.revenue * a.multiple + a.netCash) / Math.max(0.1, a.shares);
    return { perShare: perShare, multiple: a.multiple };
  }

  function blendValue(a, dcf, comps) {
    const compWeight = a.multiple > 0 ? 0.2 : 0;
    return dcf.perShare * (1 - compWeight) + comps.perShare * compWeight;
  }

  /* 模型 × 思考强度 → 估值口径：折溢、混合权重、抽样均值、区间收放 */
  function calibrationFor(modelKey, effortKey) {
    const model = MODELS[modelKey] || MODELS.codex;
    const effort = EFFORTS[effortKey] || EFFORTS.high;
    const mc = model.calibration || { label: '基准', discount: 0, multipleWeight: 20 };
    const ec = EFFORT_CALIBRATION[effortKey] || EFFORT_CALIBRATION.high;
    const discount = (1 + mc.discount / 100) * (1 + ec.discount / 100) - 1;
    return {
      tone: model.tone || 'neutral',
      modelLabel: mc.label,
      effortLabel: ec.label,
      discount: discount * 100,
      multipleWeight: clamp(mc.multipleWeight * 0.6 + ec.multipleWeight * 0.4, 0, 60),
      modelWeight: mc.multipleWeight,
      effortWeight: ec.multipleWeight,
      aShare: ec.aShare,
      bShare: ec.bShare,
      sdFactor: ec.sdFactor,
      pathsFactor: model.pathFactor * (effort.tokenFactor > 1.6 ? 1.35 : effort.tokenFactor > 0.9 ? 1.1 : 1)
    };
  }

  /* 折溢后的不确定性：在基准区间基础上缩放 */
  function applyCalibration(baseBlended, calibratedBlended, mc, cal) {
    const ratio = baseBlended > 0 ? calibratedBlended / baseBlended : (1 + cal.discount / 100);
    const mean = mc.mean * (cal.aShare + cal.bShare * ratio);
    const sd = mc.sd * cal.sdFactor * (Number.isFinite(ratio) && ratio > 0 ? Math.sqrt(ratio) : 1);
    const q = function (p) {
      const rank = clamp(p / 100, 0.0005, 0.9995);
      const z = inverseNormal(rank);
      return mean + z * sd;
    };
    const p01 = q(1), p05 = q(5), p10 = q(10), p50 = q(50), p90 = q(90), p95 = q(95), p99 = q(99);
    const standardError = sd / Math.sqrt(Math.max(1, mc.paths));
    const market = mc.marketPercentile == null ? null : null;
    let marketPercentile = null;
    if (mc.marketPercentile != null) {
      marketPercentile = normalCdf((mc.marketValue - mean) / Math.max(1e-6, sd));
    }
    void market;
    const domainLow = Math.min(p01, p50 - sd * 3);
    const domainHigh = Math.max(p99, p50 + sd * 3);
    const binCount = mc.histogram.binCount;
    const counts = new Array(binCount).fill(0);
    const span = Math.max(1e-6, domainHigh - domainLow);
    const normal = function (x, m, s) { return Math.exp(-0.5 * Math.pow((x - m) / s, 2)); };
    let maxCount = 1;
    for (let i = 0; i < binCount; i += 1) {
      const center = domainLow + span * ((i + 0.5) / binCount);
      const value = Math.round(Math.max(0, normal(center, mean, sd)) * mc.paths * (span / binCount) / Math.max(1e-6, sd) * 3.99);
      counts[i] = value;
      if (value > maxCount) maxCount = value;
    }
    return {
      mean: mean, sd: sd, standardError: standardError,
      p01: p01, p05: p05, p10: p10, p50: p50, p90: p90, p95: p95, p99: p99,
      marketPercentile: marketPercentile,
      paths: mc.paths,
      histogram: { counts: counts, low: domainLow, high: domainHigh, maxCount: maxCount, binCount: binCount }
    };
  }

  function inverseNormal(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const plow = 0.02425;
    const q = p - 0.5;
    let r;
    if (p < plow) {
      r = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    }
    if (p > 1 - plow) {
      r = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    }
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const cdf = 1 - (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
    return z >= 0 ? cdf : 1 - cdf;
  }

  function courseLabel(tone) {
    return { bullish: '乐观口径', neutral: '中性口径', bearish: '保守口径', cross: '交叉校验' }[tone] || '中性口径';
  }

  /* 口径对比：每个模型 × 当前强度下的公允价值 */
  function recallPanel(r) {
    const keys = Object.keys(MODELS);
    const rows = keys.map(function (key) {
      const model = MODELS[key];
      const cal = calibrationFor(key, r.effortKey);
      const value = calibratedValue(r.assumptions, key, r.effortKey);
      return { key: key, model: model, cal: cal, value: value };
    });
    const values = rows.map(function (row) { return row.value; });
    const lo = Math.min.apply(null, values);
    const hi = Math.max.apply(null, values);
    const span = Math.max(0.0001, hi - lo);
    const body = rows.map(function (row) {
      const left = ((row.value - lo) / span) * 100;
      const active = row.key === r.modelKey;
      return '' +
        '<div class="recall-row' + (active ? ' active' : '') + '">' +
          '<span class="recall-name"><i style="background:' + row.model.color + '"></i>' + escapeHtml(row.model.name) + (active ? '<em>当前</em>' : '') + '</span>' +
          '<span class="recall-track"><span class="recall-dot" style="left:' + clamp(left, 0, 100).toFixed(1) + '%;--dot:' + row.model.color + '"></span></span>' +
          '<span class="recall-value">' + fmtPrice(row.value) + '</span>' +
          '<span class="recall-tag">' + escapeHtml(courseLabel(row.cal.tone)) + '</span>' +
        '</div>';
    }).join('');
    return '' +
      '<section class="recall-card">' +
        '<div class="card-head"><span class="card-title">' + svg('spark') + '口径对比</span><span class="card-meta">同假设 · ' + escapeHtml(r.effortLabel) + '思考</span></div>' +
        '<div class="recall-list">' + body + '</div>' +
        '<div class="chart-note"><span>切换模型或思考强度后回看，可对比口径漂移</span><span>极差 ' + fmtPrice(hi - lo) + '</span></div>' +
      '</section>';
  }

  function calibratedValue(a, modelKey, effortKey) {
    const dcf = computeDCF(a);
    const comps = computeComps(a);
    const cal = calibrationFor(modelKey, effortKey);
    const compWeight = a.multiple > 0 ? clamp(cal.multipleWeight, 0, 60) : 0;
    return Math.max(0, (dcf.perShare * (1 - compWeight / 100) + comps.perShare * (compWeight / 100)) * (1 + cal.discount / 100));
  }

  function valueForPatch(a, patch, modelKey, effortKey) {
    const patched = Object.assign({}, a, patch);
    return isFinite(calibratedValue(patched, modelKey, effortKey)) ? calibratedValue(patched, modelKey, effortKey) : blendValue(patched, computeDCF(patched), computeComps(patched));
  }

  function scenarioValues(a, modelKey, effortKey) {
    const bearAssumptions = Object.assign({}, a, {
      growth: Math.max(-10, a.growth - 5),
      margin: Math.max(-10, a.margin - 3),
      wacc: a.wacc + 1,
      terminal: Math.max(0, a.terminal - 0.4),
      multiple: Math.max(0, a.multiple * 0.82)
    });
    const bullAssumptions = Object.assign({}, a, {
      growth: Math.min(60, a.growth + 5),
      margin: Math.min(60, a.margin + 3),
      wacc: Math.max(3, a.wacc - 0.8),
      terminal: a.terminal + 0.3,
      multiple: a.multiple > 0 ? a.multiple * 1.18 : 0
    });
    const base = { name: '基准', key: 'base', value: valueForPatch(a, {}, modelKey, effortKey), probability: 50, color: '#edb568' };
    const bearValue = valueForPatch(bearAssumptions, {}, modelKey, effortKey);
    const bullValue = valueForPatch(bullAssumptions, {}, modelKey, effortKey);
    return [
      { name: '悲观', key: 'bear', value: bearValue, probability: 25, color: '#d1837a' },
      base,
      { name: '乐观', key: 'bull', value: bullValue, probability: 25, color: '#8bceaa' }
    ];
  }

  function buildSensitivity(a) {
    const waccOffsets = [-1.5, -0.75, 0, 0.75, 1.5];
    const terminalOffsets = [-0.75, -0.375, 0, 0.375, 0.75];
    const rowValues = waccOffsets.map(function (offset) { return Number((a.wacc + offset).toFixed(2)); });
    const colValues = terminalOffsets.map(function (offset) { return Number((a.terminal + offset).toFixed(3)); });
    let min = Infinity;
    let max = -Infinity;
    let adjusted = false;
    const grid = rowValues.map(function (wacc) {
      return colValues.map(function (terminal) {
        const patched = Object.assign({}, a, { wacc: wacc, terminal: terminal });
        const dcf = computeDCF(patched);
        if (dcf.adjustedWacc) adjusted = true;
        const value = dcf.perShare;
        if (value < min) min = value;
        if (value > max) max = value;
        return value;
      });
    });
    return { grid: grid, rowValues: rowValues, colValues: colValues, min: min, max: max, adjusted: adjusted, baseRow: 2, baseCol: 2 };
  }

  function getPaths(modelKey, effortKey) {
    const model = MODELS[modelKey] || MODELS.codex;
    const effort = EFFORTS[effortKey] || EFFORTS.high;
    return Math.min(MC_CAP, Math.max(600, Math.round((effort.paths * model.pathFactor) / 100) * 100));
  }

  function computeMonteCarlo(a, paths, seed) {
    const rng = mulberry32(seed);
    const uncertainty = a.uncertainty;
    const growthSd = Math.max(1.2, Math.abs(a.growth) * 0.22) * uncertainty;
    const marginSd = Math.max(0.8, Math.abs(a.margin) * 0.14) * uncertainty;
    const waccSd = 0.7 * uncertainty;
    const terminalSd = 0.3 * uncertainty;
    const multipleSd = a.multiple > 0 ? Math.max(0.15, a.multiple * 0.12) * uncertainty : 0;
    const values = new Array(paths);

    for (let i = 0; i < paths; i += 1) {
      const growth = clamp(normalSample(rng, a.growth, growthSd), -10, 60);
      const margin = clamp(normalSample(rng, a.margin, marginSd), -15, 65);
      let wacc = clamp(normalSample(rng, a.wacc, waccSd), 5, 25);
      let terminal = clamp(normalSample(rng, a.terminal, terminalSd), -1, 6);
      if (wacc - terminal < 0.6) wacc = terminal + 0.6;
      const multiple = a.multiple > 0 ? Math.max(0, normalSample(rng, a.multiple, multipleSd)) : 0;
      const patched = Object.assign({}, a, {
        growth: growth,
        margin: margin,
        wacc: wacc,
        terminal: terminal,
        multiple: multiple
      });
      const dcf = computeDCF(patched);
      const comps = computeComps(patched);
      values[i] = blendValue(patched, dcf, comps);
    }

    const sorted = values.slice().sort(function (x, y) { return x - y; });
    const p01 = percentile(sorted, 0.01);
    const p05 = percentile(sorted, 0.05);
    const p10 = percentile(sorted, 0.1);
    const p50 = percentile(sorted, 0.5);
    const p90 = percentile(sorted, 0.9);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    let sum = 0;
    let sqSum = 0;
    values.forEach(function (value) { sum += value; sqSum += value * value; });
    const mean = sum / values.length;
    const variance = Math.max(0, sqSum / values.length - mean * mean);
    const sd = Math.sqrt(variance);
    const standardError = sd / Math.sqrt(values.length);
    const market = a.marketPrice > 0 ? a.marketPrice : null;
    let marketPercentile = null;
    if (market != null) {
      let below = 0;
      for (let i = 0; i < sorted.length; i += 1) {
        if (sorted[i] <= market) below += 1;
      }
      marketPercentile = below / sorted.length;
    }

    const domainLow = p01;
    const fieldSpan = Math.max(0.0001, p99 - p01);
    const binCount = 26;
    const counts = new Array(binCount).fill(0);
    let maxCount = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      const value = sorted[i];
      if (value < domainLow || value > p99) continue;
      const index = Math.min(binCount - 1, Math.floor(((value - domainLow) / fieldSpan) * binCount));
      counts[index] += 1;
      if (counts[index] > maxCount) maxCount = counts[index];
    }

    return {
      paths: values.length,
      p01: p01, p05: p05, p10: p10, p50: p50, p90: p90, p95: p95, p99: p99,
      mean: mean, sd: sd, standardError: standardError,
      marketPercentile: marketPercentile,
      histogram: { counts: counts, low: domainLow, high: p99, maxCount: maxCount, binCount: binCount }
    };
  }

  function buildReport(company, assumptions, modelKey, effortKey) {
    const model = MODELS[modelKey] || MODELS.codex;
    const effort = EFFORTS[effortKey] || EFFORTS.high;
    const paths = getPaths(modelKey, effortKey);
    const dcf = computeDCF(assumptions);
    const comps = computeComps(assumptions);
    const rawBlended = blendValue(assumptions, dcf, comps);
    const cal = calibrationFor(modelKey, effortKey);
    const compsEnabled = assumptions.multiple > 0;
    const compWeight = compsEnabled ? clamp(cal.multipleWeight, 0, 60) : 0;
    const calibrated = Math.max(0, (dcf.perShare * (1 - compWeight / 100) + comps.perShare * (compWeight / 100)) * (1 + cal.discount / 100));
    const blended = calibrated;
    const marketPrice = assumptions.marketPrice;
    const upside = marketPrice > 0 ? (blended / marketPrice - 1) * 100 : null;
    const scenario = scenarioValues(assumptions, modelKey, effortKey);
    const sensitivity = buildSensitivity(assumptions);
    const seed = hashString(JSON.stringify({
      company: company,
      a: assumptions,
      model: modelKey,
      effort: effortKey,
      paths: paths
    }));
    const mc = computeMonteCarlo(assumptions, paths, seed);
    const calibratedMc = applyCalibration(rawBlended, calibrated, mc, cal);
    if (marketPrice > 0) calibratedMc.marketPercentile = normalCdf((marketPrice - calibratedMc.mean) / Math.max(1e-6, calibratedMc.sd));
    const waccImpact = {
      value: valueForPatch(assumptions, { wacc: clamp(assumptions.wacc + 1, 3, 30) }, modelKey, effortKey),
      delta: null
    };
    waccImpact.delta = (waccImpact.value / calibrated - 1) * 100;
    const terminalLow = valueForPatch(assumptions, { terminal: Math.max(0, assumptions.terminal - 0.5) }, modelKey, effortKey);
    const terminalHigh = valueForPatch(assumptions, { terminal: assumptions.terminal + 0.5 }, modelKey, effortKey);
    const tokenEstimate = Math.round(((1800 + paths * 1.15) * model.tokenFactor) / 100) * 100;
    const id = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 10000).toString(36);

    const report = {
      id: id,
      createdAt: Date.now(),
      company: clone(company),
      assumptions: clone(assumptions),
      modelKey: modelKey,
      effortKey: effortKey,
      modelName: model.name,
      modelShort: model.short,
      effortLabel: effort.label,
      paths: paths,
      tokens: tokenEstimate,
      calibration: {
        tone: cal.tone,
        modelLabel: cal.modelLabel,
        effortLabel: cal.effortLabel,
        discount: cal.discount,
        compWeight: compWeight,
        rawBlended: rawBlended,
        sdFactor: cal.sdFactor
      },
      dcf: dcf,
      comps: comps,
      blended: blended,
      marketPrice: marketPrice,
      upside: upside,
      scenario: scenario,
      sensitivity: sensitivity,
      mc: calibratedMc,
      baseMc: mc,
      waccImpact: waccImpact,
      terminalRange: { low: terminalLow, high: terminalHigh },
      steps: []
    };

    report.steps = buildSteps(report);
    return report;
  }

  function buildSteps(r) {
    const a = r.assumptions;
    const d = r.dcf;
    const lastYear = d.years[d.years.length - 1];
    const allSteps = [
      {
        title: '解析标的与估值口径',
        detail: r.company.name + ' · 收入 ' + fmtMoneyM(a.revenue) + ' · 净现金 ' + fmtMoneyM(a.netCash) + ' · ' + fmt(a.shares, 1) + 'M 股'
      },
      {
        title: '构建五年自由现金流',
        detail: '增速 ' + fmtPct(a.growth) + ' → ' + fmtPct(lastYear.growth) + ' · 第 5 年 FCF ' + fmtMoneyM(d.finalFcf) + ' · CAGR ' + fmtPct(d.revenueCagr)
      },
      {
        title: '折现与相对估值交叉校验',
        detail: 'WACC ' + fmtPct(d.waccUsed) + ' · 永续 ' + fmtPct(d.terminalUsed) + ' · ' + (r.calibration.compWeight > 0 ? 'EV/Sales ' + fmt(a.multiple, 1) + '× · DCF / 相对 ' + (100 - r.calibration.compWeight) + ' / ' + r.calibration.compWeight + ' 混合' : 'EV/Sales 已关闭 · 100% DCF')
      },
      {
        title: '应用模型口径校准',
        detail: r.modelName + ' · ' + r.effortLabel + '思考 · ' + r.calibration.modelLabel + ' / ' + r.calibration.effortLabel + ' · 参考价 ' + fmtSignedPct(r.calibration.discount) + ' · 相对权重 ' + fmt(r.calibration.compWeight, 0) + '%'
      },
      {
        title: '采样不确定性路径',
        detail: fmtInt(r.paths) + ' 条路径 · P10 ' + fmtPrice(r.mc.p10) + ' · P50 ' + fmtPrice(r.mc.p50) + ' · P90 ' + fmtPrice(r.mc.p90)
      },
      {
        title: '检查终值与尾部风险',
        detail: '终值占 EV ' + fmtPct(d.tvShare, 0) + ' · WACC +100bp → ' + fmtPrice(r.waccImpact.value) + ' · P5 ' + fmtPrice(r.mc.p05)
      },
      {
        title: '形成可解释的结论',
        detail: '公允价值 ' + fmtPrice(r.blended) + ' / 股 · 相对市价 ' + (r.upside == null ? '未设市价' : fmtSignedPct(r.upside)) + ' · 抽样误差 ±' + fmtPrice(r.mc.standardError)
      }
    ];
    const effort = EFFORTS[r.effortKey] || EFFORTS.high;
    const indexes = effort.stepIndexes.slice();
    if (indexes.length < 4 && indexes.indexOf(2) !== -1 && indexes.indexOf(3) === -1) {
      indexes.splice(indexes.indexOf(2) + 1, 0, 3);
    }
    return indexes.map(function (index) { return allSteps[index]; });
  }

  function buildPreview(a) {
    const dcf = computeDCF(a);
    const comps = computeComps(a);
    const blended = calibratedValue(a, state.model, state.effort);
    const scenario = scenarioValues(a, state.model, state.effort);
    const sensitivity = buildSensitivity(a);
    return { dcf: dcf, comps: comps, blended: blended, scenario: scenario, sensitivity: sensitivity };
  }

  /* ---------------- markup helpers ---------------- */
  function mastheadMarkup() {
    const company = state.company;
    return '' +
      '<div class="thread-masthead">' +
        '<div class="masthead-copy">' +
          '<div class="masthead-eyebrow"><i></i>VALUATION SESSION · ' + escapeHtml(company.ticker) + '</div>' +
          '<h1><span id="mastheadName">' + escapeHtml(company.name) + '</span><span id="mastheadTicker">' + escapeHtml(company.ticker) + '</span></h1>' +
          '<p id="mastheadMeta">' + escapeHtml(company.sector) + ' · 基准情景 · 本地确定性估值引擎</p>' +
        '</div>' +
        '<div class="masthead-meta">' +
          '<span>MODEL <b id="mastheadModel">' + escapeHtml(MODELS[state.model].name) + '</b></span>' +
          '<span>ENGINE <b>DCF + MC</b></span>' +
        '</div>' +
      '</div>';
  }

  function userMessageMarkup(text) {
    return '' +
      '<div class="message-user">' +
        '<span class="user-meta">YOU · ' + fmtTime(Date.now()) + '</span>' +
        '<div class="user-bubble"><p>' + escapeHtml(text) + '</p></div>' +
      '</div>';
  }

  function traceMarkup(r, instant) {
    const completed = !!instant;
    return '' +
      '<div class="trace-card' + (completed ? ' completed' : '') + '" data-trace>' +
        '<div class="trace-head">' +
          '<div class="trace-title">' + svg('brain') + '推理摘要 <span class="trace-count">' + r.steps.length + ' steps</span></div>' +
          '<div class="trace-head-spacer"></div>' +
          '<div class="trace-status">' +
            '<span class="live-pip"></span>' +
            '<svg class="done-check"><use href="#i-check"/></svg>' +
            '<span class="trace-status-text">' + (completed ? '已完成' : '推演中') + '</span>' +
          '</div>' +
          '<button class="trace-toggle" type="button" aria-label="折叠推理摘要" aria-expanded="true">' + svg('chevron') + '</button>' +
        '</div>' +
        '<div class="trace-progress"><div class="trace-progress-fill" style="width:' + (completed ? 100 : 0) + '%"></div></div>' +
        '<div class="trace-steps">' +
          r.steps.map(function (step, index) {
            return '' +
              '<div class="trace-step' + (completed ? ' done' : '') + '" data-step="' + index + '">' +
                '<span class="step-marker">' +
                  '<span class="step-number">' + String(index + 1).padStart(2, '0') + '</span>' +
                  '<span class="step-spinner"></span>' +
                  '<span class="step-check">' + svg('check') + '</span>' +
                '</span>' +
                '<div class="step-content">' +
                  '<div class="step-title">' + escapeHtml(step.title) + '</div>' +
                  '<div class="step-detail">' + escapeHtml(step.detail) + '</div>' +
                '</div>' +
              '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function assistantHeadMarkup(r) {
    return '' +
      '<div class="assistant-head">' +
        '<div class="assistant-avatar">' + svg('spark') + '</div>' +
        '<div class="assistant-identity">' +
          '<span class="assistant-name">VALUECODEX</span>' +
          '<span class="assistant-meta">' + escapeHtml(r.modelName) + ' · ' + escapeHtml(r.effortLabel) + '思考 · ' + fmtInt(r.paths) + ' paths · ' + fmtTokens(r.tokens) + ' tok</span>' +
        '</div>' +
        '<div class="assistant-head-spacer"></div>' +
        '<div class="report-actions">' +
          '<button class="icon-action" type="button" data-action="copy" data-run="' + escapeHtml(r.id) + '" title="复制报告摘要" aria-label="复制报告摘要">' + svg('copy') + '</button>' +
          '<button class="icon-action" type="button" data-action="download" data-run="' + escapeHtml(r.id) + '" title="导出 Markdown 报告" aria-label="导出 Markdown 报告">' + svg('download') + '</button>' +
        '</div>' +
      '</div>';
  }

  function createReportElement(r, instant) {
    const article = document.createElement('article');
    article.className = 'assistant-block';
    article.dataset.runId = r.id;
    state.reportCache[r.id] = r;
    article.innerHTML = assistantHeadMarkup(r) + traceMarkup(r, instant) + '<div class="report-body" hidden></div>';
    if (instant) {
      const body = $('.report-body', article);
      body.innerHTML = renderReportBody(r);
      body.hidden = false;
      body.classList.add('reveal');
    }
    return article;
  }

  function histogramSvg(r) {
    const chart = r.mc.histogram;
    const width = 520;
    const height = 158;
    const pad = { left: 10, right: 10, top: 17, bottom: 22 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const binWidth = plotW / chart.binCount;
    const domain = Math.max(0.0001, chart.high - chart.low);
    let bars = '';
    chart.counts.forEach(function (count, index) {
      if (!count) return;
      const barHeight = Math.max(1, (count / chart.maxCount) * plotH);
      const x = pad.left + index * binWidth + 0.8;
      const y = pad.top + plotH - barHeight;
      const valueLow = chart.low + (index / chart.binCount) * domain;
      const valueHigh = chart.low + ((index + 1) / chart.binCount) * domain;
      bars += '<rect class="hist-bar" fill="url(#hist-grad-' + escapeHtml(r.id) + ')" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, binWidth - 1.6).toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="1">' +
        '<title>' + fmtPrice(valueLow, 0) + ' – ' + fmtPrice(valueHigh, 0) + ' · ' + fmtInt(count) + ' paths</title></rect>';
    });
    const grid = [0.25, 0.5, 0.75].map(function (ratio) {
      const y = pad.top + plotH * (1 - ratio);
      return '<line class="hist-grid" x1="' + pad.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(1) + '"/>';
    }).join('');
    function xFor(value) {
      return pad.left + clamp((value - chart.low) / domain, 0, 1) * plotW;
    }
    const p10x = xFor(r.mc.p10);
    const p50x = xFor(r.mc.p50);
    const p90x = xFor(r.mc.p90);
    const markers = '' +
      '<line class="hist-marker" x1="' + p10x.toFixed(1) + '" y1="' + pad.top + '" x2="' + p10x.toFixed(1) + '" y2="' + (pad.top + plotH) + '" stroke="#c7a76f" opacity=".55"/>' +
      '<line class="hist-marker" x1="' + p50x.toFixed(1) + '" y1="' + pad.top + '" x2="' + p50x.toFixed(1) + '" y2="' + (pad.top + plotH) + '" stroke="#f0d9b2" opacity=".75"/>' +
      '<line class="hist-marker" x1="' + p90x.toFixed(1) + '" y1="' + pad.top + '" x2="' + p90x.toFixed(1) + '" y2="' + (pad.top + plotH) + '" stroke="#8bceaa" opacity=".55"/>' +
      '<text class="hist-marker-label" x="' + (p50x + 3).toFixed(1) + '" y="' + (pad.top - 5) + '">P50</text>';
    let marketMarker = '';
    if (r.marketPrice > 0 && r.marketPrice >= chart.low && r.marketPrice <= chart.high) {
      const mx = xFor(r.marketPrice);
      marketMarker = '<line class="hist-marker" x1="' + mx.toFixed(1) + '" y1="' + pad.top + '" x2="' + mx.toFixed(1) + '" y2="' + (pad.top + plotH) + '" stroke="#94b8d8" stroke-dasharray="2 3" opacity=".65"/>' +
        '<circle cx="' + mx.toFixed(1) + '" cy="' + (pad.top + 4) + '" r="2" fill="#94b8d8"/>';
    }
    const xLabels = '' +
      '<text class="hist-axis" x="' + pad.left + '" y="' + (height - 5) + '" text-anchor="start">' + fmtPrice(chart.low, 0) + '</text>' +
      '<text class="hist-axis" x="' + width / 2 + '" y="' + (height - 5) + '" text-anchor="middle">' + fmtPrice((chart.low + chart.high) / 2, 0) + '</text>' +
      '<text class="hist-axis" x="' + (width - pad.right) + '" y="' + (height - 5) + '" text-anchor="end">' + fmtPrice(chart.high, 0) + '</text>';

    return '' +
      '<svg class="hist-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="蒙特卡洛估值分布直方图">' +
        '<defs><linearGradient id="hist-grad-' + escapeHtml(r.id) + '" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0%" stop-color="#624830"/><stop offset="60%" stop-color="#b9854e"/><stop offset="100%" stop-color="#edb568"/>' +
        '</linearGradient></defs>' +
        '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="transparent"/>' +
        grid + markers + marketMarker + bars +
        '<line x1="' + pad.left + '" y1="' + (pad.top + plotH) + '" x2="' + (width - pad.right) + '" y2="' + (pad.top + plotH) + '" stroke="#2a3038"/>' +
        xLabels +
      '</svg>';
  }

  function sensitivityCells(r, compact) {
    const s = r.sensitivity;
    const min = s.min;
    const max = s.max;
    return s.grid.map(function (row, rowIndex) {
      return row.map(function (value, colIndex) {
        const t = max > min ? clamp((value - min) / (max - min), 0, 1) : 0.5;
        const bg = 'hsla(' + (8 + t * 145).toFixed(0) + ', 38%, ' + (12 + t * 12).toFixed(0) + '%, .9)';
        const baseClass = rowIndex === s.baseRow && colIndex === s.baseCol ? ' base' : '';
        const rawWacc = s.rowValues[rowIndex];
        const usedWacc = Math.max(rawWacc, s.colValues[colIndex] + 0.5);
        const title = 'WACC ' + fmtPct(usedWacc) + (usedWacc > rawWacc + 0.0001 ? '（已自动上调）' : '') +
          ' · 永续 ' + fmtPct(s.colValues[colIndex]) + ' → ' + fmtPrice(value);
        if (compact) {
          return '<div class="mini-cell' + baseClass + '" style="--cell-bg:' + bg + '" title="' + escapeHtml(title) + '">' + fmt(value, 0) + '</div>';
        }
        return '<div class="sens-cell' + baseClass + '" style="--cell-bg:' + bg + '" title="' + escapeHtml(title) + '">' + fmt(value, 0) + '<small>¥</small></div>';
      }).join('');
    }).join('');
  }

  function renderReportBody(r) {
    const a = r.assumptions;
    const d = r.dcf;
    const up = r.upside;
    const upClass = up == null ? 'neutral' : up >= 0 ? 'positive' : 'negative';
    const upText = up == null ? '未设市价' : fmtSignedPct(up);
    const upIcon = up == null ? '' : svg('arrow-up');
    const cal = r.calibration || { discount: 0, compWeight: 20 };
    const compWeight = cal.compWeight;
    const compsEnabled = a.multiple > 0 && compWeight > 0;
    const model = MODELS[r.modelKey] || MODELS.codex;
    const blendMix = compsEnabled
      ? (100 - compWeight) + '% DCF + ' + compWeight + '% EV/Sales · ' + escapeHtml(model.name) + ' · ' + escapeHtml(r.effortLabel) + '思考'
      : '100% DCF · 相对估值已关闭 · ' + escapeHtml(model.name);
    const waccCaveat = d.adjustedWacc
      ? '<p class="report-caveat">输入 WACC 与永续增速过近。为保证 Gordon 终值有效，模型已将计算用 WACC 上调至 <b>' + fmtPct(d.waccUsed) + '</b>（WACC − g ≥ 0.5pp）。</p>'
      : '';
    const calPills = '<div class="calib-row">' +
      '<span class="calib-pill tone-' + cal.tone + '">' + escapeHtml(courseLabel(cal.tone)) + ' · ' + escapeHtml(cal.effortLabel) + '</span>' +
      '<span class="calib-pill">相对权重 ' + fmt(compWeight, 0) + '%</span>' +
      '<span class="calib-pill">口径折溢 ' + fmtSignedPct(cal.discount) + '</span>' +
      '<span class="calib-pill">区间 ' + fmt(cal.sdFactor, 2) + '×</span>' +
      '</div>';
    const compStat = a.multiple > 0 ? fmtPrice(r.comps.perShare) : '已关闭';
    const blendMemo = compsEnabled
      ? '相对估值给出 ' + fmtPrice(r.comps.perShare) + '，按 ' + (100 - compWeight) + ' / ' + compWeight + ' 混合后为 <span class="memo-highlight">' + fmtPrice(r.blended) + '</span>'
      : 'EV/Sales 倍数已关闭，因此直接采用 DCF 结果 <span class="memo-highlight">' + fmtPrice(r.blended) + '</span>';
    const rawNote = Math.abs(r.calibration.rawBlended - r.blended) > 0.05
      ? '未校准的 80/20 混合值为 ' + fmtPrice(r.calibration.rawBlended) + '，本口径 ' + (r.calibration.discount >= 0 ? '上调' : '下调') + ' ' + fmtPct(Math.abs(r.calibration.discount)) + '。'
      : '本口径与标准 80/20 混合一致。';
    const market = r.marketPrice;
    const rangePoints = [r.mc.p10, r.blended, r.mc.p90];
    if (market > 0) rangePoints.push(market);
    let axisMin = Math.min.apply(null, rangePoints);
    let axisMax = Math.max.apply(null, rangePoints);
    const span = Math.max(0.0001, axisMax - axisMin);
    axisMin -= span * 0.05;
    axisMax += span * 0.05;
    const pos = function (value) { return clamp(((value - axisMin) / (axisMax - axisMin)) * 100, 0, 100); };
    const fairPos = pos(r.blended);
    const marketPos = market > 0 ? pos(market) : null;
    const marketBadge = market > 0 ? '<span class="delta-badge ' + upClass + '">' + upIcon + upText + '</span>' : '<span class="delta-badge neutral">未设市价</span>';
    const marketNote = market > 0 ? '相对模拟市价 ' + fmtPrice(market) : '未设置参考市价';

    const scenarioMax = Math.max.apply(null, r.scenario.map(function (s) { return Math.abs(s.value); }).concat([1]));
    const scenarioRows = r.scenario.map(function (s) {
      const width = clamp((Math.abs(s.value) / scenarioMax) * 100, 4, 100);
      const delta = r.blended !== 0 ? (s.value / r.blended - 1) * 100 : 0;
      return '' +
        '<div class="scenario-row">' +
          '<span class="scenario-name">' + s.name + '</span>' +
          '<div class="scenario-bar-wrap"><div class="scenario-bar" style="width:' + width.toFixed(1) + '%;--bar-color:' + s.color + '"></div></div>' +
          '<span class="scenario-value">' + fmtPrice(s.value) + '<small>' + (s.key === 'base' ? '基准' : fmtSignedPct(delta)) + '</small></span>' +
        '</div>';
    }).join('');

    const cashflowRows = d.years.map(function (year) {
      return '<tr><td>Year ' + year.year + '</td><td>' + fmtMoneyM(year.revenue) + '</td><td>' + fmtPct(year.growth) + '</td><td>' + fmtMoneyM(year.fcf) + '</td><td>' + fmtMoneyM(year.pv) + '</td></tr>';
    }).join('');

    const cagr = d.revenueCagr;
    const lastYear = d.years[d.years.length - 1];
    const marketPercentileText = r.mc.marketPercentile == null ? '未设市价' : fmtPct(r.mc.marketPercentile * 100, 0) + ' 分位';
    const closing = modelClosing(r);
    const assumptionsPills = [
      'WACC ' + fmtPct(a.wacc),
      'g ' + fmtPct(a.terminal),
      'TV ' + fmtPct(d.tvShare, 0),
      'CAGR ' + fmtPct(cagr),
      'P10–P90 ' + fmtPrice(r.mc.p10, 0) + '–' + fmtPrice(r.mc.p90, 0)
    ].map(function (label) { return '<span class="pill">' + escapeHtml(label) + '</span>'; }).join('');

    return '' +
      '<section class="result-card">' +
        '<div class="result-top">' +
          '<div>' +
            '<div class="result-kicker"><i></i>FAIR VALUE · ' + escapeHtml(model.name.toUpperCase()) + ' · ' + escapeHtml(MODELS[r.modelKey].calibration.label) + '</div>' +
            '<div class="hero-value">' +
              '<span class="currency">' + (r.blended < 0 ? '−¥' : '¥') + '</span>' +
              '<span class="hero-number">' + fmt(Math.abs(r.blended), 1) + '</span>' +
              '<span class="hero-unit">/ 股</span>' +
            '</div>' +
            '<div class="hero-sub">' + blendMix + '</div>' +
            calPills +
          '</div>' +
          '<div>' + marketBadge + '<div class="delta-note">' + marketNote + '</div></div>' +
        '</div>' +
        '<div class="range-viz">' +
          '<div class="range-track">' +
            '<span class="range-market-marker" style="left:' + (marketPos == null ? 0 : marketPos).toFixed(2) + '%" ' + (marketPos == null ? 'hidden' : '') + '></span>' +
            '<span class="range-fair-marker" style="left:' + fairPos.toFixed(2) + '%"></span>' +
          '</div>' +
          '<div class="range-labels">' +
            '<span>P10 <b>' + fmtPrice(r.mc.p10) + '</b></span>' +
            '<span>P50 <b>' + fmtPrice(r.mc.p50) + '</b></span>' +
            '<span>P90 <b>' + fmtPrice(r.mc.p90) + '</b></span>' +
          '</div>' +
          '<div class="range-legend">' +
            '<span><i class="legend-line"></i>综合公允价值</span>' +
            (market > 0 ? '<span><i class="legend-line market"></i>模拟市价</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="result-stats">' +
          '<div class="stat-cell"><span class="stat-label">原始 DCF 混合</span><span class="stat-value">' + fmtPrice(r.calibration.rawBlended) + '</span></div>' +
          '<div class="stat-cell"><span class="stat-label">DCF 每股</span><span class="stat-value">' + fmtPrice(d.perShare) + '</span></div>' +
          '<div class="stat-cell"><span class="stat-label">相对估值</span><span class="stat-value">' + compStat + '</span></div>' +
          '<div class="stat-cell"><span class="stat-label">蒙特卡洛区间</span><span class="stat-value">' + fmtPrice(r.mc.p10, 0) + '–' + fmtPrice(r.mc.p90, 0) + '</span></div>' +
          '<div class="stat-cell"><span class="stat-label">终值占 EV</span><span class="stat-value">' + fmtPct(d.tvShare, 0) + '</span></div>' +
        '</div>' +
      '</section>' +
      '<div class="report-grid">' +
        '<section class="report-card">' +
          '<div class="card-head"><span class="card-title">' + svg('chart') + '蒙特卡洛分布</span><span class="card-meta">' + fmtInt(r.paths) + ' paths</span></div>' +
          '<div class="hist-wrap">' + histogramSvg(r) + '</div>' +
          '<div class="chart-note"><span><i class="dot"></i>P10–P90 · 截尾 P1–P99</span><span>中位 ' + fmtPrice(r.mc.p50) + '</span></div>' +
        '</section>' +
        '<section class="report-card">' +
          '<div class="card-head"><span class="card-title">' + svg('grid') + '情景推演</span><span class="card-meta">25 / 50 / 25</span></div>' +
          '<div class="scenario-list">' + scenarioRows + '</div>' +
          '<div class="scenario-foot">压力参数为模拟设定，概率为展示权重</div>' +
        '</section>' +
      '</div>' +
      '<section class="report-card sens-card">' +
        '<div class="card-head"><span class="card-title">' + svg('grid') + '敏感性矩阵</span><span class="card-meta">DCF 每股 · 5 × 5</span></div>' +
        '<div class="sens-wrap">' +
          '<div class="sens-y-label">WACC ↓ / g →</div>' +
          '<div class="sens-main">' +
            '<div class="sens-grid">' + sensitivityCells(r, false) + '</div>' +
            '<div class="sens-x-labels">' + r.sensitivity.colValues.map(function (value) { return '<span>' + fmtPct(value, 2) + '</span>'; }).join('') + '</div>' +
            '<div class="sens-x-title"><span>永续增速 →</span><span>DCF 每股价值</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="chart-note"><span>行：WACC ' + fmtPct(r.sensitivity.rowValues[0]) + '–' + fmtPct(r.sensitivity.rowValues[4]) + '</span><span>列：g ' + fmtPct(r.sensitivity.colValues[0], 2) + '–' + fmtPct(r.sensitivity.colValues[4], 2) + '</span></div>' +
        (r.sensitivity.adjusted ? '<div class="chart-note"><span>部分极端组合的 WACC 已自动上调，以维持 WACC − g ≥ 0.5pp</span></div>' : '') +
      '</section>' +
      recallPanel(r) +
      '<section class="memo">' +
        '<p>在 <strong>' + fmtPct(a.growth) + ' 首年增速 / ' + fmtPct(a.margin) + ' EBIT 利润率 / ' + fmtPct(a.wacc) + ' WACC</strong> 的组合下，' + escapeHtml(r.company.name) + ' 的 DCF 每股价值为 <span class="memo-highlight">' + fmtPrice(d.perShare) + '</span>，' + blendMemo + '。</p>' +
        waccCaveat +
        '<ul>' +
          '<li>五年收入 CAGR <b>' + fmtPct(cagr) + '</b>，第 5 年 FCF <b>' + fmtMoneyM(lastYear.fcf) + '</b>，终值贡献 <b>' + fmtPct(d.tvShare, 0) + '</b> 的企业价值。</li>' +
          '<li>蒙特卡洛 P10–P90 为 <b>' + fmtPrice(r.mc.p10) + '–' + fmtPrice(r.mc.p90) + '</b>，中位数 <b>' + fmtPrice(r.mc.p50) + '</b>；模拟市价位于 <b>' + marketPercentileText + '</b>。</li>' +
          '<li>模型口径：<b>' + escapeHtml(r.modelName) + ' · ' + escapeHtml(r.effortLabel) + '思考</b>（' + escapeHtml(r.calibration.modelLabel) + ' / ' + escapeHtml(r.calibration.effortLabel) + '），DCF / 相对估值权重 <b>' + (100 - compWeight) + ' / ' + compWeight + '</b>，口径调整 <b>' + fmtSignedPct(r.calibration.discount) + '</b>。' + rawNote + '</li>' +
          '<li>WACC 上调 100bp 会使混合价值降至 <b>' + fmtPrice(r.waccImpact.value) + '</b>（' + fmtSignedPct(r.waccImpact.delta) + '）；永续增速 ±0.5pp 对应 <b>' + fmtPrice(r.terminalRange.low) + '–' + fmtPrice(r.terminalRange.high) + '</b>。</li>' +
        '</ul>' +
        '<p><strong>' + escapeHtml(closing) + '</strong></p>' +
        '<div class="pill-row">' + assumptionsPills + '</div>' +
      '</section>' +
      '<details class="cashflow-details">' +
        '<summary>' + svg('arrow-right') + '五年现金流桥<span class="card-meta">人民币百万元</span></summary>' +
        '<div class="cashflow-table-wrap"><table class="cashflow-table"><thead><tr><th>期间</th><th>收入</th><th>增速</th><th>FCF</th><th>FCF 现值</th></tr></thead><tbody>' + cashflowRows + '</tbody></table></div>' +
      '</details>' +
      '<div class="report-footer">' + svg('info') +
        '<span>模拟推演，不构成投资建议。终值占比与折现假设对结果影响显著，请把它当作假设实验而非价格预测。</span>' +
        '<div class="footer-actions">' +
          '<button type="button" data-action="copy" data-run="' + escapeHtml(r.id) + '">' + svg('copy') + '复制摘要</button>' +
          '<button type="button" data-action="download" data-run="' + escapeHtml(r.id) + '">' + svg('download') + '导出 .md</button>' +
        '</div>' +
      '</div>';
  }

  function modelClosing(r) {
    const tv = fmtPct(r.dcf.tvShare, 0);
    const map = {
      engineering: '工程化视角：先确认自由现金流的兑现路径，再讨论倍数扩张；终值占比 ' + tv + ' 是这份结论最值得复核的变量。',
      deep: '深度视角：尾部风险主要来自 WACC 与永续增速的联合偏移，单年增长误差对价值的影响相对有限。',
      balanced: '均衡视角：基准情景已反映增速放缓，剩余安全边际取决于利润率兑现与资本开支纪律。',
      compact: '速览结论：先盯住 WACC 与终值两个变量；若需要更细的分布，提升思考强度后再跑一次。'
    };
    return map[(MODELS[r.modelKey] || MODELS.codex).voice] || map.engineering;
  }

  /* ---------------- report text ---------------- */
  function reportMarkdown(r) {
    const a = r.assumptions;
    const compsEnabled = a.multiple > 0 && r.calibration.compWeight > 0;
    return [
      '# ' + r.company.name + ' 估值报告',
      '',
      '- 模型：' + r.modelName + '（' + r.calibration.modelLabel + '）',
      '- 思考强度：' + r.effortLabel + '（' + r.calibration.effortLabel + '）',
      '- 抽样路径：' + fmtInt(r.paths),
      '- 生成时间：' + new Date(r.createdAt).toLocaleString('zh-CN'),
      '- 标的：' + r.company.ticker + ' · ' + r.company.sector,
      '',
      '## 核心结论',
      '',
      '- 综合公允价值：' + fmtPrice(r.blended) + ' / 股',
      '- DCF 每股价值：' + fmtPrice(r.dcf.perShare),
      compsEnabled ? '- 相对估值（EV/Sales ' + fmt(a.multiple, 1) + '×）：' + fmtPrice(r.comps.perShare) : '- 相对估值：已关闭（仅使用 DCF）',
      '- 口径：DCF / 相对估值权重 ' + (100 - r.calibration.compWeight) + ' / ' + r.calibration.compWeight + '，口径调整 ' + fmtSignedPct(r.calibration.discount),
      '- 蒙特卡洛 P10–P90：' + fmtPrice(r.mc.p10) + ' – ' + fmtPrice(r.mc.p90),
      '- 模拟市价：' + (r.marketPrice > 0 ? fmtPrice(r.marketPrice) + '（' + fmtSignedPct(r.upside) + '）' : '未设置'),
      '',
      '## 关键假设',
      '',
      '| 项目 | 数值 |',
      '| --- | --- |',
      '| 基期收入 | ' + fmtMoneyM(a.revenue) + ' |',
      '| 首年收入增速 | ' + fmtPct(a.growth) + ' |',
      '| EBIT 利润率 | ' + fmtPct(a.margin) + ' |',
      '| WACC | ' + fmtPct(a.wacc) + ' |',
      '| 永续增速 | ' + fmtPct(a.terminal) + ' |',
      '| 净现金 | ' + fmtMoneyM(a.netCash) + ' |',
      '| 流通股 | ' + fmt(a.shares, 1) + 'M |',
      '| 终值占 EV | ' + fmtPct(r.dcf.tvShare, 1) + ' |',
      '',
      '## 情景推演',
      '',
      '| 情景 | 每股价值 | 概率权重 |',
      '| --- | --- | --- |',
    ].concat(r.scenario.map(function (s) {
      return '| ' + s.name + ' | ' + fmtPrice(s.value) + ' | ' + s.probability + '% |';
    })).concat([
      '',
      '## 口径对比',
      '',
      '| 模型 | 公允价值 | 口径 |',
      '| --- | --- | --- |',
    ]).concat(recallRows(r)).concat([
      '',
      '## 敏感性与风险',
      '',
      '- WACC +100bp：' + fmtPrice(r.waccImpact.value) + '（' + fmtSignedPct(r.waccImpact.delta) + '）',
      '- 永续增速 ±0.5pp：' + fmtPrice(r.terminalRange.low) + ' – ' + fmtPrice(r.terminalRange.high),
      '- 蒙特卡洛抽样误差：±' + fmtPrice(r.mc.standardError),
      '- ' + modelClosing(r),
      '',
      '> 本地模拟推演，不构成投资建议。所有数值取决于用户假设，不代表真实市场定价。'
    ]).join('\n');
  }

  function recallRows(r) {
    return Object.keys(MODELS).map(function (key) {
      const cal = calibrationFor(key, r.effortKey);
      const value = calibratedValue(r.assumptions, key, r.effortKey);
      return '| ' + MODELS[key].name + ' | ' + fmtPrice(value) + ' | ' + courseLabel(cal.tone) + (key === r.modelKey ? '（当前）' : '') + ' |';
    });
  }

  function downloadReport(r) {
    const text = reportMarkdown(r);
    const safeName = r.company.name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');
    const date = new Date(r.createdAt);
    const stamp = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName + '-valuation-' + stamp + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    toast('报告已导出为 Markdown');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (ok) resolve(); else reject(new Error('copy unavailable'));
      } catch (err) { reject(err); }
    });
  }

  function copyReport(r) {
    copyText(reportMarkdown(r)).then(function () {
      toast('报告摘要已复制');
    }).catch(function () {
      toast('复制失败，请使用“导出 .md”', 'warn');
    });
  }

  /* ---------------- UI state ---------------- */
  function cacheElements() {
    els.sidebar = $('#sidebar');
    els.sidebarBackdrop = $('#sidebarBackdrop');
    els.menuBtn = $('#menuBtn');
    els.sidebarClose = $('#sidebarClose');
    els.presetList = $('#presetList');
    els.historyList = $('#historyList');
    els.newScenarioBtn = $('#newScenarioBtn');
    els.paletteBtn = $('#paletteBtn');
    els.crumbCompany = $('#crumbCompany');
    els.modelControl = $('#modelControl');
    els.modelTrigger = $('#modelTrigger');
    els.modelName = $('#modelName');
    els.modelOrb = $('#modelOrb');
    els.modelMenu = $('#modelMenu');
    els.effortSegmented = $('#effortSegmented');
    els.assumptionsBtn = $('#assumptionsBtn');
    els.assumptionsCount = $('#assumptionsCount');
    els.runBtn = $('#runBtn');
    els.staleBar = $('#staleBar');
    els.staleText = $('#staleText');
    els.staleRerun = $('#staleRerun');
    els.thread = $('#thread');
    els.quickRow = $('#quickRow');
    els.chatInput = $('#chatInput');
    els.sendBtn = $('#sendBtn');
    els.composer = $('#composer');
    els.inspector = $('#inspector');
    els.inspectorBackdrop = $('#inspectorBackdrop');
    els.inspectorClose = $('#inspectorClose');
    els.inspectorScroll = $('#inspectorScroll');
    els.resetBtn = $('#resetBtn');
    els.companyMark = $('#companyMark');
    els.companyName = $('#companyName');
    els.companyMeta = $('#companyMeta');
    els.companyEdit = $('#editCompanyBtn');
    els.statRevenue = $('#statRevenue');
    els.statStatus = $('#statStatus');
    els.assumptionGroups = $('#assumptionGroups');
    els.advancedFields = $('#advancedFields');
    els.uncertaintyRange = $('#uncertaintyRange');
    els.uncertaintyOut = $('#uncertaintyOut');
    els.previewValue = $('#previewValue');
    els.previewMeta = $('#previewMeta');
    els.previewCalib = $('#previewCalib');
    els.previewDirty = $('#previewDirty');
    els.previewHeatmap = $('#previewHeatmap');
    els.runFromInspector = $('#runFromInspector');
    els.scenarioModal = $('#scenarioModal');
    els.scenarioForm = $('#scenarioForm');
    els.scenarioModalTitle = $('#scenarioModalTitle');
    els.scenarioSubmit = $('#scenarioSubmit');
    els.scenarioName = $('#scenarioName');
    els.scenarioTicker = $('#scenarioTicker');
    els.scenarioSector = $('#scenarioSector');
    els.scenarioRevenue = $('#scenarioRevenue');
    els.scenarioShares = $('#scenarioShares');
    els.scenarioPrice = $('#scenarioPrice');
    els.paletteModal = $('#paletteModal');
    els.paletteInput = $('#paletteInput');
    els.paletteList = $('#paletteList');
    els.toastStack = $('#toastStack');
  }

  function updatePlatformShortcuts() {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent || '');
    $$('[data-shortcut="mod"]').forEach(function (el) { el.textContent = isMac ? '⌘' : 'Ctrl'; });
    $$('[data-shortcut="run"]').forEach(function (el) { el.textContent = isMac ? '⌘↵' : 'Ctrl↵'; });
  }

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast' + (type === 'warn' ? ' warn' : '');
    node.innerHTML = svg(type === 'warn' ? 'info' : 'check') + '<span>' + escapeHtml(message) + '</span>';
    els.toastStack.appendChild(node);
    while (els.toastStack.children.length > 3) els.toastStack.firstElementChild.remove();
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { node.remove(); }, 220);
    }, 2700);
  }

  function renderPresets() {
    els.presetList.innerHTML = Object.keys(PRESETS).map(function (key) {
      const preset = PRESETS[key];
      const active = state.presetId === key && !state.customCompany;
      return '' +
        '<button class="preset-item' + (active ? ' active' : '') + '" type="button" data-preset="' + key + '" style="--tone:' + preset.tone + '">' +
          '<span class="preset-avatar">' + escapeHtml(preset.company.name.charAt(0)) + '</span>' +
          '<span class="preset-copy"><strong>' + escapeHtml(preset.company.name) + '</strong><small>' + escapeHtml(preset.company.sector) + ' · ' + fmtMoneyCompact(preset.assumptions.revenue) + '</small></span>' +
          '<span class="preset-arrow">' + svg('arrow-right') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = '<div class="history-empty">运行一次估值后，记录会出现在这里。</div>';
      return;
    }
    els.historyList.innerHTML = state.history.map(function (item) {
      return '' +
        '<button class="history-item" type="button" data-history="' + escapeHtml(item.id) + '">' +
          '<span class="history-icon">' + svg('clock') + '</span>' +
          '<span class="history-copy"><strong>' + escapeHtml(item.company.name) + '</strong><small>' + timeAgo(item.timestamp) + ' · ' + escapeHtml(item.modelShort || 'Codex') + '</small></span>' +
          '<span class="history-value">' + fmtPrice(item.fair, 0) + '</span>' +
        '</button>';
    }).join('');
  }

  function loadHistory() {
    const raw = safeStorageGet(HISTORY_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      state.history = parsed.filter(function (item) {
        return item && item.id && item.company && item.company.name && item.assumptions;
      }).slice(0, 6);
    } catch (err) { state.history = []; }
  }

  function saveHistory() {
    safeStorageSet(HISTORY_KEY, JSON.stringify(state.history.slice(0, 6)));
  }

  function addHistory(r) {
    const signature = hashString(JSON.stringify({ company: r.company, assumptions: r.assumptions, model: r.modelKey, effort: r.effortKey }));
    if (state.history[0] && state.history[0].signature === signature) return;
    const item = {
      id: 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      company: clone(r.company),
      assumptions: clone(r.assumptions),
      presetId: state.presetId,
      model: r.modelKey,
      modelShort: r.modelShort,
      effort: r.effortKey,
      fair: r.blended,
      timestamp: Date.now(),
      signature: signature
    };
    state.history = [item].concat(state.history.filter(function (entry) { return entry.signature !== signature; })).slice(0, 6);
    saveHistory();
    renderHistory();
  }

  function renderModelMenu() {
    els.modelMenu.innerHTML = Object.keys(MODELS).map(function (key) {
      const model = MODELS[key];
      return '' +
        '<button class="model-option' + (state.model === key ? ' selected' : '') + '" type="button" data-model="' + key + '" role="option" aria-selected="' + (state.model === key) + '">' +
          '<span class="model-orb" style="--model-color:' + model.color + '"><i></i></span>' +
          '<span class="model-option-copy">' +
            '<span class="model-option-top"><strong>' + escapeHtml(model.name) + '</strong><span>' + model.badge + '</span></span>' +
            '<p>' + escapeHtml(model.desc) + '</p>' +
            '<span class="model-tone tone-' + model.calibration.tone + '">' + escapeHtml(courseLabel(model.tone)) +
              ' · 口径 ' + fmtSignedPct(model.calibration.discount) + '</span>' +
          '</span>' +
          '<span class="model-check">' + svg('check') + '</span>' +
        '</button>';
    }).join('') + '<div class="model-menu-foot">模型口径会移动最终公允价值（折溢 + 相对估值权重）；右侧 DCF 基准假设与公式保持不变。</div>';
  }

  function updateModelUI() {
    const model = MODELS[state.model] || MODELS.codex;
    els.modelName.textContent = model.name;
    els.modelOrb.style.setProperty('--model-color', model.color);
    const modelTone = $('#modelTone');
    if (modelTone) {
      modelTone.className = 'model-tone tone-' + model.calibration.tone;
      modelTone.textContent = courseLabel(model.tone);
    }
    $$('.model-option', els.modelMenu).forEach(function (button) {
      const selected = button.dataset.model === state.model;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    const mastheadModel = $('#mastheadModel');
    if (mastheadModel) mastheadModel.textContent = model.name;
  }

  function updateEffortUI() {
    $$('button[data-effort]', els.effortSegmented).forEach(function (button) {
      const active = button.dataset.effort === state.effort;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setModel(key, silent) {
    if (!MODELS[key] || state.model === key) return;
    state.model = key;
    updateModelUI();
    updateMastheadMeta();
    updatePreview();
    refreshDirty();
    if (!silent) toast('已切换至 ' + MODELS[key].name + ' · ' + courseLabel(MODELS[key].tone));
  }

  function setEffort(key, silent) {
    if (!EFFORTS[key] || state.effort === key) return;
    state.effort = key;
    updateEffortUI();
    updateMastheadMeta();
    updatePreview();
    refreshDirty();
    if (!silent) toast('思考强度：' + EFFORTS[key].label + ' · ' + EFFORT_CALIBRATION[key].label);
  }

  function updateMastheadMeta() {
    const model = $('#mastheadModel');
    if (model) model.textContent = MODELS[state.model].name;
  }

  function renderFields() {
    els.assumptionGroups.innerHTML = FIELD_GROUPS.map(function (group) {
      return '' +
        '<section class="assumption-group">' +
          '<div class="group-head">' +
            '<span class="group-title"><span>' + group.tag + '</span>' + group.title + '</span>' +
            '<span class="group-tag">' + group.subtitle + '</span>' +
          '</div>' +
          group.fields.map(fieldMarkup).join('') +
        '</section>';
    }).join('');
    els.advancedFields.innerHTML = ADVANCED_FIELDS.map(fieldMarkup).join('');
    els.assumptionsCount.textContent = String(Object.keys(FIELD_MAP).length);
    $$('.range', els.inspectorScroll).forEach(paintRange);
    paintRange(els.uncertaintyRange);
  }

  function fieldMarkup(field) {
    return '' +
      '<div class="field" data-field="' + field.key + '">' +
        '<div class="field-top">' +
          '<label class="field-label" for="num-' + field.key + '" title="' + escapeHtml(field.hint) + '">' + field.label + '</label>' +
          '<div class="num-wrap">' +
            '<input class="num-input" id="num-' + field.key + '" type="number" inputmode="decimal" min="' + field.min + '" max="' + field.max + '" step="' + field.step + '" data-assumption="' + field.key + '" aria-label="' + field.label + '">' +
            '<span class="num-unit">' + field.unit + '</span>' +
          '</div>' +
        '</div>' +
        '<input class="range" id="range-' + field.key + '" type="range" min="' + field.min + '" max="' + field.max + '" step="' + field.step + '" data-assumption="' + field.key + '" aria-label="' + field.label + '">' +
      '</div>';
  }

  function syncFields() {
    Object.keys(FIELD_MAP).forEach(function (key) {
      const value = state.assumptions[key];
      const numberInput = $('#num-' + key);
      const rangeInput = $('#range-' + key);
      if (numberInput) numberInput.value = formatFieldValue(key, value);
      if (rangeInput) {
        rangeInput.value = value;
        paintRange(rangeInput);
      }
    });
    if (els.uncertaintyRange) {
      els.uncertaintyRange.value = state.assumptions.uncertainty;
      paintRange(els.uncertaintyRange);
    }
    if (els.uncertaintyOut) els.uncertaintyOut.textContent = Number(state.assumptions.uncertainty).toFixed(2) + '×';
  }

  function syncCompanyUI() {
    const company = state.company;
    els.companyName.textContent = company.name;
    els.companyMeta.textContent = company.ticker + ' · ' + company.sector;
    els.companyMark.textContent = String(company.name || '?').charAt(0).toUpperCase();
    els.crumbCompany.textContent = company.name;
    els.statRevenue.textContent = fmtMoneyCompact(state.assumptions.revenue);
    const mastheadName = $('#mastheadName');
    if (mastheadName) mastheadName.textContent = company.name;
    const mastheadTicker = $('#mastheadTicker');
    if (mastheadTicker) mastheadTicker.textContent = company.ticker;
    const mastheadMeta = $('#mastheadMeta');
    if (mastheadMeta) mastheadMeta.textContent = company.sector + ' · 基准情景 · 本地确定性估值引擎';
    updateMastheadMeta();
  }

  function updatePreview() {
    const preview = buildPreview(state.assumptions);
    const market = state.assumptions.marketPrice;
    const up = market > 0 ? (preview.blended / market - 1) * 100 : null;
    const upClass = up == null ? '' : up >= 0 ? 'up' : 'down';
    const cal = calibrationFor(state.model, state.effort);
    els.previewValue.textContent = fmtPrice(preview.blended);
    els.previewMeta.innerHTML = 'DCF ' + fmtPrice(preview.dcf.perShare) +
      ' · ' + escapeHtml(courseLabel(cal.tone)) +
      (up == null ? '' : ' · <span class="' + upClass + '">' + fmtSignedPct(up) + '</span>');
    if (els.previewCalib) {
      els.previewCalib.textContent = MODELS[state.model].name + ' · ' + EFFORT_CALIBRATION[state.effort].label + ' · 口径 ' + fmtSignedPct(cal.discount) +
        (state.assumptions.multiple > 0 ? '' : ' · 相对估值已关闭');
    }
    els.previewHeatmap.innerHTML = sensitivityCells({ sensitivity: preview.sensitivity }, true);
    if (els.uncertaintyOut) els.uncertaintyOut.textContent = Number(state.assumptions.uncertainty).toFixed(2) + '×';
    els.statRevenue.textContent = fmtMoneyCompact(state.assumptions.revenue);
  }

  function refreshDirty() {
    if (!state.lastReport || !state.lastConfig) {
      els.staleBar.hidden = true;
      els.previewDirty.hidden = true;
      if (!state.isRunning) setStatus('就绪', 'status-ready');
      return;
    }
    const currentAssumptions = JSON.stringify(state.assumptions);
    const lastAssumptions = JSON.stringify(state.lastConfig.assumptions);
    const currentConfig = JSON.stringify({ company: state.company, a: state.assumptions, model: state.model, effort: state.effort });
    const lastConfig = JSON.stringify({ company: state.lastConfig.company, a: state.lastConfig.assumptions, model: state.lastConfig.model, effort: state.lastConfig.effort });
    const dirty = currentConfig !== lastConfig;
    if (state.isRunning) {
      els.staleBar.hidden = true;
      els.previewDirty.hidden = true;
      setStatus('推演中', 'status-stale');
      return;
    }
    els.staleBar.hidden = !dirty;
    els.previewDirty.hidden = !dirty;
    if (dirty) {
      if (currentAssumptions !== lastAssumptions) {
        els.staleText.textContent = '假设已修改，当前报告仍基于上一次运行。';
      } else {
        els.staleText.textContent = '模型或思考强度已修改，重新推演以刷新报告。';
      }
      setStatus('待重跑', 'status-stale');
    } else {
      setStatus('就绪', 'status-ready');
    }
  }

  function setStatus(text, className) {
    if (!els.statStatus) return;
    els.statStatus.textContent = text;
    els.statStatus.className = className || 'status-ready';
  }

  function syncAll() {
    syncCompanyUI();
    syncFields();
    updatePreview();
    renderPresets();
    updateModelUI();
    updateEffortUI();
    refreshDirty();
  }

  function clearThread() {
    els.thread.innerHTML = mastheadMarkup();
    state.reportCache = {};
  }

  function setRunning(running) {
    state.isRunning = running;
    els.runBtn.classList.toggle('is-running', running);
    els.runBtn.querySelector('.run-btn-label').textContent = running ? '停止推演' : '运行估值';
    const iconUse = els.runBtn.querySelector('.run-btn-icon use');
    if (iconUse) iconUse.setAttribute('href', running ? '#i-stop' : '#i-play');
    els.runBtn.setAttribute('aria-label', running ? '停止当前推演' : '运行估值');
    els.runFromInspector.disabled = running;
    els.chatInput.disabled = running;
    updateSendState();
    els.composer.classList.toggle('is-busy', running);
    if (running) setStatus('推演中', 'status-stale');
    else refreshDirty();
  }

  function updateSendState() {
    if (!els.sendBtn) return;
    els.sendBtn.disabled = state.isRunning || state.chatBusy || !els.chatInput.value.trim();
  }

  function resizeChatInput() {
    const input = els.chatInput;
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  }

  /* ---------------- simulation flow ---------------- */
  function startSimulation(options) {
    const opts = options || {};
    if (state.isRunning) {
      cancelSimulation(true);
    }
    cancelChat();
    closeDrawers();

    const company = clone(state.company);
    const assumptions = sanitizeAssumptions(state.assumptions);
    state.assumptions = clone(assumptions);
    syncFields();
    let report;
    try {
      report = buildReport(company, assumptions, state.model, state.effort);
    } catch (err) {
      toast('推演计算失败，请检查假设。', 'warn');
      return;
    }

    state.runToken += 1;
    const token = state.runToken;
    const prompt = opts.prompt || buildPrompt(company);
    setRunning(true);
    if (opts.clear) clearThread();
    if (!els.thread.querySelector('.thread-masthead')) {
      els.thread.insertAdjacentHTML('afterbegin', mastheadMarkup());
    }
    els.thread.insertAdjacentHTML('beforeend', userMessageMarkup(prompt));
    const block = createReportElement(report, !!opts.instant);
    els.thread.appendChild(block);
    state.activeBlock = block;

    if (opts.instant) {
      finalizeReport(report, block, token, true);
      els.thread.scrollTop = 0;
    } else {
      requestAnimationFrame(function () {
        block.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      animateTrace(report, block, token);
    }
  }

  function buildPrompt(company) {
    return '以当前假设对 ' + company.name + ' 做一次基准估值，推演五年现金流、公允价值区间与关键风险。';
  }

  function animateTrace(report, block, token) {
    const steps = $$('.trace-step', block);
    const fill = $('.trace-progress-fill', block);
    const statusText = $('.trace-status-text', block);
    const card = $('.trace-card', block);
    const model = MODELS[report.modelKey] || MODELS.codex;
    const stepDuration = Math.round(370 / model.pace);
    let index = 0;

    function schedule(fn, delay) {
      const timer = setTimeout(function () {
        state.timers = state.timers.filter(function (id) { return id !== timer; });
        if (token !== state.runToken) return;
        fn();
      }, delay);
      state.timers.push(timer);
    }

    function tick() {
      if (token !== state.runToken) return;
      if (index > 0 && steps[index - 1]) {
        steps[index - 1].classList.remove('active');
        steps[index - 1].classList.add('done');
      }
      if (index >= steps.length) {
        finishTrace();
        return;
      }
      steps[index].classList.add('active');
      statusText.textContent = '推演中 ' + (index + 1) + '/' + steps.length;
      fill.style.width = (((index + 0.55) / steps.length) * 100).toFixed(1) + '%';
      index += 1;
      schedule(tick, stepDuration * (0.88 + Math.random() * 0.24));
    }

    function finishTrace() {
      if (token !== state.runToken) return;
      $$('.trace-step', block).forEach(function (step) {
        step.classList.remove('active');
        step.classList.add('done');
      });
      if (fill) fill.style.width = '100%';
      if (card) card.classList.add('completed');
      if (statusText) statusText.textContent = '已完成';
      const body = $('.report-body', block);
      body.innerHTML = renderReportBody(report);
      body.hidden = false;
      body.classList.add('reveal');
      finalizeReport(report, block, token, false);
      requestAnimationFrame(function () {
        if (token !== state.runToken) return;
        body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    schedule(tick, 260);
  }

  function finalizeReport(report, block, token, instant) {
    if (token !== state.runToken) return;
    state.lastReport = report;
    state.lastConfig = {
      company: clone(report.company),
      assumptions: clone(report.assumptions),
      model: report.modelKey,
      effort: report.effortKey
    };
    state.activeBlock = null;
    state.isRunning = false;
    setRunning(false);
    addHistory(report);
    refreshDirty();
    if (instant) {
      const card = $('.trace-card', block);
      if (card) card.classList.add('completed');
      const fill = $('.trace-progress-fill', block);
      if (fill) fill.style.width = '100%';
    }
  }

  function cancelSimulation(silent) {
    if (!state.isRunning) return;
    state.runToken += 1;
    state.timers.forEach(function (id) { clearTimeout(id); });
    state.timers = [];
    if (state.activeBlock) {
      const prompt = state.activeBlock.previousElementSibling;
      if (prompt && prompt.classList.contains('message-user')) prompt.remove();
      state.activeBlock.remove();
    }
    state.activeBlock = null;
    state.isRunning = false;
    if (!els.thread.querySelector('.assistant-block')) {
      state.lastReport = null;
      state.lastConfig = null;
    }
    setRunning(false);
    refreshDirty();
    if (!silent) toast('已停止本次推演', 'warn');
  }

  /* ---------------- chat follow-up ---------------- */
  function cancelChat() {
    state.chatToken += 1;
    if (state.chatTimer) clearTimeout(state.chatTimer);
    state.chatTimer = null;
    if (state.typingEl) state.typingEl.remove();
    state.typingEl = null;
    state.chatBusy = false;
    updateSendState();
  }

  function sendChat(forcedText) {
    if (state.isRunning) {
      toast('推演进行中，请稍候或先停止。', 'warn');
      return;
    }
    if (state.chatBusy) return;
    const text = (forcedText == null ? els.chatInput.value : forcedText).trim();
    if (!text) return;
    if (!state.lastReport) {
      toast('请先运行一次估值，再开始追问。', 'warn');
      return;
    }
    cancelChat();
    state.chatBusy = true;
    els.chatInput.value = '';
    resizeChatInput();
    updateSendState();
    els.thread.insertAdjacentHTML('beforeend', userMessageMarkup(text));
    const typing = document.createElement('div');
    typing.className = 'followup-block';
    typing.innerHTML = '<div class="followup-avatar-row"><span class="followup-avatar">' + svg('spark') + '</span><span class="followup-label">VALUECODEX · 本地推演</span></div><div class="typing"><i></i><i></i><i></i></div>';
    els.thread.appendChild(typing);
    state.typingEl = typing;
    scrollThreadToBottom();
    const token = ++state.chatToken;
    state.chatTimer = setTimeout(function () {
      if (token !== state.chatToken) return;
      state.chatTimer = null;
      if (state.typingEl) state.typingEl.remove();
      state.typingEl = null;
      const html = generateAnswer(text, state.lastReport);
      els.thread.insertAdjacentHTML('beforeend',
        '<div class="followup-block">' +
          '<div class="followup-avatar-row"><span class="followup-avatar">' + svg('spark') + '</span><span class="followup-label">VALUECODEX · ' + escapeHtml(MODELS[state.lastReport.modelKey].name) + '</span></div>' +
          '<div class="assistant-text">' + html + '</div>' +
        '</div>'
      );
      state.chatBusy = false;
      updateSendState();
      scrollThreadToBottom();
    }, 520 + Math.random() * 360);
  }

  function scrollThreadToBottom() {
    requestAnimationFrame(function () {
      els.thread.scrollTo({ top: els.thread.scrollHeight, behavior: 'smooth' });
    });
  }

  function generateAnswer(question, r) {
    const q = String(question).toLowerCase();
    const a = r.assumptions;
    const d = r.dcf;
    const name = escapeHtml(r.company.name);
    const kicker = '<span class="answer-kicker">' + escapeHtml(r.modelName) + ' · ' + escapeHtml(r.effortLabel) + '思考 · 基于上次推演</span>';
    const waccCase = valueForPatch(a, { wacc: clamp(a.wacc + 1, 3, 30) }, r.modelKey, r.effortKey);
    const waccDelta = (waccCase / r.blended - 1) * 100;
    const lowTerminal = valueForPatch(a, { terminal: Math.max(0, a.terminal - 0.5) }, r.modelKey, r.effortKey);
    const highTerminal = valueForPatch(a, { terminal: a.terminal + 0.5 }, r.modelKey, r.effortKey);
    const marketPercentile = r.mc.marketPercentile == null ? '未设市价' : fmtPct(r.mc.marketPercentile * 100, 0);

    if (/终值|terminal|tv\b/.test(q)) {
      return kicker +
        '<p><strong>终值贡献了 ' + fmtPct(d.tvShare, 1) + ' 的企业价值。</strong>五年明确预测期只解释了剩余的 ' + fmtPct(100 - d.tvShare, 1) + '。这是典型的“远期依赖型”估值：近期现金流不是主要矛盾，永续假设才是。</p>' +
        '<p>如果永续增速从 ' + fmtPct(a.terminal) + ' 上下移动 0.5pp，混合每股价值大约落在 <strong>' + fmtPrice(lowTerminal) + '–' + fmtPrice(highTerminal) + '</strong>。因此，基线值 ' + fmtPrice(r.blended) + ' 应当理解为一条假设链，而不是一个精确价格。</p>' +
        '<p>降低终值依赖的办法：提高明确预测期的 FCF 占比、把 WACC 与 g 的差值保持在合理区间，或用相对估值做交叉验证。</p>';
    }

    if (/wacc|折现|贴现|资本成本/.test(q)) {
      return kicker +
        '<p>把 WACC 从 ' + fmtPct(a.wacc) + ' 上调到 ' + fmtPct(clamp(a.wacc + 1, 3, 30)) + ' 后，综合每股价值从 <strong>' + fmtPrice(r.blended) + '</strong> 变为 <strong>' + fmtPrice(waccCase) + '</strong>，变化 ' + fmtSignedPct(waccDelta) + '。</p>' +
        '<p>WACC 同时影响五年现金流的折现和终值，所以对估值是非线性的。当前终值占 EV 的 ' + fmtPct(d.tvShare, 0) + '，意味着折现率的小幅变化会被终值放大。</p>' +
        '<p>你可以把右侧 WACC 调高 100bp 再运行一次，观察 P10–P90 区间如何平移，而不只是盯住点估计。</p>';
    }

    if (/悲观|下行|bear|压力/.test(q)) {
      const bear = r.scenario.filter(function (s) { return s.key === 'bear'; })[0];
      return kicker +
        '<p><strong>悲观情景每股价值 ' + fmtPrice(bear.value) + '</strong>，相对基准 ' + fmtPrice(r.blended) + ' 的变化是 ' + fmtSignedPct((bear.value / r.blended - 1) * 100) + '。</p>' +
        '<p>压力设定是：首年增速 −5pp、EBIT 利润率 −3pp、WACC +100bp、永续增速 −0.4pp' + (a.multiple > 0 ? '，同时把 EV/Sales 倍数下调 18%' : '（EV/Sales 已关闭，情景只作用于 DCF）') + '。这比单变量压力更接近真实的下行环境。</p>' +
        '<p>蒙特卡洛的 P10 是 ' + fmtPrice(r.mc.p10) + '，P5 是 ' + fmtPrice(r.mc.p05) + '。当前模拟市价位于分布的 <strong>' + marketPercentile + '</strong>。如果要看更厚的左尾，可以把不确定性带宽拉到 1.5× 以上。</p>';
    }

    if (/蒙特卡洛|分布|区间|概率|p10|抽样/.test(q)) {
      return kicker +
        '<p>这次推演采样了 <strong>' + fmtInt(r.paths) + ' 条路径</strong>，同时扰动收入增速、EBIT 利润率、WACC、永续增速' + (a.multiple > 0 ? '和相对估值倍数' : '') + '。结果的中位数是 ' + fmtPrice(r.mc.p50) + '，P10–P90 为 <strong>' + fmtPrice(r.mc.p10) + '–' + fmtPrice(r.mc.p90) + '</strong>。</p>' +
        '<p>抽样标准误是 ±' + fmtPrice(r.mc.standardError) + '。提高思考强度会增加路径数，让分位数更稳定；但它不会消除假设本身的偏差。</p>' +
        '<p>模拟市价 ' + (r.marketPrice > 0 ? fmtPrice(r.marketPrice) + ' 落在 ' + marketPercentile + '，意味着约有 ' + fmtPct(r.mc.marketPercentile * 100, 0) + ' 的模拟路径低于市价。' : '未设置，无法计算市价分位。') + '</p>';
    }

    if (/模型|思考|强度|路径数|token|口径/.test(q)) {
      const cal = r.calibration;
      const rows = Object.keys(MODELS).map(function (key) {
        const c = calibrationFor(key, r.effortKey);
        const cw = r.assumptions.multiple > 0 ? clamp(c.multipleWeight, 0, 60) : 0;
        const value = Math.max(0, (d.perShare * (1 - cw / 100) + r.comps.perShare * (cw / 100)) * (1 + c.discount / 100));
        return '<li>' + escapeHtml(MODELS[key].name) + '：<strong>' + fmtPrice(value) + '</strong> · ' + courseLabel(c.tone) + ' · 权重 ' + (100 - cw) + ' / ' + cw + '</li>';
      }).join('');
      return kicker +
        '<p>模型和思考强度确实会<strong>移动估值结果</strong>：每个模型有自己的估值口径（乐观 / 中性 / 保守 / 交叉校验），思考强度在以口径之上再叠加参考价折溢与相对估值权重。</p>' +
        '<p>本次口径：<strong>' + escapeHtml(cal.modelLabel) + ' + ' + escapeHtml(cal.effortLabel) + '</strong>，DCF / 相对估值权重 ' + (100 - cal.compWeight) + ' / ' + cal.compWeight + '，整体口径调整 ' + fmtSignedPct(cal.discount) + '，区间宽度 ' + fmt(cal.sdFactor, 2) + '×。同一套假设下，各模型会给出：</p>' +
        '<ul>' + rows + '</ul>' +
        '<p>它不会改动你右侧的基准假设或 DCF 公式，只改变最终的「综合口径」与叙述方式——这正是不同模型的判断分歧所在。</p>';
    }

    if (/可信|风险|靠谱|准确|bug|误差/.test(q)) {
      return kicker +
        '<p>把它当作<strong>假设实验</strong>，而不是价格预测。当前结果最敏感的三个变量是 WACC、永续增速和 EBIT 利润率；其中终值占 EV 的 ' + fmtPct(d.tvShare, 0) + '，说明结论对远期假设高度依赖。</p>' +
        '<p>可信度检查建议看三件事：① P10–P90 的宽度是否合理；② 市价是否落在分布内部；③ WACC 上调 100bp 后价值是否仍站得住。当前 WACC +100bp 的结果是 ' + fmtPrice(waccCase) + '（' + fmtSignedPct(waccDelta) + '）。</p>' +
        '<p>另外，这是纯本地模拟器，没有接入实时行情、财报或远程模型。任何真实决策都需要独立的原始数据核验。</p>';
    }

    if (/市价|溢价|低估|高估|upside/.test(q)) {
      return kicker +
        '<p>当前综合公允价值为 <strong>' + fmtPrice(r.blended) + '</strong>，模拟市价 ' + (r.marketPrice > 0 ? fmtPrice(r.marketPrice) : '未设置') + (r.upside == null ? '。' : '，对应 ' + fmtSignedPct(r.upside) + ' 的' + (r.upside >= 0 ? '上行空间' : '下行空间') + '。') + '</p>' +
        '<p>DCF 给出的每股价值是 ' + fmtPrice(d.perShare) + '，' + (a.multiple > 0 ? '相对估值给出 ' + fmtPrice(r.comps.perShare) + '。两者差异越大，混合结果的权重就越值得重新审视。' : 'EV/Sales 倍数已关闭，因此综合公允价值完全来自 DCF。') + '</p>' +
        '<p>市价只是一个比较锚点，不参与内在价值计算。它可以帮你判断“市场隐含了什么”，但不能证明市场错了。</p>';
    }

    return kicker +
      '<p><strong>' + name + ' 的基准公允价值是 ' + fmtPrice(r.blended) + ' / 股。</strong>' + (a.multiple > 0 ? 'DCF 贡献 ' + fmtPrice(d.perShare) + '，相对估值贡献 ' + fmtPrice(r.comps.perShare) + '，' : 'EV/Sales 已关闭，结果全部来自 DCF，') + '蒙特卡洛 P10–P90 为 ' + fmtPrice(r.mc.p10) + '–' + fmtPrice(r.mc.p90) + '。</p>' +
      '<p>最值得继续追问的是终值依赖（占 EV ' + fmtPct(d.tvShare, 0) + '）与 WACC 敏感性。你也可以直接在右侧调整假设，然后点击“运行完整推演”。</p>';
  }

  /* ---------------- scenario / preset flows ---------------- */
  function applyPreset(key) {
    if (!PRESETS[key] || (state.presetId === key && !state.customCompany && !state.isRunning)) {
      if (state.presetId === key && !state.isRunning) toast('当前已在 ' + PRESETS[key].company.name + ' 模板');
      return;
    }
    const preset = PRESETS[key];
    state.presetId = key;
    state.customCompany = false;
    state.company = clone(preset.company);
    state.assumptions = sanitizeAssumptions(preset.assumptions);
    syncAll();
    clearThread();
    startSimulation({ prompt: preset.prompt });
  }

  function applyHistory(id) {
    const item = state.history.filter(function (entry) { return entry.id === id; })[0];
    if (!item) return;
    cancelChat();
    state.presetId = item.presetId && PRESETS[item.presetId] ? item.presetId : null;
    state.customCompany = !state.presetId;
    state.company = clone(item.company);
    state.assumptions = sanitizeAssumptions(item.assumptions);
    if (MODELS[item.model]) state.model = item.model;
    if (EFFORTS[item.effort]) state.effort = item.effort;
    updateModelUI();
    updateEffortUI();
    syncAll();
    clearThread();
    startSimulation({ prompt: buildPrompt(state.company) });
  }

  function defaultAssumptionsForSector(sector, revenue, shares, marketPrice) {
    const base = Object.assign({}, DEFAULT_ASSUMPTIONS, SECTOR_DEFAULTS[sector] || SECTOR_DEFAULTS['其他']);
    base.revenue = Number(revenue);
    base.shares = Number(shares);
    base.marketPrice = Number(marketPrice) || 0;
    base.netCash = Math.round(Number(revenue) * 0.05);
    return sanitizeAssumptions(base);
  }

  function openScenarioModal(mode) {
    closeModelMenu();
    closePalette();
    state.modalMode = mode;
    const editing = mode === 'edit';
    scenarioReturnFocus = document.activeElement;
    els.scenarioModalTitle.textContent = editing ? '编辑标的资料' : '新建估值标的';
    els.scenarioSubmit.querySelector('span').textContent = editing ? '保存修改' : '创建并推演';
    clearScenarioErrors();
    if (editing) {
      els.scenarioName.value = state.company.name;
      els.scenarioTicker.value = state.company.ticker === 'PRIVATE' ? '' : state.company.ticker;
      const hasSector = Array.prototype.some.call(els.scenarioSector.options, function (option) {
        return option.value === state.company.sector;
      });
      els.scenarioSector.value = hasSector ? state.company.sector : '其他';
      els.scenarioRevenue.value = state.assumptions.revenue;
      els.scenarioShares.value = state.assumptions.shares;
      els.scenarioPrice.value = state.assumptions.marketPrice;
    } else {
      els.scenarioName.value = '';
      els.scenarioTicker.value = '';
      els.scenarioSector.value = '企业软件';
      els.scenarioRevenue.value = 800;
      els.scenarioShares.value = 40;
      els.scenarioPrice.value = 72;
    }
    els.scenarioModal.hidden = false;
    setTimeout(function () { els.scenarioName.focus(); }, 30);
  }

  function closeScenarioModal() {
    if (els.scenarioModal.hidden) return;
    els.scenarioModal.hidden = true;
    clearScenarioErrors();
    if (scenarioReturnFocus && typeof scenarioReturnFocus.focus === 'function') {
      scenarioReturnFocus.focus();
    }
    scenarioReturnFocus = null;
  }

  function clearScenarioErrors() {
    $$('.form-error', els.scenarioModal).forEach(function (error) { error.textContent = ''; });
    $$('.invalid', els.scenarioModal).forEach(function (input) { input.classList.remove('invalid'); });
  }

  function showFieldError(id, message) {
    const input = $('#' + id);
    if (input) input.classList.add('invalid');
    const error = $('[data-error-for="' + id + '"]');
    if (error) error.textContent = message;
  }

  function validateScenario() {
    clearScenarioErrors();
    const name = els.scenarioName.value.trim();
    const revenue = parseNumber(els.scenarioRevenue.value);
    const shares = parseNumber(els.scenarioShares.value);
    const priceRaw = els.scenarioPrice.value.trim();
    const price = priceRaw === '' ? 0 : parseNumber(priceRaw);
    let firstInvalid = null;

    if (!name) { showFieldError('scenarioName', '请输入标的名。'); firstInvalid = firstInvalid || els.scenarioName; }
    if (name.length > 40) { showFieldError('scenarioName', '标的名不能超过 40 个字符。'); firstInvalid = firstInvalid || els.scenarioName; }
    if (!Number.isFinite(revenue) || revenue < 10 || revenue > 30000) { showFieldError('scenarioRevenue', '收入需在 ¥10M–¥30,000M 之间。'); firstInvalid = firstInvalid || els.scenarioRevenue; }
    if (!Number.isFinite(shares) || shares < 0.1 || shares > 5000) { showFieldError('scenarioShares', '流通股需在 0.1M–5,000M 之间。'); firstInvalid = firstInvalid || els.scenarioShares; }
    if (!Number.isFinite(price) || price < 0 || price > 10000) { showFieldError('scenarioPrice', '市价需在 ¥0–¥10,000 之间。'); firstInvalid = firstInvalid || els.scenarioPrice; }
    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    return {
      name: name,
      ticker: (els.scenarioTicker.value.trim() || 'PRIVATE').toUpperCase().slice(0, 10),
      sector: els.scenarioSector.value,
      revenue: revenue,
      shares: shares,
      price: price
    };
  }

  function submitScenario(event) {
    event.preventDefault();
    const data = validateScenario();
    if (!data) return;
    if (state.isRunning) cancelSimulation(true);
    if (state.modalMode === 'edit') {
      state.company = { name: data.name, ticker: data.ticker, sector: data.sector };
      state.assumptions.revenue = data.revenue;
      state.assumptions.shares = data.shares;
      state.assumptions.marketPrice = data.price;
      state.presetId = null;
      state.customCompany = true;
      closeScenarioModal();
      syncAll();
      refreshDirty();
      if (!state.lastReport) {
        clearThread();
        startSimulation();
      } else {
        toast('标的资料已更新，重新推演以刷新报告', 'warn');
      }
      return;
    }

    state.presetId = null;
    state.customCompany = true;
    state.company = { name: data.name, ticker: data.ticker, sector: data.sector };
    state.assumptions = defaultAssumptionsForSector(data.sector, data.revenue, data.shares, data.price);
    closeScenarioModal();
    syncAll();
    clearThread();
    startSimulation({ prompt: '为 ' + data.name + ' 建立基准情景，推演五年现金流与合理估值区间。' });
  }

  function resetAssumptions() {
    if (state.presetId && PRESETS[state.presetId]) {
      state.assumptions = sanitizeAssumptions(PRESETS[state.presetId].assumptions);
    } else {
      const base = defaultAssumptionsForSector(state.company.sector, state.assumptions.revenue, state.assumptions.shares, state.assumptions.marketPrice);
      state.assumptions = base;
    }
    syncFields();
    updatePreview();
    refreshDirty();
    toast('已恢复当前模板的基准假设');
  }

  /* ---------------- drawers / model menu ---------------- */
  function openSidebar() {
    closeInspector();
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.hidden = false;
    els.menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.hidden = true;
    els.menuBtn.setAttribute('aria-expanded', 'false');
  }

  function openInspector() {
    closeSidebar();
    els.inspector.classList.add('open');
    els.inspectorBackdrop.hidden = false;
  }

  function closeInspector() {
    els.inspector.classList.remove('open');
    els.inspectorBackdrop.hidden = true;
  }

  function closeDrawers() {
    closeSidebar();
    closeInspector();
  }

  function openModelMenu() {
    renderModelMenu();
    els.modelMenu.hidden = false;
    els.modelTrigger.setAttribute('aria-expanded', 'true');
  }

  function closeModelMenu() {
    els.modelMenu.hidden = true;
    els.modelTrigger.setAttribute('aria-expanded', 'false');
  }

  /* ---------------- command palette ---------------- */
  function buildCommands() {
    const commands = [
      { group: '动作', icon: 'play', title: '运行一次估值', desc: '使用当前假设、模型和思考强度重新推演', key: 'run', action: function () { startSimulation(); } },
      { group: '动作', icon: 'plus', title: '新建估值标的', desc: '创建一个自定义公司并开始推演', key: 'N', action: function () { openScenarioModal('new'); } },
      { group: '动作', icon: 'reset', title: '重置估值假设', desc: '恢复当前模板的基准参数', key: '', action: resetAssumptions },
      { group: '动作', icon: 'copy', title: '复制上次报告', desc: '把当前估值摘要复制到剪贴板', key: '', action: function () { if (state.lastReport) copyReport(state.lastReport); else toast('尚无可复制的报告', 'warn'); } },
      { group: '动作', icon: 'download', title: '导出 Markdown 报告', desc: '下载当前估值报告', key: '', action: function () { if (state.lastReport) downloadReport(state.lastReport); else toast('尚无可导出的报告', 'warn'); } }
    ];
    Object.keys(MODELS).forEach(function (key) {
      commands.push({
        group: '模型', icon: 'spark', title: '切换模型：' + MODELS[key].name,
        desc: MODELS[key].desc, key: state.model === key ? 'CURRENT' : '',
        action: function () { setModel(key); }
      });
    });
    Object.keys(EFFORTS).forEach(function (key) {
      commands.push({
        group: '思考强度', icon: 'brain', title: '思考强度：' + EFFORTS[key].label,
        desc: EFFORTS[key].note + ' · ' + fmtInt(getPaths(state.model, key)) + ' 条路径', key: state.effort === key ? 'CURRENT' : '',
        action: function () { setEffort(key); }
      });
    });
    commands.push(
      { group: '追问', icon: 'terminal', title: '为什么终值占比这么高？', desc: '解释终值依赖与永续增速敏感性', key: '', action: function () { sendChat('为什么终值占比这么高？'); } },
      { group: '追问', icon: 'terminal', title: 'WACC 上调 100bp 会怎样？', desc: '查看折现率变化对每股价值的影响', key: '', action: function () { sendChat('WACC 上调 100bp 会怎样？'); } },
      { group: '追问', icon: 'terminal', title: '拆解一下悲观情景。', desc: '查看压力参数和左尾区间', key: '', action: function () { sendChat('拆解一下悲观情景。'); } },
      { group: '追问', icon: 'terminal', title: '这个估值可信吗？', desc: '做一次假设与尾部风险检查', key: '', action: function () { sendChat('这个估值可信吗？'); } }
    );
    return commands;
  }

  function openPalette() {
    closeModelMenu();
    closeScenarioModal();
    state.paletteReturnFocus = document.activeElement;
    state.paletteOpen = true;
    state.paletteIndex = 0;
    els.paletteInput.value = '';
    els.paletteModal.hidden = false;
    renderPalette('');
    setTimeout(function () { els.paletteInput.focus(); }, 20);
  }

  function closePalette() {
    if (!state.paletteOpen) return;
    state.paletteOpen = false;
    els.paletteModal.hidden = true;
    if (state.paletteReturnFocus && typeof state.paletteReturnFocus.focus === 'function') {
      state.paletteReturnFocus.focus();
    }
    state.paletteReturnFocus = null;
  }

  function renderPalette(query) {
    state.paletteCommands = buildCommands();
    const needle = String(query || '').trim().toLowerCase();
    const filtered = state.paletteCommands.filter(function (command) {
      return !needle || (command.title + ' ' + command.desc + ' ' + command.group).toLowerCase().indexOf(needle) !== -1;
    });
    state.paletteCommands = filtered;
    if (!filtered.length) {
      els.paletteList.innerHTML = '<div class="palette-empty">没有匹配的命令。试试 “WACC” 或 “o3”。</div>';
      state.paletteIndex = 0;
      return;
    }
    state.paletteIndex = clamp(state.paletteIndex, 0, filtered.length - 1);
    let html = '';
    let group = '';
    filtered.forEach(function (command, index) {
      if (command.group !== group) {
        group = command.group;
        html += '<div class="palette-group-label">' + escapeHtml(group) + '</div>';
      }
      html += '<button class="palette-item' + (index === state.paletteIndex ? ' focused' : '') + '" type="button" data-command-index="' + index + '" role="option" aria-selected="' + (index === state.paletteIndex) + '">' +
        '<span class="palette-item-icon">' + svg(command.icon) + '</span>' +
        '<span class="palette-item-copy"><strong>' + escapeHtml(command.title) + '</strong><small>' + escapeHtml(command.desc) + '</small></span>' +
        (command.key ? '<kbd>' + escapeHtml(command.key) + '</kbd>' : '') +
        '</button>';
    });
    els.paletteList.innerHTML = html;
  }

  function movePalette(direction) {
    if (!state.paletteCommands.length) return;
    state.paletteIndex = (state.paletteIndex + direction + state.paletteCommands.length) % state.paletteCommands.length;
    $$('.palette-item', els.paletteList).forEach(function (button, index) {
      const active = index === state.paletteIndex;
      button.classList.toggle('focused', active);
      button.setAttribute('aria-selected', String(active));
    });
    const current = $('.palette-item.focused', els.paletteList);
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  function runPaletteCommand(index) {
    const command = state.paletteCommands[index];
    if (!command) return;
    closePalette();
    setTimeout(function () { command.action(); }, 30);
  }

  /* ---------------- events ---------------- */
  function bindEvents() {
    els.menuBtn.addEventListener('click', openSidebar);
    els.sidebarClose.addEventListener('click', closeSidebar);
    els.sidebarBackdrop.addEventListener('click', closeSidebar);
    els.assumptionsBtn.addEventListener('click', function () {
      if (els.inspector.classList.contains('open')) closeInspector();
      else openInspector();
    });
    els.inspectorClose.addEventListener('click', closeInspector);
    els.inspectorBackdrop.addEventListener('click', closeInspector);

    els.presetList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-preset]');
      if (!button) return;
      applyPreset(button.dataset.preset);
      closeSidebar();
    });

    els.historyList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-history]');
      if (!button) return;
      applyHistory(button.dataset.history);
      closeSidebar();
    });

    els.modelTrigger.addEventListener('click', function () {
      if (els.modelMenu.hidden) openModelMenu();
      else closeModelMenu();
    });
    els.modelMenu.addEventListener('click', function (event) {
      const option = event.target.closest('[data-model]');
      if (!option) return;
      setModel(option.dataset.model);
      closeModelMenu();
      els.modelTrigger.focus();
    });
    document.addEventListener('pointerdown', function (event) {
      if (!els.modelControl.contains(event.target)) closeModelMenu();
    });

    els.effortSegmented.addEventListener('click', function (event) {
      const button = event.target.closest('[data-effort]');
      if (!button) return;
      setEffort(button.dataset.effort);
    });

    els.runBtn.addEventListener('click', function () {
      if (state.isRunning) cancelSimulation(false);
      else startSimulation();
    });
    els.runFromInspector.addEventListener('click', function () {
      if (!state.isRunning) startSimulation();
    });
    els.staleRerun.addEventListener('click', function () { startSimulation(); });
    els.newScenarioBtn.addEventListener('click', function () { openScenarioModal('new'); });
    els.companyEdit.addEventListener('click', function () { openScenarioModal('edit'); });
    els.resetBtn.addEventListener('click', resetAssumptions);
    els.paletteBtn.addEventListener('click', openPalette);

    els.quickRow.addEventListener('click', function (event) {
      const button = event.target.closest('[data-question]');
      if (!button) return;
      sendChat(button.dataset.question);
    });
    els.sendBtn.addEventListener('click', function () { sendChat(); });
    els.chatInput.addEventListener('input', function () {
      resizeChatInput();
      updateSendState();
    });
    els.chatInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        sendChat();
      }
    });

    els.inspectorScroll.addEventListener('input', onAssumptionInput);
    els.inspectorScroll.addEventListener('blur', onAssumptionBlur, true);
    els.uncertaintyRange.addEventListener('input', function () {
      const value = clamp(parseFloat(els.uncertaintyRange.value) || 1, 0.4, 2.2);
      state.assumptions.uncertainty = Number(value.toFixed(2));
      els.uncertaintyOut.textContent = state.assumptions.uncertainty.toFixed(2) + '×';
      paintRange(els.uncertaintyRange);
      updatePreview();
      refreshDirty();
    });

    els.thread.addEventListener('click', function (event) {
      const toggle = event.target.closest('.trace-toggle');
      if (toggle) {
        const card = toggle.closest('.trace-card');
        if (!card) return;
        const collapsed = card.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? '展开推理摘要' : '折叠推理摘要');
        return;
      }
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const block = action.closest('.assistant-block');
      const runId = action.dataset.run || (block && block.dataset.runId);
      const report = (runId && state.reportCache[runId]) || state.lastReport;
      if (!report) return;
      if (action.dataset.action === 'copy') copyReport(report);
      if (action.dataset.action === 'download') downloadReport(report);
    });

    els.scenarioForm.addEventListener('submit', submitScenario);
    els.scenarioModal.addEventListener('click', function (event) {
      if (event.target.closest('[data-close-modal="scenario"]')) closeScenarioModal();
    });

    els.paletteModal.addEventListener('click', function (event) {
      if (event.target.closest('[data-close-modal="palette"]')) closePalette();
    });
    els.paletteInput.addEventListener('input', function () {
      state.paletteIndex = 0;
      renderPalette(els.paletteInput.value);
    });
    els.paletteInput.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); movePalette(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); movePalette(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); runPaletteCommand(state.paletteIndex); }
      else if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
    });
    els.paletteList.addEventListener('click', function (event) {
      const item = event.target.closest('[data-command-index]');
      if (!item) return;
      runPaletteCommand(Number(item.dataset.commandIndex));
    });
    els.paletteList.addEventListener('pointermove', function (event) {
      const item = event.target.closest('[data-command-index]');
      if (!item) return;
      const index = Number(item.dataset.commandIndex);
      if (index === state.paletteIndex) return;
      state.paletteIndex = index;
      $$('.palette-item', els.paletteList).forEach(function (button, i) {
        button.classList.toggle('focused', i === index);
        button.setAttribute('aria-selected', String(i === index));
      });
    });

    document.addEventListener('keydown', function (event) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (state.paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (event.key === 'Escape') {
        if (state.paletteOpen) { closePalette(); return; }
        if (!els.scenarioModal.hidden) { closeScenarioModal(); return; }
        if (!els.modelMenu.hidden) { closeModelMenu(); return; }
        if (els.sidebar.classList.contains('open')) { closeSidebar(); return; }
        if (els.inspector.classList.contains('open')) { closeInspector(); return; }
      }
      if (mod && event.key === 'Enter') {
        if (state.paletteOpen || !els.scenarioModal.hidden) return;
        event.preventDefault();
        if (state.isRunning) cancelSimulation(false);
        else startSimulation();
        return;
      }
      if (!mod && !event.altKey && event.key.toLowerCase() === 'n' && !isTypingTarget(event.target) && els.scenarioModal.hidden && !state.paletteOpen) {
        event.preventDefault();
        openScenarioModal('new');
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1120) closeInspector();
      if (window.innerWidth > 980) closeSidebar();
    });
  }

  function onAssumptionInput(event) {
    const input = event.target.closest('[data-assumption]');
    if (!input) return;
    const key = input.dataset.assumption;
    const field = FIELD_MAP[key];
    if (!field) return;
    const raw = parseNumber(input.value);
    if (!Number.isFinite(raw)) return;
    const value = clamp(raw, field.min, field.max);
    const rounded = Number(value.toFixed(field.digits == null ? 1 : field.digits));
    state.assumptions[key] = rounded;
    if (input.type === 'range') {
      const numberInput = $('#num-' + key);
      if (numberInput) numberInput.value = formatFieldValue(key, rounded);
    } else {
      const rangeInput = $('#range-' + key);
      if (rangeInput) rangeInput.value = rounded;
    }
    const rangeInput = $('#range-' + key);
    if (rangeInput) paintRange(rangeInput);
    updatePreview();
    refreshDirty();
  }

  function onAssumptionBlur(event) {
    const input = event.target.closest('.num-input[data-assumption]');
    if (!input) return;
    const key = input.dataset.assumption;
    const field = FIELD_MAP[key];
    if (!field) return;
    const raw = parseNumber(input.value);
    const fallback = state.assumptions[key];
    const value = Number.isFinite(raw) ? clamp(raw, field.min, field.max) : fallback;
    const rounded = Number(value.toFixed(field.digits == null ? 1 : field.digits));
    state.assumptions[key] = rounded;
    input.value = formatFieldValue(key, rounded);
    const rangeInput = $('#range-' + key);
    if (rangeInput) {
      rangeInput.value = rounded;
      paintRange(rangeInput);
    }
    updatePreview();
    refreshDirty();
  }

  /* ---------------- init ---------------- */
  function init() {
    cacheElements();
    loadHistory();
    const preset = PRESETS.nova;
    state.company = clone(preset.company);
    state.assumptions = sanitizeAssumptions(preset.assumptions);
    state.customCompany = false;
    renderModelMenu();
    renderFields();
    renderHistory();
    bindEvents();
    updatePlatformShortcuts();
    updateModelUI();
    updateEffortUI();
    syncAll();
    startSimulation({ instant: true, prompt: preset.prompt, clear: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
