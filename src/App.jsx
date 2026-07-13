import React, { useState, useEffect, useMemo, useCallback } from "react";
import { BookOpen, CalendarDays, ShoppingCart, Settings as SettingsIcon, X, Search, ChevronLeft, ChevronRight, Clock, Check, ChefHat, Flame, Sparkles, Shuffle, Heart, BarChart3, Pencil, Copy, Star, Lock, Unlock, Eye, EyeOff, WifiOff } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { supabase } from "./supabaseClient";

// ---------- thresholds (Phase 2: adjustable later, hardcoded for now) ----------
const FREQUENT_WINDOW_DAYS = 21;
const FREQUENT_MIN_COUNT = 2;
const OVERDUE_MIN_DAYS = 56;
const IDENTITY_KEY = "esstisch-identity";
const UNLOCKED_KEY = "esstisch-unlocked";

// Explicit per-cuisine colors (not a hash) so the same origin always gets the
// same color and two different origins never collide on one swatch.
const CUISINE_COLOR_MAP = {
  Italian: "#B23A2E", American: "#C08A2E", Chinese: "#D6455A", European: "#5C7A99",
  "Fusion / Asian": "#8C6BAA", "Fusion / Western": "#A2761F", Japanese: "#3F6B4A",
  Korean: "#4A7FBF", "Korean / Japanese": "#6B8E6E", Mexican: "#DB6B2F",
  Vietnamese: "#2E9E8F", Asian: "#9A5FA8",
};
const CUISINE_FALLBACK_COLORS = ["#3F6B4A", "#C08A2E", "#B23A2E", "#5C7A99", "#8C6BAA"];
function cuisineColor(cuisine) {
  if (CUISINE_COLOR_MAP[cuisine]) return CUISINE_COLOR_MAP[cuisine];
  let h = 0;
  for (let i = 0; i < cuisine.length; i++) h = (h * 31 + cuisine.charCodeAt(i)) % 997;
  return CUISINE_FALLBACK_COLORS[h % CUISINE_FALLBACK_COLORS.length];
}
function healthColor(rating) {
  if (rating >= 8) return { bg: "#EAF1EC", fg: "#3F6B4A" };
  if (rating >= 5) return { bg: "#F7EEDD", fg: "#A2761F" };
  return { bg: "#F5E7E4", fg: "#B23A2E" };
}
function fmtCHF(n) {
  return "CHF " + (Math.round(n * 20) / 20).toFixed(2);
}
function daysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
// scale factor for a meal given the household's target family size vs the
// meal's own base servings (e.g. a 6-serving soup scaled to a family of 4 = 4/6)
function scaleFactor(meal, familySize) {
  if (!familySize || !meal?.servings) return 1;
  return familySize / meal.servings;
}

