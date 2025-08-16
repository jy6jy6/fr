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
  const equityOverview = {};

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

    const binanceBalance = await binance.fetchBalance();
    equityOverview.binance = {
      walletBalance: binanceBalance.info?.assets?.[0]?.walletBalance,
      marginBalance: binanceBalance.info?.assets?.[0]?.marginBalance,
      unrealizedProfit: binanceBalance.info?.assets?.[0]?.unrealizedProfit,
      raw: binanceBalance.info,
    };

    // --- BYBIT ---
    const bybit = new ccxt.bybit({
      apiKey: BYBIT_API_KEY,
      secret: BYBIT_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });
    await bybit.loadMarkets();

    const bybitBalance = await bybit.fetchBalance();
    equityOverview.bybit = {
      totalEquity: bybitBalance.info?.result?.list?.[0]?.totalEquity,
      totalWalletBalance: bybitBalance.info?.result?.list?.[0]?.totalWalletBalance,
      totalUnrealizedProfit: bybitBalance.info?.result?.list?.[0]?.totalUnrealizedProfit,
      raw: bybitBalance.info,
    };

    // --- PHEMEX ---
    const phemex = new ccxt.phemex({
      apiKey: PHEMEX_API_KEY,
      secret: PHEMEX_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });
    await phemex.loadMarkets();

    const phemexBalance = await phemex.fetchBalance();
    equityOverview.phemex = {
      equity: phemexBalance.info?.data?.accounts?.[0]?.equity,
      marginBalance: phemexBalance.info?.data?.accounts?.[0]?.marginBalance,
      availableBalance: phemexBalance.info?.data?.accounts?.[0]?.availableBalance,
      raw: phemexBalance.info,
    };

    // --- MEXC ---
    const mexc = new ccxt.mexc({
      apiKey: MEXC_API_KEY,
      secret: MEXC_API_SECRET,
      enableRateLimit: true,
      options: { defaultType: 'swap' },
    });
    await mexc.loadMarkets();

    const mexcBalance = await mexc.fetchBalance();
    equityOverview.mexc = {
      equity: mexcBalance.info?.data?.[0]?.equity,
      marginBalance: mexcBalance.info?.data?.[0]?.marginBalance,
      availableBalance: mexcBalance.info?.data?.[0]?.availableBalance,
      unrealized: mexcBalance.info?.data?.[0]?.unrealized,
      raw: mexcBalance.info,
    };

    res.status(200).json({ success: true, result, equityOverview });
  } catch (e) {
    console.error('❌ Funding API error:', e);
    res.status(500).json({ error: e.message });
  }
};
