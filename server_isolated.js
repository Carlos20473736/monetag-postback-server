const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// ARMAZENAMENTO EM MEMÓRIA - 100% ISOLADO POR USUÁRIO
// ============================================
const events = [];
// Estrutura: userStats[zone_id][ymid] = { impressions, clicks, revenue, ... }
// SEM agregação global - cada usuário é completamente isolado
const userStats = {};

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor de postback Monetag funcionando' });
});

// ============================================
// RECEBER POSTBACK
// ============================================
app.get('/api/postback', (req, res) => {
    const {
        event_type,
        zone_id,
        ymid,
        user_email,
        estimated_price,
        sub_zone_id,
        request_var,
        telegram_id,
        reward_event_type
    } = req.query;

    console.log('[POSTBACK] Recebido:');
    console.log('  - event_type:', event_type);
    console.log('  - zone_id:', zone_id);
    console.log('  - ymid:', ymid);
    console.log('  - user_email:', user_email);
    console.log('  - estimated_price:', estimated_price);

    // Validar parâmetros obrigatórios
    if (!event_type || !zone_id) {
        return res.status(400).json({
            success: false,
            error: 'Parâmetros obrigatórios faltando: event_type, zone_id'
        });
    }

    // Usar ymid como identificador único (obrigatório)
    const userId = ymid || 'unknown';

    // Criar evento
    const event = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        event_type: event_type,
        zone_id: zone_id,
        ymid: userId,
        user_email: user_email || 'unknown',
        estimated_price: parseFloat(estimated_price) || 0,
        sub_zone_id: sub_zone_id || null,
        request_var: request_var || null,
        telegram_id: telegram_id || null,
        reward_event_type: reward_event_type || 'not_valued',
        ip: req.ip,
        user_agent: req.get('user-agent'),
        timestamp: new Date().toISOString()
    };

    // Armazenar evento
    events.push(event);

    // ============================================
    // ATUALIZAR ESTATÍSTICAS - 100% ISOLADO POR USUÁRIO
    // ============================================
    const key = `${zone_id}:${userId}`;
    
    if (!userStats[key]) {
        userStats[key] = {
            zone_id: zone_id,
            ymid: userId,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        };
    }

    const stats = userStats[key];
    
    if (event_type === 'impression') {
        stats.total_impressions++;
    } else if (event_type === 'click') {
        stats.total_clicks++;
    }

    stats.total_revenue += event.estimated_price;
    if (reward_event_type === 'valued') {
        stats.valued_events++;
    } else {
        stats.not_valued_events++;
    }
    stats.last_update = new Date().toISOString();

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[POSTBACK] Estatísticas atualizadas para zona', zone_id, 'usuário', userId);

    res.json({
        success: true,
        message: `Postback de ${event_type} recebido com sucesso`,
        event_id: event.id,
        zone_id: zone_id,
        ymid: userId
    });
});

// ============================================
// ESTATÍSTICAS POR ZONA E USUÁRIO (ymid) - ISOLADO
// ============================================
app.get('/api/stats/:zone_id/:ymid', (req, res) => {
    const { zone_id, ymid } = req.params;
    const key = `${zone_id}:${ymid}`;

    // Se usuário não tem dados, retornar estrutura vazia
    if (!userStats[key]) {
        return res.json({
            zone_id: zone_id,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        });
    }

    res.json(userStats[key]);
});

// ============================================
// ESTATÍSTICAS POR ZONA (RETORNA AGREGAÇÃO + USUÁRIOS)
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    const users = [];
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    // Buscar todos os usuários dessa zona e agregar
    Object.entries(userStats).forEach(([key, stats]) => {
        if (stats.zone_id === zone_id) {
            users.push(stats);
            total_impressions += stats.total_impressions;
            total_clicks += stats.total_clicks;
            total_revenue += stats.total_revenue;
        }
    });

    res.json({
        zone_id: zone_id,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        users_count: users.length,
        users: users,
        last_update: new Date().toISOString()
    });
});

