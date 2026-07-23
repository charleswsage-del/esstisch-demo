-- ============================================
-- Esstisch Demo database setup (Supabase / Postgres)
-- Run this whole file once in the new demo project's SQL Editor.
--
-- This is adapted from the real Esstisch app's schema, with two
-- deliberate differences documented in GOVERNANCE.md:
--   1. RLS is split by table role (read-only reference data vs.
--      read-write interactive data) instead of full open access,
--      because this project has a public URL and anonymous visitors.
--   2. A pg_cron job resets the interactive tables to a clean
--      baseline every day, so the demo never accumulates spam and
--      always shows a realistic, populated week.
-- ============================================

-- ---------- schema ----------

create table meals (
  id text primary key,
  name text not null,
  cuisine text,
  complexity int,
  prep_time int,
  cook_time int,
  est_cost numeric,
  health_rating int,
  leftover_friendly text,
  notes text,
  protein_type text,
  recipe_steps text[],
  servings int not null default 4
);

create table ingredients (
  id bigint generated always as identity primary key,
  meal_id text references meals(id) on delete cascade,
  category text,
  name text,
  quantity numeric,
  unit text,
  est_cost numeric,
  notes text
);

create table people (
  id text primary key,
  name text not null,
  initials text not null,
  color text not null,
  role text not null default 'parent' check (role in ('parent', 'kid'))
);

-- Single-row settings table.
create table settings (
  id int primary key default 1,
  family_size int,
  language text not null default 'en',
  constraint settings_single_row check (id = 1)
);

