insert into public.categories (slug, name, sort_order) values
  ('beadable-products', 'Beadable Products', 10),
  ('beadable-pen-blanks', 'Beadable Pen Blanks', 20),
  ('mixes-bundles-kits', 'Mixes, Bundles & Kits', 30),
  ('spacers-accessories', 'Spacers/Accessories', 40),
  ('acrylic-flatbacks', 'Acrylic Flatbacks', 50),
  ('rhinestone-beads', 'Rhinestone Beads', 60),
  ('focal-beads', 'Focal Beads', 70),
  ('silicone', 'Silicone', 80),
  ('acrylic', 'Acrylic', 90),
  ('cup-charms', 'Cup Charms', 100),
  ('completed-pens-keychains', 'Completed Pens/Keychains', 110),
  ('charms-dangles', 'Charms & Dangles', 120),
  ('clearance-section', 'Clearance', 130)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, updated_at = timezone('utc', now());
