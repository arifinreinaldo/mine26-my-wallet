-- Seed currencies
INSERT INTO currencies (code, name, symbol) VALUES
('SGD', 'Singapore Dollar', 'S$'),
('USD', 'US Dollar', '$'),
('EUR', 'Euro', '€'),
('MYR', 'Malaysian Ringgit', 'RM'),
('GBP', 'British Pound', '£'),
('JPY', 'Japanese Yen', '¥')
ON CONFLICT (code) DO NOTHING;

-- Seed categories
INSERT INTO categories (name) VALUES
('Food & Dining'),
('Transport'),
('Shopping'),
('Entertainment'),
('Bills & Utilities'),
('Healthcare'),
('Travel'),
('Others')
ON CONFLICT DO NOTHING;
