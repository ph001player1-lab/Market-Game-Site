/* Интерактивная модель рынка. Одна на все языковые версии.
   Все суммы, валюта и подписи приходят из window.SIM_CONFIG,
   который объявлен в самой странице выше по документу.
   Границы ползунков берутся из атрибутов min/max/step/value в HTML. */

(function(){
  'use strict';

  var C = window.SIM_CONFIG;
  if(!C) return;

  var MARKET = 10000, MONTHS = 12, SEATS_PER_TABLE = 20;

  var el = function(id){ return document.getElementById(id); };
  var price = el('simPrice'), qual = el('simQual'), ad = el('simAd'), tables = el('simTables');
  if(!price) return;

  var outPrice = el('outPrice'), outQual = el('outQual'), outAd = el('outAd'), outTables = el('outTables');
  var bars = el('simBars'), stats = el('simStats'), warn = el('simWarn');
  var cashEl = el('simCash'), cashLab = el('simCashLab'), verdict = el('simVerdict');
  var btnNext = el('simNext'), btnReset = el('simReset');

  var cents = C.priceDecimals || 0;
  var moneyFmt = new Intl.NumberFormat(C.locale, {style:'currency', currency:C.currency, maximumFractionDigits:0});
  var priceFmt = new Intl.NumberFormat(C.locale, {style:'currency', currency:C.currency,
                   minimumFractionDigits:cents, maximumFractionDigits:cents});
  var numFmt = new Intl.NumberFormat(C.locale);

  function money(v){ return moneyFmt.format(Math.round(v)); }

  function t(key, vars){
    var s = C.text[key] || key;
    if(!vars) return s;
    return s.replace(/\{(\w+)\}/g, function(match, name){
      return vars[name] != null ? vars[name] : match;
    });
  }

  var DEF = {price:+price.value, q:+qual.value, ad:+ad.value, tables:+tables.value};
  var cash = C.startCash, month = 1, done = false, result = null;

  function attract(r){
    return Math.pow(C.refPrice / r.price, 1.6) *
           Math.pow(r.q / 5, 1.1) *
           (1 + 0.9 * Math.sqrt(r.ad / C.adReference));
  }
  function capacity(r){ return r.tables * SEATS_PER_TABLE; }
  function unitCost(r){ return C.unitBase + r.q * C.unitPerQuality; }

  function paintTrack(input){
    var pct = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.background = 'linear-gradient(to right, #D8422A 0 ' + pct + '%, #3A3A46 ' + pct + '% 100%)';
  }

  function me(){
    return {id:'P1', color:'#D8422A', price:+price.value, q:+qual.value, ad:+ad.value, tables:+tables.value};
  }

  function row(name, value, cls){
    return '<div><dt>' + name + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</dd></div>';
  }

  function render(){
    var p1 = me();
    var all = [p1].concat(C.rivals);
    var scores = all.map(attract);
    var total = scores.reduce(function(a,b){ return a+b; }, 0);

    var rows = all.map(function(r, i){
      var share = scores[i] / total;
      var demand = Math.round(MARKET * share);
      return {id:r.id, color:r.color, share:share, demand:demand,
              served:Math.min(demand, capacity(r)), me:i === 0};
    });

    bars.innerHTML = rows.map(function(r){
      return '<div class="simbar' + (r.me ? ' simbar--me' : '') + '">' +
             '<b>' + r.id + '</b>' +
             '<div class="simbar__track"><div class="simbar__fill" style="width:' +
               (r.share / 0.35 * 100).toFixed(1) + '%;background:' + r.color + '"></div></div>' +
             '<span>' + Math.round(r.share * 100) + '%</span></div>';
    }).join('');

    var my = rows[0];
    var cap = capacity(p1);
    var revenue = my.served * p1.price;
    var costVar = my.served * unitCost(p1);
    var costHall = p1.tables * C.perTable;
    var costs = costVar + costHall + p1.ad + C.fixed;
    var profit = revenue - costs;

    stats.innerHTML =
      row(t('demand'), numFmt.format(my.demand)) +
      row(t('capacity'), numFmt.format(cap)) +
      row(t('served'), numFmt.format(my.served)) +
      row(t('revenue'), money(revenue)) +
      row(t('costs'), money(costs)) +
      row(t('profit'), (profit >= 0 ? '+' : '−') + money(Math.abs(profit)),
          profit >= 0 ? 'plus' : 'minus') +
      row(t('share'), Math.round(my.served / MARKET * 100) + '%');

    if(my.demand > cap){
      warn.hidden = false;
      warn.textContent = t('warn', {demand: numFmt.format(my.demand), cap: numFmt.format(cap)});
    } else {
      warn.hidden = true;
    }

    btnNext.disabled = done;
    return profit;
  }

  function labels(){
    outPrice.textContent = priceFmt.format(price.value);
    outQual.textContent = t('qualValue', {n: qual.value});
    outAd.textContent = money(ad.value);
    outTables.textContent = numFmt.format(tables.value);
    [price, qual, ad, tables].forEach(paintTrack);
  }

  function status(){
    cashLab.textContent = t('cashLine', {m: month, t: MONTHS});
    cashEl.textContent = money(cash);
    if(result){
      verdict.hidden = false;
      verdict.textContent = result.win
        ? t('verdictWin', {n: money(result.delta)})
        : t('verdictLose', {n: money(result.delta)});
    } else {
      verdict.hidden = true;
    }
  }

  function update(){ labels(); status(); render(); }

  [price, qual, ad, tables].forEach(function(i){ i.addEventListener('input', update); });

  btnNext.addEventListener('click', function(){
    if(done) return;
    cash += render();
    month++;
    if(month > MONTHS){
      done = true;
      month = MONTHS;
      var delta = cash - C.startCash;
      result = {win: delta >= 0, delta: Math.abs(delta)};
    }
    update();
  });

  btnReset.addEventListener('click', function(){
    price.value = DEF.price; qual.value = DEF.q; ad.value = DEF.ad; tables.value = DEF.tables;
    cash = C.startCash; month = 1; done = false; result = null;
    update();
  });

  update();
})();
