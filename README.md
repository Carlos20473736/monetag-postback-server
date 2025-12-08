# Monetag Postback Server

Servidor backend para rastreamento de impressões, cliques e ganhos do Monetag ADS.

## Funcionalidades

- ✅ Receber postbacks de impressões e cliques
- ✅ Armazenar dados em MySQL
- ✅ Fornecer estatísticas por zona
- ✅ Rastrear eventos por usuário
- ✅ Integração com Railway

## Endpoints

### Health Check
```
GET /health
```
Verifica se o servidor está online.

### Registrar Evento (Impressão/Clique)
```
GET /api/postback?event_type=impression&zone_id=10269314&ymid=USER_ID&user_email=user@email.com&estimated_price=0.0023
```

**Parâmetros:**
- `event_type` (obrigatório): `impression` ou `click`
- `zone_id` (obrigatório): ID da zona de anúncios
- `ymid` (obrigatório): ID do usuário
- `user_email` (opcional): Email do usuário
- `estimated_price` (opcional): Valor estimado do evento

**Resposta:**
```json
{
  "success": true,
  "message": "impression registrado com sucesso",
  "event_id": 123,
  "timestamp": "2024-12-08T12:00:00.000Z"
}
```

### Obter Estatísticas
```
GET /api/stats/:zone_id
```

Retorna estatísticas agregadas para uma zona.

**Resposta:**
```json
{
  "zone_id": "10269314",
  "impressions": 5,
  "clicks": 1,
  "total_revenue": 0.0138,
  "timestamp": "2024-12-08T12:00:00.000Z"
}
```

### Obter Eventos do Usuário
```
GET /api/events/:user_id
```

Retorna últimos 100 eventos de um usuário.

**Resposta:**
```json
{
  "user_id": "1000000001",
  "total_events": 6,
  "events": [
    {
      "id": 1,
      "event_type": "impression",
      "zone_id": "10269314",
      "user_id": "1000000001",
      "user_email": "user@email.com",
      "estimated_price": "0.0023",
      "created_at": "2024-12-08T12:00:00.000Z"
    }
  ],
  "timestamp": "2024-12-08T12:00:00.000Z"
}
```

## Instalação

### Localmente

1. Clone o repositório
```bash
git clone <repo-url>
cd monetag-postback-server
```

2. Instale as dependências
```bash
npm install
```

3. Configure as variáveis de ambiente
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Inicialize o banco de dados
```bash
npm run init-db
```

5. Inicie o servidor
```bash
npm start
```

### No Railway

1. Conecte seu repositório GitHub ao Railway
2. Configure as variáveis de ambiente:
   - `DB_HOST`: Host do MySQL
   - `DB_USER`: Usuário do MySQL
   - `DB_PASSWORD`: Senha do MySQL
   - `DB_NAME`: Nome do banco de dados
   - `PORT`: Porta (padrão: 3000)

3. O servidor será iniciado automaticamente

## Variáveis de Ambiente

```env
PORT=3000
NODE_ENV=development

# Banco de Dados
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=monetag_tracking
```

## Estrutura do Banco de Dados

### Tabela: tracking_events
Armazena todos os eventos de impressão e clique.

```sql
CREATE TABLE tracking_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    zone_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_email VARCHAR(255),
    estimated_price DECIMAL(10, 4) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Tabela: daily_stats
Armazena estatísticas agregadas por dia.

```sql
CREATE TABLE daily_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    zone_id VARCHAR(50) NOT NULL,
    event_date DATE NOT NULL,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    total_revenue DECIMAL(10, 4) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_zone_date (zone_id, event_date)
);
```

### Tabela: users
Armazena informações dos usuários.

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    total_impressions INT DEFAULT 0,
    total_clicks INT DEFAULT 0,
    total_earnings DECIMAL(10, 4) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Logs

O servidor registra todos os eventos em console:

```
[2024-12-08T12:00:00.000Z] Postback recebido: {
  event_type: 'impression',
  zone_id: '10269314',
  ymid: '1000000001',
  user_email: 'user@email.com',
  estimated_price: '0.0023'
}

[2024-12-08T12:00:00.100Z] Evento armazenado com sucesso: {
  id: 1,
  event_type: 'impression',
  zone_id: '10269314',
  user_id: '1000000001'
}
```

## Desenvolvimento

Para desenvolvimento com auto-reload:

```bash
npm install -g nodemon
nodemon server.js
```

## Testes

Para testar o servidor localmente:

```bash
# Health check
curl http://localhost:3000/health

# Registrar impressão
curl "http://localhost:3000/api/postback?event_type=impression&zone_id=10269314&ymid=1000000001&user_email=test@example.com&estimated_price=0.0023"

# Obter estatísticas
curl http://localhost:3000/api/stats/10269314

# Obter eventos do usuário
curl http://localhost:3000/api/events/1000000001
```

## Licença

ISC