-- One row per day per week. meal_id null = nothing planned yet.
-- cooked_at set = the "mark as cooked" moment; this field IS the meal history.
create table weekly_plan_days (
  id bigint generated always as identity primary key,
  week_start date not null,
  day_key text not null check (day_key in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  meal_id text references meals(id) on delete set null,
  cooked_at timestamptz,
  chosen_by text references people(id),
  unique (week_start, day_key)
);

-- Shopping list check-off state, shared across devices, per week + item.
create table shopping_checked (
  id bigint generated always as identity primary key,
  week_start date not null,
  item_key text not null,
  checked boolean not null default false,
  unique (week_start, item_key)
);

-- Favourites: who likes what. A foreign key into people rather than a
-- hardcoded name list. The real app used a check constraint listing
-- capitalised names, which drifted out of sync with the people table's
-- lowercase ids and silently rejected every favourite (see GOVERNANCE.md).
create table favourites (
  id bigint generated always as identity primary key,
  meal_id text references meals(id) on delete cascade,
  person text not null references people(id),
  unique (meal_id, person)
);

create table meal_ratings (
  id bigint generated always as identity primary key,
  meal_id text references meals(id) on delete cascade,
  person text references people(id),
  ease_rating int check (ease_rating between 1 and 5),
  quality_rating int check (quality_rating between 1 and 5),
  week_start date,
  day_key text,
  created_at timestamptz not null default now()
);

create table week_locks (
  week_start date primary key,
  locked boolean not null default false,
  locked_by text references people(id),
  locked_at timestamptz
);

create table shopping_locks (
  week_start date primary key,
  locked boolean not null default false,
  locked_by text references people(id),
  locked_at timestamptz
);

-- ---------- row level security ----------
-- Reference/configuration tables: read-only for the anon role. A public
-- demo means anonymous visitors, so nothing here should let a visitor
-- vandalise the meal library for the next person to load the page.
-- Interactive tables: full read-write for anon, since trying the
-- planner/shopping-list/favourites/locking features is the whole point.
-- See GOVERNANCE.md for the full reasoning and how this differs from
-- the real app's single open policy.

alter table meals enable row level security;
alter table ingredients enable row level security;
alter table people enable row level security;
alter table settings enable row level security;
alter table weekly_plan_days enable row level security;
alter table shopping_checked enable row level security;
alter table favourites enable row level security;
alter table meal_ratings enable row level security;
alter table week_locks enable row level security;
alter table shopping_locks enable row level security;

create policy "anon read only" on meals for select using (true);
create policy "anon read only" on ingredients for select using (true);
create policy "anon read only" on people for select using (true);
create policy "anon read only" on settings for select using (true);

create policy "anon full access" on weekly_plan_days for all using (true) with check (true);
create policy "anon full access" on shopping_checked for all using (true) with check (true);
create policy "anon full access" on favourites for all using (true) with check (true);
create policy "anon full access" on meal_ratings for all using (true) with check (true);
create policy "anon full access" on week_locks for all using (true) with check (true);
create policy "anon full access" on shopping_locks for all using (true) with check (true);

-- ---------- realtime ----------

alter publication supabase_realtime add table weekly_plan_days;
alter publication supabase_realtime add table shopping_checked;
alter publication supabase_realtime add table people;
alter publication supabase_realtime add table settings;
alter publication supabase_realtime add table favourites;
alter publication supabase_realtime add table meal_ratings;
alter publication supabase_realtime add table week_locks;
alter publication supabase_realtime add table shopping_locks;

-- ---------- seed: meals ----------
-- Real recipe/ingredient data from the original app, not personally
-- identifying, kept as-is because it's the substance worth showing off.

INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('carbonara-pasta', 'Carbonara pasta', 'Italian', 2, 10, 15, 12.1, 5, 'Yes', 'Quick and easy; add veg like broccoli to improve balance');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('home-made-pizza', 'Home made pizza', 'Fusion / Western', 3, 15, 15, 19.8, 6, 'Yes', 'Use wraps for speed; don''t overload toppings');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('burgers', 'Burgers', 'American', 3, 15, 15, 19.5, 5, 'Yes', 'Cook mince well; toast buns for better texture');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('breakky-dinner', 'Breakky dinner', 'Fusion / Western', 2, 10, 10, 11.5, 6, 'No', 'Very fast; good for lazy nights');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('schnitzel-salad', 'Schnitzel + salad', 'European', 3, 15, 20, 14.5, 7, 'Partial', 'Balance of protein and veg; oven chips optional');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('mixed-rice-bowl', 'Mixed rice bowl', 'Fusion / Asian', 2, 15, 15, 20.7, 8, 'Yes', 'Very flexible; great for using leftovers');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('lanzhou-noodles', 'Lanzhou noodles', 'Chinese', 4, 20, 60, 27.8, 7, 'Yes', 'Best flavour from slow-cooked broth; batch cook');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('beef-mince-stir-fry', 'Beef mince stir fry', 'Fusion / Asian', 2, 10, 15, 15.2, 7, 'Yes', 'Quick weeknight staple; add whatever veg you have on hand');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('seaweed-tofu-soup', 'Seaweed / tofu soup', 'Korean', 2, 10, 20, 19.4, 8, 'Yes', 'Very light and nutritious; miso paste works as a shortcut base');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('taco-bowls', 'Taco bowls', 'Mexican', 2, 15, 15, 21, 7, 'Yes', 'Easy to customise per person; lay out toppings buffet-style');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('chili-con-carne', 'Chili con carne', 'Mexican', 3, 15, 45, 19.4, 7, 'Yes', 'Better the next day; batch-cook and freeze portions');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('chicken-salad-wraps', 'Chicken salad wraps', 'Fusion / Western', 1, 15, 0, 15.3, 8, 'No', 'Great for using leftover chicken; keep dressing separate until serving');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('chicken-noodle-soup', 'Chicken noodle soup', 'Asian', 3, 15, 30, 13.8, 8, 'Yes', 'Use a rotisserie chicken to save time; add ginger for flavour');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('fried-rice', 'Fried rice', 'Asian', 2, 10, 15, 11, 6, 'No', 'Best with day-old rice; good fridge-clean-out meal');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('tuna-burgers', 'Tuna burgers', 'Fusion / Western', 2, 15, 10, 11.7, 7, 'No', 'Canned tuna works well; add capers or lemon for brightness');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('fried-chicken', 'Fried chicken', 'American', 3, 15, 25, 33.2, 5, 'Yes', 'Marinate in buttermilk if time allows; oven-bake for healthier version');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('salmon-pesto-pasta', 'Salmon + pesto pasta', 'Italian', 2, 10, 15, 23.1, 8, 'No', 'Use fresh or frozen salmon; jarred pesto works great');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('rice-cake-dumplings', 'Rice cake + dumplings', 'Korean', 2, 10, 20, 21.5, 6, 'No', 'Tteokbokki-style; use frozen dumplings to keep it simple');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('japanese-curry', 'Japanese curry', 'Japanese', 2, 15, 30, 17.3, 7, 'Yes', 'Use S&B curry roux blocks for authenticity; great batch meal');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('roast-chicken-rosti', 'Roast Chicken & Rosti', 'European', 3, 20, 60, 26.4, 7, 'Yes', 'Great weekend meal; rosti can be made ahead and reheated');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('zuppa-toscana', 'Zuppa Toscana', 'Italian', 2, 15, 30, 24, 7, 'Yes', 'Creamy and hearty; Italian sausage and potato make it very kid-friendly');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('korean-bbq', 'Korean BBQ', 'Korean', 3, 20, 20, 26.8, 7, 'No', NULL);
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('onigiri-steamed-egg', 'Onigiri & Steamed Egg', 'Japanese', 2, 20, 15, 15.7, 7, 'No', 'Fun to make with kids; fillings can be customised per person');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('mapo-tofu', 'Mapo tofu', 'Chinese', 3, 10, 20, 15.7, 7, 'Yes', 'Bold and spicy; use less chilli bean paste for a kid-friendly version');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('roast-chicken-veggies', 'Roast Chicken & Veggies', 'European', 2, 15, 45, 20.6, 8, 'Yes', 'Simple and healthy; onion gravy ties it all together; great Sunday meal');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('ramen', 'Ramen', 'Korean / Japanese', 1, 10, 10, 16.3, 6, 'No', 'Top with soft boiled egg, kimchi, corn and ham for an easy upgrade');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('udon', 'Udon', 'Japanese', 2, 10, 15, 35.8, 7, 'No', 'Use pre-cooked udon packets for speed');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('onigiri', 'Onigiri', 'Japanese', 1, 20, 0, 11.8, 7, 'No', 'Great light meal or lunchbox option; kids love shaping them');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('steamed-egg-w-dumplings', 'Steamed egg w/ dumplings', 'Korean / Japanese', 2, 15, 20, 15.1, 7, 'No', 'Silky steamed egg with frozen dumplings on the side; kid-friendly and quick');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('sushi-rolls', 'Sushi rolls', 'Japanese', 4, 30, 0, 16.2, 8, 'No', 'Use a bamboo mat for rolling; great activity to do together as a family');
INSERT INTO meals (id, name, cuisine, complexity, prep_time, cook_time, est_cost, health_rating, leftover_friendly, notes) VALUES ('rice-paper-rolls', 'Rice paper rolls', 'Vietnamese', 3, 25, 0, 22.6, 9, 'No', 'Fresh and light; lay out ingredients buffet-style so everyone rolls their own');

-- ---------- seed: ingredients ----------

INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Sauce', 'Carbonara sauce', 1, 'jar', 3.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Carbs', 'Spaghetti', 500, 'grams', 1.2, 'Or alternate pasta');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Meat', 'Bacon', 300, 'grams', 5.5, 'Or whatever sort of ham');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, 'Side dish');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Pantry', 'Butter', 30, 'grams', 0.5, 'To make a roux base for the sauce, NR if jar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('carbonara-pasta', 'Pantry', 'Flour', 2, 'tbsp', 0.2, 'Combined with butter to thicken sauce, NR if jar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Carbs', 'Wraps', 4, 'wraps', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Sauce', 'Tomato sauce', 1, 'jar', 1.8, 'Or BBQ');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Meat', 'Ham', 200, 'grams', 4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Canned', 'Pineapple', 1, 'can', 1.5, 'Sliced');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Meat', 'Salami', 100, 'grams', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Vegetable', 'Capsicum', 1, 'each', 1.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('home-made-pizza', 'Dairy', 'Mozzarella cheese', 500, 'grams', 6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Carbs', 'Burger buns', 4, 'buns', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Meat', 'Mince', 500, 'grams', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Dairy', 'Sliced cheese', 4, 'slices', 2, 'American');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Vegetable', 'Tomato', 1, 'each', 0.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Sauce', 'Tomato sauce', 1, 'bottle', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('burgers', 'Frozen', 'Frozen potato chips', 500, 'grams', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('breakky-dinner', 'Canned', 'Baked beans', 400, 'grams', 1.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('breakky-dinner', 'Fruit', 'Avocado', 1, 'each', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('breakky-dinner', 'Meat', 'Bacon', 200, 'grams', 4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('breakky-dinner', 'Dairy', 'Eggs', 4, 'each', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('breakky-dinner', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('schnitzel-salad', 'Meat', 'Chicken schnitzel', 4, 'pieces', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('schnitzel-salad', 'Vegetable', 'Sweet potato', 2, 'each', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('schnitzel-salad', 'Vegetable', 'Salad', 200, 'grams', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('schnitzel-salad', 'Vegetable', 'Cucumber', 1, 'each', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('schnitzel-salad', 'Vegetable', 'Tomato', 1, 'each', 0.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Carbs', 'Rice', 4, 'cups', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Vegetable', 'Cucumber', 1, 'each', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Vegetable', 'Tomato', 1, 'each', 0.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Canned', 'Corn', 1, 'can', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Vegetable', 'Salad', 200, 'grams', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Canned', 'Tuna', 2, 'can', 4.0, '185g cans, tinned');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Meat', 'Mince', 500, 'grams', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mixed-rice-bowl', 'Vegetable', 'Chilli', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Carbs', 'Rice noodles', 500, 'grams', 3, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Meat', 'Beef brisket', 600, 'grams', 12, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Vegetable', 'Ginger', 50, 'grams', 0.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Vegetable', 'Garlic', 4, 'cloves', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Vegetable', 'Green onion', 100, 'grams', 1.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Sauce', 'Soy sauce', 1, 'bottle', 3, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Vegetable', 'Spinach', 200, 'grams', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Sauce', 'Chilli oil', 1, 'jar', 4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('lanzhou-noodles', 'Pantry', 'Beef stock', 2, 'cube', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Meat', 'Mince', 500, 'grams', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Sauce', 'Soy sauce', 3, 'tbsp', 0.5, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Vegetable', 'Garlic', 3, 'cloves', 0.4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Sauce', 'Sesame oil', 1, 'tbsp', 0.5, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Vegetable', 'Capsicum', 1, 'each', 1.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Carbs', 'Rice', 4, 'cups', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('beef-mince-stir-fry', 'Vegetable', 'Carrot', 2, 'each', 0.6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Vegetable', 'Seaweed', 30, 'grams', 2.5, 'Dried; rehydrate before use');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Meat', 'Steak', 300, 'grams', 8, 'Or beef slices');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Sauce', 'Sesame oil', 1, 'tbsp', 0.5, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Sauce', 'Soy sauce', 2, 'tbsp', 0.4, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Dairy', 'Soft tofu', 300, 'grams', 2.5, 'Silken works well');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Dairy', 'Eggs', 2, 'each', 1, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Vegetable', 'Chilli', 1, 'each', 0.5, 'Or chilli flakes');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('seaweed-tofu-soup', 'Meat', 'Mince', 250, 'grams', 4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Meat', 'Mince', 500, 'grams', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Vegetable', 'Carrot', 1, 'each', 0.3, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Pantry', 'Taco seasoning', 1, 'sachet', 1.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Carbs', 'Rice', 4, 'cups', 2, 'Or skip for lower carb');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Vegetable', 'Salad', 200, 'grams', 2, 'Mixed leaves');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Canned', 'Corn', 1, 'can', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Dairy', 'Mozzarella cheese', 200, 'grams', 2.5, 'Or cheddar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Vegetable', 'Chilli', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('taco-bowls', 'Fruit', 'Avocado', 1, 'each', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Meat', 'Mince', 500, 'grams', 8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Vegetable', 'Carrot', 2, 'each', 0.6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Vegetable', 'Garlic', 3, 'cloves', 0.4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Sauce', 'Tomato paste', 2, 'tbsp', 0.5, 'From tube');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Pantry', 'Beef stock', 2, 'cube', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Canned', 'Can tomatoes', 1, 'can', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Canned', 'Kidney beans', 1, 'can', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Vegetable', 'Salad', 200, 'grams', 2, 'Side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Snack', 'Corn chips', 1, 'bag', 2.5, 'For serving');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chili-con-carne', 'Carbs', 'Rice', 4, 'cups', 2, 'Or serve with chips only');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Meat', 'Chicken', 400, 'grams', 6, 'Breast or leftover rotisserie');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Carbs', 'Wraps', 4, 'wraps', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Vegetable', 'Salad', 200, 'grams', 2, 'Mixed leaves');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Vegetable', 'Carrot', 2, 'each', 0.6, 'Grated works well');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Fruit', 'Avocado', 1, 'each', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.5, 'From jar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-salad-wraps', 'Vegetable', 'Cucumber', 1, 'each', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Vegetable', 'Garlic', 3, 'cloves', 0.4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Vegetable', 'Carrot', 2, 'each', 0.6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Vegetable', 'Celery', 2, 'stalks', 0.8, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Meat', 'Chicken breast', 500, 'grams', 7, 'Or thighs');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Pantry', 'Chicken broth', 1, 'litre', 2.5, 'Or stock cubes');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('chicken-noodle-soup', 'Carbs', 'Egg noodle', 200, 'grams', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-rice', 'Vegetable', 'Kimchi', 200, 'grams', 3.5, 'Adds great flavour');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-rice', 'Meat', 'Diced Ham', 200, 'grams', 3.5, 'Or bacon');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-rice', 'Dairy', 'Eggs', 3, 'each', 1.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-rice', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-rice', 'Carbs', 'Rice', 4, 'cups', 2, 'Day-old rice preferred');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Carbs', 'Burger buns', 4, 'buns', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Canned', 'Tuna', 2, 'can', 4, '185g cans');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.5, 'From jar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Vegetable', 'Salad', 100, 'grams', 1, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Vegetable', 'Cucumber', 1, 'each', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('tuna-burgers', 'Frozen', 'Frozen potato chips', 500, 'grams', 2.5, 'Frozen oven chips');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Meat', 'Chicken tenderloins', 900, 'grams', 14, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Dairy', 'Buttermilk', 500, 'ml', 2.5, 'Or regular milk + 1 tbsp lemon juice');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Sauce', 'Hot sauce', 2, 'tbsp', 0.5, 'Frank''s or similar; add to marinade');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Plain flour', 300, 'grams', 0.8, 'For double dredge');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Cornstarch', 50, 'grams', 0.5, 'Adds extra crunch to coating');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Smoked paprika', 2, 'tsp', 0.3, 'From pantry');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Garlic powder', 2, 'tsp', 0.3, 'From pantry');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Cayenne pepper', 2, 'tsp', 0.3, 'Adults'' spice sauce only');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Brown sugar', 1, 'tbsp', 0.2, 'For spicy butter sauce');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Salt and pepper', 1, 'pinch', 0.1, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Pantry', 'Neutral oil', 800, 'ml', 3, 'Sunflower or vegetable oil for frying');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Dairy', 'Butter', 50, 'grams', 0.8, 'For finishing spicy sauce');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Dairy', 'Blue cheese', 100, 'grams', 3.5, 'Gorgonzola or Roquefort work well');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Dairy', 'Sour cream', 100, 'grams', 1.2, 'Base for blue cheese sauce');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.4, 'Adds creaminess to blue cheese sauce');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Fruit', 'Lemon', 1, 'each', 0.6, 'Juice for blue cheese sauce');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Frozen', 'Frozen potato chips', 750, 'grams', 3, 'Oven fries; McCain or similar');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('fried-chicken', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, 'Side dish');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Meat', 'Salmon fillet', 600, 'grams', 12, 'Fresh or frozen; see note below');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Carbs', 'Pasta', 500, 'grams', 1.8, 'Penne or fusilli work well');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Sauce', 'Pesto', 1, 'jar', 3.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Dairy', 'Parmesan', 50, 'grams', 1.5, 'Optional but recommended');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Vegetable', 'Cherry tomatoes', 200, 'grams', 2, 'Adds freshness and colour');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Sauce', 'Olive oil', 1, 'tbsp', 0.3, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('salmon-pesto-pasta', 'Carbs', 'Garlic bread', 1, 'loaf', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Meat', 'Mince', 400, 'grams', 6.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Carbs', 'Rice cake', 400, 'grams', 4.5, 'Frozen or vacuum packed; tteok style');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Carrot', 1, 'each', 0.3, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Garlic', 3, 'cloves', 0.4, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Mushroom', 150, 'grams', 2, 'Shiitake or button');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Chilli', 1, 'each', 0.5, 'Or chilli flakes');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Vegetable', 'Green onion', 3, 'stalks', 0.8, 'Garnish and stir fry');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Sauce', 'Oyster sauce', 2, 'tbsp', 0.5, 'From bottle');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-cake-dumplings', 'Frozen', 'Frozen dumplings', 1, 'packet', 5.5, 'Pork or vegetable; 20-pack');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Pantry', 'Curry mix', 1, 'box', 3.5, 'S&B Golden Curry recommended');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Vegetable', 'Carrot', 2, 'each', 0.6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Vegetable', 'Potato', 3, 'each', 1.5, 'Waxy variety holds shape better');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, 'Add in last 5 mins to keep texture');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Carbs', 'Rice', 4, 'cups', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('japanese-curry', 'Meat', 'Chicken/pork schnitzel', 4, 'pieces', 8, 'Pre-crumbed; slice and serve on top');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Meat', 'Chicken breast', 4, 'pieces', 12, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Sweet potato', 4, 'each', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Carrot', 3, 'each', 0.9, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Garlic', 4, 'cloves', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Brussel sprouts', 300, 'grams', 2.5, 'Halve before roasting');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Vegetable', 'Mushroom', 200, 'grams', 2.5, 'Button or cremini');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Sauce', 'Gravy', 1, 'sachet', 1.5, 'Or make from pan juices');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-rosti', 'Frozen', 'Rosti', 4, 'pieces', 4, 'Frozen; or make from grated potato');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Meat', 'Italian sausage', 400, 'grams', 6.5, 'Mild for kids; spicy optional for adults');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Dairy', 'Butter', 30, 'grams', 0.5, 'For sautéing');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Vegetable', 'Garlic', 4, 'cloves', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Pantry', 'Chicken stock', 1, 'litre', 2.5, 'Or 2 stock cubes');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Vegetable', 'Potato', 3, 'each', 1.5, 'Waxy variety holds shape better');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Dairy', 'Heavy cream', 200, 'ml', 2, 'Or substitute sour cream');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Vegetable', 'Kale', 200, 'grams', 2, 'Add in last 5 mins; or use spinach');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Meat', 'Bacon', 150, 'grams', 3, 'Adds smokiness; optional');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Dairy', 'Parmesan cheese', 50, 'grams', 1.5, 'For serving');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('zuppa-toscana', 'Carbs', 'Garlic bread', 1, 'loaf', 3.5, 'Store-bought is fine');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Meat', 'Pork belly', 600, 'grams', 10, 'Sliced thin; ask at the deli or buy pre-sliced');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Dairy', 'Eggs', 4, 'each', 2, 'Fried or scrambled as a side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Vegetable', 'Mushroom', 200, 'grams', 2.5, 'Shiitake preferred; button works too');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Carbs', 'Rice', 4, 'cups', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Sauce', 'Ssamjang', 1, 'jar', 4.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Sauce', 'Sesame oil', 1, 'tbsp', 0.5, 'From bottle; for dipping and finishing');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Vegetable', 'Kimchi', 200, 'grams', 3.5, 'Side dish; store-bought is fine');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Vegetable', 'Cucumber', 1, 'each', 1.2, 'Sliced as a fresh side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('korean-bbq', 'Vegetable', 'Carrot', 2, 'each', 0.6, 'Julienned as a fresh side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Dairy', 'Eggs', 4, 'each', 2, 'Steamed or soft boiled');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Carbs', 'Rice', 4, 'cups', 2, 'Short grain Japanese rice works best for shaping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Canned', 'Tuna', 1, 'can', 2, '185g; drain well before mixing');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.5, 'Mix with tuna for filling');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Vegetable', 'Cucumber', 1, 'each', 1.2, 'Sliced as a side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Fruit', 'Avocado', 1, 'each', 2.5, 'Optional filling or side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Pantry', 'Seaweed wrap', 1, 'packet', 3, 'Nori sheets; cut into strips for wrapping onigiri');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Meat', 'Ham', 100, 'grams', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri-steamed-egg', 'Sauce', 'Sesame oil', 1, 'tbsp', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Sauce', 'Mapo tofu sauce', 1, 'jar', 4.5, 'Lee Kum Kee or similar; available at Asian grocery stores');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Dairy', 'Firm tofu', 400, 'grams', 2.5, 'Press gently before cubing to remove excess water');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Meat', 'Mince', 300, 'grams', 5, 'Pork preferred; beef works too');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Carbs', 'Rice', 4, 'cups', 2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('mapo-tofu', 'Vegetable', 'Cucumber', 1, 'each', 1.2, 'Fresh side dish');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Meat', 'Chicken breast', 4, 'pieces', 12, 'Or thighs for more flavour');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Vegetable', 'Potato', 4, 'each', 2, 'Halve and roast alongside chicken');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Vegetable', 'Carrot', 3, 'each', 0.9, 'Cut into chunks');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Vegetable', 'Brussel sprouts', 300, 'grams', 2.5, 'Halve before roasting');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Vegetable', 'Onion', 1, 'each', 0.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Vegetable', 'Broccoli', 200, 'grams', 1.2, 'Side dish');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('roast-chicken-veggies', 'Sauce', 'Onion gravy', 1, 'sachet', 1.5, 'Or make from pan juices');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Carbs', 'Instant ramen', 4, 'packet', 6, 'Mild version; adjust spice to taste');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Dairy', 'Eggs', 4, 'each', 2, 'Soft boil for 6-7 mins; marinate in soy if time allows');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Vegetable', 'Kimchi', 200, 'grams', 3.5, 'Side dish and topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Vegetable', 'Green onion', 3, 'stalks', 0.8, 'Sliced for topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Canned', 'Corn', 1, 'can', 1.2, 'Drained; classic ramen topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Meat', 'Deli ham', 150, 'grams', 2.5, 'Sliced; or use leftover pork');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('ramen', 'Sauce', 'Soy sauce', 1, 'tbsp', 0.3, 'For egg marinade; optional');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Carbs', 'Udon noodles', 4, 'packet', 5, 'Pre-cooked packets');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Pantry', 'Udon broth', 4, 'sachet', 4, 'Come with noodle packets or buy separately');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Pantry', 'Naruto', 1, 'packet', 3.5, 'Fish cake slices; available at Asian grocery stores');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Dairy', 'Eggs', 4, 'each', 2, 'Soft boiled; 6-7 mins');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Frozen', 'Gyoza', 1, 'packet', 5.5, 'Pan fry as a side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Vegetable', 'Edamame', 200, 'grams', 2.5, 'Frozen; boil from frozen');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Vegetable', 'Green onion', 3, 'stalks', 0.8, 'Sliced for topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Pantry', 'Nori', 1, 'packet', 2.5, 'Cut into strips for topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Vegetable', 'Corn cobs', 2, 'each', 1.5, 'Halve before boiling; kids love these');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Vegetable', 'Kimchi', 200, 'grams', 3.5, 'Serve straight from the jar as a side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('udon', 'Frozen', 'Frozen tempura vegetables', 1, 'packet', 5, 'Oven bake; available at Asian grocery stores');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Carbs', 'Rice', 4, 'cups', 2, 'Short grain Japanese rice preferred');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Pantry', 'Seaweed wraps', 1, 'packet', 3, 'Nori sheets; cut into strips');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Vegetable', 'Cucumber', 1, 'each', 1.2, 'Sliced as a side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Fruit', 'Avocado', 1, 'each', 2.5, 'Filling or side');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Canned', 'Tuna', 1, 'can', 2, '185g; drain and mix with mayo');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.5, 'Mix with tuna for filling');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('onigiri', 'Vegetable', 'Carrot', 2, 'each', 0.6, 'Julienned as a side or filling');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('steamed-egg-w-dumplings', 'Dairy', 'Eggs', 12, 'each', 6, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('steamed-egg-w-dumplings', 'Dairy', 'Milk', 100, 'ml', 0.3, 'Adds creaminess to steamed egg');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('steamed-egg-w-dumplings', 'Vegetable', 'Green onion', 3, 'stalks', 0.8, 'Sliced for topping');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('steamed-egg-w-dumplings', 'Frozen', 'Frozen dumplings', 1, 'packet', 5.5, 'Pork or vegetable; steam or pan fry');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('steamed-egg-w-dumplings', 'Vegetable', 'Broccolini', 200, 'grams', 2.5, 'Steam alongside dumplings');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Carbs', 'Rice', 4, 'cups', 2, 'Short grain Japanese rice');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Vegetable', 'Cucumber', 1, 'each', 1.2, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Fruit', 'Avocado', 2, 'each', 5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Pantry', 'Sushi wraps', 1, 'packet', 3, 'Nori sheets');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Pantry', 'Sushi rice vinegar', 100, 'ml', 2.5, 'Seasoned rice vinegar for sushi rice');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Canned', 'Tuna', 1, 'can', 2, '185g; or use fresh sashimi-grade if available');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('sushi-rolls', 'Sauce', 'Mayonnaise', 2, 'tbsp', 0.5, 'Mix with tuna for filling');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Vegetable', 'Capsicum', 1, 'each', 1.5, 'Sliced into thin strips');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Vegetable', 'Cucumber', 1, 'each', 1.2, 'Julienned');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Fruit', 'Apple', 1, 'each', 0.8, 'Thinly sliced for crunch and sweetness');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Fruit', 'Pineapple', 200, 'grams', 2.5, 'Fresh or canned, sliced thin');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Vegetable', 'Cabbage', 200, 'grams', 1, 'Shredded');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Fruit', 'Avocado', 1, 'each', 2.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Vegetable', 'Salad', 100, 'grams', 1, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Vegetable', 'Carrot', 2, 'each', 0.6, 'Julienned');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Pantry', 'Rice paper sheets', 1, 'packet', 3.5, NULL);
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Carbs', 'Vermicelli', 200, 'grams', 2, 'Rice noodles; soak before use');
INSERT INTO ingredients (meal_id, category, name, quantity, unit, est_cost, notes) VALUES ('rice-paper-rolls', 'Meat', 'Chicken breast', 300, 'grams', 6, 'Or shrimp; poach or grill and slice thin');