const DAYS = [
  { key: "monday", label: "Mon", full: "Monday" },
  { key: "tuesday", label: "Tue", full: "Tuesday" },
  { key: "wednesday", label: "Wed", full: "Wednesday" },
  { key: "thursday", label: "Thu", full: "Thursday" },
  { key: "friday", label: "Fri", full: "Friday" },
  { key: "saturday", label: "Sat", full: "Saturday" },
  { key: "sunday", label: "Sun", full: "Sunday" },
];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function fmtWeekRange(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const startStr = monday.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const endStr = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${startStr} – ${endStr}`;
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function ComplexityDots({ level }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: i <= level ? "#8A8071" : "#E8E1D4" }} />
      ))}
    </span>
  );
}
function HealthPill({ rating }) {
  const c = healthColor(rating);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: c.bg, color: c.fg }} title="Health rating">
      <Heart size={10} fill={c.fg} strokeWidth={0} /> {rating}/10
    </span>
  );
}
function RotationBadge({ stats }) {
  if (!stats) return null;
  if (stats.frequent) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F5E7E4", color: "#B23A2E" }}>
        <Flame size={11} /> in heavy rotation
      </span>
    );
  }
  if (stats.overdue) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#EAF1EC", color: "#3F6B4A" }}>
        <Sparkles size={11} /> haven't had this in a while
      </span>
    );
  }
  return null;
}
function PersonAvatar({ person, size = 26 }) {
  if (!person) return null;
  return (
    <span className="inline-flex items-center justify-center rounded-full font-bold shrink-0" style={{ width: size, height: size, backgroundColor: person.color, color: "#fff", fontSize: size * 0.4 }}>
      {person.initials}
    </span>
  );
}

const PROTEIN_LABELS = {
  red_meat: { emoji: "🥩", label: "red meat" },
  poultry: { emoji: "🍗", label: "poultry" },
  fish: { emoji: "🐟", label: "fish" },
  vegetarian: { emoji: "🥦", label: "vegetarian" },
};

// ---------- data loading ----------
async function fetchMeals() {
  const { data: meals, error: e1 } = await supabase.from("meals").select("*").order("name");
  if (e1) throw e1;
  const { data: ingredients, error: e2 } = await supabase.from("ingredients").select("*");
  if (e2) throw e2;
  const byMeal = {};
  ingredients.forEach((ing) => {
    if (!byMeal[ing.meal_id]) byMeal[ing.meal_id] = [];
    byMeal[ing.meal_id].push({ category: ing.category, name: ing.name, quantity: ing.quantity, unit: ing.unit, estCost: ing.est_cost, notes: ing.notes });
  });
  return meals.map((m) => ({
    id: m.id, name: m.name, cuisine: m.cuisine, complexity: m.complexity, prepTime: m.prep_time, cookTime: m.cook_time,
    estCost: m.est_cost, healthRating: m.health_rating, leftoverFriendly: m.leftover_friendly, notes: m.notes,
    proteinType: m.protein_type, servings: m.servings || 4, recipeSteps: m.recipe_steps || [],
    ingredients: byMeal[m.id] || [],
  }));
}

function upsertRow(rows, row, idField = "id") {
  const idx = rows.findIndex((r) => r[idField] === row[idField]);
  if (idx === -1) return [...rows, row];
  const next = [...rows];
  next[idx] = row;
  return next;
}
function removeRow(rows, row, idField = "id") {
  return rows.filter((r) => r[idField] !== row[idField]);
}

// Offline support: mirror the last successful fetch into localStorage so the
// app (and specifically the shopping list) still shows real data with zero
// signal — e.g. standing in a supermarket aisle. This is deliberately a full
// snapshot in one key, not per-table caching, to keep this simple.
const OFFLINE_CACHE_KEY = "esstisch-offline-cache";
function saveOfflineCache(data) {
  try { localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify({ ...data, cachedAt: new Date().toISOString() })); } catch {}
}
function loadOfflineCache() {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(UNLOCKED_KEY) === "true");
  const [view, setView] = useState("plan");
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [allPlanDays, setAllPlanDays] = useState([]);
  const [allChecked, setAllChecked] = useState([]);
  const [allFavourites, setAllFavourites] = useState([]);
  const [allWeekLocks, setAllWeekLocks] = useState([]);
  const [allShoppingLocks, setAllShoppingLocks] = useState([]);
  const [allRatings, setAllRatings] = useState([]);
  const [people, setPeople] = useState([]);
  const [settings, setSettings] = useState({ family_size: null, language: "en" });
  const [weekMonday, setWeekMonday] = useState(() => getMonday(new Date()));
  const [pickerDay, setPickerDay] = useState(null);
  const [detailMeal, setDetailMeal] = useState(null);
  const [search, setSearch] = useState("");
  const [cuisineFilter, setCuisineFilter] = useState("All");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [editingMeal, setEditingMeal] = useState(null);
  const [ratingPrompt, setRatingPrompt] = useState(null);
  const [identity, setIdentityState] = useState(() => localStorage.getItem(IDENTITY_KEY) || null);
  const [showIdentityPicker, setShowIdentityPicker] = useState(false);

  function setIdentity(id) {
    localStorage.setItem(IDENTITY_KEY, id);
    setIdentityState(id);
    setShowIdentityPicker(false);
  }

  function logout() {
    localStorage.removeItem(UNLOCKED_KEY);
    localStorage.removeItem(IDENTITY_KEY);
    setUnlocked(false);
    setIdentityState(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let active = true;

    // Show cached data immediately (works with zero signal), then let the
    // real fetch update it in the background once/if the network is there.
    const cache = loadOfflineCache();
    if (cache) {
      setMeals(cache.meals || []);
      setAllPlanDays(cache.planDays || []);
      setAllChecked(cache.checked || []);
      setPeople(cache.people || []);
      setAllFavourites(cache.favourites || []);
      setAllRatings(cache.ratings || []);
      setAllWeekLocks(cache.weekLocks || []);
      setAllShoppingLocks(cache.shoppingLocks || []);
      if (cache.settings) setSettings(cache.settings);
      setLoading(false);
      setIsOffline(true);
    }

    (async () => {
      try {
        const [mealsData, planRes, checkedRes, peopleRes, settingsRes, favRes, ratingsRes, locksRes, shopLocksRes] = await Promise.all([
          fetchMeals(),
          supabase.from("weekly_plan_days").select("*"),
          supabase.from("shopping_checked").select("*"),
          supabase.from("people").select("*"),
          supabase.from("settings").select("*").eq("id", 1).single(),
          supabase.from("favourites").select("*"),
          supabase.from("meal_ratings").select("*"),
          supabase.from("week_locks").select("*"),
          supabase.from("shopping_locks").select("*"),
        ]);
        if (!active) return;
        if (planRes.error) throw planRes.error;
        if (checkedRes.error) throw checkedRes.error;
        if (peopleRes.error) throw peopleRes.error;
        if (favRes.error) throw favRes.error;
        if (ratingsRes.error) throw ratingsRes.error;
        if (locksRes.error) throw locksRes.error;
        if (shopLocksRes.error) throw shopLocksRes.error;
        setMeals(mealsData);
        setAllPlanDays(planRes.data || []);
        setAllChecked(checkedRes.data || []);
        setPeople(peopleRes.data || []);
        setAllFavourites(favRes.data || []);
        setAllRatings(ratingsRes.data || []);
        setAllWeekLocks(locksRes.data || []);
        setAllShoppingLocks(shopLocksRes.data || []);
        if (settingsRes.data) setSettings(settingsRes.data);
        setIsOffline(false);
        saveOfflineCache({
          meals: mealsData, planDays: planRes.data || [], checked: checkedRes.data || [],
          people: peopleRes.data || [], favourites: favRes.data || [], ratings: ratingsRes.data || [],
          weekLocks: locksRes.data || [], shoppingLocks: shopLocksRes.data || [], settings: settingsRes.data || null,
        });
      } catch (err) {
        if (active && !cache) setLoadError(err.message || String(err));
        // if we already showed cached data above, just keep showing it —
        // no network right now, but that's exactly the offline case this exists for
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [unlocked]);


  useEffect(() => {
    if (!unlocked) return;
    const channels = [
      supabase.channel("weekly_plan_days-changes").on("postgres_changes", { event: "*", schema: "public", table: "weekly_plan_days" }, (payload) => {
        setAllPlanDays((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old) : upsertRow(rows, payload.new)));
      }).subscribe(),
      supabase.channel("shopping_checked-changes").on("postgres_changes", { event: "*", schema: "public", table: "shopping_checked" }, (payload) => {
        setAllChecked((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old) : upsertRow(rows, payload.new)));
      }).subscribe(),
      supabase.channel("people-changes").on("postgres_changes", { event: "*", schema: "public", table: "people" }, (payload) => {
        setPeople((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old) : upsertRow(rows, payload.new)));
      }).subscribe(),
      supabase.channel("settings-changes").on("postgres_changes", { event: "*", schema: "public", table: "settings" }, (payload) => {
        if (payload.new) setSettings(payload.new);
      }).subscribe(),
      supabase.channel("favourites-changes").on("postgres_changes", { event: "*", schema: "public", table: "favourites" }, (payload) => {
        setAllFavourites((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old) : upsertRow(rows, payload.new)));
      }).subscribe(),
      supabase.channel("week_locks-changes").on("postgres_changes", { event: "*", schema: "public", table: "week_locks" }, (payload) => {
        setAllWeekLocks((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old, "week_start") : upsertRow(rows, payload.new, "week_start")));
      }).subscribe(),
      supabase.channel("shopping_locks-changes").on("postgres_changes", { event: "*", schema: "public", table: "shopping_locks" }, (payload) => {
        setAllShoppingLocks((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old, "week_start") : upsertRow(rows, payload.new, "week_start")));
      }).subscribe(),
      supabase.channel("meal_ratings-changes").on("postgres_changes", { event: "*", schema: "public", table: "meal_ratings" }, (payload) => {
        setAllRatings((rows) => (payload.eventType === "DELETE" ? removeRow(rows, payload.old) : upsertRow(rows, payload.new)));
      }).subscribe(),
      // meals/ingredients change together (new meal = new rows in both) and are joined into a
      // nested structure client-side, so a full refetch is simpler and safer than merging in place.
      supabase.channel("meals-changes").on("postgres_changes", { event: "*", schema: "public", table: "meals" }, () => {
        fetchMeals().then(setMeals).catch(() => {});
      }).subscribe(),
      supabase.channel("ingredients-changes").on("postgres_changes", { event: "*", schema: "public", table: "ingredients" }, () => {
        fetchMeals().then(setMeals).catch(() => {});
      }).subscribe(),
    ];
    return () => channels.forEach((c) => supabase.removeChannel(c));
  }, [unlocked]);

  const weekKey = isoDate(weekMonday);
  const mealsById = useMemo(() => Object.fromEntries(meals.map((m) => [m.id, m])), [meals]);
  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const currentPerson = identity ? peopleById[identity] : null;
  const isKid = currentPerson?.role === "kid";

  useEffect(() => {
    if (!loading && people.length > 0 && !identity) setShowIdentityPicker(true);
  }, [loading, people, identity]);

  // A login username that doesn't exactly match a real people.id (typo, wrong
  // case in VITE_APP_USERS, etc.) would otherwise fail every write that tags
  // "who did this" — silently, since foreign keys reject it with no visible
  // error. Catch that mismatch as soon as the real list loads and clear it,
  // so the person gets prompted to pick a real identity instead.
  useEffect(() => {
    if (!loading && people.length > 0 && identity && !peopleById[identity]) {
      localStorage.removeItem(IDENTITY_KEY);
      setIdentityState(null);
    }
  }, [loading, people, identity, peopleById]);

  const weekRows = useMemo(() => allPlanDays.filter((r) => r.week_start === weekKey), [allPlanDays, weekKey]);
  const weekLock = useMemo(() => allWeekLocks.find((r) => r.week_start === weekKey), [allWeekLocks, weekKey]);
  const isLocked = !!weekLock?.locked;
  const planBlocked = isLocked;
  const shoppingLock = useMemo(() => allShoppingLocks.find((r) => r.week_start === weekKey), [allShoppingLocks, weekKey]);
  const isShoppingLocked = !!shoppingLock?.locked;
  const shoppingKidBlocked = isShoppingLocked && isKid;
  const plannedMeals = useMemo(
    () => DAYS.map((d) => {
      const row = weekRows.find((r) => r.day_key === d.key);
      return { day: d, meal: row?.meal_id ? mealsById[row.meal_id] : null, cookedAt: row?.cooked_at || null, chosenBy: row?.chosen_by || null };
    }),
    [weekRows, mealsById]
  );
  const weekCost = useMemo(() => plannedMeals.reduce((sum, p) => sum + (p.meal ? p.meal.estCost * scaleFactor(p.meal, settings.family_size) : 0), 0), [plannedMeals, settings.family_size]);
  const cookedCount = plannedMeals.filter((p) => p.cookedAt).length;
  const plannedCount = plannedMeals.filter((p) => p.meal).length;
  const emptyDayKeys = plannedMeals.filter((p) => !p.meal).map((p) => p.day.key);

  const rotationStats = useMemo(() => {
    const cooked = allPlanDays.filter((r) => r.meal_id && r.cooked_at);
    const map = {};
    cooked.forEach((r) => {
      if (!map[r.meal_id]) map[r.meal_id] = { count: 0, recentCount: 0, lastCookedAt: null };
      const s = map[r.meal_id];
      s.count += 1;
      if (daysAgo(r.cooked_at) <= FREQUENT_WINDOW_DAYS) s.recentCount += 1;
      if (!s.lastCookedAt || r.cooked_at > s.lastCookedAt) s.lastCookedAt = r.cooked_at;
    });
    const out = {};
    Object.entries(map).forEach(([mealId, s]) => {
      out[mealId] = {
        frequent: s.recentCount >= FREQUENT_MIN_COUNT,
        overdue: s.lastCookedAt ? daysAgo(s.lastCookedAt) >= OVERDUE_MIN_DAYS : false,
        lastCookedDaysAgo: s.lastCookedAt ? daysAgo(s.lastCookedAt) : null,
        totalCooked: s.count,
      };
    });
    return out;
  }, [allPlanDays]);

  const shoppingList = useMemo(() => {
    const map = new Map();
    plannedMeals.forEach(({ meal }) => {
      if (!meal) return;
      const factor = scaleFactor(meal, settings.family_size);
      meal.ingredients.forEach((ing) => {
        const key = `${ing.category}|${ing.name}|${ing.unit || ""}`;
        if (!map.has(key)) map.set(key, { ...ing, quantity: 0, estCost: 0, mealNames: [] });
        const entry = map.get(key);
        entry.quantity += (ing.quantity || 0) * factor;
        entry.estCost += (ing.estCost || 0) * factor;
        if (!entry.mealNames.includes(meal.name)) entry.mealNames.push(meal.name);
      });
    });
    const items = Array.from(map.values());
    items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return items;
  }, [plannedMeals, settings.family_size]);

  const checkedMap = useMemo(() => {
    const map = {};
    allChecked.filter((r) => r.week_start === weekKey).forEach((r) => { map[r.item_key] = r.checked; });
    return map;
  }, [allChecked, weekKey]);
  const checkedCount = shoppingList.filter((it) => checkedMap[`${it.category}|${it.name}|${it.unit || ""}`]).length;

  const cuisines = useMemo(() => ["All", ...Array.from(new Set(meals.map((m) => m.cuisine))).sort()], [meals]);

  const favouritesByMeal = useMemo(() => {
    const map = {};
    allFavourites.forEach((f) => {
      if (!map[f.meal_id]) map[f.meal_id] = new Set();
      map[f.meal_id].add(f.person);
    });
    return map;
  }, [allFavourites]);

  const filteredMeals = useMemo(() => meals.filter((m) => {
    if (cuisineFilter !== "All" && m.cuisine !== cuisineFilter) return false;
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (favouritesOnly && !(identity && favouritesByMeal[m.id]?.has(identity))) return false;
    return true;
  }), [meals, search, cuisineFilter, favouritesOnly, favouritesByMeal, identity]);

  // weekly protein-type breakdown for the dietary pattern summary
  const proteinCounts = useMemo(() => {
    const counts = { red_meat: 0, poultry: 0, fish: 0, vegetarian: 0 };
    plannedMeals.forEach(({ meal }) => {
      if (meal?.proteinType && counts[meal.proteinType] !== undefined) counts[meal.proteinType] += 1;
    });
    return counts;
  }, [plannedMeals]);

  // every known ingredient name -> its most common category/unit, for autocomplete + auto-fill
  const ingredientReference = useMemo(() => {
    const tally = {};
    meals.forEach((m) => m.ingredients.forEach((ing) => {
      if (!ing.name) return;
      if (!tally[ing.name]) tally[ing.name] = { counts: {} };
      const key = `${ing.category}|${ing.unit || ""}`;
      tally[ing.name].counts[key] = (tally[ing.name].counts[key] || 0) + 1;
    }));
    const ref = {};
    Object.entries(tally).forEach(([name, { counts }]) => {
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const [category, unit] = best.split("|");
      ref[name] = { category, unit };
    });
    return ref;
  }, [meals]);
  const ingredientNames = useMemo(() => Object.keys(ingredientReference).sort(), [ingredientReference]);

  const reportStats = useMemo(() => {
    const cookedRows = allPlanDays.filter((r) => r.meal_id && r.cooked_at);
    const weekTotals = {};
    cookedRows.forEach((r) => {
      const meal = mealsById[r.meal_id];
      if (!meal) return;
      weekTotals[r.week_start] = (weekTotals[r.week_start] || 0) + meal.estCost * scaleFactor(meal, settings.family_size);
    });
    const weekValues = Object.values(weekTotals);
    const avgWeeklyCost = weekValues.length ? weekValues.reduce((a, b) => a + b, 0) / weekValues.length : 0;
    const costByWeek = Object.entries(weekTotals)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week_start, cost]) => ({
        week: new Date(week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        cost: Math.round(cost * 20) / 20,
      }));

    const countByMeal = {};
    cookedRows.forEach((r) => { countByMeal[r.meal_id] = (countByMeal[r.meal_id] || 0) + 1; });
    const topMealsRanked = Object.entries(countByMeal)
      .sort((a, b) => b[1] - a[1])
      .map(([mealId, count]) => ({ meal: mealsById[mealId], count }))
      .filter((m) => m.meal);
    const topMeals = topMealsRanked.slice(0, 3);
    const top5Meals = topMealsRanked.slice(0, 5).map((m) => ({ name: m.meal.name, count: m.count }));

    const cuisineCounts = {};
    cookedRows.forEach((r) => {
      const c = mealsById[r.meal_id]?.cuisine;
      if (c) cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
    });
    const cuisinesRanked = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]);
    const topCuisine = cuisinesRanked[0];
    const top3Cuisines = cuisinesRanked.slice(0, 3).map(([cuisine, count]) => ({ cuisine, count }));

    const ratingsByMeal = {};
    allRatings.forEach((r) => {
      if (!ratingsByMeal[r.meal_id]) ratingsByMeal[r.meal_id] = [];
      ratingsByMeal[r.meal_id].push(r);
    });
    let bestRated = null;
    Object.entries(ratingsByMeal).forEach(([mealId, rows]) => {
      const avg = rows.reduce((s, r) => s + r.ease_rating + r.quality_rating, 0) / rows.length;
      if (!bestRated || avg > bestRated.avg) bestRated = { meal: mealsById[mealId], avg, count: rows.length };
    });

    const favCountByPerson = {};
    allFavourites.forEach((f) => { favCountByPerson[f.person] = (favCountByPerson[f.person] || 0) + 1; });

    return {
      totalCooked: cookedRows.length,
      weeksTracked: weekValues.length,
      avgWeeklyCost,
      costByWeek,
      topMeals,
      top5Meals,
      top3Cuisines,
      topCuisine: topCuisine ? { cuisine: topCuisine[0], count: topCuisine[1] } : null,
      bestRated,
      favCountByPerson,
    };
  }, [allPlanDays, mealsById, settings.family_size, allRatings, allFavourites]);

  // ---------- writes ----------
  const assignMeal = useCallback(async (dayKey, mealId) => {
    if (planBlocked) return;
    await supabase.from("weekly_plan_days").upsert(
      { week_start: weekKey, day_key: dayKey, meal_id: mealId, cooked_at: null, chosen_by: identity || null },
      { onConflict: "week_start,day_key" }
    );
    setPickerDay(null);
  }, [weekKey, identity, planBlocked]);

  const clearDay = useCallback(async (dayKey) => {
    if (planBlocked) return;
    await supabase.from("weekly_plan_days").delete().eq("week_start", weekKey).eq("day_key", dayKey);
    setPickerDay(null);
  }, [weekKey, planBlocked]);

  const toggleCooked = useCallback(async (dayKey, currentlyCooked, mealId) => {
    await supabase.from("weekly_plan_days").upsert(
      { week_start: weekKey, day_key: dayKey, cooked_at: currentlyCooked ? null : new Date().toISOString() },
      { onConflict: "week_start,day_key" }
    );
    if (!currentlyCooked) setRatingPrompt({ mealId, weekKey, dayKey });
  }, [weekKey]);

  const submitRating = useCallback(async (easeRating, qualityRating) => {
    if (!ratingPrompt) return;
    await supabase.from("meal_ratings").insert({
      meal_id: ratingPrompt.mealId, person: identity || null,
      ease_rating: easeRating, quality_rating: qualityRating,
      week_start: ratingPrompt.weekKey, day_key: ratingPrompt.dayKey,
    });
    setRatingPrompt(null);
  }, [ratingPrompt, identity]);

  const toggleChecked = useCallback(async (itemKey) => {
    if (shoppingKidBlocked) return;
    const current = checkedMap[itemKey] || false;
    // update locally first so this responds instantly even with no signal —
    // syncs to Supabase in the background when a connection is available
    const optimisticRow = { id: `local-${weekKey}-${itemKey}`, week_start: weekKey, item_key: itemKey, checked: !current };
    setAllChecked((rows) => upsertRow(rows, optimisticRow));
    try {
      const { error } = await supabase.from("shopping_checked").upsert(
        { week_start: weekKey, item_key: itemKey, checked: !current },
        { onConflict: "week_start,item_key" }
      );
      if (error) console.error("Check toggle didn't sync:", error.message);
    } catch (err) {
      console.error("Check toggle didn't sync (likely offline):", err.message);
    }
  }, [weekKey, checkedMap, shoppingKidBlocked]);

  const toggleWeekLock = useCallback(async () => {
    if (isKid) return;
    await supabase.from("week_locks").upsert(
      { week_start: weekKey, locked: !isLocked, locked_by: identity || null, locked_at: new Date().toISOString() },
      { onConflict: "week_start" }
    );
  }, [weekKey, isLocked, isKid, identity]);

  const toggleShoppingLock = useCallback(async () => {
    if (isKid) return;
    await supabase.from("shopping_locks").upsert(
      { week_start: weekKey, locked: !isShoppingLocked, locked_by: identity || null, locked_at: new Date().toISOString() },
      { onConflict: "week_start" }
    );
  }, [weekKey, isShoppingLocked, isKid, identity]);

  const shuffleEmptyDays = useCallback(() => {
    if (planBlocked) return;
    if (emptyDayKeys.length === 0) return;
    const usedIds = new Set(plannedMeals.filter((p) => p.meal).map((p) => p.meal.id));
    let pool = meals.filter((m) => !usedIds.has(m.id));
    const nonFrequent = pool.filter((m) => !rotationStats[m.id]?.frequent);
    if (nonFrequent.length >= emptyDayKeys.length) pool = nonFrequent;
    const weighted = [];
    pool.forEach((m) => { weighted.push(m); if (rotationStats[m.id]?.overdue) weighted.push(m); });
    const chosen = new Set(usedIds);
    emptyDayKeys.forEach((dayKey) => {
      const available = weighted.filter((m) => !chosen.has(m.id));
      const source = available.length ? available : weighted;
      if (source.length === 0) return;
      const pick = source[Math.floor(Math.random() * source.length)];
      chosen.add(pick.id);
      assignMeal(dayKey, pick.id);
    });
  }, [emptyDayKeys, plannedMeals, meals, rotationStats, assignMeal, planBlocked]);

  const updatePerson = useCallback(async (id, patch) => {
    setPeople((rows) => rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await supabase.from("people").update(patch).eq("id", id);
  }, []);

  const updateSettings = useCallback(async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    await supabase.from("settings").update(patch).eq("id", 1);
  }, []);

  const toggleFavourite = useCallback(async (mealId) => {
    if (!identity) { setShowIdentityPicker(true); return; }
    const already = favouritesByMeal[mealId]?.has(identity);
    const { error } = already
      ? await supabase.from("favourites").delete().eq("meal_id", mealId).eq("person", identity)
      : await supabase.from("favourites").insert({ meal_id: mealId, person: identity });
    if (error) console.error("Favourite toggle failed:", error.message);
  }, [identity, favouritesByMeal]);

  const addMeal = useCallback(async (form) => {
    const existingIds = new Set(meals.map((m) => m.id));
    let id = slugify(form.name);
    let suffix = 2;
    while (existingIds.has(id)) { id = `${slugify(form.name)}-${suffix}`; suffix += 1; }
    const estCost = form.ingredients.reduce((sum, ing) => sum + (parseFloat(ing.estCost) || 0), 0);
    const { error: mealErr } = await supabase.from("meals").insert({
      id, name: form.name, cuisine: form.cuisine || "Other", complexity: form.complexity,
      prep_time: form.prepTime, cook_time: form.cookTime, est_cost: estCost,
      health_rating: form.healthRating, leftover_friendly: form.leftoverFriendly, notes: form.notes || null,
      protein_type: form.proteinType || null, servings: form.servings || 4,
      recipe_steps: form.recipeSteps.filter((s) => s.trim().length > 0),
    });
    if (mealErr) throw mealErr;
    const ingredientRows = form.ingredients.map((ing) => ({
      meal_id: id, category: ing.category, name: ing.name,
      quantity: parseFloat(ing.quantity) || 0, unit: ing.unit || null,
      est_cost: parseFloat(ing.estCost) || 0, notes: ing.notes || null,
    }));
    const { error: ingErr } = await supabase.from("ingredients").insert(ingredientRows);
    if (ingErr) throw ingErr;
    const fresh = await fetchMeals();
    setMeals(fresh);
  }, [meals]);

  const updateMeal = useCallback(async (mealId, form) => {
    const estCost = form.ingredients.reduce((sum, ing) => sum + (parseFloat(ing.estCost) || 0), 0);
    const { error: mealErr } = await supabase.from("meals").update({
      name: form.name, cuisine: form.cuisine || "Other", complexity: form.complexity,
      prep_time: form.prepTime, cook_time: form.cookTime, est_cost: estCost,
      health_rating: form.healthRating, leftover_friendly: form.leftoverFriendly, notes: form.notes || null,
      protein_type: form.proteinType || null, servings: form.servings || 4,
      recipe_steps: form.recipeSteps.filter((s) => s.trim().length > 0),
    }).eq("id", mealId);
    if (mealErr) throw mealErr;
    // simplest correct approach: replace the ingredient set wholesale rather than diffing rows
    const { error: delErr } = await supabase.from("ingredients").delete().eq("meal_id", mealId);
    if (delErr) throw delErr;
    const ingredientRows = form.ingredients.map((ing) => ({
      meal_id: mealId, category: ing.category, name: ing.name,
      quantity: parseFloat(ing.quantity) || 0, unit: ing.unit || null,
      est_cost: parseFloat(ing.estCost) || 0, notes: ing.notes || null,
    }));
    const { error: ingErr } = await supabase.from("ingredients").insert(ingredientRows);
    if (ingErr) throw ingErr;
    const fresh = await fetchMeals();
    setMeals(fresh);
  }, []);

  if (!unlocked) {
    return <PasswordGate onUnlock={(username) => { localStorage.setItem(UNLOCKED_KEY, "true"); setUnlocked(true); setIdentity(username); }} />;
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FAF7F0", color: "#8A8071" }}><p className="text-sm">Loading Esstisch...</p></div>;
  }
  if (loadError) {
    return <div className="min-h-screen flex items-center justify-center p-6 text-center" style={{ backgroundColor: "#FAF7F0", color: "#B23A2E" }}><p className="text-sm">Couldn't load data: {loadError}</p></div>;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#FAF7F0", color: "#2B2620" }}>
      <header className="sticky top-0 z-20 px-4 pt-5 pb-3" style={{ backgroundColor: "#FAF7F0", borderBottom: "1px solid #E8E1D4" }}>
        <div className="max-w-md mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ChefHat size={22} style={{ color: "#3F6B4A" }} />
            <h1 className="font-serif text-xl font-semibold tracking-tight">Esstisch</h1>
            {isOffline && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F5E7E4", color: "#B23A2E" }} title="No connection — showing the last saved data">
                <WifiOff size={10} /> offline
              </span>
            )}
          </div>
          {currentPerson && (
            <button onClick={() => setShowIdentityPicker(true)} title="Switch person">
              <PersonAvatar person={currentPerson} />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 pb-28 pt-4">
        {view === "library" && (
          <LibraryView meals={filteredMeals} search={search} setSearch={setSearch} cuisines={cuisines} cuisineFilter={cuisineFilter} setCuisineFilter={setCuisineFilter} onSelect={setDetailMeal} rotationStats={rotationStats} favouritesByMeal={favouritesByMeal} identity={identity} favouritesOnly={favouritesOnly} setFavouritesOnly={setFavouritesOnly} onToggleFavourite={toggleFavourite} onAddMeal={() => setShowAddMeal(true)} familySize={settings.family_size} />
        )}
        {view === "plan" && (
          <PlanView weekMonday={weekMonday} setWeekMonday={setWeekMonday} plannedMeals={plannedMeals} weekCost={weekCost} cookedCount={cookedCount} plannedCount={plannedCount} onDayTap={setPickerDay} onToggleCooked={toggleCooked} onClearDay={clearDay} rotationStats={rotationStats} peopleById={peopleById} emptyCount={emptyDayKeys.length} onShuffle={shuffleEmptyDays} proteinCounts={proteinCounts} familySize={settings.family_size} isLocked={isLocked} isKid={isKid} planBlocked={planBlocked} onToggleLock={toggleWeekLock} />
        )}
        {view === "shop" && (
          <ShopView weekMonday={weekMonday} shoppingList={shoppingList} checked={checkedMap} toggleChecked={toggleChecked} checkedCount={checkedCount} weekCost={weekCost} hasMeals={plannedMeals.some((p) => p.meal)} isShoppingLocked={isShoppingLocked} isKid={isKid} shoppingKidBlocked={shoppingKidBlocked} onToggleShoppingLock={toggleShoppingLock} />
        )}
        {view === "settings" && (
          <SettingsView people={people} settings={settings} updatePerson={updatePerson} updateSettings={updateSettings} onLogout={logout} />
        )}
        {view === "report" && <ReportView stats={reportStats} peopleById={peopleById} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20" style={{ backgroundColor: "#FFFFFF", borderTop: "1px solid #E8E1D4" }}>
        <div className="max-w-md mx-auto flex">
          <TabButton icon={BookOpen} label="Library" active={view === "library"} onClick={() => setView("library")} />
          <TabButton icon={CalendarDays} label="Plan" active={view === "plan"} onClick={() => setView("plan")} />
          <TabButton icon={ShoppingCart} label="Shop" active={view === "shop"} onClick={() => setView("shop")} badge={checkedCount > 0 ? `${checkedCount}/${shoppingList.length}` : null} />
          <TabButton icon={BarChart3} label="Report" active={view === "report"} onClick={() => setView("report")} />
          <TabButton icon={SettingsIcon} label="Settings" active={view === "settings"} onClick={() => setView("settings")} />
        </div>
      </nav>

      {pickerDay && (
        <MealPickerSheet day={pickerDay} meals={meals} currentMealId={weekRows.find((r) => r.day_key === pickerDay.key)?.meal_id} rotationStats={rotationStats} onPick={(mealId) => assignMeal(pickerDay.key, mealId)} onClear={() => clearDay(pickerDay.key)} onClose={() => setPickerDay(null)} />
      )}
      {detailMeal && (
        <MealDetailModal meal={detailMeal} stats={rotationStats[detailMeal.id]} onClose={() => setDetailMeal(null)} favouritedBy={favouritesByMeal[detailMeal.id]} peopleById={peopleById} identity={identity} onToggleFavourite={() => toggleFavourite(detailMeal.id)} familySize={settings.family_size} onEdit={() => { setEditingMeal(detailMeal); setDetailMeal(null); }} />
      )}
      {showIdentityPicker && <IdentityPicker people={people} current={identity} onPick={setIdentity} onClose={identity ? () => setShowIdentityPicker(false) : null} />}
      {(showAddMeal || editingMeal) && (
        <MealFormSheet
          cuisines={cuisines.filter((c) => c !== "All")}
          existingMeal={editingMeal}
          ingredientReference={ingredientReference}
          ingredientNames={ingredientNames}
          onSave={async (form) => {
            if (editingMeal) { await updateMeal(editingMeal.id, form); setEditingMeal(null); }
            else { await addMeal(form); setShowAddMeal(false); }
          }}
          onClose={() => { setShowAddMeal(false); setEditingMeal(null); }}
        />
      )}
      {ratingPrompt && <RatingPromptModal meal={mealsById[ratingPrompt.mealId]} onSubmit={submitRating} onSkip={() => setRatingPrompt(null)} />}
    </div>
  );
}

function TabButton({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button onClick={onClick} className="flex-1 flex flex-col items-center justify-center gap-1 py-3 relative" style={{ color: active ? "#3F6B4A" : "#8A8071" }}>
      <Icon size={20} strokeWidth={active ? 2.4 : 2} />
      <span className="text-[11px] font-medium">{label}</span>
      {badge && <span className="absolute top-1.5 right-1/4 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#C08A2E", color: "#fff" }}>{badge}</span>}
    </button>
  );
}

// Parses VITE_APP_USERS="person1:pass1,person2:pass2,person3:pass3,person4:pass4"
// Usernames should match the `people` table ids exactly so login can also set identity.
function parseCredentials() {
  const raw = import.meta.env.VITE_APP_USERS || "";
  const map = {};
  raw.split(",").forEach((pair) => {
    const [user, pass] = pair.split(":");
    if (user && pass) map[user.trim().toLowerCase()] = pass;
  });
  return map;
}

function PasswordGate({ onUnlock }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const credentials = parseCredentials();
    const key = username.trim().toLowerCase();
    if (key && credentials[key] && password === credentials[key]) {
      onUnlock(key);
    } else {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "#FAF7F0" }}>
      <div className="w-full max-w-xs rounded-3xl p-6" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
        <div className="flex items-center gap-2 mb-1">
          <ChefHat size={22} style={{ color: "#3F6B4A" }} />
          <h1 className="font-serif text-xl font-semibold">Esstisch</h1>
        </div>
        <p className="text-sm mb-4" style={{ color: "#8A8071" }}>Family only — sign in to continue.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text" autoFocus value={username} autoCapitalize="none"
            onChange={(e) => { setUsername(e.target.value); setError(false); }}
            placeholder="Name"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2"
            style={{ backgroundColor: "#FAF7F0", border: error ? "1px solid #B23A2E" : "1px solid #E8E1D4" }}
          />
          <input
            type="password" value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder="Password"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2"
            style={{ backgroundColor: "#FAF7F0", border: error ? "1px solid #B23A2E" : "1px solid #E8E1D4" }}
          />
          {error && <p className="text-xs mb-3" style={{ color: "#B23A2E" }}>That's not it — try again.</p>}
          <button type="submit" className="w-full py-2.5 rounded-xl text-sm font-semibold mt-2" style={{ backgroundColor: "#3F6B4A", color: "#fff" }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}

function IdentityPicker({ people, current, onPick, onClose }) {
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function trySwitch(e) {
    e.preventDefault();
    const credentials = parseCredentials();
    if (credentials[selected.id] && password === credentials[selected.id]) {
      onPick(selected.id);
    } else {
      setError(true);
      setPassword("");
    }
  }

  function back() {
    setSelected(null);
    setPassword("");
    setError(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(43,38,32,0.5)" }} onClick={onClose || undefined} />
      <div className="relative w-full max-w-xs rounded-3xl p-6" style={{ backgroundColor: "#FAF7F0" }}>
        {!selected ? (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-serif text-lg font-semibold">Switch to who?</h2>
              {onClose && <button onClick={onClose} className="p-1 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><X size={16} /></button>}
            </div>
            <p className="text-xs mb-4" style={{ color: "#8A8071" }}>You'll need their password to switch.</p>
            <div className="grid grid-cols-2 gap-3">
              {people.map((p) => (
                <button key={p.id} onClick={() => setSelected(p)} className="flex flex-col items-center gap-2 p-3 rounded-2xl" style={{ backgroundColor: current === p.id ? "#EAF1EC" : "#FFFFFF", border: current === p.id ? "1px solid #3F6B4A" : "1px solid #E8E1D4" }}>
                  <PersonAvatar person={p} size={36} />
                  <span className="text-sm font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={back} className="text-xs font-medium" style={{ color: "#5C5648" }}>&larr; Back</button>
              {onClose && <button onClick={onClose} className="p-1 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><X size={16} /></button>}
            </div>
            <div className="flex flex-col items-center gap-2 mb-4">
              <PersonAvatar person={selected} size={44} />
              <p className="font-serif font-semibold">{selected.name}'s password</p>
            </div>
            <form onSubmit={trySwitch}>
              <input
                type="password" autoFocus value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                placeholder="Password"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2"
                style={{ backgroundColor: "#FFFFFF", border: error ? "1px solid #B23A2E" : "1px solid #E8E1D4" }}
              />
              {error && <p className="text-xs mb-3" style={{ color: "#B23A2E" }}>That's not it — try again.</p>}
              <button type="submit" className="w-full py-2.5 rounded-xl text-sm font-semibold mt-2" style={{ backgroundColor: "#3F6B4A", color: "#fff" }}>Switch</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function LibraryView({ meals, search, setSearch, cuisines, cuisineFilter, setCuisineFilter, onSelect, rotationStats, favouritesByMeal, identity, favouritesOnly, setFavouritesOnly, onToggleFavourite, onAddMeal, familySize }) {
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#8A8071" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search meals..." className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }} />
        </div>
        <button onClick={onAddMeal} className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl font-semibold" style={{ backgroundColor: "#3F6B4A", color: "#fff" }} title="Add a meal">+</button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4" style={{ scrollbarWidth: "none" }}>
        <button onClick={() => setFavouritesOnly((v) => !v)} className="shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap" style={favouritesOnly ? { backgroundColor: "#B23A2E", color: "#fff" } : { backgroundColor: "#FFFFFF", color: "#5C5648", border: "1px solid #E8E1D4" }}>
          <Heart size={12} fill={favouritesOnly ? "#fff" : "none"} /> My favourites
        </button>
        {cuisines.map((c) => (
          <button key={c} onClick={() => setCuisineFilter(c)} className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap" style={cuisineFilter === c ? { backgroundColor: "#3F6B4A", color: "#fff" } : { backgroundColor: "#FFFFFF", color: "#5C5648", border: "1px solid #E8E1D4" }}>
            {c !== "All" && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cuisineColor(c) }} />}
            {c}
          </button>
        ))}
      </div>
      <p className="text-xs mb-3" style={{ color: "#8A8071" }}>{meals.length} meal{meals.length !== 1 ? "s" : ""}</p>
      <div className="flex flex-col gap-2.5">
        {meals.map((meal) => <MealCard key={meal.id} meal={meal} onClick={() => onSelect(meal)} stats={rotationStats[meal.id]} isFavourited={!!(identity && favouritesByMeal[meal.id]?.has(identity))} onToggleFavourite={() => onToggleFavourite(meal.id)} familySize={familySize} />)}
        {meals.length === 0 && <p className="text-sm text-center py-10" style={{ color: "#8A8071" }}>No meals match. Try a different search or cuisine.</p>}
      </div>
    </div>
  );
}

function MealCard({ meal, onClick, stats, isFavourited, onToggleFavourite, familySize }) {
  const scaledCost = meal.estCost * scaleFactor(meal, familySize);
  return (
    <div onClick={onClick} role="button" tabIndex={0} className="relative text-left w-full rounded-2xl p-3.5 flex gap-3 items-start cursor-pointer" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4", borderLeft: `4px solid ${cuisineColor(meal.cuisine)}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 pr-6">
          <h3 className="font-serif font-semibold text-[15px] leading-snug truncate">{meal.name}</h3>
          <span className="text-sm font-semibold shrink-0" style={{ color: "#C08A2E" }}>{fmtCHF(scaledCost)}</span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: "#8A8071" }}>{meal.cuisine}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="flex items-center gap-1 text-xs" style={{ color: "#5C5648" }}><Clock size={12} /> {meal.prepTime + meal.cookTime} min</span>
          <ComplexityDots level={meal.complexity} />
          <HealthPill rating={meal.healthRating} />
          {meal.leftoverFriendly === "Yes" && <span className="text-xs font-medium" style={{ color: "#3F6B4A" }}>leftover-friendly</span>}
        </div>
        <div className="mt-1.5"><RotationBadge stats={stats} /></div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onToggleFavourite(); }} className="absolute top-3.5 right-3.5 p-0.5">
        <Heart size={18} fill={isFavourited ? "#B23A2E" : "none"} color={isFavourited ? "#B23A2E" : "#C7BFAE"} strokeWidth={2} />
      </button>
    </div>
  );
}

