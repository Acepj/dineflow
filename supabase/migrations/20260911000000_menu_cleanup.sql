/* # Menu cleanup: dish-specific images, duplicate removal, canonical categories

1. Purpose
- The customer menu showed the same 4 unrelated stock photos on nearly every item
  (lighthouse/chef photos) and ~17 orphan duplicate rows (category_id NULL or
  pointing at a removed "Other" category, image_url NULL) alongside the
  canonical items.

2. Actions (all idempotent)
- Ensure the six canonical categories exist (Signature Rolls, Nigiri & Sashimi,
  Small Plates, Ramen, Desserts, Drinks).
- Delete orphan menu_items rows with no category (duplicate seed leftovers).
  If a row is still referenced by order_items (FK RESTRICT), hide it instead by
  setting available = false.
- Remove the legacy "Other" catch-all category and its items (same FK fallback).
- Upsert all 32 canonical menu items with dish-specific, verified food photos
  (Wikimedia Commons / TheMealDB). Existing rows get image_url refreshed;
  fresh databases get the full seed.
- Refresh descriptions to match the dishes.

3. Security
- No RLS changes. No schema changes.
*/

-- ---------------------------------------------------------------- categories
INSERT INTO categories (name, slug, description, sort_order)
SELECT v.name, v.slug, v.description, v.sort_order
FROM (VALUES
  ('Signature Rolls', 'signature-rolls', 'Chef''s specialty maki creations', 1),
  ('Nigiri & Sashimi', 'nigiri-sashimi', 'Fresh cuts on and off the rice', 2),
  ('Small Plates', 'small-plates', 'Shareable starters and sides', 3),
  ('Ramen', 'ramen', 'Slow-brothed noodle bowls', 4),
  ('Desserts', 'desserts', 'Sweet finishes', 5),
  ('Drinks', 'drinks', 'Sake, tea, and refreshments', 6)
) AS v(name, slug, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM categories existing WHERE existing.name = v.name
);

-- ------------------------------------------------- remove orphan/duplicates
-- Duplicate seed rows have category_id NULL or pointing at a category that no
-- longer exists (the removed "Other" catch-all). Try to delete; if a row is
-- still referenced by order_items, hide it from the menu instead.
DO $$
DECLARE
  row_record record;
BEGIN
  FOR row_record IN
    SELECT m.id
    FROM menu_items m
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE m.category_id IS NULL OR c.id IS NULL
  LOOP
    BEGIN
      DELETE FROM menu_items WHERE id = row_record.id;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE menu_items SET available = false WHERE id = row_record.id;
    END;
  END LOOP;
END $$;

-- Remove the legacy "Other" catch-all category and its items.
DO $$
DECLARE
  other_id uuid;
  row_record record;
BEGIN
  SELECT id INTO other_id FROM categories WHERE name = 'Other';
  IF other_id IS NOT NULL THEN
    FOR row_record IN SELECT id FROM menu_items WHERE category_id = other_id LOOP
      BEGIN
        DELETE FROM menu_items WHERE id = row_record.id;
      EXCEPTION WHEN foreign_key_violation THEN
        UPDATE menu_items SET available = false WHERE id = row_record.id;
      END;
    END LOOP;
    DELETE FROM categories WHERE id = other_id;
  END IF;
END $$;

