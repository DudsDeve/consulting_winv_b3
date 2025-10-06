require('dotenv').config();
const express = require('express');
const { connect } = require('tradingview-ws');
//NOVO APP
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_SYMBOL = process.env.SYMBOL || 'BMFBOVESPA:WIN1!';

// campos que queremos receber do TV
const FIELDS = [
    'lp', 'bid', 'ask', 'ch', 'chp', 'open_price', 'close_price', 'high_price', 'low_price', 'volume', 'update_time'
];

const app = express();

// garantir que nunca cacheie as respostas
app.disable('etag');
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

/**
 * Abre uma conexão com o TradingView, pede snapshot do símbolo e fecha.
 * Retorna um objeto { symbol, price, bid, ask, ... } ou lança erro / timeout.
 */
async function fetchSnapshot(symbol, timeoutMs = 5000) {
    const conn = await connect();
    const QS = 'qs_' + Math.random().toString(36).slice(2, 8);

    return await new Promise((resolve, reject) => {
        let done = false;

        const finish = (fn, arg) => {
            if (done) return;
            done = true;
            try { conn.close?.(); } catch { }
            fn(arg);
        };

        const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs);

        conn.subscribe((evt) => {
            if (!evt || evt.name !== 'qsd' || !evt.params) return;

            const arr = Array.isArray(evt.params) ? evt.params.flat(Infinity) : [evt.params];
            for (const p of arr) {
                if (!p || typeof p !== 'object') continue;

                const n = p.n || p.s || p.symbol;
                if (n !== symbol) continue;

                const v = p.v || {};
                const bid = v.bid != null ? Number(v.bid) : null;
                const ask = v.ask != null ? Number(v.ask) : null;

                // usa lp se vier; se não vier, usa a média de bid/ask
                const price = v.lp != null ? Number(v.lp)
                    : (bid && ask ? (bid + ask) / 2 : null);

                if (price == null) continue;

                clearTimeout(timer);
                return finish(resolve, {
                    symbol: n,
                    price: Number(price),
                    bid: bid,
                    ask: ask,
                    open: v.open_price != null ? Number(v.open_price) : null,
                    close: v.close_price != null ? Number(v.close_price) : null,
                    high: v.high_price != null ? Number(v.high_price) : null,
                    low: v.low_price != null ? Number(v.low_price) : null,
                    volume: v.volume != null ? Number(v.volume) : null,
                    time: new Date().toISOString(),
                    source: 'tradingview'
                });
            }
        });

        // cria sessão e pede os dados
        conn.send('quote_create_session', [QS]);
        conn.send('quote_set_fields', [QS, ...FIELDS]);
        conn.send('quote_add_symbols', [QS, symbol]);       // sem flags
        conn.send('quote_fast_symbols', [QS, symbol]);      // snapshot inicial
    });
}

// endpoint on-demand
app.get('/price', async (req, res) => {
    const symbol = String(req.query.symbol || DEFAULT_SYMBOL);
    try {
        const data = await fetchSnapshot(symbol, 6000);
        res.json(data);
    } catch (e) {
        res.status(504).json({ error: 'snapshot_timeout', detail: e.message, symbol });
    }
});

app.get('/health', (_req, res) =>
    res.json({ ok: true, mode: 'on-demand', default_symbol: DEFAULT_SYMBOL })
);

app.listen(PORT, '0.0.0.0', () =>
    console.log(`HTTP on :${PORT} (on-demand)`)
);
