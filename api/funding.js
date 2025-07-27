const ccxt = require('ccxt');

module.exports = async (req, res) => {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  const binance = new ccxt.binance({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    options: { defaultType: 'future' }
  });

  try {
    await binance.loadMarkets();
    const positions = await binance.fetchPositions();
    const openPositions = positions.filter(p => p.contracts && p.contracts > 0);

    const result = [];

    for (const pos of openPositions) {
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

      let cycles = [];
      let current = [];
      let lastTs = null;

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
        symbol,
        count: lastCycle.length,
        totalFunding: total,
        startTime: new Date(lastCycle[0].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }),
        endTime: new Date(lastCycle[lastCycle.length - 1].timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })
      });
    }

    res.status(200).json({ success: true, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};