const ccxt = require('ccxt');

module.exports = async (req, res) => {
  const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
  const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
  const PHEMEX_API_KEY = process.env.PHEMEX_API_KEY;
  const PHEMEX_API_SECRET = process.env.PHEMEX_API_SECRET;

  const result = [];

  try {
    // BINANCE
    const binance = new ccxt.binance({
      apiKey: BINANCE_API_KEY,
      secret: BINANCE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future' }
    });

    await binance.loadMarkets();
    const binancePositions = await binance.fetchPositions();
    const openBinancePositions = binancePositions.filter(p => p.contracts && p.contracts > 0);

    for (const pos of openBinancePositions) {
      const symbol = pos.symbol;
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
      let funding = [];
      let seen = new Set();
      let cursor = since;

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

      const lastCycle = cycles[cycles.length - 1];
      const total = lastCycle.reduce((sum, f) => sum + parseFloat(f.amount), 0);

      result.push({
        source: "binance",
        symbol,
        count: lastCycle.length,
        totalFunding: total,
        startTime: new Date(lastCycle[0].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }),
        endTime: new Date(lastCycle[lastCycle.length - 1].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })
      });
    }

    // PHEMEX
    const phemex = new ccxt.phemex({
      apiKey: PHEMEX_API_KEY,
      secret: PHEMEX_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });

    await phemex.loadMarkets();
    const usdtPerpSymbols = phemex.symbols.filter(s => s.endsWith('/USDT:USDT'));
    const phemexPositions = await phemex.fetch_positions(usdtPerpSymbols);
    const openPhemexPositions = phemexPositions.filter(p => p.contracts && p.contracts > 0);

    for (const pos of openPhemexPositions) {
      const symbol = pos.symbol;
      const since = null;
      let allFunding = [];
      let seen = new Set();
      let cursor = since;

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

      const lastCycle = cycles[cycles.length - 1];
      const total = lastCycle.reduce((sum, f) => sum + parseFloat(f.amount) * -1, 0); // invert

      result.push({
        source: "phemex",
        symbol: symbol.replace('/USDT:USDT', ''),
        count: lastCycle.length,
        totalFunding: total,
        startTime: new Date(lastCycle[0].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }),
        endTime: new Date(lastCycle[lastCycle.length - 1].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })
      });
    }

    res.status(200).json({ success: true, result });

  } catch (e) {
    console.error("Funding script error:", e);
    res.status(500).json({ error: e.message });
  }
};
