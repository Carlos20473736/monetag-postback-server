CREATE DATABASE IF NOT EXISTS monetag_tracking;
USE monetag_tracking;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    total_impressions INT DEFAULT 0,
    total_clicks INT DEFAULT 0,
    total_earnings DECIMAL(10, 4) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tracking_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    zone_id VARCHAR(50) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    estimated_price DECIMAL(10, 4) DEFAULT 0.00,
    INDEX idx_event_type (event_type),
    INDEX idx_zone_id (zone_id),
    INDEX idx_user_email (user_email),
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
