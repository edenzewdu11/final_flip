-- Manually create B2CPaymentTransaction table
CREATE TABLE IF NOT EXISTS api_b2cpaymenttransaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receiver_msisdn VARCHAR(20) NOT NULL,
    receiver_account_name VARCHAR(64),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ETB',
    reason_type VARCHAR(100) NOT NULL,
    remark TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'timeout')),
    telebirr_transaction_id VARCHAR(100),
    originator_conversation_id VARCHAR(100),
    conversation_id VARCHAR(100),
    reference_data JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    payer_id INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS api_b2cpaym_payer_i_898e62_idx ON api_b2cpaymenttransaction(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_b2cpaym_receive_4149a8_idx ON api_b2cpaymenttransaction(receiver_msisdn, created_at DESC);
CREATE INDEX IF NOT EXISTS api_b2cpaym_status_25e40f_idx ON api_b2cpaymenttransaction(status, created_at DESC);
CREATE INDEX IF NOT EXISTS api_b2cpaym_telebir_a7db12_idx ON api_b2cpaymenttransaction(telebirr_transaction_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_api_b2cpaymenttransaction_updated_at BEFORE UPDATE ON api_b2cpaymenttransaction
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
