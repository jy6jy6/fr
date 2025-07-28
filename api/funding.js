import ccxt from 'ccxt';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatSG(dt) {
  return new Date(dt).toLocaleString('en-SG', { hour12: false });
}

async function getFundingData(exchange, exchangeName, usdtPerpFilter) {
  const allFundingRecords = [];
  const allSummaryRecords = [];

  const symbols = exchange.symbols.filter(usdtPerpFilter);

  const positions = await exchange.fetchPositions(symbols);
  const openPositions = positions.filter(p => p.contracts && p.contracts > 0);

  for (const pos of openPositions) {
    const symbol = pos.symbol;
    const cleanSymbol = symbol.split(':')[0].replace('/USDT', '').replace('/USDT:USDT', '');
    let since = undefined;
    let allFunding = [];
    const seen = new Set();

    try {
      while (true) {
        const history = await exchange.fetchFundingHistory(symbol, since, 200);
        if (!history || history.length === 0) break;

        for (const f of history) {
          const key = `${f.timestamp}_${f.amount}`;
          if (!seen.has(key)) {
            seen.add(key);
            allFunding.push(f);
          }
        }

        const lastTs = history[history.length - 1].timestamp;
        if (since && lastTs <= since) break;
        since = lastTs + 1;

        await sleep(exchange.rateLimit);
      }
    } catch (err) {
      console.warn(`[${exchangeName}] Error fetching for ${symbol}: ${err.message}`);
      continue;
    }

    allFunding.sort((a, b) => a.timestamp - b.timestamp);

    // Group into 9-hour cycles
    const cycles = [];
    let current = [];
    let lastTs = null;

    for (const f of allFunding) {
      if (lastTs && f.timestamp - lastTs > 9 * 3600 * 1000) {
        if (current.length > 0) cycles.push(current);
        current = [];
      }
      current.push(f);
      lastTs = f.timestamp;
    }
    if (current.length > 0) cycles.push(current);

    if (cycles.length === 0) continue;

    const lastCycle = cycles[cycles.length - 1];
    let totalFunding = 0;

    for (const f of lastCycle) {
      const amt = -parseFloat(f.amount); // invert sign to show cost
      totalFunding += amt;
      allFundingRecords.push({
        exchange: exchangeName,
        symbol: cleanSymbol,
        datetime: formatSG(f.timestamp),
        amount: amt,
      });
    }

    allSummaryRecords.push({
      exchange: exchangeName,
      symbol: cleanSymbol,
      total_funding_fee: totalFunding,
      record_count: lastCycle.length,
      cycle_count: cycles.length,
      start_time: formatSG(lastCycle[0].timestamp),
      end_time: formatSG(lastCycle[lastCycle.length - 1].timestamp),
    });
  }

  return { fundingRecords: allFundingRecords, summaryRecords: allSummaryRecords };
}

export default async function handler(req, res) {
  try {
    // Initialize Binance
    const binance = new ccxt.binance({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });

    // Initialize Phemex
    const phemex = new ccxt.phemex({
      apiKey: process.env.PHEMEX_API_KEY,
      secret: process.env.PHEMEX_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });

    await binance.loadMarkets();
    await phemex.loadMarkets();

    const [binanceData, phemexData] = await Promise.all([
      getFundingData(binance, 'Binance', (s) => s.endsWith('USDT')),
      getFundingData(phemex, 'Phemex', (s) => s.endsWith('/USDT:USDT')),
    ]);

    res.status(200).json({
      fundingRecords: [...binanceData.fundingRecords, ...phemexData.fundingRecords],
      summaryRecords: [...binanceData.summaryRecords, ...phemexData.summaryRecords],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
