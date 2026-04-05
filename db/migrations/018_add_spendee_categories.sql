-- Add categories commonly used in Spendee that don't exist yet
INSERT INTO categories (name) VALUES
('Grocery'),
('Gifts'),
('Accommodation'),
('Gunpla')
ON CONFLICT DO NOTHING;
