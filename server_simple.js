const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazenamento em memória
const events = [];
const stats = {};

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '2.1.0 (In-Memory)'
    });
});

// Receber postback via GET
app.get('/api/postback', (req, res) => {
    try {
        const {
            event_type,
            zone_id,
            sub_id,
            ymid,
            telegram_id,
            estimated_price,
            request_var
        } = req.query;

        // Validar parâmetros obrigatórios
        if (!event_type || !zone_id) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetros obrigatórios faltando: event_type, zone_id'
            });
        }

        // Validar tipo de evento
        if (!['impression', 'click'].includes(event_type)) {
            return res.status(400).json({
                success: false,
                error: 'event_type deve ser "impression" ou "click"'
            });
        }

        // Criar registro do evento
        const event = {
            id: events.length + 1,
            event_type,
            zone_id,
            sub_id: sub_id || 'unknown',
            ymid: ymid || null,
            telegram_id: telegram_id || null,
            estimated_price: parseFloat(estimated_price) || 0,
            request_var: request_var || null,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            created_at: new Date().toISOString()
        };

        // Armazenar evento
        events.push(event);

        // Atualizar estatísticas
        if (!stats[zone_id]) {
            stats[zone_id] = {
                zone_id,
                total_impressions: 0,
                total_clicks: 0,
                total_revenue: 0
            };
        }

        if (event_type === 'impression') {
            stats[zone_id].total_impressions++;
        } else if (event_type === 'click') {
            stats[zone_id].total_clicks++;
        }

        stats[zone_id].total_revenue += event.estimated_price;

        console.log(`✅ [${event.created_at}] ${event_type.toUpperCase()} recebido`);
        console.log(`   Zone ID: ${zone_id}`);
        console.log(`   User ID: ${sub_id}`);
        console.log(`   Revenue: $${event.estimated_price}`);

        res.json({
            success: true,
            message: `Postback de ${event_type} recebido com sucesso`,
            data: {
                id: event.id,
                event_type,
                zone_id,
                timestamp: event.created_at
            }
        });
    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Receber postback via POST
app.post('/api/postback', (req, res) => {
    try {
        const {
            event_type,
            zone_id,
            sub_id,
            ymid,
            telegram_id,
            estimated_price,
            request_var
        } = req.body;

        // Validar parâmetros obrigatórios
        if (!event_type || !zone_id) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetros obrigatórios faltando: event_type, zone_id'
            });
        }

        // Validar tipo de evento
        if (!['impression', 'click'].includes(event_type)) {
            return res.status(400).json({
                success: false,
                error: 'event_type deve ser "impression" ou "click"'
            });
        }

        // Criar registro do evento
        const event = {
            id: events.length + 1,
            event_type,
            zone_id,
            sub_id: sub_id || 'unknown',
            ymid: ymid || null,
            telegram_id: telegram_id || null,
            estimated_price: parseFloat(estimated_price) || 0,
            request_var: request_var || null,
            ip_address: req.ip,
            user_agent: req.get('user-agent'),
            created_at: new Date().toISOString()
        };

        // Armazenar evento
        events.push(event);

        // Atualizar estatísticas
        if (!stats[zone_id]) {
            stats[zone_id] = {
                zone_id,
                total_impressions: 0,
                total_clicks: 0,
                total_revenue: 0
            };
        }

        if (event_type === 'impression') {
            stats[zone_id].total_impressions++;
        } else if (event_type === 'click') {
            stats[zone_id].total_clicks++;
        }

        stats[zone_id].total_revenue += event.estimated_price;

        console.log(`✅ [${event.created_at}] ${event_type.toUpperCase()} recebido (POST)`);
        console.log(`   Zone ID: ${zone_id}`);
        console.log(`   User ID: ${sub_id}`);

        res.json({
            success: true,
            message: `Postback de ${event_type} recebido com sucesso`,
            data: {
                id: event.id,
                event_type,
                zone_id,
                timestamp: event.created_at
            }
        });
    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar todos os eventos
app.get('/api/events', (req, res) => {
    res.json({
        total: events.length,
        events: events.slice(-100) // Últimos 100
    });
});

// Listar eventos por tipo
app.get('/api/events/:type', (req, res) => {
    const type = req.params.type;

    if (!['impression', 'click'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Tipo deve ser "impression" ou "click"'
        });
    }

    const filtered = events.filter(e => e.event_type === type);
    res.json({
        type,
        total: filtered.length,
        events: filtered.slice(-100)
    });
});

// Obter estatísticas gerais
app.get('/api/stats', (req, res) => {
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalRevenue = 0;

    Object.values(stats).forEach(stat => {
        totalImpressions += stat.total_impressions;
        totalClicks += stat.total_clicks;
        totalRevenue += stat.total_revenue;
    });

    const ctr = totalImpressions > 0 
        ? ((totalClicks / totalImpressions) * 100).toFixed(2) 
        : '0.00';

    res.json({
        summary: {
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_revenue: totalRevenue.toFixed(6),
            ctr: ctr + '%',
            zones_count: Object.keys(stats).length
        },
        by_zone: Object.values(stats)
    });
});

