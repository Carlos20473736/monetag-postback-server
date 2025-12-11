const mysql = require('mysql2/promise');
require('dotenv').config();

async function addSessionColumn() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'password',
            database: process.env.DB_NAME || 'railway'
        });

        console.log('✅ Conectado ao banco de dados');

        // Adicionar coluna session_expires_at se não existir
        await connection.query(`
            ALTER TABLE monetag_postbacks 
            ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP NULL
        `);

        console.log('✅ Coluna session_expires_at adicionada com sucesso!');

        await connection.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

addSessionColumn();
