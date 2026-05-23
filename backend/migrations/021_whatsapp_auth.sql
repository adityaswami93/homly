-- WhatsApp bot auth state persistence
-- Stores Baileys session keys so the bot survives Railway redeploys
-- without needing a persistent volume.

CREATE TABLE IF NOT EXISTS whatsapp_auth (
    tenant_id   TEXT        NOT NULL,
    key         TEXT        NOT NULL,
    value       TEXT        NOT NULL,   -- JSON string (with Buffer encoding)
    updated_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);
