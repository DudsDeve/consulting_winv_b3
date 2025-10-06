require('dotenv').config();
const axios = require('axios');
const { connect } = require('tradingview-ws');
const express = require('express');

const SYMBOL = process.env.SYMBOL || 'BMFBOVESPA:WIN1!';  // teste depois com 'BMFBOVESPA:WINV2025'
const N8N_WEBHOOK = process.env.N8N_WEBHOOK;
const PORT = process.env.PORT || 3000;

let lastTick = null;

// Campos de quote que queremos receber
const FIELDS = [
    'lp', 'bid', 'ask', 'ch', 'chp', 'open_price', 'close_price', 'high_price', 'low_price', 'volume', 'update_time'
];

(async () => {
    if (!N8N_WEBHOOK) {
        console.error('Defina N8N_WEBHOOK no .env');
        process.exit(1);
    }

    const conn = await connect();

    // ---- DEBUG: veja os primeiros eventos para entender o formato
    let dbgCount = 0;
    conn.subscribe(async (evt) => {
        if (!evt || evt.name !== 'qsd' || !evt.params) return;
        const arr = Array.isArray(evt.params) ? evt.params.flat(Infinity) : [evt.params];

        for (const p of arr) {
            if (!p || typeof p !== 'object') continue;

            const symbol = p.n || p.s || p.symbol;
            const v = p.v || {}; // <-- os valores vêm aqui

            const price = Number(
                v.lp ?? v.price ?? p.lp ?? p.price ?? v.close_price ?? p.last_price
            );

            if (symbol === SYMBOL && Number.isFinite(price)) {
                lastTick = {
                    symbol,
                    price,
                    bid: v.bid != null ? Number(v.bid) : null,
                    ask: v.ask != null ? Number(v.ask) : null,
                    open: v.open_price != null ? Number(v.open_price) : null,
                    close: v.close_price != null ? Number(v.close_price) : null,
                    high: v.high_price != null ? Number(v.high_price) : null,
                    low: v.low_price != null ? Number(v.low_price) : null,
                    volume: v.volume != null ? Number(v.volume) : null,
                    time: new Date().toISOString(),
                    source: 'tradingview'
                };

                console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${symbol} => ${price}`);

                try {
                    await axios.post(N8N_WEBHOOK, lastTick, { timeout: 5000 });
                } catch (e) {
                    console.error('POST n8n falhou:', e?.message || e);
                }
            }
        }
    });


    // ---- cria sessão e assina
    const QS = 'qs_' + Math.random().toString(36).slice(2, 8);
    conn.send('quote_create_session', [QS]);
    conn.send('quote_set_fields', [QS, ...FIELDS]);
    conn.send('quote_add_symbols', [QS, SYMBOL]);

    // 1) FORÇAR SNAPSHOT inicial
    conn.send('quote_fast_symbols', [QS, SYMBOL]);

    // 2) KEEP-ALIVE (alguns ambientes derrubam sem ping)
    setInterval(() => {
        try { conn.send('ping'); } catch { }
    }, 20_000);

    console.log('Conectado. Assinando:', SYMBOL);

    // --- HTTP server
    const app = express();
    app.get('/price', (_req, res) => {
        if (!lastTick) return res.status(503).json({ error: 'ainda sem dados' });
        res.json(lastTick);
    });
    app.get('/health', (_req, res) => res.json({ ok: true, symbol: SYMBOL, hasTick: !!lastTick }));
    app.listen(PORT, () => console.log(`HTTP on :${PORT} → GET /price`));
})();
