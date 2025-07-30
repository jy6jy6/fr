const ccxt = require('ccxt');

module.exports = async (req, res) => {
  const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
  const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
  const PHEMEX_API_KEY = process.env.PHEMEX_API_KEY;
  const PHEMEX_API_SECRET = process.env.PHEMEX_API_SECRET;
  const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
  const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;

  const result = [];

  function toSGTime(ts) {
    return new Date(ts).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  }

  try {
    // --- BINANCE ---
    const binance = new ccxt.binance({
      apiKey: BINANCE_API_KEY,
      secret: BINANCE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });

    await binance.loadMarkets();
    const binancePositions = await binance.fetchPositions();
    const openBinance = binancePositions.filter(p => p.contracts && p.contracts > 0);

    for (const pos of openBinance) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let funding = [], seen = new Set(), cursor = since;

      while (true) {
        const data = await binance.fetchFundingHistory(symbol, cursor, 1000);
        if (!data || data.length === 0) break;

        for (const f of data) {
          const key = `${f.timestamp}-${f.amount}`;
          if (!seen.has(key)) {
            seen.add(key);
            funding.push(f);
          }
        }

        const last = data[data.length - 1].timestamp;
        if (last <= cursor) break;
        cursor = last + 1;
      }

      funding.sort((a, b) => a.timestamp - b.timestamp);
      let cycles = [], current = [], lastTs = null;

      for (const f of funding) {
        if (lastTs && (f.timestamp - lastTs) > 9 * 3600 * 1000) {
          if (current.length) cycles.push(current);
          current = [];
        }
        current.push(f);
        lastTs = f.timestamp;
      }
      if (current.length) cycles.push(current);
      if (!cycles.length) continue;

      const lastCycle = cycles.at(-1);
      if (!lastCycle?.length) continue;

      const total = lastCycle.reduce((sum, f) => sum + parseFloat(f.amount), 0);

      result.push({
        source: "binance",
        symbol: cleanSymbol,
        count: lastCycle.length,
        totalFunding: total,
        startTime: toSGTime(lastCycle[0].timestamp),
        endTime: toSGTime(lastCycle.at(-1).timestamp),
      });
    }

    // --- PHEMEX ---
    const phemex = new ccxt.phemex({
      apiKey: PHEMEX_API_KEY,
      secret: PHEMEX_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });

    await phemex.loadMarkets();
    const phemexSymbols = phemex.symbols.filter(s => s.endsWith('/USDT:USDT'));
    const phemexPositions = await phemex.fetch_positions(phemexSymbols);
    const openPhemex = phemexPositions.filter(p => p.contracts && p.contracts > 0);

    for (const pos of openPhemex) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let allFunding = [], seen = new Set(), cursor = null;

      while (true) {
        const data = await phemex.fetchFundingHistory(symbol, cursor, 200);
        if (!data || data.length === 0) break;

        for (const f of data) {
          const key = `${f.timestamp}-${f.amount}`;
          if (!seen.has(key)) {
            seen.add(key);
            allFunding.push(f);
          }
        }

        const last = data[data.length - 1].timestamp;
        if (cursor && last <= cursor) break;
        cursor = last + 1;
        await new Promise(r => setTimeout(r, phemex.rateLimit));
      }

      allFunding.sort((a, b) => a.timestamp - b.timestamp);
      let cycles = [], current = [], lastTs = null;

      for (const f of allFunding) {
        if (lastTs && (f.timestamp - lastTs) > 9 * 3600 * 1000) {
          if (current.length) cycles.push(current);
          current = [];
        }
        current.push(f);
        lastTs = f.timestamp;
      }
      if (current.length) cycles.push(current);
      if (!cycles.length) continue;

      const lastCycle = cycles.at(-1);
      if (!lastCycle?.length) continue;

      const total = lastCycle.reduce((sum, f) => sum + parseFloat(f.amount) * -1, 0);

      result.push({
        source: "phemex",
        symbol: cleanSymbol,
        count: lastCycle.length,
        totalFunding: total,
        startTime: toSGTime(lastCycle[0].timestamp),
        endTime: toSGTime(lastCycle.at(-1).timestamp),
      });
    }

    // --- BYBIT ---
      const bybit = new ccxt.bybit({
      apiKey: BYBIT_API_KEY,
      secret: BYBIT_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });

    await bybit.loadMarkets();
    const positions = await bybit.fetchPositions();
    const openPositions = positions.filter(p => p.contracts && p.contracts > 0);

    const endTime = Date.now();
    const since = endTime - 30 * 24 * 60 * 60 * 1000;

    for (const pos of openPositions) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let allFundings = [];
      let currentStart = since;

      while (currentStart < endTime) {
        const fundings = await bybit.fetchFundingHistory(symbol, currentStart, 1000, { paginate: true });
        if (fundings && fundings.length) {
          allFundings.push(...fundings);
        }
        const nextStart = currentStart + 7 * 24 * 60 * 60 * 1000;
        if (nextStart >= endTime) break;
        currentStart = nextStart + 1;
        await new Promise(r => setTimeout(r, 500));
      }

      if (!allFundings.length) continue;

      allFundings.sort((a, b) => a.timestamp - b.timestamp);
      const gapThreshold = 9 * 60 * 60 * 1000;

      let currentCycleFundings = [];
      for (let i = 0; i < allFundings.length - 1; i++) {
        const timeDiff = allFundings[i + 1].timestamp - allFundings[i].timestamp;
        if (timeDiff > gapThreshold) {
          currentCycleFundings = allFundings.slice(i + 1);
          break;
        }
      }
      if (!currentCycleFundings.length) {
        currentCycleFundings = allFundings;
      }

      const total = currentCycleFundings.reduce((sum, f) => sum + parseFloat(f.info?.execFee || f.amount || 0) * -1, 0);
      result.push({
        source: 'bybit',
        symbol: cleanSymbol,
        count: currentCycleFundings.length,
        totalFunding: total,
        startTime: toSGTime(currentCycleFundings[0].timestamp),
        endTime: toSGTime(currentCycleFundings.at(-1).timestamp),
      });
    }

    res.status(200).json({ success: true, result });

  } catch (e) {
    console.error('❌ Funding API error:', e);
    res.status(500).json({ error: e.message });
  }
};
