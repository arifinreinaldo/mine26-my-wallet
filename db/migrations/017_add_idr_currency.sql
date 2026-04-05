-- Add Indonesian Rupiah for Spendee migration
INSERT INTO currencies (code, name, symbol) VALUES
('IDR', 'Indonesian Rupiah', 'Rp')
ON CONFLICT (code) DO NOTHING;