// ============================================
// DASHBOARD
// ============================================
app.get('/dashboard', (req, res) => {
    let totalUsers = 0;
    const zonesList = {};

    // Agrupar por zona para exibição
    Object.entries(userStats).forEach(([key, stats]) => {
        if (!zonesList[stats.zone_id]) {
            zonesList[stats.zone_id] = [];
        }
        zonesList[stats.zone_id].push(stats);
        totalUsers++;
    });

    let html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monetag Postback Dashboard</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: #f5f5f5;
                margin: 0;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                border-bottom: 2px solid #007bff;
                padding-bottom: 10px;
            }
            h2 {
                color: #555;
                margin-top: 30px;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }
            .stat-card {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 8px;
                text-align: center;
            }
            .stat-card h3 {
                margin: 0;
                font-size: 0.9em;
                opacity: 0.9;
            }
            .stat-card .value {
                font-size: 2em;
                font-weight: bold;
                margin: 10px 0;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }
            th {
                background: #007bff;
                color: white;
                font-weight: bold;
            }
            tr:hover {
                background: #f9f9f9;
            }
            .zone-section {
                margin: 30px 0;
                padding: 15px;
                background: #f9f9f9;
                border-left: 4px solid #007bff;
            }
            .warning {
                background: #fff3cd;
                border: 1px solid #ffc107;
                color: #856404;
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback Dashboard</h1>
            
            <div class="warning">
                ⚠️ <strong>MODO ISOLADO POR USUÁRIO (YMID)</strong><br>
                Cada usuário tem seus próprios contadores de impressões e clicks.<br>
                <strong>Não há agregação global</strong> - os dados são 100% isolados por usuário.
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Total de Usuários</h3>
                    <div class="value">${totalUsers}</div>
                </div>
                <div class="stat-card">
                    <h3>Total de Eventos</h3>
                    <div class="value">${events.length}</div>
                </div>
                <div class="stat-card">
                    <h3>Total de Zonas</h3>
                    <div class="value">${Object.keys(zonesList).length}</div>
                </div>
            </div>

            <h2>Usuários por Zona</h2>
    `;

    Object.entries(zonesList).forEach(([zoneId, users]) => {
        html += `
            <div class="zone-section">
                <h3>Zona: ${zoneId}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>YMID (Usuário)</th>
                            <th>Impressões</th>
                            <th>Clicks</th>
                            <th>Revenue</th>
                            <th>CTR</th>
                            <th>Última Atualização</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        users.forEach(user => {
            const ctr = user.total_impressions > 0 
                ? ((user.total_clicks / user.total_impressions) * 100).toFixed(2) 
                : '0.00';
            
            html += `
                <tr>
                    <td><strong>${user.ymid}</strong></td>
                    <td>${user.total_impressions}</td>
                    <td>${user.total_clicks}</td>
                    <td>$${user.total_revenue.toFixed(4)}</td>
                    <td>${ctr}%</td>
                    <td>${new Date(user.last_update).toLocaleString('pt-BR')}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
    });

    html += `
            <h2>Últimos Eventos (últimos 10)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Tipo</th>
                        <th>Zona</th>
                        <th>YMID (Usuário)</th>
                        <th>Email</th>
                        <th>Valor</th>
                    </tr>
                </thead>
                <tbody>
    `;

    events.slice(-10).reverse().forEach(event => {
        html += `
            <tr>
                <td>${new Date(event.timestamp).toLocaleString('pt-BR')}</td>
                <td>${event.event_type}</td>
                <td>${event.zone_id}</td>
                <td><strong>${event.ymid}</strong></td>
                <td>${event.user_email}</td>
                <td>$${event.estimated_price.toFixed(4)}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>

            <p style="text-align: center; color: #999; margin-top: 30px;">
                Última atualização: ${new Date().toLocaleString('pt-BR')}
            </p>
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// ============================================
// RESET ADMIN
// ============================================
app.post('/api/admin/reset', (req, res) => {
    const eventsCleared = events.length;
    const usersCleared = Object.keys(userStats).length;

    events.length = 0;
    Object.keys(userStats).forEach(key => delete userStats[key]);

    console.log('[ADMIN] Dados resetados');
    console.log('[ADMIN] Eventos limpos:', eventsCleared);
    console.log('[ADMIN] Usuários limpos:', usersCleared);

    res.json({
        success: true,
        message: 'Todos os dados foram resetados com sucesso',
        data: {
            events_cleared: eventsCleared,
            users_cleared: usersCleared,
            timestamp: new Date().toISOString()
        }
    });
});

// ============================================
// RESET POR USUÁRIO
// ============================================
app.post('/api/admin/reset/:zone_id/:ymid', (req, res) => {
    const { zone_id, ymid } = req.params;
    const key = `${zone_id}:${ymid}`;

    if (!userStats[key]) {
        return res.status(404).json({
            success: false,
            error: 'Usuário não encontrado'
        });
    }

    delete userStats[key];

    console.log('[ADMIN] Usuário resetado:', zone_id, ymid);

    res.json({
        success: true,
        message: `Dados do usuário ${ymid} na zona ${zone_id} foram resetados`,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ENDPOINT: CONTAR IMPRESSÕES E CLIQUES POR EMAIL
// ============================================
app.get('/api/count', (req, res) => {
    const { email, event_type } = req.query;

    console.log('[COUNT] Recebido:');
    console.log('  - email:', email);
    console.log('  - event_type:', event_type);

    // Validação
    if (!email || !event_type) {
        console.log('[COUNT] ❌ Dados inválidos');
        return res.status(400).json({ error: 'Missing required fields: email, event_type' });
    }

    // Criar estrutura se não existir
    if (!userStats[email]) {
        userStats[email] = {
            email: email,
            impressions: 0,
            clicks: 0,
            last_update: null
        };
    }

    // Atualizar contagem
    if (event_type === 'impression') {
        userStats[email].impressions++;
        console.log('[COUNT] ✅ Impressão contada para', email);
    } else if (event_type === 'click') {
        userStats[email].clicks++;
        console.log('[COUNT] ✅ Clique contado para', email);
    } else {
        return res.status(400).json({ error: 'Invalid event_type. Use "impression" or "click"' });
    }

    userStats[email].last_update = new Date().toISOString();

    console.log('[COUNT] Estatísticas atualizadas:');
    console.log('  - Impressões:', userStats[email].impressions);
    console.log('  - Cliques:', userStats[email].clicks);

    res.json({ 
        success: true, 
        message: `${event_type} contado com sucesso`,
        stats: userStats[email]
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('[SERVER] ✅ Servidor de postback Monetag iniciado na porta', PORT);
    console.log('[SERVER] 📊 Dashboard: http://localhost:' + PORT + '/dashboard');
    console.log('[SERVER] 🔗 Postback URL: http://localhost:' + PORT + '/api/postback');
    console.log('[SERVER] 📈 Stats URL: http://localhost:' + PORT + '/api/stats/:zone_id/:ymid');
    console.log('[SERVER] ⚠️  MODO ISOLADO: Cada usuário tem dados 100% isolados');
});
