const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do MySQL - Usando variáveis do Railway
const pool = mysql.createPool({
    host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
    port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
    user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'monetag_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelayMs: 0
});

// Função para criar tabela se não existir
async function initializeDatabase() {
    try {
        console.log('🔄 Conectando ao banco de dados...');
        console.log(`Host: ${process.env.MYSQLHOST || 'localhost'}`);
        console.log(`Port: ${process.env.MYSQLPORT || 3306}`);
        console.log(`User: ${process.env.MYSQLUSER || 'root'}`);
        console.log(`Database: ${process.env.MYSQLDATABASE || 'monetag_db'}`);
        
        const connection = await pool.getConnection();
        console.log('✅ Conectado ao MySQL com sucesso!');
        
        // Criar tabela de postbacks
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS monetag_postbacks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(50) NOT NULL,
                sub_id VARCHAR(100) NOT NULL,
                ymid VARCHAR(100),
                telegram_id VARCHAR(100),
                estimated_price DECIMAL(10, 6),
                request_var VARCHAR(255),
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_created_at (created_at)
            )
        `);

        // Criar tabela de estatísticas
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS monetag_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                zone_id VARCHAR(50) NOT NULL UNIQUE,
                total_impressions INT DEFAULT 0,
                total_clicks INT DEFAULT 0,
                total_revenue DECIMAL(12, 6) DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_zone_id (zone_id)
            )
        `);

        connection.release();
        console.log('✅ Banco de dados inicializado com sucesso');
    } catch (error) {
        console.error('❌ Erro ao inicializar banco de dados:', error.message);
        console.error('Detalhes:', error);
        // Não fazer exit, deixar o servidor rodar mesmo sem BD
        // process.exit(1);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Receber postback via GET
app.get('/api/postback', async (req, res) => {
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

        const connection = await pool.getConnection();

        try {
            // Inserir postback
            const [result] = await connection.execute(
                `INSERT INTO monetag_postbacks 
                (event_type, zone_id, sub_id, ymid, telegram_id, estimated_price, request_var, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event_type,
                    zone_id,
                    sub_id || 'unknown',
                    ymid || null,
                    telegram_id || null,
                    estimated_price || 0,
                    request_var || null,
                    req.ip,
                    req.get('user-agent')
                ]
            );

            // Atualizar estatísticas
            const priceValue = parseFloat(estimated_price) || 0;
            
            if (event_type === 'impression') {
                await connection.execute(
                    `INSERT INTO monetag_stats (zone_id, total_impressions, total_revenue)
                    VALUES (?, 1, ?)
                    ON DUPLICATE KEY UPDATE
                    total_impressions = total_impressions + 1,
                    total_revenue = total_revenue + ?`,
                    [zone_id, priceValue, priceValue]
                );
            } else if (event_type === 'click') {
                await connection.execute(
                    `INSERT INTO monetag_stats (zone_id, total_clicks, total_revenue)
                    VALUES (?, 1, ?)
                    ON DUPLICATE KEY UPDATE
                    total_clicks = total_clicks + 1,
                    total_revenue = total_revenue + ?`,
                    [zone_id, priceValue, priceValue]
                );
            }

            console.log(`✅ [${new Date().toISOString()}] ${event_type.toUpperCase()} recebido`);
            console.log(`   Zone ID: ${zone_id}`);
            console.log(`   User ID: ${sub_id}`);
            console.log(`   Revenue: $${priceValue}`);

            res.json({
                success: true,
                message: `Postback de ${event_type} recebido com sucesso`,
                data: {
                    id: result.insertId,
                    event_type,
                    zone_id,
                    timestamp: new Date().toISOString()
                }
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Receber postback via POST
app.post('/api/postback', async (req, res) => {
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

        const connection = await pool.getConnection();

        try {
            // Inserir postback
            const [result] = await connection.execute(
                `INSERT INTO monetag_postbacks 
                (event_type, zone_id, sub_id, ymid, telegram_id, estimated_price, request_var, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event_type,
                    zone_id,
                    sub_id || 'unknown',
                    ymid || null,
                    telegram_id || null,
                    estimated_price || 0,
                    request_var || null,
                    req.ip,
                    req.get('user-agent')
                ]
            );

            // Atualizar estatísticas
            const priceValue = parseFloat(estimated_price) || 0;
            
            if (event_type === 'impression') {
                await connection.execute(
                    `INSERT INTO monetag_stats (zone_id, total_impressions, total_revenue)
                    VALUES (?, 1, ?)
                    ON DUPLICATE KEY UPDATE
                    total_impressions = total_impressions + 1,
                    total_revenue = total_revenue + ?`,
                    [zone_id, priceValue, priceValue]
                );
            } else if (event_type === 'click') {
                await connection.execute(
                    `INSERT INTO monetag_stats (zone_id, total_clicks, total_revenue)
                    VALUES (?, 1, ?)
                    ON DUPLICATE KEY UPDATE
                    total_clicks = total_clicks + 1,
                    total_revenue = total_revenue + ?`,
                    [zone_id, priceValue, priceValue]
                );
            }

            console.log(`✅ [${new Date().toISOString()}] ${event_type.toUpperCase()} recebido (POST)`);
            console.log(`   Zone ID: ${zone_id}`);
            console.log(`   User ID: ${sub_id}`);

            res.json({
                success: true,
                message: `Postback de ${event_type} recebido com sucesso`,
                data: {
                    id: result.insertId,
                    event_type,
                    zone_id,
                    timestamp: new Date().toISOString()
                }
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar todos os eventos
app.get('/api/events', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [events] = await connection.execute(
            'SELECT * FROM monetag_postbacks ORDER BY created_at DESC LIMIT 100'
        );
        connection.release();

        res.json({
            total: events.length,
            events
        });
    } catch (error) {
        console.error('❌ Erro ao listar eventos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar eventos por tipo
app.get('/api/events/:type', async (req, res) => {
    try {
        const type = req.params.type;

        if (!['impression', 'click'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Tipo deve ser "impression" ou "click"'
            });
        }

        const connection = await pool.getConnection();
        const [events] = await connection.execute(
            'SELECT * FROM monetag_postbacks WHERE event_type = ? ORDER BY created_at DESC LIMIT 100',
            [type]
        );
        connection.release();

        res.json({
            type,
            total: events.length,
            events
        });
    } catch (error) {
        console.error('❌ Erro ao listar eventos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [stats] = await connection.execute(
            'SELECT * FROM monetag_stats ORDER BY total_revenue DESC'
        );
        connection.release();

        // Calcular totais
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalRevenue = 0;

        stats.forEach(stat => {
            totalImpressions += stat.total_impressions;
            totalClicks += stat.total_clicks;
            totalRevenue += parseFloat(stat.total_revenue);
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
                zones_count: stats.length
            },
            by_zone: stats
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter estatísticas por zona
app.get('/api/stats/:zone_id', async (req, res) => {
    try {
        const { zone_id } = req.params;
        const connection = await pool.getConnection();
        
        const [stats] = await connection.execute(
            'SELECT * FROM monetag_stats WHERE zone_id = ?',
            [zone_id]
        );

        connection.release();

        if (stats.length === 0) {
            return res.json({
                zone_id,
                total_impressions: 0,
                total_clicks: 0,
                total_revenue: 0,
                ctr: '0%'
            });
        }

        const stat = stats[0];
        const ctr = stat.total_impressions > 0
            ? ((stat.total_clicks / stat.total_impressions) * 100).toFixed(2)
            : '0.00';

        res.json({
            zone_id,
            total_impressions: stat.total_impressions,
            total_clicks: stat.total_clicks,
            total_revenue: stat.total_revenue,
            ctr: ctr + '%'
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Dashboard HTML
app.get('/dashboard', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [stats] = await connection.execute(
            'SELECT * FROM monetag_stats ORDER BY total_revenue DESC'
        );
        const [recentEvents] = await connection.execute(
            'SELECT * FROM monetag_postbacks ORDER BY created_at DESC LIMIT 20'
        );
        connection.release();

        let totalImpressions = 0;
        let totalClicks = 0;
        let totalRevenue = 0;

        stats.forEach(stat => {
            totalImpressions += stat.total_impressions;
            totalClicks += stat.total_clicks;
            totalRevenue += parseFloat(stat.total_revenue);
        });

        const ctr = totalImpressions > 0 
            ? ((totalClicks / totalImpressions) * 100).toFixed(2) 
            : '0.00';

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

        <h2 style="color: white; margin-top: 40px; margin-bottom: 20px;">Eventos Recentes</h2>
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
                        <td>$${parseFloat(event.estimated_price).toFixed(6)}</td>
                        <td>${new Date(event.created_at).toLocaleString('pt-BR')}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <h2 style="color: white; margin-top: 40px; margin-bottom: 20px;">Estatísticas por Zona</h2>
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
                    ${stats.map(stat => {
                        const zoneCtr = stat.total_impressions > 0 
                            ? ((stat.total_clicks / stat.total_impressions) * 100).toFixed(2)
                            : '0.00';
                        return `
                        <tr>
                            <td>${stat.zone_id}</td>
                            <td>${stat.total_impressions}</td>
                            <td>${stat.total_clicks}</td>
                            <td>${zoneCtr}%</td>
                            <td>$${parseFloat(stat.total_revenue).toFixed(6)}</td>
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
    } catch (error) {
        console.error('❌ Erro ao renderizar dashboard:', error);
        res.status(500).send('Erro ao carregar dashboard');
    }
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        name: 'Monetag Postback Server v2 (Fixed)',
        version: '2.0.1',
        database: 'MySQL',
        endpoints: {
            'GET /health': 'Health check',
            'GET /api/postback?event_type=impression&zone_id=10269314&sub_id=123': 'Receber postback (GET)',
            'POST /api/postback': 'Receber postback (POST)',
            'GET /api/events': 'Listar últimos 100 eventos',
            'GET /api/events/:type': 'Listar eventos por tipo (impression ou click)',
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
async function start() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
            console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
            console.log(`📈 Estatísticas: http://localhost:${PORT}/api/stats`);
            console.log(`📋 Eventos: http://localhost:${PORT}/api/events`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
        // Não fazer exit, deixar o servidor rodar mesmo com erro
    }
}

start();
