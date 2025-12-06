const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// CARREGAR/SALVAR DADOS
// ============================================
let stats = {};

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            stats = JSON.parse(data);
            console.log('[INIT] ✅ Dados carregados');
        }
    } catch (e) {
        console.error('[INIT] ❌ Erro ao carregar:', e.message);
        stats = {};
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error('[SAVE] ❌ Erro ao salvar:', e.message);
    }
}

// ============================================
// POSTBACK - RECEBER DADOS
// ============================================
app.get('/api/postback', (req, res) => {
    const { zone_id, telegram_id, event_type, estimated_price } = req.query;

    console.log('[POSTBACK] Recebido:');
    console.log('  - zone_id:', zone_id);
    console.log('  - telegram_id:', telegram_id);
    console.log('  - event_type:', event_type);
    console.log('  - estimated_price:', estimated_price);

    // Validar
    if (!zone_id || !telegram_id || !event_type) {
        return res.status(400).json({ error: 'Faltam parâmetros' });
    }

    // Criar estrutura se não existir
    if (!stats[zone_id]) {
        stats[zone_id] = {};
    }
    if (!stats[zone_id][telegram_id]) {
        stats[zone_id][telegram_id] = {
            impressions: 0,
            clicks: 0,
            revenue: 0
        };
    }

    // Atualizar dados
    if (event_type === 'impression') {
        stats[zone_id][telegram_id].impressions++;
    } else if (event_type === 'click') {
        stats[zone_id][telegram_id].clicks++;
        stats[zone_id][telegram_id].revenue += parseFloat(estimated_price || 0);
    }

    saveData();

    console.log('[POSTBACK] ✅ Salvo com sucesso');
    res.json({ status: 'ok' });
});

// ============================================
// STATS - BUSCAR DADOS POR TELEGRAM ID
// ============================================
app.get('/api/stats/:zone_id/:telegram_id', (req, res) => {
    const { zone_id, telegram_id } = req.params;

    console.log('[STATS] Buscando:', zone_id, telegram_id);

    // Se não tem dados, retorna zeros
    if (!stats[zone_id] || !stats[zone_id][telegram_id]) {
        return res.json({
            zone_id,
            telegram_id,
            impressions: 0,
            clicks: 0,
            revenue: 0
        });
    }

    // Retorna dados do usuário
    res.json({
        zone_id,
        telegram_id,
        impressions: stats[zone_id][telegram_id].impressions,
        clicks: stats[zone_id][telegram_id].clicks,
        revenue: stats[zone_id][telegram_id].revenue
    });
});

// ============================================
// STATS GLOBAL
// ============================================
app.get('/api/stats', (req, res) => {
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalRevenue = 0;

    for (let zone in stats) {
        for (let user in stats[zone]) {
            totalImpressions += stats[zone][user].impressions;
            totalClicks += stats[zone][user].clicks;
            totalRevenue += stats[zone][user].revenue;
        }
    }

    res.json({
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        total_revenue: totalRevenue,
        zones: Object.keys(stats)
    });
});

// ============================================
// DASHBOARD
// ============================================
app.get('/dashboard', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Dashboard</title>
        <style>
            body { font-family: Arial; margin: 20px; background: #1a1a1a; color: #fff; }
            .container { max-width: 1200px; margin: 0 auto; }
            .zone { margin: 20px 0; border: 1px solid #444; padding: 15px; }
            .user { margin: 10px 0; padding: 10px; background: #2a2a2a; border-left: 3px solid #00ddff; }
            h1 { color: #00ddff; }
            h2 { color: #00ff88; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Dashboard de Postbacks</h1>
    `;

    for (let zone in stats) {
        html += `<div class="zone"><h2>Zona: ${zone}</h2>`;
        
        for (let user in stats[zone]) {
            const data = stats[zone][user];
            html += `
                <div class="user">
                    <strong>👤 ${user}</strong><br>
                    📊 Impressões: ${data.impressions}<br>
                    👆 Cliques: ${data.clicks}<br>
                    💰 Revenue: $${data.revenue.toFixed(4)}
                </div>
            `;
        }
        
        html += `</div>`;
    }

    html += `</div></body></html>`;
    res.send(html);
});

// ============================================
// INICIAR SERVIDOR
// ============================================
loadData();

app.listen(PORT, () => {
    console.log('[SERVER] ✅ Servidor iniciado na porta', PORT);
    console.log('[SERVER] 📊 Dashboard: http://localhost:' + PORT + '/dashboard');
    console.log('[SERVER] 🔗 Postback: http://localhost:' + PORT + '/api/postback');
    console.log('[SERVER] 📈 Stats: http://localhost:' + PORT + '/api/stats/:zone_id/:telegram_id');
});