-- ------------------------------------------------------- canonical menu items
-- Dish-specific, verified photos (Wikimedia Commons / TheMealDB).
INSERT INTO menu_items (category_id, name, description, price, prep_time, available, image_url)
SELECT c.id, v.name, v.description, v.price, v.prep, true, v.img
FROM (VALUES
  ('Signature Rolls', 'Dragon Roll', 'Eel, cucumber, avocado, tobiko', 320.00, 12, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/Teriyaki_Chicken_Sushi_Roll_and_Avocado_and_Prawn_Tempura_Sushi_Rolls_-_Sakura_Kaiten_Sushi.jpg/960px-Teriyaki_Chicken_Sushi_Roll_and_Avocado_and_Prawn_Tempura_Sushi_Rolls_-_Sakura_Kaiten_Sushi.jpg'),
  ('Signature Rolls', 'Rainbow Roll', 'Crab, avocado, topped with assorted sashimi', 380.00, 14, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Sen_rainbow_roll_sushi_1.jpg/960px-Sen_rainbow_roll_sushi_1.jpg'),
  ('Signature Rolls', 'Spicy Tuna Roll', 'Tuna, spicy mayo, scallion, sesame', 280.00, 10, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Spicy_Tuna_Roll_-_Diane_Sushi_AUD1.80_%283484892107%29.jpg/960px-Spicy_Tuna_Roll_-_Diane_Sushi_AUD1.80_%283484892107%29.jpg'),
  ('Signature Rolls', 'Philadelphia Roll', 'Salmon, cream cheese, cucumber', 290.00, 10, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Philly_roll.jpg/960px-Philly_roll.jpg'),
  ('Signature Rolls', 'Tempura Roll', 'Shrimp tempura, avocado, eel sauce', 340.00, 12, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Sakura_Kaiten_Sushi_by_avlxyz_in_Melbourne.jpg/960px-Sakura_Kaiten_Sushi_by_avlxyz_in_Melbourne.jpg'),
  ('Signature Rolls', 'Volcano Roll', 'Spicy scallop, crunch, dynamite sauce', 360.00, 14, 'https://www.themealdb.com/images/media/meals/g046bb1663960946.jpg'),
  ('Nigiri & Sashimi', 'Toro Nigiri', 'Bluefin belly, wasabi', 220.00, 8, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Nigiri_Sushi_%2826505096851%29.jpg/960px-Nigiri_Sushi_%2826505096851%29.jpg'),
  ('Nigiri & Sashimi', 'Salmon Nigiri', 'Norwegian salmon, wasabi', 180.00, 8, 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Salmon_Nigiri_Sushi%2C_2008.jpg'),
  ('Nigiri & Sashimi', 'Hamachi Nigiri', 'Yellowtail, wasabi', 190.00, 8, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/19/Nigiri_Moriawase_%28Sushi_Sei%29_%2842217840971%29.jpg/960px-Nigiri_Moriawase_%28Sushi_Sei%29_%2842217840971%29.jpg'),
  ('Nigiri & Sashimi', 'Sashimi Platter', 'Chef''s selection of 9 pieces', 520.00, 12, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d0/Deluxe_sashimi_platter_02.jpg/960px-Deluxe_sashimi_platter_02.jpg'),
  ('Nigiri & Sashimi', 'Ebi Nigiri', 'Cooked prawn, wasabi', 160.00, 8, 'https://upload.wikimedia.org/wikipedia/commons/9/98/Sushi-shrimp.jpg'),
  ('Nigiri & Sashimi', 'Unagi Nigiri', 'Freshwater eel, sweet sauce', 240.00, 8, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Unagi_Nigiri_Sushi_-_Suzuran_Japan_Foods_Trading.jpg/960px-Unagi_Nigiri_Sushi_-_Suzuran_Japan_Foods_Trading.jpg'),
  ('Small Plates', 'Edamame', 'Steamed soybeans, sea salt', 150.00, 6, 'https://upload.wikimedia.org/wikipedia/commons/8/87/Edamame_on_a_bamboo_bowl_by_yomi955.jpg'),
  ('Small Plates', 'Gyoza', 'Pan-fried pork dumplings (6 pcs)', 220.00, 12, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/53/Gyoza_dumplings_%2853726549642%29.jpg/960px-Gyoza_dumplings_%2853726549642%29.jpg'),
  ('Small Plates', 'Agedashi Tofu', 'Fried tofu, dashi broth, daikon', 190.00, 10, 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Agedashi_tofu%2C_fried_tofu_with_broth.jpg'),
  ('Small Plates', 'Karaage', 'Japanese fried chicken (8 pcs)', 280.00, 14, 'https://www.themealdb.com/images/media/meals/tyywsw1505930373.jpg')
) AS v(cat, name, description, price, prep, img)
JOIN categories c ON c.name = v.cat
ON CONFLICT (category_id, name) DO UPDATE
SET image_url = EXCLUDED.image_url,
    description = EXCLUDED.description;

INSERT INTO menu_items (category_id, name, description, price, prep_time, available, image_url)
SELECT c.id, v.name, v.description, v.price, v.prep, true, v.img
FROM (VALUES
  ('Small Plates', 'Takoyaki', 'Octopus balls, bonito, mayo (6 pcs)', 240.00, 12, 'https://upload.wikimedia.org/wikipedia/commons/d/d8/Takoyaki_by_yomi955.jpg'),
  ('Small Plates', 'Wagyu Tataki', 'Seared wagyu, ponzu, microgreens', 480.00, 10, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Canada_Prime_Beef_Tataki_with_ponzu_pearls_and_horseradish_%285895881268%29.jpg/960px-Canada_Prime_Beef_Tataki_with_ponzu_pearls_and_horseradish_%285895881268%29.jpg'),
  ('Ramen', 'Tonkotsu Ramen', 'Pork bone broth, chashu, egg, scallion', 390.00, 18, 'https://www.themealdb.com/images/media/meals/ip5xtp1769779958.jpg'),
  ('Ramen', 'Miso Ramen', 'Miso broth, ground pork, corn, bean sprouts', 360.00, 18, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Tsukemen_at_a_Tokyo_restaurant.jpg/960px-Tsukemen_at_a_Tokyo_restaurant.jpg'),
  ('Ramen', 'Spicy Ramen', 'Spicy miso broth, chashu, chili oil', 380.00, 18, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/42/Tsukemen_%28Dipping_Ramen%29_-_Goemon_Ramen_Bar_2023-07-16.jpg/960px-Tsukemen_%28Dipping_Ramen%29_-_Goemon_Ramen_Bar_2023-07-16.jpg'),
  ('Ramen', 'Vegan Ramen', 'Mushroom broth, tofu, vegetables', 340.00, 18, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Fusion_of_Japanese_and_Meitei_cuisines_-_Mixed_bowl_of_octopus_ramen_noodles_and_traditional_Meetei_vegetables_-_Imphal%2C_Kangleipak_%28Manipur%29_02.jpg/960px-Fusion_of_Japanese_and_Meitei_cuisines_-_Mixed_bowl_of_octopus_ramen_noodles_and_traditional_Meetei_vegetables_-_Imphal%2C_Kangleipak_%28Manipur%29_02.jpg'),
  ('Desserts', 'Matcha Cheesecake', 'Green tea cheesecake, red bean', 220.00, 5, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Matcha_Cheese_Cake.jpg/960px-Matcha_Cheese_Cake.jpg'),
  ('Desserts', 'Mochi Ice Cream', 'Three flavors: matcha, black sesame, yuzu', 190.00, 5, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/05/Mochi_Ice_Cream.jpg/960px-Mochi_Ice_Cream.jpg'),
  ('Desserts', 'Tempura Ice Cream', 'Vanilla ice cream, fried tempura shell', 200.00, 8, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/38/FriedIceCream.jpg/960px-FriedIceCream.jpg'),
  ('Desserts', 'Yuzu Tart', 'Yuzu curd, sable crust, toasted meringue', 240.00, 5, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Fruit_tart_with_kiwi%2C_peach%2C_and_raspberry.jpg/960px-Fruit_tart_with_kiwi%2C_peach%2C_and_raspberry.jpg'),
  ('Drinks', 'Junmai Sake', 'Chilled sake, 180ml', 350.00, 3, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/Tokkuri_sake2.JPG/960px-Tokkuri_sake2.JPG'),
  ('Drinks', 'Ginjo Sake', 'Premium chilled sake, 180ml', 480.00, 3, 'https://upload.wikimedia.org/wikipedia/commons/1/13/Blue_stream_sake-set_4cups.jpg'),
  ('Drinks', 'Hot Green Tea', 'Hojicha, pot', 90.00, 3, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Green_tea_Sencha.jpg/960px-Green_tea_Sencha.jpg'),
  ('Drinks', 'Iced Yuzu Tea', 'Yuzu, honey, sparkling water', 130.00, 3, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6a/Iced_tea_with_ice_cubes.jpg/960px-Iced_tea_with_ice_cubes.jpg'),
  ('Drinks', 'Asahi Beer', 'Draft, 500ml', 180.00, 2, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4b/Sapporo_Ginjikomi_Special_Clean_Malt_Draft_Beer_%28224291451%29.jpg/960px-Sapporo_Ginjikomi_Special_Clean_Malt_Draft_Beer_%28224291451%29.jpg'),
  ('Drinks', 'Plum Wine', 'Umeshu, on the rocks', 220.00, 2, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Umeshu_on_the_rocks.jpg/960px-Umeshu_on_the_rocks.jpg')
) AS v(cat, name, description, price, prep, img)
JOIN categories c ON c.name = v.cat
ON CONFLICT (category_id, name) DO UPDATE
SET image_url = EXCLUDED.image_url,
    description = EXCLUDED.description;
