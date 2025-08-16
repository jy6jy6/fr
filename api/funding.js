const ccxt = require('ccxt');

module.exports = async (req, res) => {
  const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
  const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
  const PHEMEX_API_KEY = process.env.PHEMEX_API_KEY;
  const PHEMEX_API_SECRET = process.env.PHEMEX_API_SECRET;
  const BYBIT_API_KEY = process.env.BYBIT_API_KEY;
  const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET;
  const MEXC_API_KEY = process.env.MEXC_API_KEY;
  const MEXC_API_SECRET = process.env.MEXC_API_SECRET;

  const result = [];
  const equityOverview = {}; // store equity per exchange

  function toSGTime(ts) {
    return new Date(ts).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
  }

  async function getUnrealizedPnl(exchange, pos) {
    try {
      const ticker = await exchange.fetchTicker(pos.symbol);
      const currentPrice = ticker.last;
      const avgPrice = pos.entryPrice || pos.entry_price || 0;
      const amount = pos.contracts || pos.positionAmt || 0;
      const side = pos.side || (amount > 0 ? 'long' : 'short');
      let pnl = (currentPrice - avgPrice) * amount;
      if (side.toLowerCase().includes('short')) {
        pnl = (avgPrice - currentPrice) * amount;
      }
      return pnl;
    } catch (err) {
      console.error(`❌ Failed to fetch ticker for ${pos.symbol}:`, err.message);
      return 0;
    }
  }

  async function getEquity(exchange, name) {
    try {
      const balance = await exchange.fetchBalance();
      // USDT-based account
      let equity = balance.total?.USDT || balance.info?.totalWalletBalance || null;
      equityOverview[name] = equity;
    } catch (err) {
      console.error(`❌ Failed to fetch balance for ${name}:`, err.message);
      equityOverview[name] = null;
    }
  }

  try {
    const now = Date.now();
    const oneDayAgo = now - 24.001 * 60 * 60 * 1000;

    // --- BINANCE ---
    const binance = new ccxt.binance({
      apiKey: BINANCE_API_KEY,
      secret: BINANCE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });

    await binance.loadMarkets();
    await getEquity(binance, 'binance');
    const openBinance = (await binance.fetchPositions()).filter(p => p.contracts && p.contracts > 0);

    for (const pos of openBinance) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let seen = new Set();
      let allFunding = [];
      let startTime = oneDayAgo;
      const endTime = now;

      while (startTime < endTime) {
        const data = await binance.fetchFundingHistory(symbol, startTime, 1000, {
          incomeType: 'FUNDING_FEE',
          startTime,
          endTime,
        });
        if (!data?.length) break;
        for (const f of data) {
          const key = `${f.timestamp}-${f.amount}`;
          if (!seen.has(key)) {
            seen.add(key);
            allFunding.push(f);
          }
        }
        const last = data[data.length - 1].timestamp;
        if (last <= startTime) break;
        startTime = last + 1;
        await new Promise(r => setTimeout(r, binance.rateLimit));
      }

      const total = allFunding.reduce((sum, f) => sum + parseFloat(f.amount), 0);
      const unrealizedPnl = await getUnrealizedPnl(binance, pos);

      result.push({
        source: 'binance',
        symbol: cleanSymbol,
        positionSize: pos.contracts,
        unrealizedPnl,
        count: allFunding.length,
        totalFunding: total,
        startTime: toSGTime(oneDayAgo),
        endTime: toSGTime(now),
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
    await getEquity(phemex, 'phemex');
    const openPhemex = (await phemex.fetch_positions()).filter(p => p.contracts && p.contracts > 0);

    for (const pos of openPhemex) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let offset = 0;
      const limit = 200;
      let seen = new Set();
      let allFunding = [];

      while (offset < 1000) {
        const data = await phemex.fetchFundingHistory(symbol, undefined, limit, {
          limit: limit,
          offset: offset
        });
        if (!data?.length) break;
        for (const f of data) {
          if (f.timestamp >= oneDayAgo && f.timestamp <= now) {
            const key = `${f.timestamp}-${f.amount}`;
            if (!seen.has(key)) {
              seen.add(key);
              allFunding.push(f);
            }
          }
        }
        if (data.length < limit) break;
        offset += limit;
        await new Promise(r => setTimeout(r, phemex.rateLimit));
      }

      const total = allFunding.reduce((sum, f) => sum + parseFloat(f.amount) * -1, 0);
      const unrealizedPnl = await getUnrealizedPnl(phemex, pos);

      result.push({
        source: 'phemex',
        symbol: cleanSymbol,
        positionSize: pos.contracts,
        unrealizedPnl,
        count: allFunding.length,
        totalFunding: total,
        startTime: toSGTime(oneDayAgo),
        endTime: toSGTime(now),
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
    await getEquity(bybit, 'bybit');
    const openBybit = (await bybit.fetchPositions()).filter(p => p.contracts && p.contracts > 0);

    for (const pos of openBybit) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let seen = new Set();
      let allFunding = [];
      let currentStart = oneDayAgo;
      const currentEnd = now;

      while (currentStart < currentEnd) {
        const fundings = await bybit.fetchFundingHistory(symbol, currentStart, 100, {
          startTime: currentStart,
          endTime: currentEnd,
        });
        if (!fundings?.length) break;
        for (const f of fundings) {
          const key = `${f.timestamp}-${f.amount}`;
          if (!seen.has(key)) {
            seen.add(key);
            allFunding.push(f);
          }
        }
        const lastTs = fundings.at(-1).timestamp;
        if (lastTs <= currentStart) break;
        currentStart = lastTs + 1;
        await new Promise(r => setTimeout(r, 500));
      }

      const total = allFunding.reduce((sum, f) => sum + parseFloat(f.info?.execFee || f.amount || 0) * -1, 0);
      const unrealizedPnl = await getUnrealizedPnl(bybit, pos);

      result.push({
        source: 'bybit',
        symbol: cleanSymbol,
        positionSize: pos.contracts,
        unrealizedPnl,
        count: allFunding.length,
        totalFunding: total,
        startTime: toSGTime(oneDayAgo),
        endTime: toSGTime(now),
      });
    }

    // --- MEXC ---
    const mexc = new ccxt.mexc({
      apiKey: MEXC_API_KEY,
      secret: MEXC_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });

    await mexc.loadMarkets();
    await getEquity(mexc, 'mexc');
    const openMexc = (await mexc.fetch_positions()).filter(p => p.contracts && p.contracts > 0);

    for (const pos of openMexc) {
      const symbol = pos.symbol;
      const cleanSymbol = symbol.replace('/USDT:USDT', '');
      let page = 1;
      let seen = new Set();
      let allFunding = [];

      while (true) {
        const data = await mexc.fetchFundingHistory(symbol, undefined, 100, {
          page_num: page,
          page_size: 100
        });
        if (!data?.length) break;
        for (const f of data) {
          if (f.timestamp >= oneDayAgo && f.timestamp <= now) {
            const key = `${f.timestamp}-${f.amount}`;
            if (!seen.has(key)) {
              seen.add(key);
              allFunding.push(f);
            }
          }
        }
        if (data.length < 100) break;
        page++;
        await new Promise(r => setTimeout(r, mexc.rateLimit));
      }

      const total = allFunding.reduce((sum, f) => sum + parseFloat(f.amount), 0);
      const unrealizedPnl = await getUnrealizedPnl(mexc, pos);

      result.push({
        source: 'mexc',
        symbol: cleanSymbol,
        positionSize: pos.contracts,
        unrealizedPnl,
        count: allFunding.length,
        totalFunding: total,
        startTime: toSGTime(oneDayAgo),
        endTime: toSGTime(now),
      });
    }

    res.status(200).json({ success: true, equityOverview, result });
  } catch (e) {
    console.error('❌ Funding API error:', e);
    res.status(500).json({ error: e.message });
  }
};