// Obter estatísticas por zona
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;

    if (!stats[zone_id]) {
        return res.json({
            zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            ctr: '0%'
        });
    }

    const stat = stats[zone_id];
    const ctr = stat.total_impressions > 0
        ? ((stat.total_clicks / stat.total_impressions) * 100).toFixed(2)
        : '0.00';

    res.json({
        zone_id,
        total_impressions: stat.total_impressions,
        total_clicks: stat.total_clicks,
        total_revenue: stat.total_revenue.toFixed(6),
        ctr: ctr + '%'
    });
});

// Dashboard HTML
app.get('/dashboard', (req, res) => {
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalRevenue = 0;

    Object.values(stats).forEach(stat => {
        totalImpressions += stat.total_impressions;
        totalClicks += stat.total_clicks;
        totalRevenue += stat.total_revenue;
    });

    const ctr = totalImpressions > 0 
        ? ((totalClicks / totalImpressions) * 100).toFixed(2) 
        : '0.00';

    const recentEvents = events.slice(-20);
    const zoneStats = Object.values(stats);

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monetag Postback Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: white;
            margin-bottom: 30px;
            text-align: center;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        h2 {
            color: white;
            margin-top: 40px;
            margin-bottom: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            border-radius: 10px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease;
        }
        .stat-card:hover {
            transform: translateY(-5px);
        }
        .stat-label {
            color: #666;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            color: #667eea;
        }
        .stat-unit {
            font-size: 0.5em;
            color: #999;
            margin-left: 5px;
        }
        .table-container {
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            margin-bottom: 30px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th {
            background: #667eea;
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 12px 15px;
            border-bottom: 1px solid #eee;
        }
        tr:hover {
            background: #f9f9f9;
        }
        .badge {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
        }
        .badge-impression {
            background: #e3f2fd;
            color: #1976d2;
        }
        .badge-click {
            background: #f3e5f5;
            color: #7b1fa2;
        }
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            margin-bottom: 20px;
        }
        .refresh-btn:hover {
            background: #764ba2;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Monetag Postback Dashboard</h1>
        
        <button class="refresh-btn" onclick="location.reload()">🔄 Atualizar</button>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total de Impressões</div>
                <div class="stat-value">${totalImpressions}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total de Cliques</div>
                <div class="stat-value">${totalClicks}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Taxa de Clique (CTR)</div>
                <div class="stat-value">${ctr}<span class="stat-unit">%</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Revenue Total</div>
                <div class="stat-value">$${totalRevenue.toFixed(6)}</div>
            </div>
        </div>

        <h2>Eventos Recentes</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Tipo</th>
                        <th>Zone ID</th>
                        <th>User ID</th>
                        <th>Revenue</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentEvents.map(event => `
                    <tr>
                        <td>#${event.id}</td>
                        <td><span class="badge badge-${event.event_type}">${event.event_type.toUpperCase()}</span></td>
                        <td>${event.zone_id}</td>
                        <td>${event.sub_id}</td>
                        <td>$${event.estimated_price.toFixed(6)}</td>
                        <td>${new Date(event.created_at).toLocaleString('pt-BR')}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <h2>Estatísticas por Zona</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Zone ID</th>
                        <th>Impressões</th>
                        <th>Cliques</th>
                        <th>CTR</th>
                        <th>Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    ${zoneStats.map(stat => {
                        const zoneCtr = stat.total_impressions > 0 
                            ? ((stat.total_clicks / stat.total_impressions) * 100).toFixed(2)
                            : '0.00';
                        return `
                        <tr>
                            <td>${stat.zone_id}</td>
                            <td>${stat.total_impressions}</td>
                            <td>${stat.total_clicks}</td>
                            <td>${zoneCtr}%</td>
                            <td>$${stat.total_revenue.toFixed(6)}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
    `;

    res.send(html);
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        name: 'Monetag Postback Server',
        version: '2.1.0 (In-Memory)',
        database: 'In-Memory',
        status: 'ONLINE',
        endpoints: {
            'GET /health': 'Health check',
            'GET /api/postback?event_type=impression&zone_id=10269314&sub_id=123': 'Receber postback (GET)',
            'POST /api/postback': 'Receber postback (POST)',
            'GET /api/events': 'Listar últimos 100 eventos',
            'GET /api/events/:type': 'Listar eventos por tipo',
            'GET /api/stats': 'Obter estatísticas gerais',
            'GET /api/stats/:zone_id': 'Obter estatísticas por zona',
            'GET /dashboard': 'Dashboard visual'
        }
    });
});

// Tratamento de erros 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        path: req.path
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📈 Estatísticas: http://localhost:${PORT}/api/stats`);
    console.log(`📋 Eventos: http://localhost:${PORT}/api/events`);
    console.log(`💾 Modo: In-Memory (dados não persistem após reinicialização)`);
});
