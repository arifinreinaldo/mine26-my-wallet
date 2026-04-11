-- Add Philippine Peso
INSERT INTO currencies (code, name, symbol) VALUES
('PHP', 'Philippine Peso', '₱')
ON CONFLICT (code) DO NOTHING;