-- ---------- seed: people ----------
-- Four generic demo identities, matching the real app's two-parent/two-kid
-- shape so favourites-by-person, ratings, and the parent/kid RBAC all have
-- something real to demonstrate. Passwords are set separately via
-- VITE_APP_USERS (see .env.example); these ids just need to match exactly.

INSERT INTO people (id, name, initials, color, role) VALUES
  ('person1', 'Person One', 'P1', '#3F6B4A', 'parent'),
  ('person2', 'Person Two', 'P2', '#C08A2E', 'parent'),
  ('person3', 'Person Three', 'P3', '#5C7A99', 'kid'),
  ('person4', 'Person Four', 'P4', '#8C6BAA', 'kid');

INSERT INTO settings (id, family_size, language) VALUES (1, 4, 'en');

-- ---------- daily reset ----------
-- Restores the interactive tables to a realistic, populated baseline,
-- computed relative to CURRENT_DATE so the demo always shows "this week"
-- and "last week", never a stale hardcoded date. Safe to re-run manually
-- at any time from the SQL Editor.

create or replace function reset_demo_data()
returns void
language plpgsql
as $$
declare
  this_week date := date_trunc('week', current_date)::date;
  last_week date := this_week - 7;
begin
  delete from weekly_plan_days;
  delete from shopping_checked;
  delete from favourites;
  delete from meal_ratings;
  delete from week_locks;
  delete from shopping_locks;

  -- this week: two meals already cooked, two more planned, rest left open
  -- so a visitor can try planning/shuffling an empty day
  insert into weekly_plan_days (week_start, day_key, meal_id, cooked_at, chosen_by) values
    (this_week, 'monday', 'carbonara-pasta', this_week + interval '18 hours', 'person1'),
    (this_week, 'tuesday', 'taco-bowls', this_week + interval '1 day 18 hours 30 minutes', 'person2'),
    (this_week, 'wednesday', 'japanese-curry', null, 'person1'),
    (this_week, 'thursday', 'roast-chicken-veggies', null, 'person2');

  -- last week: fully cooked and locked, showing off the report tab's trend
  -- and the parent-only week lock
  insert into weekly_plan_days (week_start, day_key, meal_id, cooked_at, chosen_by) values
    (last_week, 'monday', 'burgers', last_week + interval '18 hours', 'person1'),
    (last_week, 'tuesday', 'fried-rice', last_week + interval '1 day 18 hours', 'person2'),
    (last_week, 'wednesday', 'chili-con-carne', last_week + interval '2 days 18 hours', 'person1'),
    (last_week, 'thursday', 'zuppa-toscana', last_week + interval '3 days 18 hours', 'person2'),
    (last_week, 'friday', 'salmon-pesto-pasta', last_week + interval '4 days 18 hours 30 minutes', 'person1');

  insert into week_locks (week_start, locked, locked_by, locked_at) values
    (last_week, true, 'person1', last_week + interval '5 days');
  insert into shopping_locks (week_start, locked, locked_by, locked_at) values
    (last_week, true, 'person1', last_week + interval '5 days');

  -- favourites spread across all four people
  insert into favourites (meal_id, person) values
    ('carbonara-pasta', 'person1'), ('salmon-pesto-pasta', 'person1'), ('japanese-curry', 'person1'),
    ('zuppa-toscana', 'person2'), ('roast-chicken-veggies', 'person2'), ('mapo-tofu', 'person2'),
    ('burgers', 'person3'), ('tuna-burgers', 'person3'), ('fried-chicken', 'person3'),
    ('taco-bowls', 'person4'), ('sushi-rolls', 'person4'), ('onigiri', 'person4');

  -- ratings for the cooked meals, this week and last
  insert into meal_ratings (meal_id, person, ease_rating, quality_rating, week_start, day_key) values
    ('carbonara-pasta', 'person1', 4, 5, this_week, 'monday'),
    ('carbonara-pasta', 'person3', 5, 4, this_week, 'monday'),
    ('taco-bowls', 'person2', 5, 5, this_week, 'tuesday'),
    ('taco-bowls', 'person4', 4, 5, this_week, 'tuesday'),
    ('burgers', 'person3', 5, 5, last_week, 'monday'),
    ('fried-rice', 'person1', 4, 4, last_week, 'tuesday'),
    ('chili-con-carne', 'person2', 3, 5, last_week, 'wednesday'),
    ('zuppa-toscana', 'person1', 3, 4, last_week, 'thursday'),
    ('salmon-pesto-pasta', 'person2', 4, 5, last_week, 'friday');

  -- a few shopping list items already checked off for this week, so the
  -- "hide checked" toggle has something to demonstrate
  insert into shopping_checked (week_start, item_key, checked) values
    (this_week, 'Vegetable|Onion|each', true),
    (this_week, 'Vegetable|Carrot|each', true),
    (this_week, 'Carbs|Rice|cups', true),
    (this_week, 'Pantry|Butter|grams', true);
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. Without
-- this, anyone holding the public anon key (everyone, by design) could
-- call this function directly via /rest/v1/rpc/reset_demo_data instead
-- of waiting for the scheduled job. Only pg_cron should ever run this.
revoke execute on function reset_demo_data() from public, anon, authenticated;

select reset_demo_data();

-- ============================================
-- pg_cron scheduling. Run this block AFTER enabling the pg_cron
-- extension (Database -> Extensions -> pg_cron, in the Supabase
-- dashboard; this can't be done from SQL). If you run it before
-- enabling the extension it will error; just re-run this block
-- once pg_cron is on. Re-runnable any time.
-- ============================================

select cron.schedule(
  'esstisch-demo-daily-reset',
  '0 4 * * *', -- 04:00 UTC daily, a low-traffic window
  $$select reset_demo_data();$$
);
