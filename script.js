/**
 * script.js - Funding Dashboard Frontend
 * Reads public/data.json and renders the data table with date filtering.
 */

(function () {
  "use strict";

  // Column definitions: key, type, format
  const COLUMNS = [
    { key: "日期", type: "date" },
    { key: "时段", type: "period" },
    { key: "R001", type: "rate" },
    { key: "DR001", type: "rate" },
    { key: "R007", type: "rate" },
    { key: "DR007", type: "rate" },
    { key: "大型银行净融出", type: "blue" },
    { key: "中小银行净融出", type: "blue" },
    { key: "理财+货基净融出", type: "blue" },
    { key: "全市场正回购", type: "purple" },
    { key: "政府债净缴款", type: "gov" },
    { key: "OMO存量", type: "orange" },
    { key: "买断式逆回购", type: "orange" },
    { key: "MLF余额", type: "orange" },
  ];

  // Amount fields (use 千分位 formatting)
  const AMOUNT_KEYS = new Set([
    "大型银行净融出",
    "中小银行净融出",
    "理财+货基净融出",
    "全市场正回购",
    "政府债净缴款",
    "OMO存量",
    "买断式逆回购",
    "MLF余额",
  ]);

  // Stock/balance fields - use compressed 70%-100% bar range
  // These fields have small relative variations that get exaggerated by full min-max scaling
  const STOCK_KEYS = new Set([
    "OMO存量",
    "买断式逆回购",
    "MLF余额",
  ]);

  // Rate fields
  const RATE_KEYS = new Set([
    "R001", "DR001", "R007", "DR007",
  ]);

  const DEFAULT_COUNT = 350;

  // Year line colors for seasonal chart
  // Gradient from gray (oldest) to deep blue (second latest) to red (latest)
  const LATEST_YEAR_COLOR = '#ef4444';
  const SECOND_LATEST_COLOR = '#0000CD';

  // Historical year colors: older = grayer, newer = bluer
  const YEAR_COLOR_MAP = {
  '2026': '#ef4444', // red, current year
  '2025': '#0000CD', // deep blue, latest full year
  '2024': '#7C3AED', // purple
  '2023': '#0891B2', // teal
  '2022': '#D97706', // muted amber
  '2021': '#64748B', // slate
  '2020': '#94A3B8', // light slate
  '2019': '#A3A3A3', // gray
  '2018': '#CBD5E1', // very light blue-gray
  '2017': '#D1D5DB', // light gray
  '2016': '#E5E7EB', // very light gray
};

function getYearColor(year, latestYear, allYears) {
  // Explicit color mapping is more stable than index-based colors.
  if (YEAR_COLOR_MAP[year]) return YEAR_COLOR_MAP[year];

  // If future years appear, make the latest year red.
  if (year === latestYear) return '#ef4444';

  // Fallback for unknown older years.
  return '#CBD5E1';
}

function getYearBorderWidth(year, latestYear) {
  if (year === '2026' || year === latestYear) return 3.2;
  if (year === '2025') return 2.8;
  if (year === '2024') return 2.2;
  if (year === '2023' || year === '2022') return 2;
  return 1.6;
}

  // Rate metrics for unit display
  const RATE_METRICS = new Set(['R001', 'DR001', 'R007', 'DR007', 'R007-DR007']);

  let allData = [];       // All data from JSON (sorted desc)
  let filteredData = [];  // Currently displayed subset
  let activeQuick = "350"; // Track which quick button is active
  let seasonalCharts = {};  // Map of metric -> ECharts instance
  let selectedYears = new Set(); // Selected years for seasonal chart
  let seasonalChartsInitialized = false;

  // Shared ECharts dataZoom config
  function getDataZoomConfig() {
    return [
      { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 24,
        bottom: 8,
        filterMode: 'filter',
        showDetail: true,
        moveHandleSize: 8,
        borderColor: '#d0d5dd',
        fillerColor: 'rgba(59,130,246,0.12)',
        handleStyle: { color: '#4f8ef7', borderColor: '#3b82f6' },
        textStyle: { fontSize: 10 },
      },
    ];
  }

  // Shared ECharts grid config (leaves room for dataZoom)
  function getGridConfig() {
    return { left: 60, right: 60, top: 45, bottom: 70, containLabel: false };
  }

  // ===== ECharts global resize management =====

  window.echartsInstances = window.echartsInstances || {};

  function resizeAllECharts() {
    if (!window.echartsInstances) return;
    Object.keys(window.echartsInstances).forEach(function (key) {
      var chart = window.echartsInstances[key];
      if (chart && chart.resize) {
        chart.resize();
      }
    });
  }

  // Wrap echarts.init to auto-register instances and auto-resize after setOption
  (function () {
    var waitForEcharts = setInterval(function () {
      if (typeof echarts === 'undefined') return;
      clearInterval(waitForEcharts);

      var _origInit = echarts.init;
      echarts.init = function () {
        var chart = _origInit.apply(this, arguments);
        var dom = arguments[0];
        var chartId = dom ? (dom.id || ('ec_' + Math.random().toString(36).slice(2, 10))) : ('ec_' + Math.random().toString(36).slice(2, 10));
        window.echartsInstances[chartId] = chart;

        // Wrap setOption to auto-resize after each call
        var _origSetOption = chart.setOption.bind(chart);
        chart.setOption = function () {
          var result = _origSetOption.apply(this, arguments);
          setTimeout(function () { chart.resize(); }, 0);
          setTimeout(function () { chart.resize(); }, 300);
          return result;
        };

        // Wrap dispose to clean up registry
        var _origDispose = chart.dispose.bind(chart);
        chart.dispose = function () {
          delete window.echartsInstances[chartId];
          return _origDispose();
        };

        return chart;
      };
    }, 50);
  })();

  // ===== Formatting helpers =====

  function formatRate(val) {
    if (val === null || val === undefined) return null;
    return val.toFixed(2) + "%";
  }

  function formatAmount(val) {
    if (val === null || val === undefined) return null;
    const rounded = Math.round(val * 100) / 100;
    const parts = rounded.toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (parts[1] === "00") return parts[0];
    return parts.join(".");
  }

  function formatValue(key, val) {
    if (val === null || val === undefined) return null;
    if (RATE_KEYS.has(key)) return formatRate(val);
    if (AMOUNT_KEYS.has(key)) return formatAmount(val);
    return String(val);
  }

  // ===== Arrow logic =====

  function getArrow(current, previous) {
    if (current === null || current === undefined) return "";
    if (previous === null || previous === undefined) return "";
    if (Math.abs(current - previous) < 0.0001) {
      return '<span class="arrow-neutral">*</span>';
    }
    if (current > previous) {
      return '<span class="arrow-up">▲</span>';
    }
    return '<span class="arrow-down">▼</span>';
  }

  // ===== Weekday =====

  function getWeekday(dateStr) {
    const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const d = new Date(dateStr + "T00:00:00");
    return days[d.getDay()];
  }

  // ===== Period label =====

  function getDaysInMonth(year, month) {
    // month is 1-based; get last day by going to next month day 0
    return new Date(year, month, 0).getDate();
  }

  function getPeriodLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDate();
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1-based
    const totalDays = getDaysInMonth(year, month);

    // First 5 days -> month start
    if (day <= 5) return "月初";
    // Last 5 days -> month end
    if (day > totalDays - 5) return "月底";
    return "普通";
  }

  // ===== Data bar (heatmap) helpers =====

  function computeColumnStats(data) {
    // For stock fields: min/max for compressed 70-100% scaling
    // For flow fields: absCap (95th percentile of abs values) for magnitude scaling
    var stats = {};
    AMOUNT_KEYS.forEach(function (key) {
      var values = [];
      for (var i = 0; i < data.length; i++) {
        var v = data[i][key];
        if (v !== null && v !== undefined) values.push(v);
      }
      if (values.length === 0) {
        stats[key] = { min: 0, max: 0, absCap: 0, empty: true };
        return;
      }
      var min = Math.min.apply(null, values);
      var max = Math.max.apply(null, values);
      // Compute absCap: 95th percentile of abs values
      var absValues = values.map(function (v) { return Math.abs(v); });
      absValues.sort(function (a, b) { return a - b; });
      var p95Index = Math.floor(absValues.length * 0.95);
      if (p95Index >= absValues.length) p95Index = absValues.length - 1;
      var absCap = absValues[p95Index];
      if (absCap === 0) absCap = 1; // avoid division by zero
      stats[key] = { min: min, max: max, absCap: absCap, empty: false };
    });
    return stats;
  }

  function getStockIntensity(value, stats) {
    // For stock fields: normalized position between min and max
    if (!stats || stats.empty) return 0.5;
    if (value === null || value === undefined) return 0.5;
    if (stats.max === stats.min) return 0.5;
    var intensity = (value - stats.min) / (stats.max - stats.min);
    return Math.max(0, Math.min(1, intensity));
  }

  function getFlowBarWidth(value, stats) {
    // For flow fields: width based on abs(value) / absCap
    if (!stats || stats.empty) return 0;
    if (value === null || value === undefined || value === 0) return 0;
    var width = (Math.abs(value) / stats.absCap) * 100;
    width = Math.min(100, width); // cap at 100%
    if (width > 0) width = Math.max(6, width); // min 6% for non-zero
    return width;
  }

  // Map column type to bar color class, with sign awareness for gov field
  function getBarColorClass(type, value) {
    if (type === "blue") return "bar-blue";
    if (type === "purple") return "bar-purple";
    if (type === "gov") {
      // Positive: red/pink, Negative: green/teal
      if (value !== null && value !== undefined && value < 0) return "bar-gov-neg";
      return "bar-gov";
    }
    if (type === "orange") return "bar-orange";
    return "";
  }

  // ===== Render =====

  function renderTable(data) {
    var tbody = document.getElementById("table-body");
    var fragment = document.createDocumentFragment();

    // Compute stats for data bars
    var colStats = computeColumnStats(data);

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var prevRow = i < data.length - 1 ? data[i + 1] : null;
      var tr = document.createElement("tr");

      for (var c = 0; c < COLUMNS.length; c++) {
        var col = COLUMNS[c];
        var td = document.createElement("td");
        var key = col.key;
        var type = col.type;
        var val = row[key];

        td.className = "cell-" + type;

        if (type === "date") {
          var weekday = getWeekday(val);
          var period = getPeriodLabel(val);
          td.className += " period-" + period;
          td.innerHTML = val + '<br/><span style="color:#999;font-size:11px;">' + weekday + "</span>";
        } else if (type === "period") {
          var dateVal = row["日期"];
          var period = dateVal ? getPeriodLabel(dateVal) : "普通";
          td.className += " period-tag-" + period;
          td.textContent = period;
        } else {
          var formatted = formatValue(key, val);
          if (formatted === null) {
            td.className += " cell-na";
            td.textContent = "--";
          } else {
            var arrow = prevRow ? getArrow(val, prevRow[key]) : "";
            // Check if this is an amount field that needs a data bar
            if (AMOUNT_KEYS.has(key) && val !== null && val !== undefined) {
              var barWidth;
              if (STOCK_KEYS.has(key)) {
                // Stock fields: compressed 70%-100% range
                var intensity = getStockIntensity(val, colStats[key]);
                barWidth = 70 + intensity * 30;
              } else {
                // Flow fields: abs(value) magnitude scaling
                barWidth = getFlowBarWidth(val, colStats[key]);
              }
              // No bar for zero-value flow fields
              if (barWidth <= 0) {
                td.innerHTML = formatted + arrow;
              } else {
                var barClass = getBarColorClass(type, val);
                td.className += " has-bar";
                td.innerHTML =
                  '<div class="data-bar ' + barClass + '" style="width:' + barWidth.toFixed(1) + '%"></div>' +
                  '<span class="cell-value">' + formatted + '</span>' + arrow;
              }
            } else {
              td.innerHTML = formatted + arrow;
            }
          }
        }

        tr.appendChild(td);
      }

      fragment.appendChild(tr);
    }

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
  }

  // ===== Filter helpers =====

  function getDateInput(id) {
    return document.getElementById(id).value; // YYYY-MM-DD or ""
  }

  function setDateInput(id, val) {
    document.getElementById(id).value = val;
  }

  function filterByDateRange(startDate, endDate) {
    return allData.filter(function (row) {
      const d = row["日期"];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }

  function filterByCount(count) {
    if (count >= allData.length) return allData.slice();
    return allData.slice(0, count);
  }

  function setActiveQuick(action) {
    activeQuick = action;
    document.querySelectorAll(".quick-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-action") === action);
    });
  }

  // ===== Apply filter & render =====

  function applyFilter() {
    const startDate = getDateInput("date-start");
    const endDate = getDateInput("date-end");
    filteredData = filterByDateRange(startDate, endDate);
    updateSummary(filteredData);
    renderTable(filteredData);
  }

  function applyQuickAction(action) {
    setActiveQuick(action);

    if (action === "all") {
      filteredData = allData.slice();
    } else if (action === "350") {
      filteredData = filterByCount(DEFAULT_COUNT);
    } else if (action === "30d") {
      const latest = allData[0]["日期"];
      const d = new Date(latest + "T00:00:00");
      d.setDate(d.getDate() - 30);
      const start = d.toISOString().slice(0, 10);
      filteredData = filterByDateRange(start, latest);
    } else if (action === "90d") {
      const latest = allData[0]["日期"];
      const d = new Date(latest + "T00:00:00");
      d.setDate(d.getDate() - 90);
      const start = d.toISOString().slice(0, 10);
      filteredData = filterByDateRange(start, latest);
    }

    // Sync date inputs to reflect the current filter
    if (filteredData.length > 0) {
      setDateInput("date-start", filteredData[filteredData.length - 1]["日期"]);
      setDateInput("date-end", filteredData[0]["日期"]);
    }

    updateSummary(filteredData);
    renderTable(filteredData);
  }

  // ===== Summary bar =====

  function updateSummary(data) {
    const totalEl = document.getElementById("total-count");
    const updateEl = document.getElementById("update-time");

    totalEl.textContent = "共 " + data.length + " 条";

    const now = new Date();
    updateEl.textContent =
      "更新于 " +
      now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0") + " " +
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");
  }

  // ===== Load data =====

  async function loadData() {
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = '<tr><td colspan="14" class="loading">正在加载数据...</td></tr>';

    try {
      const resp = await fetch("public/data.json");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      allData = await resp.json();

      // Sort descending by date
      allData.sort(function (a, b) {
        return b["日期"] > a["日期"] ? 1 : b["日期"] < a["日期"] ? -1 : 0;
      });

      // Set date input boundaries (full range)
      if (allData.length > 0) {
        const dateStartEl = document.getElementById("date-start");
        const dateEndEl = document.getElementById("date-end");
        dateStartEl.min = allData[allData.length - 1]["日期"];
        dateStartEl.max = allData[0]["日期"];
        dateEndEl.min = allData[allData.length - 1]["日期"];
        dateEndEl.max = allData[0]["日期"];
      }

      // Default: show latest 350 records
      applyQuickAction("350");

      // Init seasonal tab
      initSeasonalTab();

      // Bind events
      bindEvents();

      // Start auto-refresh (re-fetch JSON every 5 minutes)
      startAutoRefresh();
    } catch (err) {
      tbody.innerHTML =
        '<tr><td colspan="14" class="loading" style="color:#e53e3e;">' +
        "加载失败: " + err.message + "<br/><br/>" +
        "请确保已运行 python scripts/process_data.py 生成 public/data.json" +
        "</td></tr>";
    }
  }

  // ===== Event binding =====

  function bindEvents() {
    // Date input change
    var dateStartEl = document.getElementById("date-start");
    var dateEndEl = document.getElementById("date-end");

    dateStartEl.addEventListener("change", function () {
      setActiveQuick("");  // Deactivate all quick buttons
      applyFilter();
    });
    dateEndEl.addEventListener("change", function () {
      setActiveQuick("");
      applyFilter();
    });

    // Quick buttons
    document.querySelectorAll('.quick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyQuickAction(this.getAttribute('data-action'));
      });
    });
  
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    // Gov bond interactive controls
    bindGovBondEvents();

    // CD net financing (issuance/maturity/net) interactive controls
    bindCDNFEvents();
  }

  // ===== Tab switching =====

  function switchTab(tabId) {
    // Toggle content visibility
    document.querySelectorAll('.tab-content').forEach(function (el) {
      el.style.display = 'none';
    });
    var target = document.getElementById('tab-' + tabId);
    if (target) target.style.display = 'block';

    // Update tab button active state
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Re-render chart when switching to seasonal tab
    if (tabId === 'seasonal') {
      if (!seasonalChartsInitialized) {
        seasonalChartsInitialized = true;
        renderAllSeasonalCharts();
        renderAllTrendCharts();
        renderAllBillRateCharts();
        loadLeverageMetrics();
        loadBillRates();
        loadCDRates();
        loadCDNetFinancing();
        loadGovDailyNF();
        loadGovMonthlyNF();
      } else {
        renderAllSeasonalCharts();
        renderAllTrendCharts();
        renderAllBillRateCharts();
        if (cdnfData) renderCDNFCharts();
      }
      renderGovBondChart();
      setTimeout(resizeAllECharts, 0);
      setTimeout(resizeAllECharts, 300);
    }
  }

  // ===== Seasonal chart =====

  // Metric config: maps canvas ID suffix to data key
  const SEASONAL_METRICS = [
    { id: 'R001', key: 'R001', unit: '%' },
    { id: 'DR001', key: 'DR001', unit: '%' },
    { id: 'R007', key: 'R007', unit: '%' },
    { id: 'DR007', key: 'DR007', unit: '%' },
    { id: 'R007-DR007', key: 'R007-DR007', unit: '%' },
    { id: 'large-bank', key: '大型银行净融出', unit: '亿元' },
    { id: 'small-bank', key: '中小银行净融出', unit: '亿元' },
    { id: 'wm-mf', key: '理财+货基净融出', unit: '亿元' },
    { id: 'total-repo', key: '全市场正回购', unit: '亿元' },
    { id: 'OMO', key: 'OMO存量', unit: '亿元' },
  ];

  function getAvailableYears(data) {
    var years = new Set();
    for (var i = 0; i < data.length; i++) {
      var dateStr = data[i]['日期'];
      if (dateStr) years.add(dateStr.substring(0, 4));
    }
    return Array.from(years).sort();
  }

  function buildSeasonalData(data, metric) {
    // Group records by year, keyed by MM-DD
    var byYear = {};
    var isRate = RATE_METRICS.has(metric);
    for (var i = 0; i < data.length; i++) {
      var dateStr = data[i]['日期'];
      if (!dateStr) continue;
      var val = data[i][metric];
      if (val === null || val === undefined) continue;
      // Filter out 0 values for rate metrics (invalid placeholder data)
      if (isRate && val === 0) continue;
      var year = dateStr.substring(0, 4);
      var mmdd = dateStr.substring(5); // MM-DD
      if (!byYear[year]) byYear[year] = {};
      byYear[year][mmdd] = val;
    }
    return byYear;
  }

  // Generate all MM-DD labels for x-axis (01-01 to 12-31)
  function generateCalendarLabels() {
    var labels = [];
    for (var m = 1; m <= 12; m++) {
      var mm = String(m).padStart(2, '0');
      var daysInMonth = new Date(2024, m, 0).getDate(); // 2024 is leap year, max days
      for (var d = 1; d <= daysInMonth; d++) {
        var dd = String(d).padStart(2, '0');
        labels.push(mm + '-' + dd);
      }
    }
    return labels;
  }

  function createSeasonalSeries(metric) {
    var seasonalData = buildSeasonalData(allData, metric);
    var allLabels = generateCalendarLabels();
    var labelIndex = {};
    for (var li = 0; li < allLabels.length; li++) {
      labelIndex[allLabels[li]] = li;
    }
    var years = Array.from(selectedYears).sort();
    var allYears = getAvailableYears(allData);
    var latestYear = allYears[allYears.length - 1];
    var series = [];
  
    for (var i = 0; i < years.length; i++) {
      var year = years[i];
      var yearData = seasonalData[year];
      if (!yearData || Object.keys(yearData).length === 0) continue;
  
      var values = new Array(allLabels.length).fill(null);
      var keys = Object.keys(yearData);
      for (var k = 0; k < keys.length; k++) {
        var mmdd = keys[k];
        if (labelIndex[mmdd] !== undefined) {
          values[labelIndex[mmdd]] = yearData[mmdd];
        }
      }
  
      var isLatest = (year === latestYear);
      var color = getYearColor(year, latestYear, allYears);
      var borderWidth = getYearBorderWidth(year, latestYear);
      var isGovBond = metric === '\u653f\u5e9c\u503a\u51c0\u7f34\u6b3e';
      var fillColor = color;
      if (isGovBond) {
        if (year === latestYear) { fillColor = 'rgba(239,68,68,0.85)'; color = '#ef4444'; }
        else if (year === '2025') { fillColor = 'rgba(0,0,205,0.65)'; color = '#0000CD'; }
        else { fillColor = color + '99'; }
      }
  
      series.push({
        name: year,
        type: isGovBond ? 'bar' : 'line',
        data: values,
        itemStyle: { color: color },
        lineStyle: { width: isGovBond ? 1 : borderWidth, color: color },
        symbol: 'none',
        emphasis: { focus: 'series' },
        connectNulls: true,
        z: isLatest ? 100 : Number(year) - 2000,
        barGap: isGovBond ? '0%' : undefined,
        barCategoryGap: isGovBond ? '35%' : undefined,
      });
    }
    series.sort(function (a, b) { return Number(a.name) - Number(b.name); });
    return { series: series, allLabels: allLabels };
  }
  
  function renderSeasonalChartForMetric(metricConfig) {
    if (typeof echarts === 'undefined') return;
  
    var metric = metricConfig.key;
    var unit = metricConfig.unit;
    var domId = 'chart-' + metricConfig.id;
    var dom = document.getElementById(domId);
    if (!dom) return;
  
    if (seasonalCharts[metric]) {
      seasonalCharts[metric].dispose();
      delete seasonalCharts[metric];
    }
  
    var result = createSeasonalSeries(metric);
    var series = result.series;
    var allLabels = result.allLabels;
    var isRate = RATE_METRICS.has(metric);
  
    var chart = echarts.init(dom);
    seasonalCharts[metric] = chart;
  
    var yFormatter = isRate
      ? function (v) { return v.toFixed(2) + '%'; }
      : function (v) { return v.toLocaleString('en-US'); };
  
    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var mmdd = params[0].axisValue;
          var lines = [];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            var val;
            if (isRate) { val = p.value.toFixed(2) + '%'; }
            else { val = Math.round(p.value * 100) / 100; val = val.toLocaleString('en-US') + ' \u4ebf\u5143'; }
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ' ' + mmdd + ': ' + val);
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: allLabels,
        axisLabel: {
          fontSize: 10,
          rotate: 45,
          hideOverlap: true,
        },
        axisTick: { alignWithLabel: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: yFormatter },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
        name: unit,
        nameTextStyle: { fontSize: 11 },
      },
      series: series,
      dataZoom: getDataZoomConfig(),
    });
  }
  
  function renderAllSeasonalCharts() {
    if (typeof echarts === 'undefined') return;
    Object.keys(seasonalCharts).forEach(function (key) {
      seasonalCharts[key].dispose();
    });
    seasonalCharts = {};
    for (var i = 0; i < SEASONAL_METRICS.length; i++) {
      renderSeasonalChartForMetric(SEASONAL_METRICS[i]);
    }
  }

  // ===== 政府债净缴款 交互式图表 =====

  var GOV_KEY = '\u653f\u5e9c\u503a\u51c0\u7f34\u6b3e'; // 政府债净缴款（数据字段键，亦为图表显示名；净缴款≠净融资）
  var govFreq = 'week';      // day | week | month | quarter，默认周
  var govChartType = 'bar';  // bar(时序柱状图) | seasonal(季节折线图)
  var govChart = null;
  var govTableVisible = false;
  var GOV_FREQ_NAMES = { day: '\u65e5\u5ea6', week: '\u5468\u5ea6', month: '\u6708\u5ea6', quarter: '\u5b63\u5ea6' };

  // 政府债净缴款日度源数据（日度资金情况汇总.xlsx -> 政府债净缴款 sheet）
  var govDailyData = null; // [{日期, 净缴款}, ...]

  function loadGovDailyNF() {
    fetch('public/gov_daily_net_payment.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        govDailyData = data;
        renderGovBondChart();
        if (govTableVisible) renderGovBondTable();
      })
      .catch(function (err) {
        console.warn('Gov daily net payment load failed:', err.message);
      });
  }

  function govPad2(n) { return n < 10 ? '0' + n : '' + n; }

  function govParseDate(s) {
    return new Date(parseInt(s.substring(0, 4), 10), parseInt(s.substring(5, 7), 10) - 1, parseInt(s.substring(8, 10), 10));
  }

  function govDateToStr(d) {
    return d.getFullYear() + '-' + govPad2(d.getMonth() + 1) + '-' + govPad2(d.getDate());
  }

  // 返回日期 d 所属政府债统计周（上周六至本周五）的周五（周末日期）。
  // 例：2026-08-08(周六) 至 2026-08-14(周五) 归入同一周，横轴按 2026-08-14 显示。
  function govWeekFriday(d) {
    var add = (5 - d.getDay() + 7) % 7; // 周日+5 ... 周五+0，周六+6
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
  }

  // 某个周五在其所属年份中的序号（0=该年第一个周五）
  function govFridayWeekIndex(fri) {
    var d = new Date(fri.getFullYear(), 0, 1);
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
    return Math.round(Math.round((fri - d) / 86400000) / 7);
  }

  // 周频最新显示周的周五：默认为今天所在统计周（周六-周五）的周五；
  // 若今天是周五（本周数据已完整），则向后多显示一周（下周周五）。
  function govLastWeeklyFriday() {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var fri = govWeekFriday(today);
    if (today.getDay() === 5) fri.setDate(fri.getDate() + 7);
    return govDateToStr(fri);
  }

  // 将日频底层数据按指定频率聚合为政府债净缴款。
  // 数据源：govDailyData（日度资金情况汇总.xlsx -> 政府债净缴款 sheet，A列日期/G列净缴款）。
  // 周频口径：上周六至本周五为一周，横轴按周五日期标记；仅显示至今天所在周，
  // 若今天为周五则额外显示下一周；更远未来的排期数据不显示。
  function aggregateGovBond(freq) {
    var map = {};
    if (!govDailyData) return [];
    var lastFriStr = (freq === 'week') ? govLastWeeklyFriday() : null;
    for (var i = 0; i < govDailyData.length; i++) {
      var r = govDailyData[i];
      var dateStr = r['\u65e5\u671f'];
      var val = r['\u51c0\u7f34\u6b3e'];
      if (!dateStr || val === null || val === undefined) continue;
      var key, sortKey, label;
      if (freq === 'day') {
        key = sortKey = dateStr;
        label = dateStr.replace(/-/g, '/');
      } else if (freq === 'week') {
        var friStr = govDateToStr(govWeekFriday(govParseDate(dateStr)));
        if (friStr > lastFriStr) continue; // 截断超出显示范围的未来周
        key = sortKey = friStr;
        label = friStr.replace(/-/g, '/');
      } else if (freq === 'month') {
        key = sortKey = dateStr.substring(0, 7);
        label = key.replace('-', '/');
      } else { // quarter
        var q = Math.floor((parseInt(dateStr.substring(5, 7), 10) - 1) / 3) + 1;
        key = sortKey = dateStr.substring(0, 4) + '-Q' + q;
        label = dateStr.substring(0, 4) + 'Q' + q;
      }
      if (!map[key]) map[key] = { sortKey: sortKey, label: label, value: 0 };
      map[key].value += val;
    }
    var arr = [];
    Object.keys(map).forEach(function (k) { arr.push(map[k]); });
    arr.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0; });
    return arr;
  }

  // 默认呈现窗口起点：最近两个自然年（上年+今年）的第一个周期
  function govDefaultStartPct(agg) {
    if (!agg || !agg.length) return 0;
    var startYear = new Date().getFullYear() - 1;
    for (var i = 0; i < agg.length; i++) {
      if (parseInt(agg[i].sortKey.substring(0, 4), 10) >= startYear) {
        return i / Math.max(1, agg.length - 1) * 100;
      }
    }
    return 0;
  }

  // 时序柱状图：横轴升序，正值红色/负值绿色
  function buildGovBarSeries(agg) {
    var labels = [], data = [];
    for (var i = 0; i < agg.length; i++) {
      labels.push(agg[i].label);
      var v = agg[i].value;
      data.push({ value: v, itemStyle: { color: v >= 0 ? '#dc2626' : '#16a34a' } });
    }
    return { labels: labels, data: data };
  }

  // 季节折线图：按年拆分系列，颜色参考资金利率板块
  function buildGovSeasonalSeries(agg, freq) {
    var byYear = {}, maxPos = 0;
    var calLabels = freq === 'day' ? generateCalendarLabels() : null;
    var calIdx = {};
    if (calLabels) {
      for (var c = 0; c < calLabels.length; c++) calIdx[calLabels[c]] = c;
    }
    for (var i = 0; i < agg.length; i++) {
      var sk = agg[i].sortKey;
      var year = sk.substring(0, 4);
      var pos;
      if (freq === 'day') {
        pos = calIdx[sk.substring(5)];
      } else if (freq === 'week') {
        pos = govFridayWeekIndex(govParseDate(sk));
      } else if (freq === 'month') {
        pos = parseInt(sk.substring(5, 7), 10) - 1;
      } else {
        pos = parseInt(sk.split('-Q')[1], 10) - 1;
      }
      if (pos === undefined || pos === null) continue;
      if (pos > maxPos) maxPos = pos;
      if (!byYear[year]) byYear[year] = {};
      byYear[year][pos] = agg[i].value;
    }

    // 生成横轴：闰年366天基准，日/周频 mm/dd、月频 m“月”、季频 “Q”q
    var axisLabels = [];
    if (freq === 'day') {
      for (var di = 0; di < calLabels.length; di++) axisLabels.push(calLabels[di].replace('-', '/'));
    } else if (freq === 'week') {
      var fd = new Date(2024, 0, 1);
      while (fd.getDay() !== 5) fd.setDate(fd.getDate() + 1);
      for (var wi = 0; wi <= maxPos; wi++) {
        axisLabels.push(govPad2(fd.getMonth() + 1) + '/' + govPad2(fd.getDate()));
        fd.setDate(fd.getDate() + 7);
      }
    } else if (freq === 'month') {
      for (var m = 1; m <= 12; m++) axisLabels.push(m + '\u6708');
    } else {
      for (var qi = 1; qi <= 4; qi++) axisLabels.push('Q' + qi);
    }

    var years = Object.keys(byYear).sort();
    var latestYear = years[years.length - 1];
    var series = [];
    for (var yi = 0; yi < years.length; yi++) {
      var y = years[yi];
      var values = new Array(axisLabels.length).fill(null);
      var yd = byYear[y];
      Object.keys(yd).forEach(function (p) {
        var idx = parseInt(p, 10);
        if (idx < axisLabels.length) values[idx] = yd[p];
      });
      var isLatest = (y === latestYear);
      var color = getYearColor(y, latestYear, years);
      series.push({
        name: y,
        type: 'line',
        data: values,
        itemStyle: { color: color },
        lineStyle: { width: isLatest ? 3 : 1.8, color: color },
        symbol: 'circle',
        symbolSize: isLatest ? 5 : 3.5,
        connectNulls: true,
        emphasis: { focus: 'series' },
        z: isLatest ? 100 : Number(y) - 2000,
      });
    }
    series.sort(function (a, b) { return Number(a.name) - Number(b.name); });
    return { series: series, axisLabels: axisLabels };
  }

  function renderGovBondChart() {
    if (typeof echarts === 'undefined') return;
    var dom = document.getElementById('chart-gov-bond');
    if (!dom) return;
    if (govChart) { govChart.dispose(); govChart = null; }

    var agg = aggregateGovBond(govFreq);
    var chart = echarts.init(dom);
    govChart = chart;

    var isBar = govChartType === 'bar';
    var series, axisLabels;
    if (isBar) {
      var built = buildGovBarSeries(agg);
      axisLabels = built.labels;
      series = [{
        name: GOV_KEY,
        type: 'bar',
        data: built.data,
        barMaxWidth: 28,
        emphasis: { focus: 'series' },
      }];
    } else {
      var s = buildGovSeasonalSeries(agg, govFreq);
      axisLabels = s.axisLabels;
      series = s.series;
    }

    // 默认只呈现最近两个自然年：柱状图设 dataZoom 窗口起点；季节图早年在图例中灰显
    var govStartYear = new Date().getFullYear() - 1;
    var govLegendSelected = {};
    if (!isBar) {
      for (var gli = 0; gli < series.length; gli++) {
        var gyr = parseInt(series[gli].name, 10);
        if (!isNaN(gyr) && gyr < govStartYear) govLegendSelected[series[gli].name] = false;
      }
    }
    var govDataZoom = getDataZoomConfig();
    if (isBar) {
      var govStartPct = govDefaultStartPct(agg);
      if (govStartPct > 0) { govDataZoom[0].start = govStartPct; govDataZoom[1].start = govStartPct; }
    }

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: isBar ? 'shadow' : 'line' },
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [];
          if (isBar) lines.push(params[0].axisValue);
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            var raw = (p.value && typeof p.value === 'object') ? p.value.value : p.value;
            if (raw === null || raw === undefined) continue;
            var v = Math.round(raw * 100) / 100;
            var dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>';
            if (isBar) {
              lines.push(dot + p.seriesName + ': ' + v.toLocaleString('en-US') + ' \u4ebf\u5143');
            } else {
              lines.push(dot + p.seriesName + ' ' + p.axisValue + ': ' + v.toLocaleString('en-US') + ' \u4ebf\u5143');
            }
          }
          return lines.join('<br/>');
        },
      },
      legend: isBar ? { show: false } : { type: 'scroll', top: 5, textStyle: { fontSize: 11 }, selected: govLegendSelected },
      xAxis: {
        type: 'category',
        data: axisLabels,
        axisLabel: { fontSize: 10, rotate: 45, hideOverlap: true },
        axisTick: { alignWithLabel: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toLocaleString('en-US'); } },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
        name: '\u4ebf\u5143',
        nameTextStyle: { fontSize: 11 },
      },
      series: series,
      dataZoom: govDataZoom,
    });

    updateGovTitle();
  }

  function updateGovTitle() {
    var el = document.getElementById('gov-chart-title');
    if (!el) return;
    var typeName = govChartType === 'bar' ? '\u65f6\u5e8f\u67f1\u72b6\u56fe' : '\u5b63\u8282\u6027\u5bf9\u6bd4';
    el.textContent = GOV_KEY + ' ' + GOV_FREQ_NAMES[govFreq] + typeName + ' (\u4ebf\u5143)';
  }

  // 数据表：纵向排列，按日期降序
  function renderGovBondTable() {
    var thead = document.getElementById('gov-thead');
    var tbody = document.getElementById('gov-tbody');
    if (!thead || !tbody) return;
    var agg = aggregateGovBond(govFreq);
    var rows = agg.slice().sort(function (a, b) { return a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0; });
    thead.innerHTML = '<tr><th>\u65e5\u671f</th><th>\u653f\u5e9c\u503a\u51c0\u7f34\u6b3e\uff08\u4ebf\u5143\uff09</th></tr>';
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var v = Math.round(rows[i].value * 100) / 100;
      var cls = v >= 0 ? 'positive' : 'negative';
      html += '<tr><td>' + rows[i].label + '</td><td class="' + cls + '">' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td></tr>';
    }
    tbody.innerHTML = html;
  }

  function bindGovBondEvents() {
    var freqEl = document.getElementById('gov-freq');
    var typeEl = document.getElementById('gov-charttype');
    var tableBtn = document.getElementById('gov-table-toggle');
    if (!freqEl || !typeEl || !tableBtn) return;

    freqEl.addEventListener('change', function () {
      govFreq = this.value;
      renderGovBondChart();
      if (govTableVisible) renderGovBondTable();
    });
    typeEl.addEventListener('change', function () {
      govChartType = this.value;
      renderGovBondChart();
    });
    tableBtn.addEventListener('click', function () {
      govTableVisible = !govTableVisible;
      var wrap = document.getElementById('gov-table-wrap');
      if (govTableVisible) {
        renderGovBondTable();
        wrap.style.display = 'block';
        tableBtn.classList.add('active');
      } else {
        wrap.style.display = 'none';
        tableBtn.classList.remove('active');
      }
    });
  }

  // ===== Liquidity Table =====

  function formatLiquidityValue(val) {
    if (val === null || val === undefined) return '--';
    var num = Math.round(val * 100) / 100;
    var parts = num.toFixed(0).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function renderLiquidityTable(data) {
    if (!data || !data.headers || !data.data) return;

    var thead = document.getElementById('liquidity-thead');
    var tbody = document.getElementById('liquidity-tbody');
    if (!thead || !tbody) return;

    // Build two-row header
    var row1 = '<tr>';
    var row2 = '<tr>';
    var headers = data.headers;
    var currentGroup = '';
    var groupStart = 0;

    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (i === 0) {
        row1 += '<th rowspan="2">' + h.label + '</th>';
      } else {
        if (h.group !== currentGroup) {
          if (currentGroup && groupStart > 0) {
            // Close previous group (already added)
          }
          currentGroup = h.group;
          groupStart = i;
          // Count how many columns in this group
          var groupCount = 0;
          for (var j = i; j < headers.length; j++) {
            if (headers[j].group === currentGroup) groupCount++;
            else break;
          }
          row1 += '<th colspan="' + groupCount + '">' + currentGroup + '</th>';
        }
        row2 += '<th>' + h.label + '</th>';
      }
    }
    row1 += '</tr>';
    row2 += '</tr>';
    thead.innerHTML = row1 + row2;

    // Build body
    var html = '';
    for (var r = 0; r < data.data.length; r++) {
      var record = data.data[r];
      html += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        var key = headers[c].key;
        var val = record[key];
        if (c === 0) {
          html += '<td>' + (val || '--') + '</td>';
        } else {
          var formatted = formatLiquidityValue(val);
          var cls = '';
          if (val !== null && val !== undefined) {
            cls = val >= 0 ? 'positive' : 'negative';
          }
          html += '<td class="' + cls + '">' + formatted + '</td>';
        }
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function loadLiquidityTable() {
    fetch('public/medium_long_liquidity.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        renderLiquidityTable(data);
      })
      .catch(function (err) {
        console.warn('Liquidity table load failed:', err.message);
      });
  }

  // ===== Stock Trend Charts (Combined MLF + 买断式逆回购, MDSMLF) =====

  var trendCharts = {};

  function buildMonthTicks(labels) {
    var indexes = [];
    var seenMonths = {};
    for (var i = 0; i < labels.length; i++) {
      var month = labels[i].slice(0, 7);
      if (!seenMonths[month]) {
        indexes.push(i);
        seenMonths[month] = true;
      }
    }
    return indexes;
  }

  // Build evenly-spaced tick indexes (~count ticks), always including first and last
  function buildEvenTicks(totalCount, targetCount) {
    if (totalCount <= targetCount) {
      var all = [];
      for (var j = 0; j < totalCount; j++) all.push(j);
      return all;
    }
    var tickSet = {};
    tickSet[0] = true;
    tickSet[totalCount - 1] = true;
    var step = (totalCount - 1) / (targetCount - 1);
    for (var i = 0; i < targetCount; i++) {
      tickSet[Math.round(i * step)] = true;
    }
    return tickSet;
  }

  function renderCombinedStockTrendChart() {
    if (typeof echarts === 'undefined') return;
    var domId = 'chart-buyout-repo';
    var dom = document.getElementById(domId);
    if (!dom) return;

    if (trendCharts[domId]) { trendCharts[domId].dispose(); delete trendCharts[domId]; }

    var trendData = allData
      .filter(function (row) { return row['\u65e5\u671f'] >= '2025-01-01'; })
      .filter(function (row) {
        return (row['\u4e70\u65ad\u5f0f\u9006\u56de\u8d2d'] != null) || (row['MLF\u4f59\u989d'] != null);
      })
      .sort(function (a, b) { return a['\u65e5\u671f'].localeCompare(b['\u65e5\u671f']); });

    var labels = trendData.map(function (r) { return r['\u65e5\u671f']; });
    var mlfValues = trendData.map(function (r) { return r['MLF\u4f59\u989d']; });
    var buyoutValues = trendData.map(function (r) { return r['\u4e70\u65ad\u5f0f\u9006\u56de\u8d2d']; });
    var chart = echarts.init(dom);
    trendCharts[domId] = chart;

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [params[0].axisValue];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ': ' + p.value.toLocaleString('zh-CN') + ' \u4ebf\u5143');
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          fontSize: 10,
          rotate: 45,
          hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toLocaleString('zh-CN'); } },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        name: '\u4ebf\u5143',
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        { name: 'MLF\u4f59\u989d', type: 'line', data: mlfValues, itemStyle: { color: '#2563eb' }, lineStyle: { width: 2.5 }, symbol: 'none', connectNulls: true },
        { name: '\u4e70\u65ad\u5f0f\u9006\u56de\u8d2d', type: 'line', data: buyoutValues, itemStyle: { color: '#dc2626' }, lineStyle: { width: 2.5 }, symbol: 'none', connectNulls: true },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  function renderMDSMLFTrendChart() {
    if (typeof echarts === 'undefined') return;
    var domId = 'chart-MDSMLF';
    var dom = document.getElementById(domId);
    if (!dom) return;

    if (trendCharts[domId]) { trendCharts[domId].dispose(); delete trendCharts[domId]; }

    var metric = 'MDSMLF';
    var trendData = allData
      .filter(function (row) { return row['\u65e5\u671f'] >= '2025-01-01'; })
      .filter(function (row) { return row[metric] != null; })
      .sort(function (a, b) { return a['\u65e5\u671f'].localeCompare(b['\u65e5\u671f']); });

    var labels = trendData.map(function (r) { return r['\u65e5\u671f']; });
    var values = trendData.map(function (r) { return r[metric]; });
    var chart = echarts.init(dom);
    trendCharts[domId] = chart;

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var p = params[0];
          if (p.value == null) return '';
          return p.axisValue + '<br/>' + metric + ': ' + p.value.toLocaleString('zh-CN') + ' \u4ebf\u5143';
        },
      },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          fontSize: 10,
          rotate: 45,
          hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toLocaleString('zh-CN'); } },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        name: '\u4ebf\u5143',
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        { name: metric, type: 'line', data: values, itemStyle: { color: '#16a34a' }, lineStyle: { width: 2.5 }, symbol: 'none', connectNulls: true },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  function renderAllTrendCharts() {
    renderCombinedStockTrendChart();
    renderMDSMLFTrendChart();
    renderFR007ComboChart();
    renderCDYieldChart();
  }

  // ===== CD Rate Charts (FR007 Combo + AAA CD Yield) =====

  var cdRateData = null;

  function loadCDRates() {
    fetch('public/cd_rates.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        cdRateData = data;
        renderFR007ComboChart();
        renderCDYieldChart();
      })
      .catch(function (err) {
        console.warn('CD rates load failed:', err.message);
      });
  }

  function renderFR007ComboChart() {
    if (typeof echarts === 'undefined' || !cdRateData) return;
    var domId = 'chart-fr007-combo';
    var dom = document.getElementById(domId);
    if (!dom) return;
    if (trendCharts[domId]) { trendCharts[domId].dispose(); delete trendCharts[domId]; }

    // Filter to 2015 onward
    var sorted = cdRateData.slice()
      .filter(function (r) { return r['\u65e5\u671f'] >= '2015-01-01'; })
      .sort(function (a, b) { return a['\u65e5\u671f'].localeCompare(b['\u65e5\u671f']); });
    var labels = sorted.map(function (r) { return r['\u65e5\u671f']; });
    var irs7d = sorted.map(function (r) { return r.IRS_7D; });
    var spread20ma = sorted.map(function (r) { return r['R007_7D\u5229\u5dee20MA']; });
    var rate7d = sorted.map(function (r) { return r['7D\u9006\u56de\u8d2d\u5229\u7387']; });

    var chart = echarts.init(dom);
    trendCharts[domId] = chart;

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [params[0].axisValue];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ': ' + Number(p.value).toFixed(4) + '%');
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          fontSize: 10, rotate: 45, hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value', position: 'left',
          axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2) + '%'; } },
          splitLine: { lineStyle: { color: '#e5e7eb' } },
          name: '', nameTextStyle: { fontSize: 11 },
        },
        {
          type: 'value', position: 'right',
          axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2) + '%'; } },
          splitLine: { show: false },
          name: '7\u5929\u9006\u56de\u8d2d\uff08\u53f3\u8f74\uff09', nameTextStyle: { fontSize: 11 },
        },
      ],
      series: [
        { name: 'IRS-7D\u5229\u5dee', type: 'line', data: irs7d, yAxisIndex: 0, itemStyle: { color: '#2563eb' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: 'R007-7D\u9006\u56de\u8d2d\u5229\u5dee20MA', type: 'line', data: spread20ma, yAxisIndex: 0, itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '7\u5929\u9006\u56de\u8d2d\u5229\u7387', type: 'line', data: rate7d, yAxisIndex: 1, itemStyle: { color: '#10b981' }, lineStyle: { width: 2, type: 'dashed' }, symbol: 'none', connectNulls: true },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  function renderCDYieldChart() {
    if (typeof echarts === 'undefined' || !cdRateData) return;
    var domId = 'chart-cd-yield';
    var dom = document.getElementById(domId);
    if (!dom) return;
    if (trendCharts[domId]) { trendCharts[domId].dispose(); delete trendCharts[domId]; }

    // Filter data from 2013-12-13 onward (no valid data before that)
    var sorted = cdRateData.slice()
      .filter(function (r) { return r['\u65e5\u671f'] >= '2013-12-13'; })
      .sort(function (a, b) { return a['\u65e5\u671f'].localeCompare(b['\u65e5\u671f']); });
    var labels = sorted.map(function (r) { return r['\u65e5\u671f']; });
    var cd3m = sorted.map(function (r) { return r.CD_3M; });
    var cd6m = sorted.map(function (r) { return r.CD_6M; });
    var cd9m = sorted.map(function (r) { return r.CD_9M; });
    var cd1y = sorted.map(function (r) { return r.CD_1Y; });

    var chart = echarts.init(dom);
    trendCharts[domId] = chart;

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [params[0].axisValue];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ': ' + Number(p.value).toFixed(4) + '%');
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: {
          fontSize: 10, rotate: 45, hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        minInterval: 0.10,
        splitNumber: 25,
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2) + '%'; } },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
        name: '%', nameTextStyle: { fontSize: 11 },
      },
      series: [
        { name: '3M', type: 'line', data: cd3m, itemStyle: { color: '#3b82f6' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '6M', type: 'line', data: cd6m, itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '9M', type: 'line', data: cd9m, itemStyle: { color: '#10b981' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '1Y', type: 'line', data: cd1y, itemStyle: { color: '#ef4444' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  // ===== Bill Rate Seasonal Charts =====

  var billRateData = null;
  var billRateCharts = {};

  function buildBillRateSeasonalData(data, field) {
    var byYear = {};
    for (var i = 0; i < data.length; i++) {
      var dateStr = data[i]['\u65e5\u671f'];
      if (!dateStr) continue;
      var val = data[i][field];
      if (val === null || val === undefined) continue;
      var year = dateStr.substring(0, 4);
      var mmdd = dateStr.substring(5);
      if (!byYear[year]) byYear[year] = {};
      byYear[year][mmdd] = val;
    }
    return byYear;
  }

  function getBillRateYears(data) {
    var years = new Set();
    for (var i = 0; i < data.length; i++) {
      var d = data[i]['\u65e5\u671f'];
      if (d) years.add(d.substring(0, 4));
    }
    return Array.from(years).sort();
  }

  function renderBillRateChart(domId, field, title) {
    if (typeof echarts === 'undefined' || !billRateData) return;

    var dom = document.getElementById(domId);
    if (!dom) return;

    if (billRateCharts[domId]) {
      billRateCharts[domId].dispose();
      delete billRateCharts[domId];
    }

    var seasonalData = buildBillRateSeasonalData(billRateData, field);
    var allLabels = generateCalendarLabels();
    var labelIndex = {};
    for (var li = 0; li < allLabels.length; li++) {
      labelIndex[allLabels[li]] = li;
    }

    var allYears = getBillRateYears(billRateData);
    var latestYear = allYears[allYears.length - 1];
    var years = Array.from(selectedYears).sort().filter(function (y) {
      return allYears.indexOf(y) >= 0;
    });

    var series = [];
    for (var i = 0; i < years.length; i++) {
      var year = years[i];
      var yearData = seasonalData[year];
      if (!yearData || Object.keys(yearData).length === 0) continue;

      var values = new Array(allLabels.length).fill(null);
      var keys = Object.keys(yearData);
      for (var k = 0; k < keys.length; k++) {
        var mmdd = keys[k];
        if (labelIndex[mmdd] !== undefined) {
          values[labelIndex[mmdd]] = yearData[mmdd];
        }
      }

      var color = getYearColor(year, latestYear, allYears);
      var borderWidth = getYearBorderWidth(year, latestYear);

      series.push({
        name: year,
        type: 'line',
        data: values,
        itemStyle: { color: color },
        lineStyle: { width: borderWidth, color: color },
        symbol: 'none',
        connectNulls: true,
      });
    }
    // Sort ascending so newer years render last (on top)
    series.sort(function (a, b) { return Number(a.name) - Number(b.name); });
    series.forEach(function (s) { s.z = (s.name === latestYear) ? 100 : Number(s.name) - 2000; });

    var chart = echarts.init(dom);
    billRateCharts[domId] = chart;

    chart.setOption({
      grid: getGridConfig(),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var mmdd = params[0].axisValue;
          var lines = [];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value == null) continue;
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ' ' + mmdd + ': ' + p.value.toFixed(4) + '%');
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: allLabels,
        axisLabel: {
          fontSize: 10,
          rotate: 45,
          hideOverlap: true,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2); } },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: series,
      dataZoom: getDataZoomConfig(),
    });
  }

  function renderAllBillRateCharts() {
    renderBillRateChart('chart-bill-rate-1m', '\u7968\u636e\u5229\u7387_1M', '\u7968\u636e\u5229\u7387\uff081M\uff09');
    renderBillRateChart('chart-bill-rate-6m', '\u7968\u636e\u5229\u7387_6M', '\u7968\u636e\u5229\u7387\uff086M\uff09');
  }

  function loadBillRates() {
    fetch('public/bill_rates.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        billRateData = data;
        renderAllBillRateCharts();
      })
      .catch(function (err) {
        console.warn('Bill rates load failed:', err.message);
      });
  }

  // ===== Leverage Metrics Charts =====

  var leverageCharts = {};

  function renderOvernightShareChart(data) {
    var dom = document.getElementById('chart-overnight-share');
    if (!dom) return;
    if (leverageCharts.overnight) leverageCharts.overnight.dispose();

    var filtered = data.filter(function (r) {
      return r.DR007_14DMA !== null || r['\u9694\u591c\u5360\u6bd45DMA'] !== null;
    });
    var labels = filtered.map(function (r) { return r['\u65e5\u671f']; });
    var dr007Data = filtered.map(function (r) { return r.DR007_14DMA; });
    var overnightData = filtered.map(function (r) { return r['\u9694\u591c\u5360\u6bd45DMA']; });

    // Signal: where overnight > 0.9, value = DR007
    var signalData = filtered.map(function (r, idx) {
      if (r['\u9694\u591c\u5360\u6bd45DMA'] !== null && r['\u9694\u591c\u5360\u6bd45DMA'] > 0.9 && r.DR007_14DMA !== null) {
        return [idx, r.DR007_14DMA];
      }
      return null;
    }).filter(function (v) { return v !== null; });

    var chart = echarts.init(dom);
    leverageCharts.overnight = chart;

    chart.setOption({
      grid: { left: 65, right: 65, top: 50, bottom: 80 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [params[0].axisValue];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            var val;
            if (p.seriesName === '\u9694\u591c\u5360\u6bd45DMA\uff08\u53f3\uff09' || p.seriesName === '\u9608\u503c0.9') {
              val = Number(p.value).toFixed(4);
            } else if (p.seriesName === 'DR007(14DMA)') {
              val = Number(p.value).toFixed(4) + '%';
            } else {
              val = p.value;
            }
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ': ' + val);
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 },
        data: ['DR007(14DMA)', '\u9694\u591c\u5360\u6bd45DMA\uff08\u53f3\uff09', '\u9608\u503c0.9', '\u9694\u591c\u5360\u6bd4\u4fe1\u53f7'] },
      xAxis: {
        type: 'category', data: labels,
        axisLabel: { fontSize: 10, rotate: 45, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'DR007(14DMA) %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2) + '%'; } }, splitLine: { lineStyle: { color: '#e5e7eb' } } },
        { type: 'value', name: '\u9694\u591c\u5360\u6bd4', nameTextStyle: { fontSize: 11 }, min: 0, max: 1, axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2); } }, splitLine: { show: false } },
      ],
      series: [
        { name: 'DR007(14DMA)', type: 'line', data: dr007Data, yAxisIndex: 0, itemStyle: { color: '#dc2626' }, lineStyle: { width: 2.5 }, symbol: 'none', connectNulls: true },
        { name: '\u9694\u591c\u5360\u6bd45DMA\uff08\u53f3\uff09', type: 'line', data: overnightData, yAxisIndex: 1, itemStyle: { color: '#2563eb' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '\u9608\u503c0.9', type: 'line', yAxisIndex: 1, data: labels.map(function () { return 0.9; }), itemStyle: { color: '#7c3aed' }, lineStyle: { width: 1.5, type: 'dashed' }, symbol: 'none' },
        { name: '\u9694\u591c\u5360\u6bd4\u4fe1\u53f7', type: 'scatter', yAxisIndex: 0, data: signalData, itemStyle: { color: '#34f916' }, symbol: 'diamond', symbolSize: 8 },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  function renderRepoVolumeRatioChart(data) {
    var dom = document.getElementById('chart-repo-volume-ratio');
    if (!dom) return;
    if (leverageCharts.repoVolume) leverageCharts.repoVolume.dispose();

    var filtered = data.filter(function (r) {
      return r.DR007_14DMA !== null || r['\u6210\u4ea4\u91cf_120\u65e5\u5747\u503c'] !== null;
    });
    var labels = filtered.map(function (r) { return r['\u65e5\u671f']; });
    var dr007Data = filtered.map(function (r) { return r.DR007_14DMA; });
    var volRatioData = filtered.map(function (r) { return r['\u6210\u4ea4\u91cf_120\u65e5\u5747\u503c']; });

    var signalData = filtered.map(function (r, idx) {
      if (r['\u6210\u4ea4\u91cf_120\u65e5\u5747\u503c'] !== null && r['\u6210\u4ea4\u91cf_120\u65e5\u5747\u503c'] > 1.3 && r.DR007_14DMA !== null) {
        return [idx, r.DR007_14DMA];
      }
      return null;
    }).filter(function (v) { return v !== null; });

    var chart = echarts.init(dom);
    leverageCharts.repoVolume = chart;

    chart.setOption({
      grid: { left: 65, right: 65, top: 50, bottom: 80 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [params[0].axisValue];
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            if (p.value === null || p.value === undefined) continue;
            var val;
            if (p.seriesName === '\u6210\u4ea4\u91cf/120\u65e5\u5747\u503c\uff08\u53f3\uff09' || p.seriesName === '\u9608\u503c1.3') {
              val = Number(p.value).toFixed(4);
            } else if (p.seriesName === 'DR007(14DMA)') {
              val = Number(p.value).toFixed(4) + '%';
            } else {
              val = p.value;
            }
            lines.push('<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>' + p.seriesName + ': ' + val);
          }
          return lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', top: 5, textStyle: { fontSize: 11 },
        data: ['DR007(14DMA)', '\u6210\u4ea4\u91cf/120\u65e5\u5747\u503c\uff08\u53f3\uff09', '\u9608\u503c1.3', '\u9884\u8b66\u4fe1\u53f7'] },
      xAxis: {
        type: 'category', data: labels,
        axisLabel: { fontSize: 10, rotate: 45, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: [
        { type: 'value', name: 'DR007(14DMA) %', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2) + '%'; } }, splitLine: { lineStyle: { color: '#e5e7eb' } } },
        { type: 'value', name: '\u6210\u4ea4\u91cf/120\u65e5\u5747\u503c', nameTextStyle: { fontSize: 11 }, axisLabel: { fontSize: 10, formatter: function (v) { return v.toFixed(2); } }, splitLine: { show: false } },
      ],
      series: [
        { name: 'DR007(14DMA)', type: 'line', data: dr007Data, yAxisIndex: 0, itemStyle: { color: '#16a34a' }, lineStyle: { width: 2.5 }, symbol: 'none', connectNulls: true },
        { name: '\u6210\u4ea4\u91cf/120\u65e5\u5747\u503c\uff08\u53f3\uff09', type: 'line', data: volRatioData, yAxisIndex: 1, itemStyle: { color: '#dc2626' }, lineStyle: { width: 2 }, symbol: 'none', connectNulls: true },
        { name: '\u9608\u503c1.3', type: 'line', yAxisIndex: 1, data: labels.map(function () { return 1.3; }), itemStyle: { color: '#2563eb' }, lineStyle: { width: 1.5, type: 'dashed' }, symbol: 'none' },
        { name: '\u9884\u8b66\u4fe1\u53f7', type: 'scatter', yAxisIndex: 0, data: signalData, itemStyle: { color: '#f97316' }, symbol: 'diamond', symbolSize: 8 },
      ],
      dataZoom: getDataZoomConfig(),
    });
  }

  function loadLeverageMetrics() {
    fetch('public/leverage_metrics.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        renderOvernightShareChart(data);
        renderRepoVolumeRatioChart(data);
      })
      .catch(function (err) {
        console.warn('Leverage metrics load failed:', err.message);
      });
  }

  // ===== CD Net Financing (同业存单周度净融资额) =====

  // ===== 同业存单净融资（发行/到期/净融资额 三图联动） =====
  // 底层为日度数据，按所选频率聚合；三张图共享同一频率/图类型控制与一个横轴滑块（echarts.connect 联动）。

  var cdnfData = null; // [{日期, 发行, 到期, 净融资额}, ...]

  var CDNF_METRICS = [
    { key: '\u53d1\u884c', dom: 'chart-cdnf-issue', color: '#3b82f6', signColor: false },
    { key: '\u5230\u671f', dom: 'chart-cdnf-mature', color: '#f59e0b', signColor: false },
    { key: '\u51c0\u878d\u8d44\u989d', dom: 'chart-cdnf-net', color: null, signColor: true }
  ];
  var CDNF_FREQ_NAMES = { day: '\u65e5\u5ea6', week: '\u5468\u5ea6', month: '\u6708\u5ea6', quarter: '\u5b63\u5ea6' };
  var cdnfFreq = 'week';      // day | week | month | quarter
  var cdnfChartType = 'bar';  // bar | seasonal
  var cdnfTableVisible = false;
  var cdnfCharts = {};
  var CDNF_GROUP = 'cdnf-link';
  var CDNF_DEFAULT_START_YEAR = new Date().getFullYear() - 1; // 默认呈现最近两个自然年（上年+今年），之前的数据默认隐藏（灰显），用户可自行查看

  function loadCDNetFinancing() {
    fetch('public/cd_net_financing.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        cdnfData = data;
        renderCDNFCharts();
      })
      .catch(function (err) {
        console.warn('CD net financing load failed:', err.message);
      });
  }

  // 返回日期 d 所属同业存单统计周（前一周周六至本周周五）的周五（周末日期）。
  // 例：2026-08-08(周六) 至 2026-08-14(周五) 的数据归入同一周，横轴按 2026-08-14 显示。
  function cdnfWeekFriday(d) {
    var add = (5 - d.getDay() + 7) % 7; // 周日+5 ... 周五+0，周六+6
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
  }

  // 计算某日期在指定频率下所属桶的 key/sortKey/label
  function cdnfBucket(dateStr, freq) {
    var key, sortKey, label;
    if (freq === 'day') {
      key = sortKey = dateStr;
      label = dateStr.replace(/-/g, '/');
    } else if (freq === 'week') {
      var friStr = govDateToStr(cdnfWeekFriday(govParseDate(dateStr)));
      key = sortKey = friStr;
      label = friStr.replace(/-/g, '/');
    } else if (freq === 'month') {
      key = sortKey = dateStr.substring(0, 7);
      label = key.replace('-', '/');
    } else { // quarter
      var q = Math.floor((parseInt(dateStr.substring(5, 7), 10) - 1) / 3) + 1;
      key = sortKey = dateStr.substring(0, 4) + '-Q' + q;
      label = dateStr.substring(0, 4) + 'Q' + q;
    }
    return { key: key, sortKey: sortKey, label: label };
  }

  // 今日所处周期（周/月/季/日）的 sortKey
  function cdnfCurrentPeriodKey(freq) {
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + govPad2(now.getMonth() + 1) + '-' + govPad2(now.getDate());
    return cdnfBucket(todayStr, freq).sortKey;
  }

  // 将日度数据按频率聚合。口径：
  //   到期：累加所有周期（一直延伸到数据末尾，如 2026-12-31）；
  //   发行/净融资额：仅累加到当前周期（含当前周期），当前周期之后的桶置为 null。
  //   当前周期本身按“周期第一日至最后一日”完整计算（底层含未来日数据）。
  // 三个指标共用同一套桶（横轴一致），保证滑块联动对齐。
  function aggregateCDNF(freq) {
    var currentKey = cdnfCurrentPeriodKey(freq);
    var map = {};
    for (var i = 0; i < cdnfData.length; i++) {
      var r = cdnfData[i];
      var dateStr = r['\u65e5\u671f'];
      if (!dateStr) continue;
      var b = cdnfBucket(dateStr, freq);
      if (!map[b.key]) {
        map[b.key] = { sortKey: b.sortKey, label: b.label, values: { '\u53d1\u884c': null, '\u5230\u671f': null, '\u51c0\u878d\u8d44\u989d': null } };
      }
      var bucket = map[b.key];
      var isCurrentOrPast = (b.sortKey <= currentKey);
      for (var m = 0; m < CDNF_METRICS.length; m++) {
        var mk = CDNF_METRICS[m].key;
        var v = r[mk];
        if (v === null || v === undefined) continue;
        // 到期始终累加；发行/净融资额仅累加当前周期及以前
        if (mk === '\u5230\u671f' || isCurrentOrPast) {
          if (bucket.values[mk] === null) bucket.values[mk] = 0;
          bucket.values[mk] += v;
        }
      }
    }
    var arr = [];
    Object.keys(map).forEach(function (k) { arr.push(map[k]); });
    arr.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0; });
    return arr;
  }

  // 提取单指标聚合数组，供政府债的季节/柱状构建器复用
  function cdnfMetricAgg(buckets, key) {
    var out = [];
    for (var i = 0; i < buckets.length; i++) {
      out.push({ sortKey: buckets[i].sortKey, label: buckets[i].label, value: buckets[i].values[key] });
    }
    return out;
  }

  // 横轴滑块：三图均带 [inside, slider] 相同结构（保证 echarts.connect 按
  // dataZoomIndex 可靠联动）；仅滑块所在图显示可见 slider，其余 show:false。
  function cdnfDataZoom(showSlider, startPct) {
    var dz = [
      { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
      {
        type: 'slider',
        xAxisIndex: 0,
        show: showSlider,
        height: 24,
        bottom: 8,
        filterMode: 'filter',
        showDetail: true,
        moveHandleSize: 8,
        borderColor: '#d0d5dd',
        fillerColor: 'rgba(59,130,246,0.12)',
        handleStyle: { color: '#4f8ef7', borderColor: '#3b82f6' },
        textStyle: { fontSize: 10 }
      }
    ];
    // 时序柱状图：默认隐藏早年数据，设置初始窗口起点（灰显区域，拖动滑块可查看）
    if (typeof startPct === 'number' && startPct > 0) { dz[0].start = startPct; dz[1].start = startPct; }
    return dz;
  }

  // 计算柱状图默认 dataZoom 窗口起点（第一个年份 >= CDNF_DEFAULT_START_YEAR 的周期）
  function cdnfDefaultStartPct(buckets) {
    if (!buckets || !buckets.length) return 0;
    for (var i = 0; i < buckets.length; i++) {
      if (parseInt(buckets[i].sortKey.substring(0, 4), 10) >= CDNF_DEFAULT_START_YEAR) {
        return i / Math.max(1, buckets.length - 1) * 100;
      }
    }
    return 0;
  }

  function getCdnfChart(metric) {
    var dom = document.getElementById(metric.dom);
    if (!dom) return null;
    if (cdnfCharts[metric.key]) return cdnfCharts[metric.key];
    var chart = echarts.init(dom);
    chart.group = CDNF_GROUP;
    cdnfCharts[metric.key] = chart;
    return chart;
  }

  function buildCDNFOption(buckets, metric, withSlider) {
    var isBar = cdnfChartType === 'bar';
    var defaultStartPct = isBar ? cdnfDefaultStartPct(buckets) : 0;
    var series, axisLabels;
    if (isBar) {
      var labels = [], data = [];
      for (var i = 0; i < buckets.length; i++) {
        labels.push(buckets[i].label);
        var v = buckets[i].values[metric.key];
        if (metric.signColor) {
          data.push({ value: v, itemStyle: { color: v >= 0 ? '#dc2626' : '#16a34a' } });
        } else {
          data.push(v);
        }
      }
      axisLabels = labels;
      var ser = {
        name: metric.key,
        type: 'bar',
        data: data,
        barMaxWidth: 24,
        emphasis: { focus: 'series' }
      };
      if (!metric.signColor) ser.itemStyle = { color: metric.color };
      if (metric.signColor) {
        ser.markLine = { silent: true, symbol: 'none', lineStyle: { color: '#334155', width: 1.2, type: 'solid' }, data: [{ yAxis: 0 }], label: { show: false } };
      }
      series = [ser];
    } else {
      var s = buildGovSeasonalSeries(cdnfMetricAgg(buckets, metric.key), cdnfFreq);
      axisLabels = s.axisLabels;
      series = s.series;
    }
    // 季节图：默认不选中 CDNF_DEFAULT_START_YEAR（最近两个自然年起点）之前的年份（图例灰显，点击图例可重新显示）
    var legendSelected = {};
    if (!isBar) {
      for (var li = 0; li < series.length; li++) {
        var yr = parseInt(series[li].name, 10);
        if (!isNaN(yr) && yr < CDNF_DEFAULT_START_YEAR) legendSelected[series[li].name] = false;
      }
    }

    return {
      grid: withSlider ? getGridConfig() : { left: 60, right: 60, top: 45, bottom: 50, containLabel: false },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: isBar ? 'shadow' : 'line' },
        formatter: function (params) {
          if (!params || !params.length) return '';
          var lines = [];
          if (isBar) lines.push(params[0].axisValue);
          for (var i = 0; i < params.length; i++) {
            var p = params[i];
            var raw = (p.value && typeof p.value === 'object') ? p.value.value : p.value;
            if (raw === null || raw === undefined) continue;
            var val = Math.round(raw * 100) / 100;
            var dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px"></span>';
            if (isBar) {
              lines.push(dot + p.seriesName + ': ' + val.toLocaleString('en-US') + ' \u4ebf\u5143');
            } else {
              lines.push(dot + p.seriesName + ' ' + p.axisValue + ': ' + val.toLocaleString('en-US') + ' \u4ebf\u5143');
            }
          }
          return lines.join('<br/>');
        }
      },
      legend: isBar ? { show: false } : { type: 'scroll', top: 5, textStyle: { fontSize: 11 }, selected: legendSelected },
      xAxis: {
        type: 'category',
        data: axisLabels,
        axisLabel: { fontSize: 10, rotate: 45, hideOverlap: true },
        axisTick: { alignWithLabel: false },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, formatter: function (v) { return v.toLocaleString('en-US'); } },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
        name: '\u4ebf\u5143',
        nameTextStyle: { fontSize: 11 }
      },
      series: series,
      dataZoom: cdnfDataZoom(withSlider, defaultStartPct)
    };
  }

  function renderCDNFCharts() {
    if (typeof echarts === 'undefined' || !cdnfData) return;
    var buckets = aggregateCDNF(cdnfFreq);
    for (var i = 0; i < CDNF_METRICS.length; i++) {
      var metric = CDNF_METRICS[i];
      var chart = getCdnfChart(metric);
      if (!chart) continue;
      // 仅最后一张图（净融资额）承载可见滑块，三图经 connect 联动
      var withSlider = (i === CDNF_METRICS.length - 1);
      chart.setOption(buildCDNFOption(buckets, metric, withSlider), { notMerge: true });
    }
    if (typeof echarts.connect === 'function') echarts.connect(CDNF_GROUP);
    updateCDNFTitle();
  }

  function updateCDNFTitle() {
    var el = document.getElementById('cdnf-chart-title');
    if (!el) return;
    var typeName = cdnfChartType === 'bar' ? '\u65f6\u5e8f\u67f1\u72b6\u56fe' : '\u5b63\u8282\u6027\u5bf9\u6bd4';
    el.textContent = '\u540c\u4e1a\u5b58\u5355\u53d1\u884c\u4e0e\u51c0\u878d\u8d44 ' + CDNF_FREQ_NAMES[cdnfFreq] + typeName + ' (\u4ebf\u5143)';
  }

  // 数据表：日期 + 三指标并排，按日期降序
  function renderCDNFTable() {
    var thead = document.getElementById('cdnf-thead');
    var tbody = document.getElementById('cdnf-tbody');
    if (!thead || !tbody) return;
    var buckets = aggregateCDNF(cdnfFreq);
    var rows = buckets.slice().sort(function (a, b) { return a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0; });
    thead.innerHTML = '<tr><th>\u65e5\u671f</th><th>\u53d1\u884c\uff08\u4ebf\u5143\uff09</th><th>\u5230\u671f\uff08\u4ebf\u5143\uff09</th><th>\u51c0\u878d\u8d44\u989d\uff08\u4ebf\u5143\uff09</th></tr>';
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += '<tr><td>' + rows[i].label + '</td>';
      for (var m = 0; m < CDNF_METRICS.length; m++) {
        var key = CDNF_METRICS[m].key;
        var raw = rows[i].values[key];
        if (raw === null || raw === undefined) {
          html += '<td class="cdnf-muted">--</td>';
          continue;
        }
        var v = Math.round(raw * 100) / 100;
        var cls = (key === '\u51c0\u878d\u8d44\u989d') ? (v >= 0 ? 'positive' : 'negative') : '';
        html += '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function bindCDNFEvents() {
    var freqEl = document.getElementById('cdnf-freq');
    var typeEl = document.getElementById('cdnf-charttype');
    var tableBtn = document.getElementById('cdnf-table-toggle');
    if (!freqEl || !typeEl || !tableBtn) return;
    freqEl.addEventListener('change', function () {
      cdnfFreq = this.value;
      renderCDNFCharts();
      if (cdnfTableVisible) renderCDNFTable();
    });
    typeEl.addEventListener('change', function () {
      cdnfChartType = this.value;
      renderCDNFCharts();
    });
    tableBtn.addEventListener('click', function () {
      cdnfTableVisible = !cdnfTableVisible;
      var wrap = document.getElementById('cdnf-table-wrap');
      if (cdnfTableVisible) {
        renderCDNFTable();
        wrap.style.display = 'block';
        tableBtn.classList.add('active');
      } else {
        wrap.style.display = 'none';
        tableBtn.classList.remove('active');
      }
    });
  }

  // ===== 政府债月度净融资（及预期）热力图表格 =====

  var govMonthlyNFData = null; // {列: [年份...], 行: [{月份, 数据: [...]}, ...]}

  function loadGovMonthlyNF() {
    fetch('public/gov_monthly_net_financing.json')
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        govMonthlyNFData = data;
        renderGovMonthlyNFTable();
      })
      .catch(function (err) {
        console.warn('Gov monthly net financing load failed:', err.message);
      });
  }

  // 热力图色带：淡蓝（低）-> 淡红（高），t 属于 [0,1]
  function govNFHeatColor(t) {
    var lo = [219, 234, 254]; // #DBEAFE 淡蓝
    var hi = [254, 202, 202]; // #FECACA 淡红
    var r = Math.round(lo[0] + (hi[0] - lo[0]) * t);
    var g = Math.round(lo[1] + (hi[1] - lo[1]) * t);
    var b = Math.round(lo[2] + (hi[2] - lo[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function renderGovMonthlyNFTable() {
    var thead = document.getElementById('gov-monthly-nf-thead');
    var tbody = document.getElementById('gov-monthly-nf-tbody');
    if (!thead || !tbody || !govMonthlyNFData) return;
    var cols = govMonthlyNFData['\u5217'];
    var rows = govMonthlyNFData['\u884c'];
    if (!cols || !rows) return;
    // 全局 min/max 用于热力图归一化
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < rows[i]['\u6570\u636e'].length; j++) {
        var vv = rows[i]['\u6570\u636e'][j];
        if (vv === null || vv === undefined) continue;
        if (vv < min) min = vv;
        if (vv > max) max = vv;
      }
    }
    var span = (max - min) || 1;
    var thtml = '<tr><th>\u6708\u4efd</th>';
    for (var c = 0; c < cols.length; c++) thtml += '<th>' + cols[c] + '</th>';
    thtml += '</tr>';
    thead.innerHTML = thtml;
    var html = '';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr><td>' + rows[r]['\u6708\u4efd'] + '</td>';
      var vals = rows[r]['\u6570\u636e'];
      for (var k = 0; k < vals.length; k++) {
        var v = vals[k];
        if (v === null || v === undefined) {
          html += '<td class="cdnf-muted">--</td>';
          continue;
        }
        var t = (v - min) / span;
        html += '<td style="background:' + govNFHeatColor(t) + ';">' +
          v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>';
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function initSeasonalTab() {
    var years = getAvailableYears(allData);
    var container = document.getElementById('year-selector');
    container.innerHTML = '';

    // Default: only select the latest 2 years
    var defaultYears = years.slice(-2);
    selectedYears = new Set(defaultYears);

    for (var i = 0; i < years.length; i++) {
      var btn = document.createElement('button');
      var isDefault = defaultYears.indexOf(years[i]) >= 0;
      btn.className = 'year-btn' + (isDefault ? ' active' : '');
      btn.textContent = years[i];
      btn.setAttribute('data-year', years[i]);
      btn.addEventListener('click', function () {
        var year = this.getAttribute('data-year');
        if (selectedYears.has(year)) {
          selectedYears.delete(year);
          this.classList.remove('active');
        } else {
          selectedYears.add(year);
          this.classList.add('active');
        }
        renderAllSeasonalCharts();
        renderAllBillRateCharts();
      });
      container.appendChild(btn);
    }

    // Reset button: reset to default (latest 2 years)
    document.getElementById('seasonal-reset').addEventListener('click', function () {
      var allYears = getAvailableYears(allData);
      var resetYears = allYears.slice(-2);
      selectedYears = new Set(resetYears);
      document.querySelectorAll('.year-btn').forEach(function (btn) {
        var year = btn.getAttribute('data-year');
        if (resetYears.indexOf(year) >= 0) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      renderAllSeasonalCharts();
      renderAllBillRateCharts();
    });

    // Load liquidity table (table, not chart — safe to init immediately)
    loadLiquidityTable();

    // Defer chart rendering until seasonal tab is first shown
    // (ECharts cannot calculate dimensions in display:none containers)

    // Resize all ECharts on window resize
    window.addEventListener('resize', resizeAllECharts);
  }

  // ===== Init =====
  document.addEventListener("DOMContentLoaded", loadData);

  // ===== Auto-refresh: re-fetch JSON every 5 minutes =====

  var AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  function refreshData() {
    // Fetch all 8 JSON sources in parallel (cache-busting query param)
    Promise.all([
      fetch('public/data.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/medium_long_liquidity.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/bill_rates.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/leverage_metrics.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/cd_rates.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/cd_net_financing.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/gov_monthly_net_financing.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
      fetch('public/gov_daily_net_payment.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : Promise.reject(); }),
    ]).then(function (results) {
      var newData = results[0];
      var newLiquidity = results[1];
      var newBillRates = results[2];
      var newLeverage = results[3];
      var newCDRates = results[4];
      var newCDNetFin = results[5];
      var newGovMonthlyNF = results[6];
      var newGovDailyNF = results[7];

      var changed = false;

      // Check main data (compare record count + latest date)
      if (!allData || newData.length !== allData.length ||
          (newData.length > 0 && newData[0]['\u65e5\u671f'] !== allData[0]['\u65e5\u671f'])) {
        allData = newData;
        allData.sort(function (a, b) {
          return b['\u65e5\u671f'] > a['\u65e5\u671f'] ? 1 : b['\u65e5\u671f'] < a['\u65e5\u671f'] ? -1 : 0;
        });
        changed = true;
      }

      // Check bill rates
      if (!billRateData || JSON.stringify(newBillRates).length !== JSON.stringify(billRateData).length) {
        billRateData = newBillRates;
        renderAllBillRateCharts();
        changed = true;
      }

      // Check leverage metrics
      if (newLeverage) {
        renderOvernightShareChart(newLeverage);
        renderRepoVolumeRatioChart(newLeverage);
      }

      // Check CD rates
      if (!cdRateData || JSON.stringify(newCDRates).length !== JSON.stringify(cdRateData).length) {
        cdRateData = newCDRates;
        renderFR007ComboChart();
        renderCDYieldChart();
      }

      // Check CD net financing
      if (newCDNetFin) {
        cdnfData = newCDNetFin;
        renderCDNFCharts();
      }

      // Check gov monthly net financing (heatmap table)
      if (newGovMonthlyNF) {
        govMonthlyNFData = newGovMonthlyNF;
        renderGovMonthlyNFTable();
      }

      // Check gov daily net payment (政府债净缴款图表源数据)
      if (newGovDailyNF && JSON.stringify(newGovDailyNF).length !== JSON.stringify(govDailyData || []).length) {
        govDailyData = newGovDailyNF;
        renderGovBondChart();
        if (govTableVisible) renderGovBondTable();
      }

      // Re-render liquidity table
      renderLiquidityTable(newLiquidity);

      // If main data changed, re-render table and seasonal charts
      if (changed) {
        renderTable();
        renderAllSeasonalCharts();
        renderAllTrendCharts();
        renderGovBondChart();
        if (govTableVisible) renderGovBondTable();
        console.log('[Auto-refresh] Data updated at ' + new Date().toLocaleTimeString());
      }
    }).catch(function () {
      // Silently ignore network errors during auto-refresh
    });
  }

  function startAutoRefresh() {
    setInterval(refreshData, AUTO_REFRESH_INTERVAL);
    console.log('[Auto-refresh] Enabled: polling every ' + (AUTO_REFRESH_INTERVAL / 60000) + ' minutes');
  }
})();