function MealDetailModal({ meal, stats, onClose, favouritedBy, peopleById, identity, onToggleFavourite, familySize, onEdit }) {
  const favList = favouritedBy ? Array.from(favouritedBy).map((id) => peopleById[id]).filter(Boolean) : [];
  const isFavourited = !!(identity && favouritedBy?.has(identity));
  const factor = scaleFactor(meal, familySize);
  const scaledCost = meal.estCost * factor;
  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5" style={{ backgroundColor: "#FAF7F0" }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-serif text-xl font-semibold leading-tight">{meal.name}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
              <Pencil size={15} color="#5C5648" />
            </button>
            <button onClick={onToggleFavourite} className="p-1.5 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
              <Heart size={17} fill={isFavourited ? "#B23A2E" : "none"} color={isFavourited ? "#B23A2E" : "#8A8071"} />
            </button>
            <button onClick={onClose} className="p-1 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><X size={18} /></button>
          </div>
        </div>
        <p className="text-sm mb-3" style={{ color: "#8A8071" }}>{meal.cuisine}</p>
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <span className="flex items-center gap-1 text-xs" style={{ color: "#5C5648" }}><Clock size={12} /> {meal.prepTime}m prep &middot; {meal.cookTime}m cook</span>
          <ComplexityDots level={meal.complexity} />
          <HealthPill rating={meal.healthRating} />
          <span className="text-sm font-semibold" style={{ color: "#C08A2E" }}>{fmtCHF(scaledCost)}</span>
        </div>
        {factor !== 1 && (
          <p className="text-xs mb-2" style={{ color: "#8A8071" }}>Scaled from {meal.servings} to {familySize} servings</p>
        )}
        {meal.proteinType && PROTEIN_LABELS[meal.proteinType] && (
          <p className="text-xs mb-2" style={{ color: "#8A8071" }}>{PROTEIN_LABELS[meal.proteinType].emoji} {PROTEIN_LABELS[meal.proteinType].label}</p>
        )}
        {favList.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs" style={{ color: "#8A8071" }}>Favourited by</span>
            <div className="flex -space-x-1.5">
              {favList.map((p) => <PersonAvatar key={p.id} person={p} size={20} />)}
            </div>
          </div>
        )}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <RotationBadge stats={stats} />
          <span className="text-xs" style={{ color: "#8A8071" }}>{stats?.lastCookedDaysAgo != null ? `Last cooked ${stats.lastCookedDaysAgo === 0 ? "today" : `${stats.lastCookedDaysAgo}d ago`}` : "Not cooked yet"}</span>
        </div>
        {meal.notes && <p className="text-sm mb-4 italic p-3 rounded-xl" style={{ backgroundColor: "#F7EEDD", color: "#5C5648" }}>{meal.notes}</p>}
        <h3 className="font-serif font-semibold text-sm mb-2">Ingredients</h3>
        <div className="flex flex-col gap-1.5 mb-2">
          {meal.ingredients.map((ing, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 text-sm py-1" style={{ borderBottom: "1px solid #EFE9DC" }}>
              <span>{ing.name}{ing.notes && <span className="text-xs ml-1.5" style={{ color: "#8A8071" }}>{ing.notes}</span>}</span>
              <span className="shrink-0 text-xs font-medium" style={{ color: "#5C5648" }}>{Math.round(ing.quantity * factor * 100) / 100} {ing.unit || ""}</span>
            </div>
          ))}
        </div>
        {meal.recipeSteps && meal.recipeSteps.length > 0 && (
          <>
            <h3 className="font-serif font-semibold text-sm mb-2 mt-4">Recipe</h3>
            <ol className="flex flex-col gap-2.5">
              {meal.recipeSteps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: "#EAF1EC", color: "#3F6B4A" }}>{i + 1}</span>
                  <span style={{ color: "#2B2620" }}>{step}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function PlanView({ weekMonday, setWeekMonday, plannedMeals, weekCost, cookedCount, plannedCount, onDayTap, onToggleCooked, onClearDay, rotationStats, peopleById, emptyCount, onShuffle, proteinCounts, familySize, isLocked, isKid, planBlocked, onToggleLock }) {
  const totalProtein = Object.values(proteinCounts).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setWeekMonday(addDays(weekMonday, -7))} className="p-2 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><ChevronLeft size={18} /></button>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5">
            <p className="font-serif font-semibold">{fmtWeekRange(weekMonday)}</p>
            {isKid ? (
              isLocked && <Lock size={13} color="#B23A2E" />
            ) : (
              <button onClick={onToggleLock} title={isLocked ? "Unlock this week" : "Lock this week"}>
                {isLocked ? <Lock size={14} color="#B23A2E" /> : <Unlock size={14} color="#C7BFAE" />}
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: "#8A8071" }}>{cookedCount}/{plannedCount || 0} cooked &middot; <span className="font-semibold" style={{ color: "#C08A2E" }}>{fmtCHF(weekCost)}</span></p>
        </div>
        <button onClick={() => setWeekMonday(addDays(weekMonday, 7))} className="p-2 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><ChevronRight size={18} /></button>
      </div>
      {planBlocked && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: "#F5E7E4" }}>
          <Lock size={14} color="#B23A2E" className="shrink-0" />
          <p className="text-xs" style={{ color: "#B23A2E" }}>
            {isKid ? "This week is locked — you can still mark meals cooked, just can't change the plan. Ask a parent to unlock it." : "This week is locked — tap the lock icon above to make changes."}
          </p>
        </div>
      )}
      {totalProtein > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-1">
          {Object.entries(proteinCounts).filter(([, n]) => n > 0).map(([type, n]) => (
            <span key={type} className="text-xs" style={{ color: "#5C5648" }}>{PROTEIN_LABELS[type].emoji} {n} {PROTEIN_LABELS[type].label}</span>
          ))}
          {proteinCounts.fish === 0 && <span className="text-xs italic" style={{ color: "#8A8071" }}>&middot; no fish planned this week</span>}
        </div>
      )}
      {emptyCount > 0 && !planBlocked && (
        <button onClick={onShuffle} className="w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl mb-3" style={{ backgroundColor: "#FFFFFF", border: "1px dashed #C7BFAE", color: "#5C5648" }}>
          <Shuffle size={15} /> Fill {emptyCount} empty day{emptyCount !== 1 ? "s" : ""} randomly
        </button>
      )}
      <div className="flex flex-col gap-2.5">
        {plannedMeals.map(({ day, meal, cookedAt, chosenBy }) => {
          const person = chosenBy ? peopleById[chosenBy] : null;
          const blockColor = !meal ? "#EFE9DC" : cookedAt ? "#E4DDCB" : person ? person.color : "#8A8071";
          const blockTextColor = !meal ? "#8A8071" : cookedAt ? "#9C9280" : "#fff";
          const factor = meal ? scaleFactor(meal, familySize) : 1;
          const dayDisabled = planBlocked;
          return (
            <div key={day.key} className="w-full rounded-2xl overflow-hidden flex" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4", opacity: dayDisabled ? 0.7 : 1 }}>
              <button onClick={() => !dayDisabled && onDayTap(day)} className="w-16 shrink-0 flex flex-col items-center justify-center py-3 gap-0.5" style={{ backgroundColor: blockColor }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: blockTextColor }}>{day.label}</span>
                {person && <span className="text-[9px] font-semibold" style={{ color: blockTextColor, opacity: 0.85 }}>{person.initials}</span>}
              </button>
              <button onClick={() => !dayDisabled && onDayTap(day)} className="flex-1 p-3 min-w-0 text-left">
                {meal ? (
                  <>
                    <p className="font-serif font-semibold text-sm truncate" style={{ color: cookedAt ? "#A79C89" : "#2B2620" }}>{meal.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs" style={{ color: "#8A8071" }}>{meal.cuisine}</span>
                      <span className="text-xs font-medium" style={{ color: cookedAt ? "#B0A793" : "#C08A2E" }}>{fmtCHF(meal.estCost * factor)}</span>
                    </div>
                    {!cookedAt && <div className="mt-1"><RotationBadge stats={rotationStats[meal.id]} /></div>}
                  </>
                ) : (
                  <p className="text-sm" style={{ color: "#8A8071" }}>{dayDisabled ? "Locked" : "Tap to add a meal"}</p>
                )}
              </button>
              {meal && !cookedAt && !dayDisabled && (
                <button onClick={() => onClearDay(day.key)} className="shrink-0 w-8 flex items-center justify-center" style={{ borderLeft: "1px solid #EFE9DC" }} title="Clear this day">
                  <X size={14} color="#B23A2E" />
                </button>
              )}
              {meal && (
                <button onClick={() => onToggleCooked(day.key, !!cookedAt, meal.id)} className="shrink-0 w-16 flex flex-col items-center justify-center gap-1 px-2" style={{ borderLeft: "1px solid #EFE9DC", backgroundColor: cookedAt ? "#EAF1EC" : "transparent" }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: cookedAt ? "#3F6B4A" : "#FFFFFF", border: cookedAt ? "1px solid #3F6B4A" : "1px solid #C7BFAE" }}>
                    {cookedAt && <Check size={14} color="#fff" strokeWidth={3} />}
                  </span>
                  <span className="text-[10px] font-medium text-center leading-none" style={{ color: cookedAt ? "#3F6B4A" : "#8A8071" }}>{cookedAt ? "Cooked" : "Mark\ncooked"}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MealPickerSheet({ day, meals, currentMealId, rotationStats, onPick, onClear, onClose }) {
  const [search, setSearch] = useState("");
  const filtered = meals.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[80vh] flex flex-col rounded-t-3xl p-4 pb-6" style={{ backgroundColor: "#FAF7F0" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-lg font-semibold">{day.full}</h2>
          <button onClick={onClose} className="p-1 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><X size={18} /></button>
        </div>
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#8A8071" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search meals..." className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }} autoFocus />
        </div>
        {currentMealId && <button onClick={onClear} className="text-sm font-medium text-left mb-2 px-1" style={{ color: "#B23A2E" }}>Clear this day</button>}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {filtered.map((meal) => (
            <button key={meal.id} onClick={() => onPick(meal.id)} className="w-full text-left rounded-xl p-3" style={{ backgroundColor: meal.id === currentMealId ? "#EAF1EC" : "#FFFFFF", border: meal.id === currentMealId ? "1px solid #3F6B4A" : "1px solid #E8E1D4" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{meal.name}</p>
                  <p className="text-xs" style={{ color: "#8A8071" }}>{meal.cuisine}</p>
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color: "#C08A2E" }}>{fmtCHF(meal.estCost)}</span>
              </div>
              <div className="mt-1"><RotationBadge stats={rotationStats[meal.id]} /></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const INGREDIENT_CATEGORIES = ["Meat", "Dairy", "Vegetable", "Carbs", "Sauce", "Canned", "Frozen", "Pantry", "Fruit", "Snack"];
const INGREDIENT_UNITS = ["grams", "each", "cups", "tbsp", "ml", "jar", "can", "packet", "litre", "cloves", "stalks", "pieces", "buns", "wraps", "sachet", "slices", "bag", "box", "bottle", "tsp", "pinch", "loaf", "cube"];

function fieldStyle() {
  return { backgroundColor: "#FAF7F0", border: "1px solid #E8E1D4" };
}

function StarPicker({ value, onChange, count = 5 }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <button key={n} onClick={() => onChange(n)} type="button">
          <Star size={22} fill={n <= value ? "#C08A2E" : "none"} color={n <= value ? "#C08A2E" : "#C7BFAE"} />
        </button>
      ))}
    </div>
  );
}

function RatingPromptModal({ meal, onSubmit, onSkip }) {
  const [ease, setEase] = useState(0);
  const [quality, setQuality] = useState(0);
  if (!meal) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(43,38,32,0.5)" }} onClick={onSkip} />
      <div className="relative w-full max-w-xs rounded-3xl p-6" style={{ backgroundColor: "#FAF7F0" }}>
        <h2 className="font-serif text-lg font-semibold mb-1">How did it go?</h2>
        <p className="text-sm mb-4" style={{ color: "#8A8071" }}>{meal.name}</p>
        <p className="text-xs font-medium mb-1.5" style={{ color: "#5C5648" }}>Easy to prepare?</p>
        <div className="mb-4"><StarPicker value={ease} onChange={setEase} /></div>
        <p className="text-xs font-medium mb-1.5" style={{ color: "#5C5648" }}>How did it turn out?</p>
        <div className="mb-5"><StarPicker value={quality} onChange={setQuality} /></div>
        <div className="flex gap-2">
          <button onClick={onSkip} className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4", color: "#5C5648" }}>Skip</button>
          <button onClick={() => onSubmit(ease, quality)} disabled={!ease || !quality} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: ease && quality ? "#3F6B4A" : "#C7BFAE", color: "#fff" }}>Save rating</button>
        </div>
      </div>
    </div>
  );
}

function ReportView({ stats, peopleById }) {
  const StatCard = ({ children }) => (
    <div className="rounded-2xl p-4" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>{children}</div>
  );
  const tooltipStyle = { backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4", borderRadius: 10, fontSize: 12 };
  if (stats.totalCooked === 0) {
    return (
      <div className="text-center py-16">
        <BarChart3 size={32} className="mx-auto mb-3" style={{ color: "#C7BFAE" }} />
        <p className="font-serif font-semibold mb-1">No cooking history yet</p>
        <p className="text-sm" style={{ color: "#8A8071" }}>Mark a few meals as cooked on the Plan tab and your stats will show up here.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <StatCard>
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "#8A8071" }}>Average cost per week</p>
        <p className="font-serif text-2xl font-semibold" style={{ color: "#C08A2E" }}>{fmtCHF(stats.avgWeeklyCost)}</p>
        <p className="text-xs mb-2" style={{ color: "#8A8071" }}>across {stats.weeksTracked} tracked week{stats.weeksTracked !== 1 ? "s" : ""}</p>
        {stats.costByWeek.length > 1 && (
          <div style={{ width: "100%", height: 140 }}>
            <ResponsiveContainer>
              <LineChart data={stats.costByWeek} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#EFE9DC" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#8A8071" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#8A8071" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtCHF(v), "Cost"]} />
                <Line type="monotone" dataKey="cost" stroke="#3F6B4A" strokeWidth={2.5} dot={{ r: 3, fill: "#3F6B4A" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </StatCard>

      <StatCard>
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#8A8071" }}>Top {stats.top5Meals.length > 1 ? "5" : ""} most-cooked meals</p>
        <div style={{ width: "100%", height: Math.max(120, stats.top5Meals.length * 36) }}>
          <ResponsiveContainer>
            <BarChart data={stats.top5Meals} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "#2B2620" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}×`, "Cooked"]} />
              <Bar dataKey="count" fill="#C08A2E" radius={[0, 8, 8, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </StatCard>

      {stats.top3Cuisines.length > 0 && (
        <StatCard>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#8A8071" }}>Top cuisines</p>
          <div style={{ width: "100%", height: Math.max(90, stats.top3Cuisines.length * 40) }}>
            <ResponsiveContainer>
              <BarChart data={stats.top3Cuisines} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="cuisine" width={100} tick={{ fontSize: 11, fill: "#2B2620" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}×`, "Cooked"]} />
                <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={16}>
                  {stats.top3Cuisines.map((entry, i) => <Cell key={i} fill={cuisineColor(entry.cuisine)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </StatCard>
      )}

      {stats.bestRated && (
        <StatCard>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "#8A8071" }}>Highest rated</p>
          <p className="text-sm font-semibold">{stats.bestRated.meal.name}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8A8071" }}>{stats.bestRated.avg.toFixed(1)}/10 average &middot; {stats.bestRated.count} rating{stats.bestRated.count !== 1 ? "s" : ""}</p>
        </StatCard>
      )}

      {Object.keys(stats.favCountByPerson).length > 0 && (
        <StatCard>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "#8A8071" }}>Favourites by person</p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(stats.favCountByPerson).map(([personId, count]) => {
              const p = peopleById[personId];
              if (!p) return null;
              return (
                <div key={personId} className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-2"><PersonAvatar person={p} size={20} /> {p.name}</span>
                  <span className="text-xs font-semibold" style={{ color: "#3F6B4A" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </StatCard>
      )}

      <StatCard>
        <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "#8A8071" }}>Total meals cooked</p>
        <p className="font-serif text-2xl font-semibold">{stats.totalCooked}</p>
      </StatCard>
    </div>
  );
}

function MealFormSheet({ cuisines, existingMeal, ingredientReference, ingredientNames, onSave, onClose }) {
  const isEdit = !!existingMeal;
  const [name, setName] = useState(existingMeal?.name || "");
  const [cuisine, setCuisine] = useState(existingMeal?.cuisine || "");
  const [complexity, setComplexity] = useState(existingMeal?.complexity ?? 3);
  const [prepTime, setPrepTime] = useState(existingMeal?.prepTime ?? 15);
  const [cookTime, setCookTime] = useState(existingMeal?.cookTime ?? 20);
  const [healthRating, setHealthRating] = useState(existingMeal?.healthRating ?? 5);
  const [leftoverFriendly, setLeftoverFriendly] = useState(existingMeal?.leftoverFriendly || "No");
  const [proteinType, setProteinType] = useState(existingMeal?.proteinType || "");
  const [servings, setServings] = useState(existingMeal?.servings ?? 4);
  const [notes, setNotes] = useState(existingMeal?.notes || "");
  const [ingredients, setIngredients] = useState(
    existingMeal?.ingredients?.length
      ? existingMeal.ingredients.map((ing) => ({ category: ing.category, name: ing.name, quantity: String(ing.quantity ?? ""), unit: ing.unit || "grams", estCost: String(ing.estCost ?? ""), notes: ing.notes || "" }))
      : [{ category: "Vegetable", name: "", quantity: "", unit: "grams", estCost: "", notes: "" }]
  );
  const [recipeSteps, setRecipeSteps] = useState(existingMeal?.recipeSteps?.length ? [...existingMeal.recipeSteps] : [""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const estCostTotal = ingredients.reduce((sum, ing) => sum + (parseFloat(ing.estCost) || 0), 0);
  const canSave = name.trim().length > 0 && ingredients.some((ing) => ing.name.trim().length > 0);

  function updateIngredient(i, patch) {
    setIngredients((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function handleIngredientNameChange(i, value) {
    const patch = { name: value };
    // auto-fill category/unit when the name exactly matches a known ingredient,
    // so re-using an existing ingredient stays consistent for shopping-list aggregation
    const ref = ingredientReference[value];
    if (ref) { patch.category = ref.category; patch.unit = ref.unit; }
    updateIngredient(i, patch);
  }
  function addIngredientRow() {
    setIngredients((rows) => [...rows, { category: "Vegetable", name: "", quantity: "", unit: "grams", estCost: "", notes: "" }]);
  }
  function removeIngredientRow(i) {
    setIngredients((rows) => rows.filter((_, idx) => idx !== i));
  }
  function updateStep(i, value) {
    setRecipeSteps((rows) => rows.map((r, idx) => (idx === i ? value : r)));
  }
  function addStep() {
    setRecipeSteps((rows) => [...rows, ""]);
  }
  function removeStep(i) {
    setRecipeSteps((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(), cuisine: cuisine.trim(), complexity, prepTime, cookTime,
        healthRating, leftoverFriendly, proteinType: proteinType || null, notes: notes.trim(),
        servings: servings || 4, recipeSteps: recipeSteps.map((s) => s.trim()).filter(Boolean),
        ingredients: ingredients.filter((ing) => ing.name.trim().length > 0),
      });
    } catch (err) {
      // the demo's meal library is intentionally read-only for anon visitors (see GOVERNANCE.md) —
      // surface that as a clear explanation rather than the raw Postgres RLS error text
      const isReadOnly = /row-level security/i.test(err.message || "");
      setError(isReadOnly ? "The meal library is read-only in this public demo — planning, favourites, and ratings are still fully interactive." : (err.message || "Couldn't save this meal — try again."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5" style={{ backgroundColor: "#FAF7F0" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg font-semibold">{isEdit ? "Edit meal" : "Add a meal"}</h2>
          <button onClick={onClose} className="p-1 rounded-full" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3 mb-5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meal name" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle()} />
          <input value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="Cuisine (e.g. Italian)" list="cuisine-list" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={fieldStyle()} />
          <datalist id="cuisine-list">{cuisines.map((c) => <option key={c} value={c} />)}</datalist>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs" style={{ color: "#8A8071" }}>Prep (min)
              <input type="number" min="0" value={prepTime} onChange={(e) => setPrepTime(parseInt(e.target.value) || 0)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
            </label>
            <label className="text-xs" style={{ color: "#8A8071" }}>Cook (min)
              <input type="number" min="0" value={cookTime} onChange={(e) => setCookTime(parseInt(e.target.value) || 0)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
            </label>
            <label className="text-xs" style={{ color: "#8A8071" }}>Complexity (1-5)
              <input type="number" min="1" max="5" value={complexity} onChange={(e) => setComplexity(parseInt(e.target.value) || 1)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
            </label>
            <label className="text-xs" style={{ color: "#8A8071" }}>Health (1-10)
              <input type="number" min="1" max="10" value={healthRating} onChange={(e) => setHealthRating(parseInt(e.target.value) || 1)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs" style={{ color: "#8A8071" }}>Leftover-friendly
              <select value={leftoverFriendly} onChange={(e) => setLeftoverFriendly(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                <option>Yes</option><option>No</option><option>Partial</option>
              </select>
            </label>
            <label className="text-xs" style={{ color: "#8A8071" }}>Protein type
              <select value={proteinType} onChange={(e) => setProteinType(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={fieldStyle()}>
                <option value="">Not set</option>
                <option value="red_meat">Red meat</option>
                <option value="poultry">Poultry</option>
                <option value="fish">Fish</option>
                <option value="vegetarian">Vegetarian</option>
              </select>
            </label>
          </div>

          <label className="text-xs" style={{ color: "#8A8071" }}>This recipe is written for how many servings?
            <input type="number" min="1" value={servings} onChange={(e) => setServings(parseInt(e.target.value) || 4)} className="w-24 mt-1 px-3 py-2 rounded-xl text-sm outline-none block" style={fieldStyle()} />
          </label>

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes, tips, substitutions..." rows={2} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={fieldStyle()} />
        </div>

        <div className="flex items-center justify-between mb-2">
          <h3 className="font-serif font-semibold text-sm">Ingredients</h3>
          <span className="text-xs font-semibold" style={{ color: "#C08A2E" }}>{fmtCHF(estCostTotal)} total</span>
        </div>
        <datalist id="ingredient-name-list">{ingredientNames.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="flex flex-col gap-2 mb-3">
          {ingredients.map((ing, i) => (
            <div key={i} className="rounded-xl p-2.5" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
              <div className="flex gap-2 mb-2">
                <select value={ing.category} onChange={(e) => updateIngredient(i, { category: e.target.value })} className="text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()}>
                  {INGREDIENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={ing.name} onChange={(e) => handleIngredientNameChange(i, e.target.value)} list="ingredient-name-list" placeholder="Ingredient name" className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()} />
                <button onClick={() => removeIngredientRow(i)} className="shrink-0 px-1.5" style={{ color: "#B23A2E" }}><X size={14} /></button>
              </div>
              <div className="flex gap-2">
                <input type="number" step="any" value={ing.quantity} onChange={(e) => updateIngredient(i, { quantity: e.target.value })} placeholder="Qty" className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()} />
                <select value={ing.unit} onChange={(e) => updateIngredient(i, { unit: e.target.value })} className="text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()}>
                  {INGREDIENT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input type="number" step="0.05" value={ing.estCost} onChange={(e) => updateIngredient(i, { estCost: e.target.value })} placeholder="CHF" className="w-16 text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()} />
                <input value={ing.notes} onChange={(e) => updateIngredient(i, { notes: e.target.value })} placeholder="Note (optional)" className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg outline-none" style={fieldStyle()} />
              </div>
            </div>
          ))}
        </div>
        <button onClick={addIngredientRow} className="w-full text-sm font-medium py-2 rounded-xl mb-5" style={{ backgroundColor: "#FFFFFF", border: "1px dashed #C7BFAE", color: "#5C5648" }}>+ Add ingredient</button>

        <h3 className="font-serif font-semibold text-sm mb-2">Recipe steps <span className="font-normal text-xs" style={{ color: "#8A8071" }}>(optional)</span></h3>
        <div className="flex flex-col gap-2 mb-3">
          {recipeSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: "#EAF1EC", color: "#3F6B4A" }}>{i + 1}</span>
              <input value={step} onChange={(e) => updateStep(i, e.target.value)} placeholder={`Step ${i + 1}`} className="flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-lg outline-none" style={fieldStyle()} />
              <button onClick={() => removeStep(i)} className="shrink-0 px-1" style={{ color: "#B23A2E" }}><X size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={addStep} className="w-full text-sm font-medium py-2 rounded-xl mb-4" style={{ backgroundColor: "#FFFFFF", border: "1px dashed #C7BFAE", color: "#5C5648" }}>+ Add step</button>

        {error && <p className="text-xs mb-3" style={{ color: "#B23A2E" }}>{error}</p>}
        <button onClick={handleSave} disabled={!canSave || saving} className="w-full py-3 rounded-xl text-sm font-semibold" style={{ backgroundColor: canSave && !saving ? "#3F6B4A" : "#C7BFAE", color: "#fff" }}>
          {saving ? "Saving..." : isEdit ? "Save changes" : "Save meal"}
        </button>
      </div>
    </div>
  );
}

function buildPlainTextList(weekMonday, shoppingList, remainingOnly, checked) {
  const items = remainingOnly
    ? shoppingList.filter((item) => !checked[`${item.category}|${item.name}|${item.unit || ""}`])
    : shoppingList;
  const lines = [`Shopping list — ${fmtWeekRange(weekMonday)}${remainingOnly ? " (remaining)" : ""}`, ""];
  let lastCategory = null;
  items.forEach((item) => {
    if (item.category !== lastCategory) {
      lines.push("", item.category.toUpperCase());
      lastCategory = item.category;
    }
    const qty = Math.round(item.quantity * 100) / 100;
    lines.push(`- ${item.name}: ${qty}${item.unit ? " " + item.unit : ""}`);
  });
  return lines.join("\n").trim();
}

function ShopView({ weekMonday, shoppingList, checked, toggleChecked, checkedCount, weekCost, hasMeals, isShoppingLocked, isKid, shoppingKidBlocked, onToggleShoppingLock }) {
  const [copied, setCopied] = useState(null);
  const [hideChecked, setHideChecked] = useState(false);

  async function handleCopy(remainingOnly) {
    const text = buildPlainTextList(weekMonday, shoppingList, remainingOnly, checked);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(remainingOnly ? "remaining" : "all");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this text:", text);
    }
  }

  if (!hasMeals) {
    return (
      <div className="text-center py-16">
        <ShoppingCart size={32} className="mx-auto mb-3" style={{ color: "#C7BFAE" }} />
        <p className="font-serif font-semibold mb-1">No meals planned yet</p>
        <p className="text-sm" style={{ color: "#8A8071" }}>Head to the Plan tab and add meals to this week to build your shopping list.</p>
      </div>
    );
  }
  const visibleList = hideChecked
    ? shoppingList.filter((item) => !checked[`${item.category}|${item.name}|${item.unit || ""}`])
    : shoppingList;
  let lastCategory = null;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-serif font-semibold">{fmtWeekRange(weekMonday)}</p>
            {isKid ? (
              isShoppingLocked && <Lock size={13} color="#B23A2E" />
            ) : (
              <button onClick={onToggleShoppingLock} title={isShoppingLocked ? "Unlock shopping list" : "Lock shopping list"}>
                {isShoppingLocked ? <Lock size={14} color="#B23A2E" /> : <Unlock size={14} color="#C7BFAE" />}
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: "#8A8071" }}>{checkedCount}/{shoppingList.length} checked</p>
        </div>
        <p className="text-lg font-semibold" style={{ color: "#C08A2E" }}>{fmtCHF(weekCost)}</p>
      </div>
      {shoppingKidBlocked && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl" style={{ backgroundColor: "#F5E7E4" }}>
          <Lock size={14} color="#B23A2E" className="shrink-0" />
          <p className="text-xs" style={{ color: "#B23A2E" }}>The shopping list is locked by a parent right now.</p>
        </div>
      )}
      <div className="flex gap-2 mb-2">
        <button onClick={() => handleCopy(false)} className="flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl" style={{ backgroundColor: "#FFFFFF", border: "1px dashed #C7BFAE", color: "#5C5648" }}>
          <Copy size={14} /> {copied === "all" ? "Copied!" : "Copy all"}
        </button>
        <button onClick={() => handleCopy(true)} className="flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl" style={{ backgroundColor: "#FFFFFF", border: "1px dashed #C7BFAE", color: "#5C5648" }}>
          <Copy size={14} /> {copied === "remaining" ? "Copied!" : "Copy remaining"}
        </button>
      </div>
      <button onClick={() => setHideChecked((v) => !v)} className="w-full flex items-center justify-center gap-2 text-sm font-medium py-2 rounded-xl mb-4" style={hideChecked ? { backgroundColor: "#3F6B4A", color: "#fff" } : { backgroundColor: "transparent", color: "#5C5648" }}>
        {hideChecked ? <Eye size={14} /> : <EyeOff size={14} />} {hideChecked ? "Showing remaining only" : "Hide checked items"}
      </button>
      <div className="flex flex-col">
        {visibleList.map((item) => {
          const key = `${item.category}|${item.name}|${item.unit || ""}`;
          const isChecked = !!checked[key];
          const showHeader = item.category !== lastCategory;
          lastCategory = item.category;
          return (
            <React.Fragment key={key}>
              {showHeader && <p className="text-xs font-bold uppercase tracking-wide mt-4 mb-1.5 first:mt-0" style={{ color: "#8A8071" }}>{item.category}</p>}
              <button onClick={() => toggleChecked(key)} className="w-full flex items-center gap-3 py-2.5 text-left" style={{ borderBottom: "1px solid #EFE9DC", opacity: shoppingKidBlocked ? 0.6 : 1 }}>
                <span className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center" style={{ backgroundColor: isChecked ? "#3F6B4A" : "#FFFFFF", border: isChecked ? "1px solid #3F6B4A" : "1px solid #C7BFAE" }}>{isChecked && <Check size={13} color="#fff" strokeWidth={3} />}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm block" style={{ color: isChecked ? "#B0A793" : "#2B2620", textDecoration: isChecked ? "line-through" : "none" }}>{item.name}</span>
                  {item.mealNames?.length > 0 && (
                    <span className="text-[11px] block" style={{ color: "#8A8071" }}>{item.mealNames.join(", ")}</span>
                  )}
                </span>
                <span className="text-xs font-medium shrink-0" style={{ color: isChecked ? "#C7BFAE" : "#5C5648" }}>{Math.round(item.quantity * 100) / 100} {item.unit || ""}</span>
                <span className="text-xs font-semibold shrink-0 w-14 text-right" style={{ color: isChecked ? "#C7BFAE" : "#C08A2E" }}>{fmtCHF(item.estCost)}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SettingsView({ people, settings, updatePerson, updateSettings, onLogout }) {
  const [familySizeInput, setFamilySizeInput] = useState(settings.family_size ?? "");
  useEffect(() => { setFamilySizeInput(settings.family_size ?? ""); }, [settings.family_size]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-serif font-semibold text-sm mb-2" style={{ color: "#8A8071" }}>FAMILY SIZE</h2>
        <div className="rounded-2xl p-4" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
          <input
            type="number"
            min="1"
            value={familySizeInput}
            onChange={(e) => setFamilySizeInput(e.target.value)}
            onBlur={() => updateSettings({ family_size: familySizeInput === "" ? null : parseInt(familySizeInput, 10) })}
            placeholder="e.g. 4"
            className="w-24 px-3 py-2 rounded-xl text-sm outline-none"
            style={{ backgroundColor: "#FAF7F0", border: "1px solid #E8E1D4" }}
          />
          <p className="text-xs mt-2" style={{ color: "#8A8071" }}>Scales ingredient quantities and costs against each meal's own servings. Leave blank to use each meal's recipe amounts as written.</p>
        </div>
      </section>

      <section>
        <h2 className="font-serif font-semibold text-sm mb-2" style={{ color: "#8A8071" }}>LANGUAGE</h2>
        <div className="flex gap-2">
          <button className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#3F6B4A", color: "#fff" }}>English</button>
          <button disabled className="flex-1 py-2.5 rounded-xl text-sm font-medium" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4", color: "#C7BFAE" }}>Deutsch (coming soon)</button>
        </div>
      </section>

      <section>
        <h2 className="font-serif font-semibold text-sm mb-2" style={{ color: "#8A8071" }}>PEOPLE</h2>
        <div className="flex flex-col gap-2.5">
          {people.map((p) => (
            <div key={p.id} className="rounded-2xl p-3.5 flex items-center gap-3" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8E1D4" }}>
              <label className="relative cursor-pointer">
                <PersonAvatar person={p} size={34} />
                <input type="color" value={p.color} onChange={(e) => updatePerson(p.id, { color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              <input
                type="text"
                maxLength={2}
                value={p.initials}
                onChange={(e) => updatePerson(p.id, { initials: e.target.value.toUpperCase() })}
                className="w-14 px-2 py-1.5 rounded-lg text-sm text-center font-semibold outline-none"
                style={{ backgroundColor: "#FAF7F0", border: "1px solid #E8E1D4" }}
              />
            </div>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: "#8A8071" }}>Tap the coloured circle to change colour, edit initials directly.</p>
      </section>

      <section>
        <button onClick={onLogout} className="w-full py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: "#FFFFFF", border: "1px solid #B23A2E", color: "#B23A2E" }}>
          Log out
        </button>
      </section>
    </div>
  );
}
