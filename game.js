const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Use /data volume on Railway for persistence, fallback to local file
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT ? '/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'gamedata.json');

// ═══════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════
const CONFIG = {
  attackCooldown: 30000,
  statsCooldown: 20000,
  bossCooldown: 15000,
  theGameCooldown: 300000,
  dailyCooldown: 86400000,
  dodgeWindow: 5000,

  boss1BaseHP: 1500,
  boss1PerPlayer: 60,
  boss2BaseHP: 5000,
  boss2PerPlayer: 180,

  baseMinDmg: 8,
  baseMaxDmg: 12,
  dmgPerLevel: 1,
  critLevel: 5,
  baseCritChance: 0.05,
  critPerLevel: 0.005,
  critMultiplier: 2.5,

  // Gold economy — 1000g = $1 USD
  goldPerHit: 1,           // 1 gold per attack
  baseXP: 25,
  baseGold: 15,            // kill participation reward
  mvpXP: 100,
  mvpGold: 50,             // MVP bonus
  top3Gold: 30,
  top5Gold: 15,
  dailyXP: 20,
  dailyGold: 50,           // daily claim ($0.05)
  top5XP: 50,
  dodgePenalty: 5,         // gold lost if you don't dodge

  xpPerLevel: 100,
  breakDuration: 180000,
  activeWindow: 600000,
  saveInterval: 60000,

  // Cash prize exchange rate (admin sets this)
  goldPerDollar: 1000,      // 1000 gold = $1 IRL
};

// ═══════════════════════════════════════════
// Arena PvP System
// ═══════════════════════════════════════════
const ARENA_CONFIG = {
  // Level brackets — matchmaking only pairs within same bracket
  brackets: [
    { id: 'bronze',   label: 'Bronze',   minLv: 1,  maxLv: 15 },
    { id: 'silver',   label: 'Silver',   minLv: 16, maxLv: 30 },
    { id: 'gold',     label: 'Gold',     minLv: 31, maxLv: 50 },
    { id: 'platinum', label: 'Platinum', minLv: 51, maxLv: 75 },
    { id: 'diamond',  label: 'Diamond',  minLv: 76, maxLv: 100 },
  ],
  // Stat scaling — gear stats are compressed in arena
  pvpStatScale: {
    dmgMult: 0.5,      // Gear dmg bonus counts at 50% in arena
    maxHP: 0.5,         // Gear HP bonus counts at 50% in arena
    critChance: 0.6,    // Gear crit chance at 60%
    critMult: 0.5,      // Gear crit mult at 50%
    dodgeChance: 0.5,   // Gear dodge at 50%
  },
  // Rating ranks (display only)
  ranks: [
    { name: 'Unranked',     icon: '⚪', minRating: 0 },
    { name: 'Bronze',       icon: '🥉', minRating: 800 },
    { name: 'Silver',       icon: '🥈', minRating: 1000 },
    { name: 'Gold',         icon: '🥇', minRating: 1200 },
    { name: 'Platinum',     icon: '💠', minRating: 1400 },
    { name: 'Diamond',      icon: '💎', minRating: 1600 },
    { name: 'Champion',     icon: '👑', minRating: 1800 },
    { name: 'Grandmaster',  icon: '⚔️', minRating: 2000 },
  ],
  // Token rewards
  winTokens: 15,
  loseTokens: 5,
  drawTokens: 8,
  // Streak bonus: extra tokens per consecutive win (capped at 5x)
  streakBonus: 3,
  maxStreakBonus: 5,
};

// PvP Shop — exclusive cosmetics purchasable with arena tokens
const PVP_SHOP = [
  { id: 'gladiator_helm',   name: 'Gladiator Helm',     type: 'wearable', slot: 'hat',   cost: 100,  rarity: 'rare',      icon: '⚔️', desc: 'Forged in the arena' },
  { id: 'champion_crown',   name: 'Champion Crown',     type: 'wearable', slot: 'hat',   cost: 500,  rarity: 'legendary', icon: '👑', desc: 'Only true champions wear this' },
  { id: 'arena_cloak',      name: 'Arena Cloak',        type: 'wearable', slot: 'cape',  cost: 150,  rarity: 'rare',      icon: '🏟️', desc: 'Blood-red arena cape' },
  { id: 'victor_mantle',    name: "Victor's Mantle",    type: 'wearable', slot: 'cape',  cost: 750,  rarity: 'legendary', icon: '🏆', desc: 'Shimmering golden victory cape' },
  { id: 'battle_bracer',    name: 'Battle Bracer',      type: 'wearable', slot: 'wrist', cost: 80,   rarity: 'uncommon',  icon: '🛡️', desc: 'Scarred arena bracer' },
  { id: 'duelist_mask',     name: "Duelist's Mask",     type: 'wearable', slot: 'face',  cost: 400,  rarity: 'epic',      icon: '🎭', desc: 'The mask of a feared duelist' },
];

// ═══════════════════════════════════════════
// Loot Tables
// ═══════════════════════════════════════════
const RARITY_COLOR = { common: '#aaa', uncommon: '#4ade80', rare: '#60a5fa', epic: '#c084fc', legendary: '#fbbf24', mythic: '#ff4500' };
// Estimated market values by rarity (for display only — no NPC selling)
const VENDOR_PRICE = { common: 100, uncommon: 500, rare: 2000, epic: 8000, legendary: 30000, mythic: 100000 };

const BOSS_LOOT = {
  // Top 1 (MVP) — legendary or epic
  mvp: [
    { id: 'dragonblade', name: "Dragon's Edge", rarity: 'legendary', slot: 'weapon', stat: 'dmgMult', value: 1.06, desc: '+6% damage (Boss & PvP)' },
    { id: 'voidhelm', name: 'Void Crown', rarity: 'legendary', slot: 'armor', stat: 'maxHP', value: 50, desc: '+50 HP (Boss & PvP)' },
    { id: 'phoenixring', name: 'Phoenix Signet', rarity: 'legendary', slot: 'accessory', stat: 'critMult', value: 0.3, desc: '+0.3 crit multiplier (Boss & PvP)' },
    { id: 'stormcleaver', name: 'Storm Cleaver', rarity: 'epic', slot: 'weapon', stat: 'dmgMult', value: 1.04, desc: '+4% damage (Boss & PvP)' },
    { id: 'lichscrown', name: "Lich's Diadem", rarity: 'legendary', slot: 'armor', stat: 'dodgeChance', value: 0.15, desc: '15% dodge chance (Boss & PvP)' },
  ],
  // Top 2-3 — rare or epic
  top3: [
    { id: 'flameblade', name: 'Flame Sword', rarity: 'epic', slot: 'weapon', stat: 'dmgMult', value: 1.03, desc: '+3% damage (Boss & PvP)' },
    { id: 'ironwall', name: 'Iron Bulwark', rarity: 'rare', slot: 'armor', stat: 'maxHP', value: 25, desc: '+25 HP (Boss & PvP)' },
    { id: 'swiftdagger', name: 'Swift Dagger', rarity: 'epic', slot: 'weapon', stat: 'cdReduce', value: 0.10, desc: '10% cooldown reduction' },
    { id: 'amuletoffortune', name: 'Amulet of Fortune', rarity: 'rare', slot: 'accessory', stat: 'critChance', value: 0.05, desc: '+5% crit chance (Boss & PvP)' },
    { id: 'shadowcloak', name: 'Shadow Cloak', rarity: 'epic', slot: 'armor', stat: 'dodgeChance', value: 0.08, desc: '8% dodge chance (Boss & PvP)' },
  ],
  // Top 4-15 — common or uncommon
  rest: [
    { id: 'rustyaxe', name: 'Battered Axe', rarity: 'uncommon', slot: 'weapon', stat: 'dmgMult', value: 1.01, desc: '+1% damage (Boss & PvP)' },
    { id: 'chainmail', name: 'Chain Mail', rarity: 'common', slot: 'armor', stat: 'maxHP', value: 10, desc: '+10 HP (Boss & PvP)' },
    { id: 'luckycoin', name: 'Lucky Coin', rarity: 'uncommon', slot: 'accessory', stat: 'critChance', value: 0.02, desc: '+2% crit chance (Boss & PvP)' },
    { id: 'woodshield', name: 'Wooden Shield', rarity: 'common', slot: 'armor', stat: 'maxHP', value: 5, desc: '+5 HP (Boss & PvP)' },
    { id: 'bronzering', name: 'Bronze Ring', rarity: 'common', slot: 'accessory', stat: 'goldFind', value: 0.10, desc: '+10% gold find' },
    { id: 'steelknife', name: 'Steel Knife', rarity: 'uncommon', slot: 'weapon', stat: 'dmgMult', value: 1.015, desc: '+1.5% damage (Boss & PvP)' },
    { id: 'leatherboots', name: 'Leather Boots', rarity: 'common', slot: 'accessory', stat: 'cdReduce', value: 0.05, desc: '5% cooldown reduction' },
    { id: 'ironhelm', name: 'Iron Helmet', rarity: 'common', slot: 'armor', stat: 'maxHP', value: 8, desc: '+8 HP (Boss & PvP)' },
  ],
};

// ═══════════════════════════════════════════
// Item Definitions (weapons, armor, consumables, materials)
// ═══════════════════════════════════════════
const ITEMS = {
  // ── NPC Weapons (buyable from shop) ──
  wooden_sword:   { id: 'wooden_sword',   name: 'Wooden Sword',   type: 'weapon', rarity: 'common',   dmgBonus: 2,  maxDurability: 80,  desc: '+2 damage', icon: '🗡️', shopPrice: 0 },
  rusty_mace:     { id: 'rusty_mace',     name: 'Rusty Mace',     type: 'weapon', rarity: 'common',   dmgBonus: 3,  maxDurability: 90,  desc: '+3 damage', icon: '🔨', shopPrice: 500 },
  iron_sword:     { id: 'iron_sword',     name: 'Iron Sword',     type: 'weapon', rarity: 'uncommon', dmgBonus: 5,  maxDurability: 120, desc: '+5 damage', icon: '⚔️', shopPrice: 2500 },
  hunter_bow:     { id: 'hunter_bow',     name: 'Hunter\'s Bow',  type: 'weapon', rarity: 'uncommon', dmgBonus: 7,  maxDurability: 100, desc: '+7 damage', icon: '🏹', shopPrice: 4000 },
  crimson_sabre:  { id: 'crimson_sabre',  name: 'Crimson Sabre',  type: 'weapon', rarity: 'uncommon', dmgBonus: 6,  maxDurability: 110, desc: '+6 damage — curved blade with a blood-red tint', icon: '🗡️', shopPrice: 3000 },
  steel_blade:    { id: 'steel_blade',    name: 'Steel Blade',    type: 'weapon', rarity: 'rare',     dmgBonus: 10, maxDurability: 180, desc: '+10 damage', icon: '🔪', shopPrice: 8000 },
  war_axe:        { id: 'war_axe',        name: 'War Axe',        type: 'weapon', rarity: 'rare',     dmgBonus: 12, maxDurability: 160, desc: '+12 damage', icon: '🪓', shopPrice: 12000 },
  frost_spear:    { id: 'frost_spear',    name: 'Frost Spear',    type: 'weapon', rarity: 'rare',     dmgBonus: 14, maxDurability: 170, desc: '+14 damage — chills on hit', icon: '🔱', shopPrice: 15000 },
  tempest_blade:  { id: 'tempest_blade',  name: 'Tempest Blade',  type: 'weapon', rarity: 'rare',     dmgBonus: 11, maxDurability: 175, desc: '+11 damage — wind-etched steel hums in combat', icon: '🗡️', shopPrice: 10000 },
  shadow_dagger:  { id: 'shadow_dagger',  name: 'Shadow Dagger',  type: 'weapon', rarity: 'epic',     dmgBonus: 18, maxDurability: 220, desc: '+18 damage', icon: '🗡️', shopPrice: 25000 },
  thunder_hammer: { id: 'thunder_hammer', name: 'Thunder Hammer', type: 'weapon', rarity: 'epic',     dmgBonus: 22, maxDurability: 240, desc: '+22 damage — crackling with lightning', icon: '⚒️', shopPrice: 35000 },
  inferno_blade:  { id: 'inferno_blade',  name: 'Inferno Blade',  type: 'weapon', rarity: 'epic',     dmgBonus: 21, maxDurability: 250, desc: '+21 damage — wreathed in living flame', icon: '🗡️', shopPrice: 30000 },
  // ── NPC Armor (buyable from shop) ──
  cloth_armor:    { id: 'cloth_armor',    name: 'Cloth Armor',    type: 'armor',  rarity: 'common',   defBonus: 1,  maxDurability: 80,  desc: '-1 damage taken', icon: '👕', shopPrice: 0 },
  padded_tunic:   { id: 'padded_tunic',   name: 'Padded Tunic',   type: 'armor',  rarity: 'common',   defBonus: 2,  maxDurability: 90,  desc: '-2 damage taken', icon: '👔', shopPrice: 400 },
  leather_vest:   { id: 'leather_vest',   name: 'Leather Vest',   type: 'armor',  rarity: 'uncommon', defBonus: 3,  maxDurability: 120, desc: '-3 damage taken', icon: '🦺', shopPrice: 2000 },
  ranger_cloak:   { id: 'ranger_cloak',   name: 'Ranger Cloak',   type: 'armor',  rarity: 'uncommon', defBonus: 4,  maxDurability: 110, desc: '-4 damage taken', icon: '🧥', shopPrice: 3500 },
  studded_leather:{ id: 'studded_leather',name: 'Studded Leather', type: 'armor',  rarity: 'uncommon', defBonus: 5,  maxDurability: 115, desc: '-5 damage taken — reinforced with iron studs', icon: '🦺', shopPrice: 3200 },
  chain_armor:    { id: 'chain_armor',    name: 'Chain Armor',    type: 'armor',  rarity: 'rare',     defBonus: 6,  maxDurability: 180, desc: '-6 damage taken', icon: '🛡️', shopPrice: 7000 },
  knight_plate:   { id: 'knight_plate',   name: 'Knight Plate',   type: 'armor',  rarity: 'rare',     defBonus: 8,  maxDurability: 200, desc: '-8 damage taken', icon: '🛡️', shopPrice: 11000 },
  frost_mail:     { id: 'frost_mail',     name: 'Frost Mail',     type: 'armor',  rarity: 'rare',     defBonus: 10, maxDurability: 190, desc: '-10 damage taken — cold to the touch', icon: '❄️', shopPrice: 14000 },
  battle_cuirass: { id: 'battle_cuirass', name: 'Battle Cuirass', type: 'armor',  rarity: 'rare',     defBonus: 7,  maxDurability: 185, desc: '-7 damage taken — forged for front-line warriors', icon: '🛡️', shopPrice: 9000 },
  dark_plate:     { id: 'dark_plate',     name: 'Dark Plate',     type: 'armor',  rarity: 'epic',     defBonus: 12, maxDurability: 250, desc: '-12 damage taken', icon: '🛡️', shopPrice: 22000 },
  storm_aegis:    { id: 'storm_aegis',    name: 'Storm Aegis',    type: 'armor',  rarity: 'epic',     defBonus: 15, maxDurability: 260, desc: '-15 damage taken — hums with static', icon: '⚡', shopPrice: 32000 },
  phantom_shroud: { id: 'phantom_shroud', name: 'Phantom Shroud', type: 'armor',  rarity: 'epic',     defBonus: 13, maxDurability: 255, desc: '-13 damage taken — woven from spectral threads', icon: '👻', shopPrice: 26000 },
  // ── NPC Legendary Weapons (top-tier shop) ──
  radiant_longsword:{ id: 'radiant_longsword', name: 'Radiant Longsword', type: 'weapon', rarity: 'legendary', dmgBonus: 28, maxDurability: 320, desc: '+28 damage — blazes with golden light', icon: '⚔️', shopPrice: 60000 },
  dragons_warhammer:{ id: 'dragons_warhammer', name: 'Dragon\'s Warhammer', type: 'weapon', rarity: 'legendary', dmgBonus: 32, maxDurability: 340, desc: '+32 damage — forged from dragonscale iron', icon: '⚒️', shopPrice: 75000 },
  // ── NPC Legendary Armor (top-tier shop) ──
  golden_aegis:    { id: 'golden_aegis',    name: 'Golden Aegis',    type: 'armor', rarity: 'legendary', defBonus: 22, maxDurability: 320, desc: '-22 damage taken — plated in blessed gold', icon: '🛡️', shopPrice: 55000 },
  dragonscale_mail:{ id: 'dragonscale_mail', name: 'Dragonscale Mail', type: 'armor', rarity: 'legendary', defBonus: 26, maxDurability: 340, desc: '-26 damage taken — scales shimmer like embers', icon: '🐉', shopPrice: 70000 },
  // ── Consumables (NPC shop + drops) ──
  health_potion:  { id: 'health_potion',  name: 'Health Potion',  type: 'consumable', subtype: 'heal',       value: 30,   desc: 'Restore 30 HP', icon: '❤️', shopPrice: 75, stackable: true },
  power_elixir:   { id: 'power_elixir',   name: 'Power Elixir',   type: 'consumable', subtype: 'buff_dmg',   value: 1.25, duration: 300000, desc: '+25% dmg 5min', icon: '💪', shopPrice: 250, stackable: true },
  shield_scroll:  { id: 'shield_scroll',  name: 'Shield Scroll',  type: 'consumable', subtype: 'buff_def',   value: 5,    duration: 300000, desc: '+5 def 5min', icon: '📜', shopPrice: 180, stackable: true },
  speed_tonic:    { id: 'speed_tonic',    name: 'Speed Tonic',    type: 'consumable', subtype: 'buff_speed', value: 1.5,  duration: 180000, desc: '+50% speed 3min', icon: '⚡', shopPrice: 120, stackable: true },
  repair_kit:     { id: 'repair_kit',     name: 'Repair Kit',     type: 'consumable', subtype: 'repair',     value: 50,   desc: 'Restore 50 durability', icon: '🔧', shopPrice: 500, stackable: true },
  // ── Starter Kit ──
  starter_kit:    { id: 'starter_kit',    name: 'Starter Kit',    type: 'consumable', subtype: 'kit', desc: 'A care package for new adventurers. Open it!', icon: '🎁', stackable: false, sellPrice: 0 },
  // ── Key Items ──
  goblin_key:     { id: 'goblin_key',     name: 'Goblin King\'s Key', type: 'material', rarity: 'epic',     desc: 'An ornate key pried from the Goblin King\'s throne. Opens something in his hut...', icon: '🔑', stackable: false },
  // ── Special Rewards ──
  kings_bludgeon: { id: 'kings_bludgeon', name: 'King\'s Bludgeon',   type: 'weapon',   rarity: 'epic',     dmgBonus: 20, maxDurability: 250, desc: '+20 damage — The Goblin King\'s massive war club, still stained with gold dust', icon: '🏏' },
  // ── Ancient Treant Boss Drops ──
  heartwood_greataxe: { id: 'heartwood_greataxe', name: 'Heartwood Greataxe', type: 'weapon', rarity: 'legendary', dmgBonus: 28, maxDurability: 350, desc: '+28 damage — Carved from the Treant\'s living heartwood, pulses with primal energy', icon: '🪓' },
  ancient_bark_plate: { id: 'ancient_bark_plate', name: 'Ancient Bark Plate', type: 'armor', rarity: 'legendary', defBonus: 18, maxDurability: 350, desc: '-18 damage taken — Living bark armor that slowly regenerates', icon: '🌳' },
  // ── Materials (drops only — used for crafting) ──
  slime_gel:      { id: 'slime_gel',      name: 'Slime Gel',      type: 'material', rarity: 'common',   desc: 'Sticky gel from slimes', icon: '🟢', stackable: true },
  goblin_ear:     { id: 'goblin_ear',     name: 'Goblin Ear',     type: 'material', rarity: 'common',   desc: 'Pointy goblin ear', icon: '👂', stackable: true },
  wolf_fang:      { id: 'wolf_fang',      name: 'Wolf Fang',      type: 'material', rarity: 'uncommon', desc: 'Sharp wolf fang', icon: '🦷', stackable: true },
  treant_bark:    { id: 'treant_bark',    name: 'Treant Bark',    type: 'material', rarity: 'rare',     desc: 'Ancient living bark', icon: '🪵', stackable: true },
  bone_fragment:  { id: 'bone_fragment',  name: 'Bone Fragment',  type: 'material', rarity: 'common',   desc: 'Bleached skeleton bone', icon: '🦴', stackable: true },
  zombie_flesh:   { id: 'zombie_flesh',   name: 'Zombie Flesh',   type: 'material', rarity: 'common',   desc: 'Rotting zombie flesh', icon: '🧟', stackable: true },
  wraith_essence: { id: 'wraith_essence', name: 'Wraith Essence', type: 'material', rarity: 'uncommon', desc: 'Ethereal wraith energy', icon: '👻', stackable: true },
  demon_core:     { id: 'demon_core',     name: 'Demon Core',     type: 'material', rarity: 'rare',     desc: 'Burning demon heart', icon: '🔴', stackable: true },
  iron_ore:       { id: 'iron_ore',       name: 'Iron Ore',       type: 'material', rarity: 'common',   desc: 'Raw iron ore', icon: '⬜', stackable: true, sellPrice: 3 },
  gold_nugget:    { id: 'gold_nugget',    name: 'Gold Nugget',    type: 'material', rarity: 'uncommon', desc: 'Shiny gold nugget', icon: '🟡', stackable: true, sellPrice: 8 },
  crystal_shard:  { id: 'crystal_shard',  name: 'Crystal Shard',  type: 'material', rarity: 'rare',     desc: 'Glowing crystal shard', icon: '🔮', stackable: true, sellPrice: 15 },
  void_fragment:  { id: 'void_fragment',  name: 'Void Fragment',  type: 'material', rarity: 'epic',     desc: 'Fragment of the void', icon: '🌀', stackable: true, sellPrice: 40 },
  // ── Mining Materials (quarry drops — sellable to Grizzle) ──
  stone_chunk:    { id: 'stone_chunk',    name: 'Stone Chunk',    type: 'material', rarity: 'common',   desc: 'A solid chunk of quarry stone', icon: '🪨', stackable: true, sellPrice: 1 },
  copper_ore:     { id: 'copper_ore',     name: 'Copper Ore',     type: 'material', rarity: 'common',   desc: 'Raw copper ore with green patina', icon: '🟤', stackable: true, sellPrice: 2 },
  raw_gem:        { id: 'raw_gem',        name: 'Raw Gem',        type: 'material', rarity: 'rare',     desc: 'An uncut gemstone glowing faintly blue', icon: '💎', stackable: true, sellPrice: 20 },
  ruby_shard:     { id: 'ruby_shard',     name: 'Ruby Shard',     type: 'material', rarity: 'rare',     desc: 'A shard of deep crimson ruby', icon: '🔴', stackable: true, sellPrice: 25 },
  diamond_chunk:  { id: 'diamond_chunk',  name: 'Diamond Chunk',  type: 'material', rarity: 'epic',     desc: 'A rough diamond, blindingly brilliant', icon: '💠', stackable: true, sellPrice: 35 },
  // ── Fuel ──
  coal:           { id: 'coal',           name: 'Coal',           type: 'material', rarity: 'common',   desc: 'Black coal — fuel for the smelter', icon: '⬛', stackable: true, sellPrice: 1, shopPrice: 3 },
  // ── Refined Materials (smelted/cut from raw ores) ──
  stone_block:    { id: 'stone_block',    name: 'Stone Block',    type: 'material', rarity: 'common',   desc: 'Shaped quarry stone block', icon: '🧱', stackable: true, sellPrice: 3 },
  copper_bar:     { id: 'copper_bar',     name: 'Copper Bar',     type: 'material', rarity: 'common',   desc: 'Smelted copper bar', icon: '🟫', stackable: true, sellPrice: 5 },
  iron_bar:       { id: 'iron_bar',       name: 'Iron Bar',       type: 'material', rarity: 'common',   desc: 'Smelted iron bar', icon: '⬜', stackable: true, sellPrice: 8 },
  gold_ingot:     { id: 'gold_ingot',     name: 'Gold Ingot',     type: 'material', rarity: 'uncommon', desc: 'Gleaming smelted gold ingot', icon: '🟨', stackable: true, sellPrice: 18 },
  crystal_lens:   { id: 'crystal_lens',   name: 'Crystal Lens',   type: 'material', rarity: 'rare',     desc: 'Polished crystal lens — refracts light', icon: '🔮', stackable: true, sellPrice: 30 },
  cut_gem:        { id: 'cut_gem',        name: 'Cut Gem',        type: 'material', rarity: 'rare',     desc: 'Expertly faceted gemstone', icon: '💎', stackable: true, sellPrice: 42 },
  polished_ruby:  { id: 'polished_ruby',  name: 'Polished Ruby',  type: 'material', rarity: 'rare',     desc: 'Deep crimson polished ruby', icon: '❤️', stackable: true, sellPrice: 50 },
  cut_diamond:    { id: 'cut_diamond',    name: 'Cut Diamond',    type: 'material', rarity: 'epic',     desc: 'Perfectly cut diamond — dazzling', icon: '💠', stackable: true, sellPrice: 72 },
  void_crystal:   { id: 'void_crystal',   name: 'Void Crystal',   type: 'material', rarity: 'epic',     desc: 'Crystallized void energy — pulses with dark light', icon: '🌀', stackable: true, sellPrice: 85 },
  // ── Enchantment Books (rare mining drops — apply to equipment) ──
  book_sharpness: { id: 'book_sharpness', name: 'Book of Sharpness', type: 'enchant_book', rarity: 'rare',      desc: '+4 damage bonus to weapon', icon: '📕', stackable: true, enchant: 'sharpness' },
  book_protection:{ id: 'book_protection',name: 'Book of Protection',type: 'enchant_book', rarity: 'rare',      desc: '+3 defense bonus to armor', icon: '📗', stackable: true, enchant: 'protection' },
  book_fortune:   { id: 'book_fortune',   name: 'Book of Fortune',   type: 'enchant_book', rarity: 'epic',      desc: '+15% gold find from mining', icon: '📒', stackable: true, enchant: 'fortune' },
  book_lifesteal: { id: 'book_lifesteal', name: 'Book of Lifesteal', type: 'enchant_book', rarity: 'epic',      desc: 'Heal 8% of damage dealt', icon: '📙', stackable: true, enchant: 'lifesteal' },
  book_critical:  { id: 'book_critical',  name: 'Book of Criticals', type: 'enchant_book', rarity: 'epic',      desc: '+5% critical hit chance', icon: '📘', stackable: true, enchant: 'critical' },
  book_unbreaking:{ id: 'book_unbreaking',name: 'Book of Unbreaking',type: 'enchant_book', rarity: 'rare',      desc: '+50% durability on equipment', icon: '📓', stackable: true, enchant: 'unbreaking' },
  // ── Elemental Enchant Books (apply to non-mythic weapons — proc chance on hit) ──
  book_fire:      { id: 'book_fire',      name: 'Tome of Inferno',   type: 'enchant_book', rarity: 'legendary', desc: '10% chance to burn enemies on hit', icon: '📕🔥', stackable: true, enchant: 'fire_enchant', shopPrice: 15000 },
  book_poison:    { id: 'book_poison',    name: 'Tome of Venom',     type: 'enchant_book', rarity: 'legendary', desc: '10% chance to poison enemies on hit', icon: '📗☠️', stackable: true, enchant: 'poison_enchant', shopPrice: 12000 },
  book_holy:      { id: 'book_holy',      name: 'Tome of Radiance',  type: 'enchant_book', rarity: 'legendary', desc: '10% chance for holy burst on hit', icon: '📘✨', stackable: true, enchant: 'holy_enchant', shopPrice: 18000 },
  // ── Crafted Weapons (better than NPC shop) ──
  venom_blade:    { id: 'venom_blade',    name: 'Venom Blade',    type: 'weapon', rarity: 'rare',      dmgBonus: 14, maxDurability: 200, desc: '+14 damage (crafted)', icon: '🗡️', crafted: true },
  bone_cleaver:   { id: 'bone_cleaver',   name: 'Bone Cleaver',   type: 'weapon', rarity: 'epic',      dmgBonus: 22, maxDurability: 260, desc: '+22 damage (crafted)', icon: '🪓', crafted: true },
  void_edge:      { id: 'void_edge',      name: 'Void Edge',      type: 'weapon', rarity: 'legendary', dmgBonus: 30, maxDurability: 300, desc: '+30 damage (crafted)', icon: '⚔️', crafted: true },
  demon_scythe:   { id: 'demon_scythe',   name: 'Demon Scythe',   type: 'weapon', rarity: 'legendary', dmgBonus: 35, maxDurability: 280, desc: '+35 damage (crafted)', icon: '⚔️', crafted: true },
  mythic_blade:   { id: 'mythic_blade',   name: 'Mythic Blade',   type: 'weapon', rarity: 'mythic',    dmgBonus: 50, maxDurability: 400, enchant: 'poison', desc: '+50 damage (crafted)', icon: '⚔️', crafted: true },
  // ── Crafted Armor (better than NPC shop) ──
  wolf_hide:      { id: 'wolf_hide',      name: 'Wolf Hide Armor', type: 'armor', rarity: 'rare',      defBonus: 8,  maxDurability: 200, desc: '-8 damage taken (crafted)', icon: '🐺', crafted: true },
  wraith_cloak:   { id: 'wraith_cloak',   name: 'Wraith Cloak',    type: 'armor', rarity: 'epic',      defBonus: 14, maxDurability: 260, desc: '-14 damage taken (crafted)', icon: '👻', crafted: true },
  void_armor:     { id: 'void_armor',     name: 'Void Armor',      type: 'armor', rarity: 'legendary', defBonus: 20, maxDurability: 300, desc: '-20 damage taken (crafted)', icon: '🌀', crafted: true },
  demon_plate:    { id: 'demon_plate',    name: 'Demon Plate',     type: 'armor', rarity: 'legendary', defBonus: 24, maxDurability: 280, desc: '-24 damage taken (crafted)', icon: '😈', crafted: true },
  mythic_armor:   { id: 'mythic_armor',   name: 'Mythic Armor',    type: 'armor', rarity: 'mythic',    defBonus: 35, maxDurability: 400, desc: '-35 damage taken (crafted)', icon: '🛡️', crafted: true },
  // ── Mythic Drops (admin / ultra-rare event only — NOT craftable) ──
  celestial_greatsword: { id: 'celestial_greatsword', name: 'Celestial Greatsword', type: 'weapon', rarity: 'mythic', dmgBonus: 65, maxDurability: 600, enchant: 'holy', desc: '+65 damage — forged in starfire, radiates prismatic light', icon: '🌟' },
  abyssal_scythe:      { id: 'abyssal_scythe',      name: 'Abyssal Scythe',      type: 'weapon', rarity: 'mythic', dmgBonus: 58, maxDurability: 550, enchant: 'fire', desc: '+58 damage — harvests souls with every swing', icon: '🌙' },
  prismatic_aegis:     { id: 'prismatic_aegis',     name: 'Prismatic Aegis',     type: 'armor',  rarity: 'mythic', defBonus: 45, maxDurability: 600, desc: '-45 damage taken — shifts through every color of light', icon: '🌈' },
  starforged_crown:    { id: 'starforged_crown',    name: 'Starforged Crown',    type: 'armor',  rarity: 'mythic', defBonus: 40, maxDurability: 550, desc: '-40 damage taken — a crown woven from collapsed stars', icon: '👑' },
  // ── Mining Gear (equippable in mining-specific slots) ──
  basic_helmet:     { id: 'basic_helmet',     name: 'Rusty Miner Helmet',  type: 'mining_gear', slot: 'helmet',  rarity: 'common',   lightRadius: 20,  desc: '+20 light radius', icon: '⛑️', shopPrice: 500, stackable: true },
  iron_helmet:      { id: 'iron_helmet',      name: 'Iron Miner Helmet',   type: 'mining_gear', slot: 'helmet',  rarity: 'uncommon', lightRadius: 40,  desc: '+40 light radius', icon: '⛑️', shopPrice: 2000, stackable: true },
  crystal_helmet:   { id: 'crystal_helmet',   name: 'Crystal Lamp Helmet', type: 'mining_gear', slot: 'helmet',  rarity: 'rare',     lightRadius: 70,  desc: '+70 light radius', icon: '💡', shopPrice: 6000, stackable: true },
  basic_gloves:     { id: 'basic_gloves',     name: 'Leather Work Gloves', type: 'mining_gear', slot: 'gloves',  rarity: 'common',   mineSpeedMult: 0.90, desc: '-10% mining time', icon: '🧤', shopPrice: 400, stackable: true },
  iron_gloves:      { id: 'iron_gloves',      name: 'Reinforced Gloves',   type: 'mining_gear', slot: 'gloves',  rarity: 'uncommon', mineSpeedMult: 0.80, desc: '-20% mining time', icon: '🧤', shopPrice: 1800, stackable: true },
  crystal_gloves:   { id: 'crystal_gloves',   name: 'Crystal-Weave Gloves',type: 'mining_gear', slot: 'gloves',  rarity: 'rare',     mineSpeedMult: 0.65, desc: '-35% mining time', icon: '🧤', shopPrice: 5500, stackable: true },
  basic_boots:      { id: 'basic_boots',      name: 'Sturdy Mine Boots',   type: 'mining_gear', slot: 'boots',   rarity: 'common',   moveSpeedMult: 1.10, desc: '+10% move speed',  icon: '👢', shopPrice: 350, stackable: true },
  iron_boots:       { id: 'iron_boots',       name: 'Iron-Tread Boots',    type: 'mining_gear', slot: 'boots',   rarity: 'uncommon', moveSpeedMult: 1.20, desc: '+20% move speed',  icon: '👢', shopPrice: 1500, stackable: true },
  crystal_boots:    { id: 'crystal_boots',    name: 'Crystal Runner Boots', type: 'mining_gear', slot: 'boots',  rarity: 'rare',     moveSpeedMult: 1.35, desc: '+35% move speed',  icon: '👢', shopPrice: 5000, stackable: true },
  // ── Furniture (Housing) ──
  oak_table:        { id: 'oak_table',        name: 'Oak Table',           type: 'furniture', rarity: 'common',    desc: 'A sturdy oak table',       icon: '🪑', shopPrice: 800,   w: 2, h: 1, sprite: 'table' },
  wooden_chair:     { id: 'wooden_chair',     name: 'Wooden Chair',        type: 'furniture', rarity: 'common',    desc: 'Simple wooden chair',      icon: '🪑', shopPrice: 400,   w: 1, h: 1, sprite: 'chair' },
  straw_bed:        { id: 'straw_bed',        name: 'Straw Bed',           type: 'furniture', rarity: 'common',    desc: 'A humble straw bed',       icon: '🛏️', shopPrice: 600,   w: 2, h: 1, sprite: 'bed_straw' },
  cozy_bed:         { id: 'cozy_bed',         name: 'Cozy Bed',            type: 'furniture', rarity: 'uncommon',  desc: 'Soft quilted bed',         icon: '🛏️', shopPrice: 2500,  w: 2, h: 1, sprite: 'bed_cozy' },
  royal_bed:        { id: 'royal_bed',        name: 'Royal Bed',           type: 'furniture', rarity: 'epic',      desc: 'Fit for a king',           icon: '🛏️', shopPrice: 12000, w: 2, h: 2, sprite: 'bed_royal' },
  wall_torch:       { id: 'wall_torch',       name: 'Wall Torch',          type: 'furniture', rarity: 'common',    desc: 'Flickers warmly',          icon: '🔥', shopPrice: 300,   w: 1, h: 1, sprite: 'torch' },
  iron_chandelier:  { id: 'iron_chandelier',  name: 'Iron Chandelier',     type: 'furniture', rarity: 'uncommon',  desc: 'Hanging chandelier',       icon: '💡', shopPrice: 3000,  w: 2, h: 2, sprite: 'chandelier' },
  crystal_lamp:     { id: 'crystal_lamp',     name: 'Crystal Lamp',        type: 'furniture', rarity: 'rare',      desc: 'Glowing crystal light',    icon: '💎', shopPrice: 8000,  w: 1, h: 1, sprite: 'lamp_crystal' },
  small_rug:        { id: 'small_rug',        name: 'Small Rug',           type: 'furniture', rarity: 'common',    desc: 'Woven floor rug',          icon: '🟫', shopPrice: 500,   w: 2, h: 2, sprite: 'rug_small' },
  fancy_rug:        { id: 'fancy_rug',        name: 'Fancy Rug',           type: 'furniture', rarity: 'rare',      desc: 'Ornate patterned rug',     icon: '🟫', shopPrice: 5000,  w: 3, h: 2, sprite: 'rug_fancy' },
  bookshelf:        { id: 'bookshelf',        name: 'Bookshelf',           type: 'furniture', rarity: 'uncommon',  desc: 'Packed with tomes',        icon: '📚', shopPrice: 2000,  w: 2, h: 1, sprite: 'bookshelf' },
  weapon_rack:      { id: 'weapon_rack',      name: 'Weapon Rack',         type: 'furniture', rarity: 'uncommon',  desc: 'Display your arsenal',     icon: '⚔️', shopPrice: 3500,  w: 2, h: 1, sprite: 'weapon_rack' },
  trophy_case:      { id: 'trophy_case',      name: 'Trophy Case',         type: 'furniture', rarity: 'rare',      desc: 'Show off your victories',  icon: '🏆', shopPrice: 7000,  w: 2, h: 1, sprite: 'trophy_case' },
  fireplace:        { id: 'fireplace',        name: 'Stone Fireplace',     type: 'furniture', rarity: 'rare',      desc: 'Crackling warmth',         icon: '🔥', shopPrice: 6000,  w: 3, h: 2, sprite: 'fireplace' },
  barrel:           { id: 'barrel',           name: 'Storage Barrel',      type: 'furniture', rarity: 'common',    desc: 'For storing goods',        icon: '🛢️', shopPrice: 350,   w: 1, h: 1, sprite: 'barrel' },
  potted_plant:     { id: 'potted_plant',     name: 'Potted Plant',        type: 'furniture', rarity: 'common',    desc: 'A touch of green',         icon: '🌿', shopPrice: 250,   w: 1, h: 1, sprite: 'plant' },
  anvil:            { id: 'anvil',            name: 'Decorative Anvil',    type: 'furniture', rarity: 'uncommon',  desc: 'Blacksmith vibes',         icon: '⚒️', shopPrice: 2500,  w: 1, h: 1, sprite: 'anvil' },
  gilded_mirror:    { id: 'gilded_mirror',    name: 'Gilded Mirror',       type: 'furniture', rarity: 'epic',      desc: 'Gold-framed mirror',       icon: '🪞', shopPrice: 10000, w: 1, h: 2, sprite: 'mirror' },
  throne:           { id: 'throne',           name: 'Throne',              type: 'furniture', rarity: 'legendary', desc: 'The ultimate flex',        icon: '👑', shopPrice: 25000, w: 2, h: 2, sprite: 'throne' },
  dragon_statue:    { id: 'dragon_statue',    name: 'Dragon Statue',       type: 'furniture', rarity: 'legendary', desc: 'Intimidating stone dragon', icon: '🐉', shopPrice: 20000, w: 2, h: 2, sprite: 'dragon_statue' },
  fountain:         { id: 'fountain',         name: 'Indoor Fountain',     type: 'furniture', rarity: 'epic',      desc: 'Flowing water feature',    icon: '⛲', shopPrice: 15000, w: 2, h: 2, sprite: 'fountain' },
  achievement_plaque: { id: 'achievement_plaque', name: 'Achievement Plaque', type: 'furniture', rarity: 'rare', desc: 'Display an earned achievement', icon: '🏅', shopPrice: 1500, w: 1, h: 1, sprite: 'achievement_plaque' },
  house_staircase: { id: 'house_staircase', name: 'Grand Staircase', type: 'furniture', rarity: 'legendary', desc: 'Connects to the upper floor', icon: '🪜', shopPrice: 0, w: 3, h: 2, sprite: 'staircase', noPickup: true },
};

// ═══════════════════════════════════════════
// Housing System Constants
// ═══════════════════════════════════════════
const HOUSING = {
  PLOTS_PER_STREET: 8,
  TIERS: [
    { id: 1, name: 'Cottage',  gridW: 8, gridH: 8, maxFurniture: 10, cost: 5000,  upgradeCost: 0 },
    { id: 2, name: 'House',    gridW: 10, gridH: 10, maxFurniture: 16, cost: 15000, upgradeCost: 10000 },
    { id: 3, name: 'Manor',    gridW: 14, gridH: 14, maxFurniture: 28, cost: 40000, upgradeCost: 25000 },
    { id: 4, name: 'Grand Manor', gridW: 16, gridH: 24, maxFurniture: 45, cost: 75000, upgradeCost: 50000 },
  ],
  WALL_STYLES: [
    { id: 0, name: 'Stone',       color: '#4a4a5a', cost: 0 },
    { id: 1, name: 'Wood Plank',  color: '#7a5c3a', cost: 1500 },
    { id: 2, name: 'Dark Brick',  color: '#3a2828', cost: 3000 },
    { id: 3, name: 'Marble',      color: '#d0cfc8', cost: 8000 },
    { id: 4, name: 'Royal Purple', color: '#4a2860', cost: 12000 },
  ],
  FLOOR_STYLES: [
    { id: 0, name: 'Dirt',        color: '#5a4a3a', cost: 0 },
    { id: 1, name: 'Wood',        color: '#8a6a42', cost: 1000 },
    { id: 2, name: 'Cobblestone', color: '#6a6a6e', cost: 2500 },
    { id: 3, name: 'Tile',        color: '#a08868', cost: 5000 },
    { id: 4, name: 'Marble',      color: '#ccc8bc', cost: 10000 },
  ],
};

const FURNITURE_SHOP = [
  'oak_table', 'wooden_chair', 'straw_bed', 'cozy_bed', 'royal_bed',
  'wall_torch', 'iron_chandelier', 'crystal_lamp',
  'small_rug', 'fancy_rug', 'bookshelf', 'weapon_rack', 'trophy_case',
  'fireplace', 'barrel', 'potted_plant', 'anvil',
  'gilded_mirror', 'throne', 'dragon_statue', 'fountain',
  'achievement_plaque',
];

// Default furniture placed when buying/upgrading a house
const DEFAULT_FURNITURE = {
  1: [ // Cottage 8x8
    { id: 'straw_bed',    fx: 1, fy: 1 },
    { id: 'wall_torch',   fx: 3, fy: 1 },
    { id: 'wooden_chair', fx: 5, fy: 1 },
    { id: 'oak_table',    fx: 5, fy: 3 },
    { id: 'barrel',       fx: 1, fy: 5 },
    { id: 'potted_plant', fx: 6, fy: 5 },
  ],
  2: [ // House 10x10
    { id: 'cozy_bed',       fx: 1, fy: 1 },
    { id: 'wall_torch',     fx: 4, fy: 1 },
    { id: 'wall_torch',     fx: 7, fy: 1 },
    { id: 'bookshelf',      fx: 6, fy: 1 },
    { id: 'oak_table',      fx: 4, fy: 4 },
    { id: 'wooden_chair',   fx: 3, fy: 5 },
    { id: 'wooden_chair',   fx: 6, fy: 5 },
    { id: 'small_rug',      fx: 4, fy: 5 },
    { id: 'weapon_rack',    fx: 8, fy: 4 },
    { id: 'barrel',         fx: 1, fy: 7 },
    { id: 'potted_plant',   fx: 8, fy: 7 },
  ],
  3: [ // Manor 14x14
    { id: 'royal_bed',       fx: 1,  fy: 1 },
    { id: 'gilded_mirror',   fx: 4,  fy: 1 },
    { id: 'iron_chandelier', fx: 6,  fy: 2 },
    { id: 'fireplace',       fx: 10, fy: 1 },
    { id: 'trophy_case',     fx: 12, fy: 1 },
    { id: 'fancy_rug',       fx: 5,  fy: 6 },
    { id: 'oak_table',       fx: 6,  fy: 5 },
    { id: 'wooden_chair',    fx: 5,  fy: 6 },
    { id: 'wooden_chair',    fx: 8,  fy: 6 },
    { id: 'bookshelf',       fx: 1,  fy: 4 },
    { id: 'bookshelf',       fx: 1,  fy: 6 },
    { id: 'weapon_rack',     fx: 12, fy: 5 },
    { id: 'crystal_lamp',    fx: 5,  fy: 1 },
    { id: 'fountain',        fx: 6,  fy: 9 },
    { id: 'throne',          fx: 6,  fy: 11 },
    { id: 'barrel',          fx: 12, fy: 11 },
    { id: 'potted_plant',    fx: 1,  fy: 11 },
  ],
  4: [ // Grand Manor 16x24 — single continuous map, bottom=ground, top=upper via stairs
    // === Ground floor (bottom half, fy 13-22) ===
    { id: 'iron_chandelier', fx: 4,  fy: 15 },
    { id: 'iron_chandelier', fx: 11, fy: 15 },
    { id: 'fireplace',       fx: 11, fy: 14 },
    { id: 'trophy_case',     fx: 1,  fy: 14 },
    { id: 'fancy_rug',       fx: 5,  fy: 17 },
    { id: 'oak_table',       fx: 5,  fy: 16 },
    { id: 'wooden_chair',    fx: 4,  fy: 17 },
    { id: 'wooden_chair',    fx: 7,  fy: 17 },
    { id: 'weapon_rack',     fx: 14, fy: 16 },
    { id: 'crystal_lamp',    fx: 1,  fy: 15 },
    { id: 'fountain',        fx: 6,  fy: 20 },
    { id: 'throne',          fx: 7,  fy: 14 },
    { id: 'dragon_statue',   fx: 1,  fy: 20 },
    { id: 'barrel',          fx: 2,  fy: 20 },
    { id: 'barrel',          fx: 3,  fy: 20 },
    { id: 'potted_plant',    fx: 12, fy: 22 },
    // === Upper floor (top half, fy 1-10) ===
    { id: 'royal_bed',       fx: 1,  fy: 1 },
    { id: 'gilded_mirror',   fx: 4,  fy: 1 },
    { id: 'iron_chandelier', fx: 8,  fy: 3 },
    { id: 'bookshelf',       fx: 1,  fy: 4 },
    { id: 'bookshelf',       fx: 1,  fy: 6 },
    { id: 'cozy_bed',        fx: 11, fy: 1 },
    { id: 'fireplace',       fx: 11, fy: 4 },
    { id: 'crystal_lamp',    fx: 6,  fy: 1 },
    { id: 'fancy_rug',       fx: 6,  fy: 5 },
    { id: 'oak_table',       fx: 10, fy: 7 },
    { id: 'wooden_chair',    fx: 9,  fy: 8 },
    { id: 'wooden_chair',    fx: 12, fy: 8 },
    { id: 'potted_plant',    fx: 14, fy: 1 },
    { id: 'small_rug',       fx: 3,  fy: 8 },
  ],
};

// ═══════════════════════════════════════════
// Loot Tables — what mobs/bosses/mines drop
// ═══════════════════════════════════════════
const LOOT_TABLES = {
  // Forest mobs
  slime:    { drops: [{ itemId: 'slime_gel',   chance: 0.40 }, { itemId: 'health_potion', chance: 0.05 }, { itemId: 'party_hat', chance: 0.02, wearable: true }] },
  goblin:   { drops: [{ itemId: 'goblin_ear',  chance: 0.35 }, { itemId: 'iron_ore',      chance: 0.10 }, { itemId: 'health_potion', chance: 0.05 }, { itemId: 'straw_hat', chance: 0.02, wearable: true }, { itemId: 'leather_band', chance: 0.02, wearable: true }] },
  wolf:     { drops: [{ itemId: 'wolf_fang',   chance: 0.30 }, { itemId: 'leather_vest',  chance: 0.02 }, { itemId: 'health_potion', chance: 0.08 }, { itemId: 'crimson_sabre', chance: 0.015 }, { itemId: 'studded_leather', chance: 0.015 }, { itemId: 'woodland_cloak', chance: 0.015, wearable: true }, { itemId: 'bandana', chance: 0.02, wearable: true }] },
  // Dungeon mobs
  skeleton: { drops: [{ itemId: 'bone_fragment', chance: 0.40 }, { itemId: 'iron_ore',      chance: 0.10 }, { itemId: 'health_potion', chance: 0.08 }, { itemId: 'tattered_cape', chance: 0.02, wearable: true }, { itemId: 'eye_patch', chance: 0.015, wearable: true }] },
  zombie:   { drops: [{ itemId: 'zombie_flesh',  chance: 0.35 }, { itemId: 'bone_fragment',  chance: 0.15 }, { itemId: 'shield_scroll', chance: 0.05 }, { itemId: 'chain_bracelet', chance: 0.01, wearable: true }] },
  wraith:   { drops: [{ itemId: 'wraith_essence',chance: 0.25 }, { itemId: 'crystal_shard',  chance: 0.05 }, { itemId: 'power_elixir',  chance: 0.05 }, { itemId: 'tempest_blade', chance: 0.015 }, { itemId: 'battle_cuirass', chance: 0.012 }, { itemId: 'wizard_hat', chance: 0.015, wearable: true }, { itemId: 'shadow_cape', chance: 0.008, wearable: true }, { itemId: 'void_shackle', chance: 0.003, wearable: true }] },
  demon:    { drops: [{ itemId: 'demon_core',    chance: 0.20 }, { itemId: 'wraith_essence', chance: 0.10 }, { itemId: 'repair_kit',    chance: 0.05 }, { itemId: 'void_fragment', chance: 0.02 }, { itemId: 'inferno_blade', chance: 0.01 }, { itemId: 'phantom_shroud', chance: 0.01 }, { itemId: 'top_hat', chance: 0.01, wearable: true }, { itemId: 'skull_mask', chance: 0.005, wearable: true }, { itemId: 'inferno_horns', chance: 0.004, wearable: true }, { itemId: 'demon_gaze', chance: 0.003, wearable: true }, { itemId: 'blood_mantle', chance: 0.008, wearable: true }] },
  // RPG Bosses — guaranteed drop + bonus
  ancient_treant: { guaranteed: 'treant_bark', drops: [{ itemId: 'heartwood_greataxe', chance: 0.12 }, { itemId: 'ancient_bark_plate', chance: 0.10 }, { itemId: 'crystal_shard', chance: 0.30 }, { itemId: 'venom_blade', chance: 0.08 }, { itemId: 'power_elixir', chance: 0.20 }, { itemId: 'venom_shroud', chance: 0.06, wearable: true }, { itemId: 'ember_gauntlet', chance: 0.04, wearable: true }, { itemId: 'storm_cloak', chance: 0.03, wearable: true }] },
  goblin_king:    { guaranteed: 'goblin_key', drops: [{ itemId: 'goblin_ear', chance: 0.50 }, { itemId: 'iron_ore', chance: 0.20 }, { itemId: 'gold_nugget', chance: 0.10 }, { itemId: 'health_potion', chance: 0.15 }, { itemId: 'steel_blade', chance: 0.05 }, { itemId: 'chain_armor', chance: 0.04 }, { itemId: 'bandana', chance: 0.03, wearable: true }, { itemId: 'eye_patch', chance: 0.02, wearable: true }, { itemId: 'astral_wings', chance: 0.01, wearable: true }, { itemId: 'solar_radiance', chance: 0.005, wearable: true }] },
  // Mining bonus drops — PER ORE TYPE (each node only drops items matching its ore)
  // Quarry ore types
  mine_stone:     { drops: [{ itemId: 'stone_chunk', chance: 0.55 }, { itemId: 'coal', chance: 0.30 }, { itemId: 'book_unbreaking', chance: 0.002 }, { itemId: 'miner_helmet', chance: 0.004, wearable: true }, { itemId: 'basic_gloves', chance: 0.004 }, { itemId: 'basic_boots', chance: 0.004 }] },
  mine_copper:    { drops: [{ itemId: 'copper_ore', chance: 0.50 }, { itemId: 'stone_chunk', chance: 0.10 }, { itemId: 'coal', chance: 0.20 }, { itemId: 'book_unbreaking', chance: 0.002 }, { itemId: 'basic_helmet', chance: 0.004 }] },
  mine_iron:      { drops: [{ itemId: 'iron_ore', chance: 0.50 }, { itemId: 'copper_ore', chance: 0.08 }, { itemId: 'coal', chance: 0.25 }, { itemId: 'book_sharpness', chance: 0.003 }, { itemId: 'iron_gloves', chance: 0.002 }, { itemId: 'iron_boots', chance: 0.002 }, { itemId: 'iron_helmet', chance: 0.002 }] },
  mine_gold:      { drops: [{ itemId: 'gold_nugget', chance: 0.45 }, { itemId: 'iron_ore', chance: 0.06 }, { itemId: 'coal', chance: 0.15 }, { itemId: 'book_fortune', chance: 0.003 }, { itemId: 'gold_watch', chance: 0.003, wearable: true }] },
  mine_gem:       { drops: [{ itemId: 'raw_gem', chance: 0.50 }, { itemId: 'crystal_shard', chance: 0.15 }, { itemId: 'book_fortune', chance: 0.004 }] },
  mine_ruby:      { drops: [{ itemId: 'ruby_shard', chance: 0.50 }, { itemId: 'raw_gem', chance: 0.10 }, { itemId: 'book_sharpness', chance: 0.004 }, { itemId: 'book_critical', chance: 0.002 }] },
  mine_diamond:   { drops: [{ itemId: 'diamond_chunk', chance: 0.50 }, { itemId: 'crystal_shard', chance: 0.12 }, { itemId: 'book_fortune', chance: 0.005 }, { itemId: 'book_lifesteal', chance: 0.002 }, { itemId: 'crystal_cuff', chance: 0.001, wearable: true }, { itemId: 'crystal_gloves', chance: 0.001 }, { itemId: 'crystal_boots', chance: 0.001 }, { itemId: 'crystal_helmet', chance: 0.001 }] },
  mine_crystal:   { drops: [{ itemId: 'crystal_shard', chance: 0.50 }, { itemId: 'raw_gem', chance: 0.08 }, { itemId: 'book_protection', chance: 0.004 }, { itemId: 'monocle', chance: 0.002, wearable: true }] },
  mine_void:      { drops: [{ itemId: 'void_fragment', chance: 0.40 }, { itemId: 'diamond_chunk', chance: 0.10 }, { itemId: 'crystal_shard', chance: 0.08 }, { itemId: 'book_lifesteal', chance: 0.004 }, { itemId: 'book_critical', chance: 0.003 }, { itemId: 'pirate_hat', chance: 0.002, wearable: true }] },
  mine_silver:    { drops: [{ itemId: 'iron_ore', chance: 0.30 }, { itemId: 'gold_nugget', chance: 0.10 }, { itemId: 'coal', chance: 0.20 }, { itemId: 'book_fortune', chance: 0.003 }, { itemId: 'book_sharpness', chance: 0.002 }] },
  mine_mythril:   { drops: [{ itemId: 'crystal_shard', chance: 0.40 }, { itemId: 'diamond_chunk', chance: 0.15 }, { itemId: 'void_fragment', chance: 0.08 }, { itemId: 'coal', chance: 0.15 }, { itemId: 'book_lifesteal', chance: 0.005 }, { itemId: 'book_critical', chance: 0.004 }] },
  // Underground mine mobs
  cave_spider:    { drops: [{ itemId: 'slime_gel', chance: 0.30 }, { itemId: 'iron_ore', chance: 0.12 }, { itemId: 'health_potion', chance: 0.06 }, { itemId: 'bandana', chance: 0.015, wearable: true }] },
  stone_golem:    { drops: [{ itemId: 'stone_chunk', chance: 0.40 }, { itemId: 'iron_ore', chance: 0.15 }, { itemId: 'copper_ore', chance: 0.10 }, { itemId: 'book_protection', chance: 0.008 }, { itemId: 'miner_helmet', chance: 0.01, wearable: true }] },
  mimic_ore:      { drops: [{ itemId: 'gold_nugget', chance: 0.35 }, { itemId: 'raw_gem', chance: 0.15 }, { itemId: 'crystal_shard', chance: 0.08 }, { itemId: 'book_fortune', chance: 0.010 }, { itemId: 'gold_watch', chance: 0.008, wearable: true }] },
  // Deep mine boss
  stone_guardian: { guaranteed: 'stone_chunk', drops: [{ itemId: 'diamond_chunk', chance: 0.35 }, { itemId: 'crystal_shard', chance: 0.40 }, { itemId: 'void_fragment', chance: 0.20 }, { itemId: 'shadow_dagger', chance: 0.08 }, { itemId: 'thunder_hammer', chance: 0.06 }, { itemId: 'inferno_blade', chance: 0.05 }, { itemId: 'book_critical', chance: 0.12 }, { itemId: 'book_lifesteal', chance: 0.10 }, { itemId: 'power_elixir', chance: 0.30 }, { itemId: 'frost_visor', chance: 0.06, wearable: true }, { itemId: 'celestial_halo', chance: 0.03, wearable: true }, { itemId: 'frost_cloak', chance: 0.04, wearable: true }] },
  crystal_burrower: { guaranteed: 'crystal_shard', drops: [{ itemId: 'diamond_chunk', chance: 0.25 }, { itemId: 'ruby_shard', chance: 0.20 }, { itemId: 'void_fragment', chance: 0.10 }, { itemId: 'iron_ore', chance: 0.35 }, { itemId: 'frost_spear', chance: 0.08 }, { itemId: 'tempest_blade', chance: 0.06 }, { itemId: 'book_sharpness', chance: 0.08 }, { itemId: 'book_protection', chance: 0.08 }, { itemId: 'power_elixir', chance: 0.20 }, { itemId: 'miner_helmet', chance: 0.06, wearable: true }, { itemId: 'ninja_hood', chance: 0.04, wearable: true }, { itemId: 'crystal_cuff', chance: 0.04, wearable: true }] },
  hollow_sentinel: { guaranteed: 'void_fragment', drops: [{ itemId: 'wraith_essence', chance: 0.35 }, { itemId: 'demon_core', chance: 0.20 }, { itemId: 'crystal_shard', chance: 0.25 }, { itemId: 'diamond_chunk', chance: 0.15 }, { itemId: 'bone_cleaver', chance: 0.07 }, { itemId: 'void_edge', chance: 0.04 }, { itemId: 'book_lifesteal', chance: 0.10 }, { itemId: 'book_critical', chance: 0.08 }, { itemId: 'power_elixir', chance: 0.30 }, { itemId: 'skull_mask', chance: 0.05, wearable: true }, { itemId: 'void_shackle', chance: 0.03, wearable: true }, { itemId: 'shadow_cape', chance: 0.04, wearable: true }] },
};

// ═══════════════════════════════════════════
// Crafting Recipes
// ═══════════════════════════════════════════
const RECIPES = {
  // Weapons — gold cost ~40-50% of equivalent shop tier (materials are the other investment)
  venom_blade:  { result: 'venom_blade',  materials: { wolf_fang: 6, slime_gel: 10, iron_ore: 5 },               goldCost: 5000,   desc: 'Poison-tipped blade' },
  bone_cleaver: { result: 'bone_cleaver', materials: { bone_fragment: 12, wraith_essence: 5, crystal_shard: 3 }, goldCost: 12000,  desc: 'Heavy undead cleaver' },
  void_edge:    { result: 'void_edge',    materials: { void_crystal: 3, crystal_lens: 5, demon_core: 3 },      goldCost: 25000,  desc: 'Edge of nothingness' },
  demon_scythe: { result: 'demon_scythe', materials: { demon_core: 10, void_crystal: 2, cut_gem: 4 },            goldCost: 40000,  desc: 'Demonic reaper blade' },
  mythic_blade: { result: 'mythic_blade', materials: { void_crystal: 8, cut_diamond: 6, demon_core: 10, treant_bark: 8 }, goldCost: 100000, desc: 'The ultimate weapon' },
  // Armor — same scaling principle
  wolf_hide:    { result: 'wolf_hide',    materials: { wolf_fang: 10, goblin_ear: 8, slime_gel: 6 },              goldCost: 4000,   desc: 'Primal wolf armor' },
  wraith_cloak: { result: 'wraith_cloak', materials: { wraith_essence: 8, bone_fragment: 10, zombie_flesh: 6 },   goldCost: 10000,  desc: 'Ghostly protection' },
  void_armor:   { result: 'void_armor',   materials: { void_crystal: 3, crystal_lens: 4, wraith_essence: 4 },     goldCost: 22000,  desc: 'Armor from the void' },
  demon_plate:  { result: 'demon_plate',  materials: { demon_core: 8, cut_diamond: 3, bone_fragment: 12 },        goldCost: 36000,  desc: 'Infernal plate armor' },
  mythic_armor: { result: 'mythic_armor', materials: { void_crystal: 10, cut_diamond: 8, demon_core: 12, treant_bark: 10 }, goldCost: 95000, desc: 'The ultimate armor' },
  // Consumables
  repair_kit:   { result: 'repair_kit',   materials: { iron_bar: 8, crystal_shard: 4, demon_core: 2, treant_bark: 3 }, goldCost: 8000, desc: 'Advanced repair toolkit' },
};

// ═══════════════════════════════════════════
// Refining / Smelting Recipes
// ═══════════════════════════════════════════
// input → output, time in ms, coal cost
const REFINE_RECIPES = {
  stone_chunk:    { result: 'stone_block',   time: 8000,   coal: 0, desc: 'Shape into stone block' },
  copper_ore:     { result: 'copper_bar',    time: 12000,  coal: 1, desc: 'Smelt into copper bar' },
  iron_ore:       { result: 'iron_bar',      time: 15000,  coal: 1, desc: 'Smelt into iron bar' },
  gold_nugget:    { result: 'gold_ingot',    time: 20000,  coal: 2, desc: 'Smelt into gold ingot' },
  crystal_shard:  { result: 'crystal_lens',  time: 25000,  coal: 2, desc: 'Polish into crystal lens' },
  raw_gem:        { result: 'cut_gem',       time: 30000,  coal: 0, desc: 'Cut into faceted gem' },
  ruby_shard:     { result: 'polished_ruby', time: 35000,  coal: 2, desc: 'Polish into ruby' },
  diamond_chunk:  { result: 'cut_diamond',   time: 40000,  coal: 3, desc: 'Cut into diamond' },
  void_fragment:  { result: 'void_crystal',  time: 50000,  coal: 3, desc: 'Crystallize void fragment' },
};

// ═══════════════════════════════════════════
// Ore Quality Tiers — assigned when ore drops
// ═══════════════════════════════════════════
// quality: 0=Poor, 1=Normal, 2=Pure
// Poor ores sell at 70%, Normal at 100%, Pure at 150%
// Pure ores in crafting give +5% craft bonus
const ORE_QUALITY = {
  labels: ['Poor', '', 'Pure'],        // '' for Normal (no prefix)
  colors: ['#888', '#ccc', '#4ade80'], // gray, white, green
  sellMult: [0.7, 1.0, 1.5],
  weights: [55, 35, 10],              // % chance: 55% Poor, 35% Normal, 10% Pure
};

// ═══════════════════════════════════════════
// Mining Mini-Game — timing-based hit quality
// ═══════════════════════════════════════════
// Grades: 'perfect' (center 15%), 'good' (next 25%), 'bad' (outer)
// perfect → 2x ore drops, good → normal, bad → stone_chunk only
const MINING_MINIGAME = {
  perfectZone: 0.15,  // center 15% of the bar
  goodZone: 0.40,     // center 40% (includes perfect)
  // everything else is bad
};

// ═══════════════════════════════════════════
// Ore Caravan — periodic trader buying bulk ore at premium
// ═══════════════════════════════════════════
const CARAVAN_ORE_POOL = ['stone_chunk','copper_ore','iron_ore','gold_nugget','crystal_shard','raw_gem','ruby_shard','diamond_chunk','void_fragment'];
const CARAVAN_CONFIG = {
  intervalMin: 600000,   // 10 min minimum between caravans
  intervalMax: 1200000,  // 20 min max
  duration: 180000,      // 3 min duration
  priceMult: 2.5,        // 2.5x base price
};

// ═══════════════════════════════════════════
// World Events — automated rotating events
// ═══════════════════════════════════════════
const WORLD_EVENTS = {
  mob_invasion: {
    name: 'Horde Attack',
    icon: '👹',
    desc: 'Monsters are attacking Tavernvale! Fight them together for a shared gold reward!',
    duration: 300000,      // 5 minutes
    zones: ['hub'],        // hub zone only — shared mobs
    hordeGoldPool: 5000,   // default shared gold pool (admin can override)
    hordeMobCount: 15,     // total horde mobs
    hordeMobs: [
      { name: 'Cave Spider',  maxHP: 120, atk: 8,  color: '#884422', moveSpeed: 1.2, atkCD: 1800 },
      { name: 'Skeleton',     maxHP: 200, atk: 12, color: '#ffffff', moveSpeed: 0.7, atkCD: 2200 },
      { name: 'Zombie',       maxHP: 300, atk: 14, color: '#6b8e23', moveSpeed: 0.5, atkCD: 2800 },
      { name: 'Wraith',       maxHP: 430, atk: 18, color: '#8844cc', moveSpeed: 0.4, atkCD: 2000 },
    ],
    xpMult: 1.5,
  },
  blood_moon: {
    name: 'Blood Moon',
    icon: '🌑',
    desc: 'The Blood Moon rises! Mobs deal 2x damage but drop 3x gold!',
    duration: 300000,
    zones: null,           // all zones
    mobDmgMult: 2.0,
    goldMult: 3.0,
    xpMult: 1.5,
  },
  boss_rush: {
    name: 'Boss Rush',
    icon: '👹',
    desc: 'Bosses respawn rapidly! Farm them while you can!',
    duration: 300000,
    zones: null,
    bossRespawnMult: 0.15, // 15% of normal respawn time
    goldMult: 1.5,
    xpMult: 2.0,
  },
  gold_rush: {
    name: 'Gold Rush',
    icon: '⛏️',
    desc: 'Mining yields are doubled! Get to the mines!',
    duration: 300000,
    zones: ['hub', 'underground_mine', 'deep_mine'],
    miningGoldMult: 2.0,
    miningXPMult: 1.5,
  },
  bounty_hunt: {
    name: 'Bounty Hunt',
    icon: '🎯',
    desc: 'The Gilded Hoarder has appeared! Slay this golden beast for massive Vault Gold!',
    duration: 600000,      // 10 minutes
    zones: ['forest'],     // default zone, admin can override
    bountyBossHP: 5000,
    bountyBossAtk: 8,
    bountyKillVG: 50,      // VG for last-hit killer
    bountyShareVG: 100,    // VG split among ALL damage-dealers
    bountyGold: 5000,      // gold reward for killer
    bountyXP: 2000,
    attacks: [
      { name: 'Gold Toss',     type: 'aoe',   radius: 100, dmg: 8,  cd: 5000, telegraph: 1500 },
      { name: 'Gem Shower',    type: 'spread', count: 5,  range: 200, dmg: 5, cd: 6000, telegraph: 1200 },
      { name: 'Treasure Slam', type: 'aoe',   radius: 130, dmg: 12, cd: 8000, telegraph: 2000 },
      { name: 'Coin Storm',    type: 'aoe',   radius: 180, dmg: 10, cd: 10000, telegraph: 1500 },
    ],
  },
};
const WORLD_EVENT_CONFIG = {
  intervalMin: 3600000,   // 1 hour minimum between events
  intervalMax: 3600000,   // 1 hour max (exactly 1/hour)
  adminOverride: true,    // admin can force-trigger
};

// ═══════════════════════════════════════════
// Mining Gear — Grizzle sells these
// ═══════════════════════════════════════════
const MINING_GEAR_SHOP = ['basic_helmet','basic_gloves','basic_boots','iron_helmet','iron_gloves','iron_boots','crystal_helmet','crystal_gloves','crystal_boots'];

function rollOreQuality() {
  const r = Math.random() * 100;
  if (r < ORE_QUALITY.weights[0]) return 0; // Poor
  if (r < ORE_QUALITY.weights[0] + ORE_QUALITY.weights[1]) return 1; // Normal
  return 2; // Pure
}

// ═══════════════════════════════════════════
// Daily NPC Demand — changes prices every 24h
// ═══════════════════════════════════════════
// Sellable ore item IDs that can be affected by demand
const DEMAND_POOL = ['stone_chunk','copper_ore','iron_ore','gold_nugget','crystal_shard','raw_gem','ruby_shard','diamond_chunk','void_fragment',
                     'stone_block','copper_bar','iron_bar','gold_ingot','crystal_lens','cut_gem','polished_ruby','cut_diamond','void_crystal','coal'];
function getDailyDemand() {
  // Deterministic seed from UTC day number so all players see the same demand
  const dayNum = Math.floor(Date.now() / 86400000);
  // Simple seeded PRNG (mulberry32)
  let seed = dayNum * 2654435761 >>> 0;
  function rand() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  // Shuffle pool
  const shuffled = [...DEMAND_POOL];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return {
    dayNum,
    hot:      shuffled[0],                        // +50% price
    shortage: [shuffled[1], shuffled[2]],          // +25% price each
    surplus:  [shuffled[3], shuffled[4]],          // -15% price each
  };
}
function getDemandMult(itemId) {
  const d = getDailyDemand();
  if (itemId === d.hot) return 1.50;
  if (d.shortage.includes(itemId)) return 1.25;
  if (d.surplus.includes(itemId)) return 0.85;
  return 1.0;
}

// ═══════════════════════════════════════════
// NPC Shop (items you can buy with gold)
// ═══════════════════════════════════════════
const NPC_SHOP = {
  weapons: ['wooden_sword', 'rusty_mace', 'iron_sword', 'hunter_bow', 'crimson_sabre', 'steel_blade', 'war_axe', 'frost_spear', 'tempest_blade', 'shadow_dagger', 'thunder_hammer', 'inferno_blade', 'radiant_longsword', 'dragons_warhammer'],
  armor:   ['cloth_armor', 'padded_tunic', 'leather_vest', 'ranger_cloak', 'studded_leather', 'chain_armor', 'knight_plate', 'frost_mail', 'battle_cuirass', 'dark_plate', 'storm_aegis', 'phantom_shroud', 'golden_aegis', 'dragonscale_mail'],
  consumables: ['health_potion', 'power_elixir', 'shield_scroll', 'speed_tonic'],
  enchants: ['book_fire', 'book_poison', 'book_holy'],
};

// ═══════════════════════════════════════════
// Cosmetic Items (tradeable, buyable)
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// Rank Badges — unlocked by LEVEL (shown beside name)
// ═══════════════════════════════════════════
const RANK_BADGES = [
  { level: 1,  badge: '',   name: '' },
  { level: 10, badge: '🥉', name: 'Bronze' },
  { level: 20, badge: '🥈', name: 'Silver' },
  { level: 30, badge: '🥇', name: 'Gold' },
  { level: 40, badge: '💎', name: 'Diamond' },
  { level: 50, badge: '👑', name: 'Crown' },
];

function getRankBadge(level) {
  let best = RANK_BADGES[0];
  for (const rb of RANK_BADGES) {
    if (level >= rb.level) best = rb;
  }
  return best;
}

// ═══════════════════════════════════════════
// Wearable Cosmetics — earn-only, tradeable on marketplace
// ═══════════════════════════════════════════
const WEARABLES = {
  // ── Hats ──
  straw_hat:      { name: 'Straw Hat',       rarity: 'common',    slot: 'hat',   icon: '👒', desc: 'A simple farmer\'s hat',      source: 'Goblin drops' },
  party_hat:      { name: 'Party Hat',        rarity: 'common',    slot: 'hat',   icon: '🥳', desc: 'Time to celebrate',           source: 'Slime drops' },
  wizard_hat:     { name: 'Wizard Hat',       rarity: 'uncommon',  slot: 'hat',   icon: '🧙', desc: 'Pointy and mystical',         source: 'Wraith drops' },
  pirate_hat:     { name: 'Pirate Tricorn',   rarity: 'rare',      slot: 'hat',   icon: '🏴‍☠️', desc: 'Yarr matey!',                 source: 'Mining rare find' },
  top_hat:        { name: 'Top Hat',          rarity: 'rare',      slot: 'hat',   icon: '🎩', desc: 'Distinguished gentleman',      source: 'Demon drops' },
  santa_hat:      { name: 'Santa Hat',        rarity: 'epic',      slot: 'hat',   icon: '🎅', desc: 'Ho ho ho!',                    source: 'Boss reward' },
  void_crown:     { name: 'Void Crown',       rarity: 'mythic',    slot: 'hat',   icon: '👑', desc: 'Crown of the abyss',          source: 'Boss MVP' },
  miner_helmet:   { name: 'Miner\'s Helmet',  rarity: 'uncommon',  slot: 'hat',   icon: '⛑️', desc: 'Hard hat with a lamp on top',  source: 'Quarry mining' },
  ninja_hood:      { name: 'Ninja Hood',       rarity: 'rare',      slot: 'hat',   icon: '🥷', desc: 'Silent and deadly',           source: 'Wraith drops' },
  inferno_horns:   { name: 'Inferno Horns',    rarity: 'epic',      slot: 'hat',   icon: '😈', desc: 'Horns forged in hellfire',    source: 'Demon drops' },
  celestial_halo:  { name: 'Celestial Halo',   rarity: 'legendary', slot: 'hat',   icon: '😇', desc: 'A ring of divine light',      source: 'Boss MVP' },
  // ── Capes ──
  tattered_cape:  { name: 'Tattered Cape',    rarity: 'common',    slot: 'cape',  icon: '🧥', desc: 'Seen better days',            source: 'Skeleton drops' },
  woodland_cloak: { name: 'Woodland Cloak',   rarity: 'uncommon',  slot: 'cape',  icon: '🍃', desc: 'Blends with nature',          source: 'Wolf drops' },
  shadow_cape:    { name: 'Shadow Cape',      rarity: 'rare',      slot: 'cape',  icon: '🌑', desc: 'Made of pure shadow',         source: 'Wraith drops' },
  fire_cape:      { name: 'Fire Cape',        rarity: 'epic',      slot: 'cape',  icon: '🔥', desc: 'Burns with fury',             source: 'Boss reward' },
  royal_mantle:   { name: 'Royal Mantle',     rarity: 'legendary',  slot: 'cape',  icon: '👑', desc: 'Fit for royalty',             source: 'Boss MVP' },
  frost_cloak:     { name: 'Frost Cloak',      rarity: 'epic',      slot: 'cape',  icon: '❄️', desc: 'Woven from eternal ice',       source: 'Boss reward' },
  venom_shroud:    { name: 'Venom Shroud',     rarity: 'epic',      slot: 'cape',  icon: '🐍', desc: 'Drips with deadly poison',    source: 'Boss reward' },
  astral_wings:    { name: 'Astral Wings',     rarity: 'legendary', slot: 'cape',  icon: '🌌', desc: 'Wings of starlight',          source: 'Boss MVP' },
  blood_mantle:    { name: 'Blood Mantle',     rarity: 'rare',      slot: 'cape',  icon: '🩸', desc: 'Soaked in crimson',           source: 'Demon drops' },
  storm_cloak:     { name: 'Storm Cloak',      rarity: 'epic',      slot: 'cape',  icon: '⚡', desc: 'Crackling with lightning',    source: 'Boss reward' },
  solar_radiance:  { name: 'Solar Radiance',   rarity: 'legendary', slot: 'cape',  icon: '☀️', desc: 'Woven from pure sunlight',    source: 'Boss MVP' },
  // ── Wrist ──
  leather_band:   { name: 'Leather Band',     rarity: 'common',    slot: 'wrist', icon: '🤎', desc: 'Simple leather wrap',         source: 'Goblin drops' },
  gold_watch:     { name: 'Gold Watch',       rarity: 'uncommon',  slot: 'wrist', icon: '⌚', desc: 'Tick tock',                    source: 'Mining gold vein' },
  chain_bracelet: { name: 'Chain Bracelet',   rarity: 'rare',      slot: 'wrist', icon: '⛓️', desc: 'Heavy chain links',           source: 'Zombie drops' },
  crystal_cuff:   { name: 'Crystal Cuff',     rarity: 'epic',      slot: 'wrist', icon: '💎', desc: 'Glowing crystal band',        source: 'Mining rare find' },
  dragon_bangle:  { name: 'Dragon Bangle',    rarity: 'legendary',  slot: 'wrist', icon: '🐲', desc: 'Scales of a dragon',         source: 'Boss MVP' },
  bone_bracelet:   { name: 'Bone Bracelet',    rarity: 'uncommon',  slot: 'wrist', icon: '🦴', desc: 'Carved from fallen foes',     source: 'Skeleton drops' },
  ember_gauntlet:  { name: 'Ember Gauntlet',   rarity: 'epic',      slot: 'wrist', icon: '🧤', desc: 'Smoldering knuckle wraps',    source: 'Boss reward' },
  void_shackle:    { name: 'Void Shackle',     rarity: 'legendary', slot: 'wrist', icon: '⛓️‍💥', desc: 'Chains from the abyss',        source: 'Boss MVP' },
  // ── Face ──
  bandana:        { name: 'Bandana',          rarity: 'common',    slot: 'face',  icon: '🟥', desc: 'Outlaw vibes',                source: 'Wolf drops' },
  eye_patch:      { name: 'Eye Patch',        rarity: 'uncommon',  slot: 'face',  icon: '🏴‍☠️', desc: 'Lost it in battle',           source: 'Skeleton drops' },
  monocle:        { name: 'Monocle',          rarity: 'rare',      slot: 'face',  icon: '🧐', desc: 'Quite distinguished',         source: 'Mining rare find' },
  skull_mask:     { name: 'Skull Mask',       rarity: 'epic',      slot: 'face',  icon: '💀', desc: 'Face of death',               source: 'Demon drops' },
  phantom_mask:   { name: 'Phantom Mask',     rarity: 'legendary',  slot: 'face',  icon: '🎭', desc: 'Who hides behind it?',       source: 'Boss MVP' },
  war_paint:       { name: 'War Paint',        rarity: 'rare',      slot: 'face',  icon: '⚔️', desc: 'Tribal markings of a warrior', source: 'Boss reward' },
  frost_visor:     { name: 'Frost Visor',      rarity: 'epic',      slot: 'face',  icon: '🥶', desc: 'Ice-forged face guard',        source: 'Boss reward' },
  demon_gaze:      { name: 'Demon Gaze',       rarity: 'legendary', slot: 'face',  icon: '👹', desc: 'Eyes that burn with hellfire', source: 'Demon drops' },
  // ── PvP Arena Exclusives ──
  gladiator_helm:  { name: 'Gladiator Helm',   rarity: 'rare',      slot: 'hat',   icon: '⚔️', desc: 'Forged in the arena',         source: 'PvP Shop' },
  champion_crown:  { name: 'Champion Crown',   rarity: 'legendary', slot: 'hat',   icon: '👑', desc: 'Only true champions wear this', source: 'PvP Shop' },
  arena_cloak:     { name: 'Arena Cloak',      rarity: 'rare',      slot: 'cape',  icon: '🏟️', desc: 'Blood-red arena cape',        source: 'PvP Shop' },
  victor_mantle:   { name: "Victor's Mantle",  rarity: 'legendary', slot: 'cape',  icon: '🏆', desc: 'Shimmering golden victory cape', source: 'PvP Shop' },
  battle_bracer:   { name: 'Battle Bracer',    rarity: 'uncommon',  slot: 'wrist', icon: '🛡️', desc: 'Scarred arena bracer',        source: 'PvP Shop' },
  duelist_mask:    { name: "Duelist's Mask",   rarity: 'epic',      slot: 'face',  icon: '🎭', desc: 'The mask of a feared duelist', source: 'PvP Shop' },
};

const COSMETICS = {
  // ── Borders (leaderboard/name frame) ──
  border_gold:    { name: '🟡 Gold Border', cost: 1500, desc: 'Gold border on leaderboard', type: 'border', cssVal: '#ffd700' },
  border_red:     { name: '🔴 Red Border', cost: 1200, desc: 'Red border on leaderboard', type: 'border', cssVal: '#ff4444' },
  border_blue:    { name: '🔵 Blue Border', cost: 1200, desc: 'Blue border on leaderboard', type: 'border', cssVal: '#4488ff' },
  border_purple:  { name: '🟣 Purple Border', cost: 1800, desc: 'Purple border on leaderboard', type: 'border', cssVal: '#c084fc' },
  border_rainbow: { name: '🌈 Rainbow Border', cost: 5000, desc: 'Animated rainbow border', type: 'border', cssVal: 'rainbow' },
  border_green:   { name: '💚 Emerald Border', cost: 1500, desc: 'Green border on leaderboard', type: 'border', cssVal: '#4ade80' },
  border_fire:    { name: '🔥 Inferno Border', cost: 8000, desc: 'Animated fire border', type: 'border', cssVal: 'fire' },
  border_ice:     { name: '❄️ Frost Border', cost: 6000, desc: 'Animated ice border', type: 'border', cssVal: 'ice' },
  // ── Titles (shown before name) ──
  title_champion: { name: '⭐ Champion', cost: 6000, desc: 'Permanent ⭐ title', type: 'title', titleText: '⭐' },
  title_legend:   { name: '🔥 Legend', cost: 10000, desc: 'Permanent 🔥 title', type: 'title', titleText: '🔥' },
  title_king:     { name: '👑 King', cost: 15000, desc: 'Permanent 👑 title', type: 'title', titleText: '👑' },
  title_skull:    { name: '💀 Reaper', cost: 8000, desc: 'Permanent 💀 title', type: 'title', titleText: '💀' },
  title_diamond:  { name: '💎 Diamond', cost: 20000, desc: 'Permanent 💎 title', type: 'title', titleText: '💎' },
  title_clown:    { name: '🤡 Class Clown', cost: 3000, desc: 'Permanent 🤡 title', type: 'title', titleText: '🤡' },
  title_rat:      { name: '🐀 Chat Rat', cost: 2000, desc: 'Embrace the grind 🐀', type: 'title', titleText: '🐀' },
  title_goat:     { name: '🐐 GOAT', cost: 30000, desc: 'The greatest of all time', type: 'title', titleText: '🐐' },
  // ── Hit Effects (visual on boss/pvp hits) ──
  effect_fire:    { name: '🔥 Flame Hits', cost: 3000, desc: 'Hits show as fire', type: 'hitEffect', effectId: 'fire' },
  effect_ice:     { name: '❄️ Ice Hits', cost: 3000, desc: 'Hits show as ice', type: 'hitEffect', effectId: 'ice' },
  effect_lightning:{ name: '⚡ Lightning Hits', cost: 4000, desc: 'Hits show as lightning', type: 'hitEffect', effectId: 'lightning' },
  effect_shadow:  { name: '🌑 Shadow Hits', cost: 4000, desc: 'Hits show as shadow', type: 'hitEffect', effectId: 'shadow' },
  effect_blood:   { name: '🩸 Blood Hits', cost: 5000, desc: 'Hits show blood splatter', type: 'hitEffect', effectId: 'blood' },
  effect_holy:    { name: '✨ Holy Hits', cost: 6000, desc: 'Hits show divine light', type: 'hitEffect', effectId: 'holy' },
  // ── Badges (emoji beside name) ──
  badge_vip:      { name: '💠 VIP Badge', cost: 5000, desc: 'VIP badge next to name', type: 'badge', badgeEmoji: '💠' },
  badge_sword:    { name: '⚔️ Warrior Badge', cost: 4000, desc: 'Sword badge next to name', type: 'badge', badgeEmoji: '⚔️' },
  badge_shield:   { name: '🛡️ Guardian Badge', cost: 4000, desc: 'Shield badge next to name', type: 'badge', badgeEmoji: '🛡️' },
  badge_skull:    { name: '💀 Death Badge', cost: 8000, desc: 'Skull badge — fear me', type: 'badge', badgeEmoji: '💀' },
  badge_dragon:   { name: '🐲 Dragon Badge', cost: 12000, desc: 'Dragon badge — I own bosses', type: 'badge', badgeEmoji: '🐲' },
  // ── Kill Effects (animation on final blow) ──
  killeffect_explode: { name: '💥 Explosion', cost: 7000, desc: 'Target explodes on defeat', type: 'killEffect', effectId: 'explode' },
  killeffect_disintegrate: { name: '✨ Disintegrate', cost: 9000, desc: 'Target fades to dust', type: 'killEffect', effectId: 'disintegrate' },
  killeffect_lightning: { name: '⚡ Smited', cost: 12000, desc: 'Lightning strikes the loser', type: 'killEffect', effectId: 'smite' },
};

// ═══════════════════════════════════════════
// Achievement Definitions
// ═══════════════════════════════════════════
const ACHIEVEMENTS = {
  first_blood:    { name: '🩸 First Blood', desc: 'Land your first attack', check: (p) => p.totalDamage > 0 },
  dmg_100:        { name: '💥 Centurion', desc: 'Deal 100 total damage', check: (p) => p.totalDamage >= 100 },
  dmg_1k:         { name: '⚔️ Thousand Cuts', desc: 'Deal 1,000 total damage', check: (p) => p.totalDamage >= 1000 },
  dmg_10k:        { name: '🔥 Inferno', desc: 'Deal 10,000 total damage', check: (p) => p.totalDamage >= 10000 },
  dmg_100k:       { name: '☄️ Cataclysm', desc: 'Deal 100,000 total damage', check: (p) => p.totalDamage >= 100000 },
  gold_100:       { name: '🪙 Moneybags', desc: 'Hold 1,000 gold at once', check: (p) => p.gold >= 1000 },
  gold_500:       { name: '💰 Wealthy', desc: 'Hold 5,000 gold at once', check: (p) => p.gold >= 5000 },
  gold_2k:        { name: '🏦 Tycoon', desc: 'Hold 25,000 gold at once', check: (p) => p.gold >= 25000 },
  level_5:        { name: '⬆️ Rising Star', desc: 'Reach level 5', check: (p) => p.level >= 5 },
  level_10:       { name: '🌟 Veteran', desc: 'Reach level 10', check: (p) => p.level >= 10 },
  level_25:       { name: '💫 Elite', desc: 'Reach level 25', check: (p) => p.level >= 25 },
  level_50:       { name: '👑 Legendary', desc: 'Reach level 50', check: (p) => p.level >= 50 },
  streak_10:      { name: '🔁 Relentless', desc: '10 attack streak', check: (p) => (p.bestStreak || 0) >= 10 },
  streak_25:      { name: '🔁 Unstoppable', desc: '25 attack streak', check: (p) => (p.bestStreak || 0) >= 25 },
  mvp_1:          { name: '🏆 MVP', desc: 'Be MVP once', check: (p) => (p.mvpCount || 0) >= 1 },
  mvp_5:          { name: '🏆 MVP Master', desc: 'Be MVP 5 times', check: (p) => (p.mvpCount || 0) >= 5 },
  gamble_win:     { name: '🎰 Lucky', desc: 'Win a gamble', check: (p) => (p.gamblesWon || 0) >= 1 },
  gamble_5:       { name: '🎰 High Roller', desc: 'Win 5 gambles', check: (p) => (p.gamblesWon || 0) >= 5 },
  collector_3:    { name: '🎒 Collector', desc: 'Own 3 items', check: (p) => (p.inventory || []).length >= 3 },
  collector_10:   { name: '🗃️ Hoarder', desc: 'Own 10 items', check: (p) => (p.inventory || []).length >= 10 },
  dodge_10:       { name: '🏃 Quick Feet', desc: 'Dodge 10 boss attacks', check: (p) => (p.dodgeCount || 0) >= 10 },
  trade_1:        { name: '🤝 Trader', desc: 'Complete a trade', check: (p) => (p.tradeCount || 0) >= 1 },
  cosmetic_3:     { name: '✨ Fashionista', desc: 'Own 3 cosmetics', check: (p) => (p.cosmetics || []).length >= 3 },
  boss_killer:    { name: '💀 Boss Slayer', desc: '10 boss kills', check: (p) => (p.bossKills || 0) >= 10 },
  boss_50:        { name: '💀 Raid Legend', desc: '50 boss kills', check: (p) => (p.bossKills || 0) >= 50 },
  duel_1:         { name: '⚔️ Duelist', desc: 'Win your first duel', check: (p) => (p.duelsWon || 0) >= 1 },
  duel_10:        { name: '⚔️ Arena Warrior', desc: 'Win 10 duels', check: (p) => (p.duelsWon || 0) >= 10 },
  duel_50:        { name: '⚔️ Arena Champion', desc: 'Win 50 duels', check: (p) => (p.duelsWon || 0) >= 50 },
  duel_streak_5:  { name: '🔥 On Fire', desc: '5 duel win streak', check: (p) => (p.bestDuelStreak || 0) >= 5 },
  prestige_1:     { name: '⭐ Prestige', desc: 'Prestige once', check: (p) => (p.prestige || 0) >= 1 },
  prestige_3:     { name: '💎 Prestige III', desc: 'Reach Prestige 3', check: (p) => (p.prestige || 0) >= 3 },
  prestige_5:     { name: '☀️ Prestige V', desc: 'Reach Prestige 5', check: (p) => (p.prestige || 0) >= 5 },
  prestige_6:     { name: '🔥 Mikey X', desc: 'Reach max Prestige', check: (p) => (p.prestige || 0) >= 6 },
};

const BOSS1_NAMES = [
  'Goblin Warchief', 'Shadow Lurker', 'Crystal Golem',
  'Cursed Knight', 'Flame Imp Lord', 'Toxic Slime King',
  'Bandit Overlord', 'Frost Wraith', 'Iron Golem', 'Dark Shaman',
];
const BOSS2_NAMES = [
  'Dragon of Chaos', 'The Void King', 'Titan of Flames',
  'Lich Emperor', 'World Serpent', 'Abyssal Kraken',
  'Storm Colossus', 'Demon Overlord', 'Phoenix Reborn', 'The Undying',
];

const BOSS_ATTACKS = [
  { name: 'Tail Swipe', emoji: '🌪️' },
  { name: 'Fire Breath', emoji: '🔥' },
  { name: 'Earthquake', emoji: '💥' },
  { name: 'Shadow Bolt', emoji: '🌑' },
  { name: 'Frost Nova', emoji: '❄️' },
  { name: 'Thunder Slam', emoji: '⚡' },
  { name: 'Poison Cloud', emoji: '☠️' },
  { name: 'Death Stare', emoji: '👁️' },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ═══════════════════════════════════════════
// Game Class
// ═══════════════════════════════════════════
class Game {
  constructor(emitFn) {
    this.emit = emitFn || (() => {});
    this.players = {};
    this.boss = null;
    this.bossNumber = 0;
    this.state = 'idle';
    this.damageMap = {};
    this.cooldowns = {};
    this.globalCD = { thegame: 0 };
    this.recentAttackers = {};
    this.breakTimer = null;
    this.doubleXPUntil = 0;
    this.doubleDmgUntil = 0;

    this.admin = 'mikeydamike';
    this.rpgEnabled = false;
    this.gamblingEnabled = false;
    this.wheelRewards = ['10,000g Gold Rain','Double / Re-spin','5,000g Jackpot','Re-spin!','Random Viewer Pick'];
    this.prizeMultiplier = 1;
    this.comboCount = 0;
    this.lastAttacker = null;
    this.comboTimer = null;

    // Shop temp buffs
    this.shopItems = {
      whetstone: { name: '🗡️ Whetstone', cost: 500, desc: '+3 bonus dmg this boss', type: 'dmg_boost', value: 3 },
      charm:     { name: '🍀 Lucky Charm', cost: 800, desc: '+15% crit this boss', type: 'crit_boost', value: 0.15 },
      boots:     { name: '👟 Swift Boots', cost: 1200, desc: 'Half cooldown this boss', type: 'speed_boost' },
      potion:    { name: '💪 Mega Potion', cost: 2000, desc: '2x damage this boss', type: 'mega_dmg' },
    };
    this.playerBuffs = {};

    // Boss attack state
    this.bossAttackActive = false;
    this.bossAttackDodgers = new Set();
    this.bossAttackTimer = null;

    // Market
    this.market = [];
    this.marketIdCounter = 1;
    this.tradeLog = [];
    // Player-owned stalls in the Marketplace zone
    this.marketStalls = {}; // { stallId: { owner, color, tier, items: [{id,qty?,uid?,price},...] } }

    // Pending direct trades
    this.pendingTrades = {};
    this.houseKnockCooldowns = {}; // key: from->owner plot, value: timestamp

    // Link tokens for player portal auth
    this.linkTokens = {};  // { username: { token, created } }
    this.pendingLinkCodes = {};  // { username: { code, created } }
    this.authAccounts = {};  // { username: { hash, salt } }
    this.purchaseLog = [];  // Stripe purchase dedup log

    // Portal chat (in-memory, last 100 messages)
    this.chatMessages = [];

    // Payout queue (persisted)
    this.payoutQueue = [];
    this.payoutIdCounter = 1;

    // Discord webhook URL (set via admin panel)
    this.discordWebhook = null;
    this.discordBotConfig = null; // { botToken, chatChannelId }

    // PvP Arena
    this.activeDuels = {};   // { challengeId: { challenger, defender, bet, arena, created, status } }
    this.duelIdCounter = 1;
    this.duelCooldowns = {}; // username -> timestamp

    this.loadData();
    this.saveTimer = setInterval(() => this._flushSave(), CONFIG.saveInterval);
    // Expire panel marketplace listings older than 24h (check every 5 min)
    this.marketExpiryTimer = setInterval(() => this._expireMarketListings(), 300000);
    this.initRPG();
  }

  // ── Persistence ──────────────────────────
  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.players = d.players || {};
        this.market = d.market || [];
        // Patch legacy market listings missing item names
        for (const l of this.market) {
          if (l.itemData && !l.itemData.name && l.itemData.id && ITEMS[l.itemData.id]) {
            l.itemData.name = ITEMS[l.itemData.id].name;
            l.itemData.icon = l.itemData.icon || ITEMS[l.itemData.id].icon;
            l.itemData.rarity = l.itemData.rarity || ITEMS[l.itemData.id].rarity;
          }
        }
        this.marketIdCounter = d.marketIdCounter || 1;
        this.tradeLog = d.tradeLog || [];
        this.payoutQueue = d.payoutQueue || [];
        this.payoutIdCounter = d.payoutIdCounter || 1;
        this.discordWebhook = d.discordWebhook || null;
        this.discordBotConfig = d.discordBotConfig || null;
        if (d.rpgEnabled !== undefined) this.rpgEnabled = d.rpgEnabled;
        if (d.gamblingEnabled !== undefined) this.gamblingEnabled = d.gamblingEnabled;
        this.authAccounts = d.authAccounts || {};
        this.linkTokens = d.linkTokens || {};
        this.communityMilestonesCompleted = d.communityMilestonesCompleted || [];
        this.communityMilestoneData = d.communityMilestoneData || { bossKills: 0 };
        this.housingStreets = d.housingStreets || [];
        this.purchaseLog = d.purchaseLog || [];
        this.marketStalls = d.marketStalls || {};
      }
    } catch (e) {
      console.error('⚠️ loadData failed:', e.message);
      // Attempt backup recovery instead of wiping all data
      const backupFile = DATA_FILE + '.bak';
      try {
        if (fs.existsSync(backupFile)) {
          console.log('Attempting recovery from backup...');
          const d = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
          this.players = d.players || {};
          this.market = d.market || [];
          this.tradeLog = d.tradeLog || [];
          console.log('Recovered from backup successfully.');
          return;
        }
      } catch (e2) { console.error('Backup recovery also failed:', e2.message); }
      this.players = {}; this.market = []; this.tradeLog = [];
    }
  }

  saveData(immediate) {
    // Debounced saving: batch rapid writes into a single disk write within 5 seconds
    this._saveDirty = true;
    if (immediate) {
      this._flushSave();
      return;
    }
    if (!this._saveDebounce) {
      this._saveDebounce = setTimeout(() => { this._saveDebounce = null; this._flushSave(); }, 5000);
    }
  }

  _flushSave() {
    if (!this._saveDirty) return;
    this._saveDirty = false;
    if (this._saveDebounce) { clearTimeout(this._saveDebounce); this._saveDebounce = null; }
    const data = JSON.stringify({
      players: this.players, market: this.market, marketIdCounter: this.marketIdCounter, tradeLog: this.tradeLog,
      payoutQueue: this.payoutQueue, payoutIdCounter: this.payoutIdCounter,
      discordWebhook: this.discordWebhook, discordBotConfig: this.discordBotConfig,
      authAccounts: this.authAccounts, linkTokens: this.linkTokens,
      rpgEnabled: this.rpgEnabled,
      gamblingEnabled: this.gamblingEnabled,
      communityMilestonesCompleted: this.communityMilestonesCompleted,
      communityMilestoneData: this.communityMilestoneData,
      housingStreets: this.housingStreets || [],
      purchaseLog: this.purchaseLog || [],
      marketStalls: this.marketStalls || {},
    }, null, 2);
    const tmpFile = DATA_FILE + '.tmp';
    try {
      // Write to temp file, then rename atomically to prevent corruption
      fs.writeFileSync(tmpFile, data);
      // Keep a backup of the previous good save
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak');
      }
      fs.renameSync(tmpFile, DATA_FILE);
    } catch (e) { console.error('Save failed:', e.message); }
  }

  // ── Player helpers ───────────────────────
  player(name) {
    if (!this.players[name]) {
      this.players[name] = {
        xp: 0, gold: 0, vaultGold: 0, level: 1, totalDamage: 0, lastDaily: 0,
        streak: 0, bestStreak: 0, mvpCount: 0, gamblesWon: 0,
        bossKills: 0, dodgeCount: 0, tradeCount: 0,
        prestige: 0, prestigeBonus: 0,
        duelsWon: 0, duelsLost: 0, duelWinStreak: 0, bestDuelStreak: 0, arenaRating: 1000, arenaTokens: 0,
        inventory: [], equipped: {},
        wearables: [], activeWearables: { hat: null, cape: null, wrist: null, face: null },
        cosmetics: [], activeCosmetics: { border: null, title: null, hitEffect: null, badge: null, killEffect: null },
        achievements: [],
        appearance: this.randomAppearance(),
      };
    }
    const p = this.players[name];
    if (!p.inventory) p.inventory = [];
    if (!p.equipped) p.equipped = {};
    if (!p.cosmetics) p.cosmetics = [];
    if (!p.activeCosmetics) p.activeCosmetics = { border: null, title: null, hitEffect: null, badge: null, killEffect: null };
    if (!p.wearables) p.wearables = [];
    if (!p.activeWearables) p.activeWearables = { hat: null, cape: null, wrist: null, face: null };
    if (!p.achievements) p.achievements = [];
    if (p.mvpCount === undefined) p.mvpCount = 0;
    if (p.gamblesWon === undefined) p.gamblesWon = 0;
    if (p.bossKills === undefined) p.bossKills = 0;
    if (p.dodgeCount === undefined) p.dodgeCount = 0;
    if (p.tradeCount === undefined) p.tradeCount = 0;
    if (p.streak === undefined) { p.streak = 0; p.bestStreak = 0; }
    if (!p.appearance) p.appearance = this.randomAppearance();
    if (p.prestige === undefined) { p.prestige = 0; p.prestigeBonus = 0; }
    if (p.duelsWon === undefined) { p.duelsWon = 0; p.duelsLost = 0; p.duelWinStreak = 0; p.bestDuelStreak = 0; p.arenaRating = 1000; }
    if (p.arenaTokens === undefined) p.arenaTokens = 0;
    if (p.vaultGold === undefined) p.vaultGold = 0;
    if (!p.lastVgConvert) p.lastVgConvert = 0;
    if (!p.activityLog) p.activityLog = [];
    return p;
  }

  logAction(username, action, detail) {
    const p = this.players[username];
    if (!p) return;
    if (!p.activityLog) p.activityLog = [];
    p.activityLog.push({ t: Date.now(), a: action, d: detail });
    if (p.activityLog.length > 150) p.activityLog = p.activityLog.slice(-150);
  }

  // ── Vault Gold System ──────────────────────────
  // Convert regular gold → Vault Gold (withdrawable). 5000g → 1000 VG, once per day.
  convertToVaultGold(username) {
    const p = this.player(username);
    const CONVERT_COST = 5000;   // gold spent
    const CONVERT_YIELD = 1000;  // VG received
    if (p.gold < CONVERT_COST) return { error: 'broke', gold: p.gold, cost: CONVERT_COST, message: `Need ${CONVERT_COST.toLocaleString()}g to convert (you have ${p.gold.toLocaleString()}g)` };
    p.gold -= CONVERT_COST;
    p.vaultGold = (p.vaultGold || 0) + CONVERT_YIELD;
    p.lastVgConvert = Date.now();
    this.logAction(username, 'vg_convert', `${CONVERT_COST}g → ${CONVERT_YIELD} VG`);
    this.saveData();
    return { success: true, gold: p.gold, vaultGold: p.vaultGold, converted: CONVERT_YIELD, message: `Converted ${CONVERT_COST.toLocaleString()}g → ${CONVERT_YIELD.toLocaleString()} Vault Gold 💎` };
  }

  // Award Vault Gold directly (for leaderboards, events, boss kills)
  awardVaultGold(username, amount, reason) {
    const p = this.player(username);
    const amt = Math.floor(amount);
    if (amt <= 0) return;
    p.vaultGold = (p.vaultGold || 0) + amt;
    this.logAction(username, 'vg_award', `+${amt} VG (${reason})`);
    this.saveData();
    return { vaultGold: p.vaultGold, added: amt };
  }

  randomAppearance() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return {
      skinColor: pick(['#f5d0a9','#c68642','#8d5524','#ffdbac','#e0ac69','#6b4226','#f1c27d','#d4a574']),
      gender: pick(['male','female']),
      hairStyle: pick(['spiky','flat','mohawk','long','bald','curly','ponytail','messy']),
      hairColor: pick(['#2c1b0e','#8b4513','#daa520','#c0392b','#2c3e50','#ecf0f1','#8e44ad','#e67e22','#1abc9c','#e74c3c']),
      eyeStyle: pick(['normal','angry','happy','cool','sleepy','wide','dot','wink']),
      eyeColor: pick(['#3498db','#2ecc71','#8b4513','#2c3e50','#e74c3c','#9b59b6','#f39c12']),
      mouthStyle: pick(['smile','neutral','open','smirk','frown','teeth','tiny']),
      outfit: pick(['tshirt','tank','hoodie','vest','robe','armor_light']),
      outfitColor: pick(['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#34495e','#ecf0f1']),
    };
  }

  updateAppearance(username, appearance) {
    const p = this.player(username);
    const allowed = ['gender','skinColor','hairStyle','hairColor','eyeStyle','eyeColor','mouthStyle','outfit','outfitColor'];
    for (const key of allowed) {
      if (appearance[key] !== undefined) p.appearance[key] = String(appearance[key]).slice(0, 20);
    }
    return p.appearance;
  }

  // Equipment stat helpers
  equipStat(p, stat) {
    let val = 0;
    for (const item of Object.values(p.equipped || {})) {
      if (item && item.stat === stat) {
        if (stat === 'dmgMult') val += (item.value - 1);
        else val += item.value;
      }
      // Also check book enchantments on equipped items
      if (item && item.enchantments) {
        for (const ench of item.enchantments) {
          if (ench.stat === stat) val += ench.value;
        }
      }
    }
    return val;
  }

  // Get bonus damage from equipped weapon (new item system)
  weaponDmgBonus(p) {
    const wep = (p.equipped || {}).weapon;
    return (wep && wep.dmgBonus && (!wep.durability || wep.durability > 0)) ? wep.dmgBonus : 0;
  }

  // Get damage reduction from equipped armor (new item system)
  armorDefBonus(p) {
    const arm = (p.equipped || {}).armor;
    return (arm && arm.defBonus && (!arm.durability || arm.durability > 0)) ? arm.defBonus : 0;
  }

  // Degrade durability of an equipped slot
  degradeEquipped(p, slot, amount) {
    const item = (p.equipped || {})[slot];
    if (!item || item.durability === undefined) return;
    item.durability = Math.max(0, item.durability - amount);
    if (item.durability <= 0) {
      // Item is destroyed
      delete p.equipped[slot];
      return { broken: true, name: item.name };
    }
    return { broken: false, durability: item.durability, maxDurability: item.maxDurability };
  }

  equipItem(username, uid) {
    const p = this.player(username);
    const idx = p.inventory.findIndex(i => i.uid === uid);
    if (idx === -1) return { error: 'not_found' };
    const item = p.inventory[idx];
    if (item.type !== 'weapon' && item.type !== 'armor') return { error: 'not_equippable' };
    if (item.durability !== undefined && item.durability <= 0) return { error: 'broken' };
    const slot = item.type; // 'weapon' or 'armor'
    // Unequip current item in that slot
    if (p.equipped[slot]) {
      p.inventory.push(p.equipped[slot]);
    }
    p.equipped[slot] = item;
    p.inventory.splice(idx, 1);
    this.saveData();
    // Broadcast equip change to all players in zone for real-time visuals
    const rp = this.rpgPlayers[username];
    if (rp && rp.zone) {
      this.rpgBroadcastZone(rp.zone, { type: 'rpg_player_equip_update', data: { username, equipped: p.equipped } }, username);
    }
    return { success: true, slot, item, equipped: p.equipped };
  }

  unequipItem(username, slot) {
    const p = this.player(username);
    if (!p.equipped[slot]) return { error: 'nothing_equipped' };
    p.inventory.push(p.equipped[slot]);
    const item = p.equipped[slot];
    p.equipped[slot] = null;
    this.saveData();
    // Broadcast equip change to all players in zone
    const rp = this.rpgPlayers[username];
    if (rp && rp.zone) {
      this.rpgBroadcastZone(rp.zone, { type: 'rpg_player_equip_update', data: { username, equipped: p.equipped } }, username);
    }
    return { success: true, slot, item, equipped: p.equipped };
  }

  repairItem(username, uid) {
    const p = this.player(username);
    // Find item in inventory or equipped
    let item = p.inventory.find(i => i.uid === uid);
    if (!item) {
      for (const eq of Object.values(p.equipped || {})) {
        if (eq && eq.uid === uid) { item = eq; break; }
      }
    }
    if (!item) return { error: 'not_found' };
    if (item.durability === undefined) return { error: 'no_durability' };
    if (item.durability >= item.maxDurability) return { error: 'full_durability' };
    // Consume a repair kit
    if (!this.removeStackable(p, 'repair_kit', 1)) return { error: 'no_repair_kit' };
    const repairAmount = ITEMS.repair_kit.value || 50;
    item.durability = Math.min(item.maxDurability, item.durability + repairAmount);
    this.saveData();
    return { success: true, item, durability: item.durability, maxDurability: item.maxDurability };
  }

  useConsumable(username, itemId) {
    const p = this.player(username);
    const template = ITEMS[itemId];
    if (!template || template.type !== 'consumable') return { error: 'not_consumable' };
    // Kit items are non-stackable, remove by uid-less match
    if (template.subtype === 'kit') {
      const idx = p.inventory.findIndex(i => i.id === itemId);
      if (idx === -1) return { error: 'none_owned' };
      p.inventory.splice(idx, 1);
    } else {
      if (!this.removeStackable(p, itemId, 1)) return { error: 'none_owned' };
    }
    const rp = this.rpgPlayers[username];
    let result = { success: true, item: itemId, name: template.name };
    switch (template.subtype) {
      case 'heal':
        if (rp) { rp.hp = Math.min(rp.maxHP, rp.hp + template.value); result.hp = rp.hp; result.maxHP = rp.maxHP; }
        break;
      case 'buff_dmg':
        if (!p.rpg) p.rpg = {};
        p.rpg.buffDmg = { mult: template.value, expires: Date.now() + template.duration };
        result.buff = 'dmg'; result.duration = template.duration;
        break;
      case 'buff_def':
        if (!p.rpg) p.rpg = {};
        p.rpg.buffDef = { value: template.value, expires: Date.now() + template.duration };
        result.buff = 'def'; result.duration = template.duration;
        break;
      case 'buff_speed':
        if (!p.rpg) p.rpg = {};
        p.rpg.buffSpeed = { mult: template.value, expires: Date.now() + template.duration };
        result.buff = 'speed'; result.duration = template.duration;
        break;
      case 'kit': {
        // Starter kit — give basic gear + potions + gold
        const gifts = [];
        this.addItemToInventory(p, 'wooden_sword'); gifts.push('Wooden Sword');
        this.addItemToInventory(p, 'cloth_armor'); gifts.push('Cloth Armor');
        this.addItemToInventory(p, 'health_potion', 5); gifts.push('Health Potion x5');
        this.addItemToInventory(p, 'repair_kit', 2); gifts.push('Repair Kit x2');
        p.gold += 100;
        result.kit = true;
        result.gifts = gifts;
        result.goldGiven = 100;
        result.gold = p.gold;
        break;
      }
    }
    this.saveData();
    return result;
  }

  minDmg(p) {
    const base = Math.floor((CONFIG.baseMinDmg + (p.level - 1) * CONFIG.dmgPerLevel) * (1 + this.equipStat(p, 'dmgMult') + (p.prestigeBonus || 0)));
    let bonus = this.weaponDmgBonus(p);
    if (p.rpg && p.rpg.buffDmg && Date.now() < p.rpg.buffDmg.expires) bonus = Math.floor(bonus * p.rpg.buffDmg.mult);
    return base + bonus;
  }
  maxDmg(p) {
    const base = Math.floor((CONFIG.baseMaxDmg + (p.level - 1) * CONFIG.dmgPerLevel) * (1 + this.equipStat(p, 'dmgMult') + (p.prestigeBonus || 0)));
    let bonus = this.weaponDmgBonus(p);
    if (p.rpg && p.rpg.buffDmg && Date.now() < p.rpg.buffDmg.expires) bonus = Math.floor(bonus * p.rpg.buffDmg.mult);
    return base + bonus;
  }
  critChance(p) {
    let base = p.level >= CONFIG.critLevel ? CONFIG.baseCritChance + (p.level - CONFIG.critLevel) * CONFIG.critPerLevel : 0;
    return base + this.equipStat(p, 'critChance');
  }
  critMultiplier(p) { return CONFIG.critMultiplier + this.equipStat(p, 'critMult'); }
  dodgeChance(p) { return this.equipStat(p, 'dodgeChance'); }
  cooldownReduce(p) { return this.equipStat(p, 'cdReduce'); }
  goldFindMult(p) { return 1 + this.equipStat(p, 'goldFind'); }
  xpNeeded(p) { return p.level * CONFIG.xpPerLevel; }

  buyFromShop(username, itemId) {
    const template = ITEMS[itemId];
    if (!template) return { error: 'not_found' };
    if (template.shopPrice === undefined) return { error: 'not_for_sale' };
    const p = this.player(username);
    if (template.shopPrice > 0 && p.gold < template.shopPrice) return { error: 'broke', gold: p.gold, cost: template.shopPrice };
    if (template.shopPrice > 0) p.gold -= template.shopPrice;
    const item = this.addItemToInventory(p, itemId);
    this.logAction(username, 'shop_buy', (item.icon||'') + ' ' + item.name + ' for ' + (template.shopPrice||0) + 'g');
    this.saveData();
    return { success: true, item, gold: p.gold };
  }

  craftItem(username, recipeId) {
    const recipe = RECIPES[recipeId];
    if (!recipe) return { error: 'unknown_recipe' };
    const p = this.player(username);
    // Check gold
    if (p.gold < recipe.goldCost) return { error: 'broke', gold: p.gold, cost: recipe.goldCost };
    // Check materials
    for (const [matId, qty] of Object.entries(recipe.materials)) {
      if (this.getStackCount(p, matId) < qty) {
        return { error: 'missing_material', material: matId, need: qty, have: this.getStackCount(p, matId) };
      }
    }
    // Consume gold + materials
    p.gold -= recipe.goldCost;
    for (const [matId, qty] of Object.entries(recipe.materials)) {
      this.removeStackable(p, matId, qty);
    }
    // Create the item(s)
    const resultQty = recipe.resultQty || 1;
    const items = [];
    for (let i = 0; i < resultQty; i++) {
      const item = this.addItemToInventory(p, recipe.result);
      if (item) items.push(item);
    }
    this.logAction(username, 'craft', items.map(i=>(i.icon||'')+' '+i.name).join(', ') + ' (-' + recipe.goldCost + 'g)');
    this.saveData();
    return { success: true, items, gold: p.gold };
  }

  getInventory(username) {
    const p = this.player(username);
    return { inventory: p.inventory, equipped: p.equipped, gold: p.gold };
  }

  addXP(p, amount) {
    if (Date.now() < this.doubleXPUntil) amount *= 2;
    p.xp += amount;
    let leveled = false;
    while (p.xp >= this.xpNeeded(p)) { p.xp -= this.xpNeeded(p); p.level++; leveled = true; }
    return leveled;
  }

  addGold(p, amount) {
    amount = Math.floor(amount * this.goldFindMult(p));
    p.gold += amount;
    return amount;
  }

  // ── Inventory helpers ────────────────────
  addItemToInventory(p, itemId, qty = 1, quality = -1) {
    const template = ITEMS[itemId];
    if (!template) return null;
    if (template.stackable) {
      // Stackable: find existing stack matching id AND quality, or create new
      const existing = p.inventory.find(i => i.id === itemId && i.stackable && (i.quality || -1) === quality);
      if (existing) {
        existing.qty += qty;
        return existing;
      }
      const stack = { id: itemId, name: template.name, type: template.type, rarity: template.rarity, icon: template.icon, desc: template.desc, stackable: true, qty };
      if (template.subtype) stack.subtype = template.subtype;
      if (template.value !== undefined) stack.value = template.value;
      if (template.duration) stack.duration = template.duration;
      if (quality >= 0) {
        stack.quality = quality;
        const ql = ORE_QUALITY.labels[quality];
        if (ql) stack.name = ql + ' ' + template.name;
      }
      p.inventory.push(stack);
      return stack;
    }
    // Non-stackable: create unique instance with durability
    const item = {
      id: itemId, uid: crypto.randomUUID(),
      name: template.name, type: template.type, rarity: template.rarity, icon: template.icon, desc: template.desc,
    };
    if (template.dmgBonus !== undefined) item.dmgBonus = template.dmgBonus;
    if (template.defBonus !== undefined) item.defBonus = template.defBonus;
    if (template.maxDurability) { item.durability = template.maxDurability; item.maxDurability = template.maxDurability; }
    if (template.crafted) item.crafted = true;
    // Random craft bonus (5% chance for +10-25% bonus stats on craft)
    if (template.crafted && Math.random() < 0.05) {
      const bonusMult = 1 + (0.10 + Math.random() * 0.15);
      if (item.dmgBonus) item.dmgBonus = Math.round(item.dmgBonus * bonusMult);
      if (item.defBonus) item.defBonus = Math.round(item.defBonus * bonusMult);
      item.bonusRoll = true;
      item.name = '★ ' + item.name;
    }
    p.inventory.push(item);
    return item;
  }

  removeItemFromInventory(p, uid) {
    const idx = p.inventory.findIndex(i => i.uid === uid);
    if (idx === -1) return null;
    return p.inventory.splice(idx, 1)[0];
  }

  removeStackable(p, itemId, qty = 1) {
    const stack = p.inventory.find(i => i.id === itemId && i.stackable);
    if (!stack || stack.qty < qty) return false;
    stack.qty -= qty;
    if (stack.qty <= 0) p.inventory.splice(p.inventory.indexOf(stack), 1);
    return true;
  }

  getStackCount(p, itemId) {
    const stack = p.inventory.find(i => i.id === itemId && i.stackable);
    return stack ? stack.qty : 0;
  }

  rollLootTable(tableId) {
    const table = LOOT_TABLES[tableId];
    if (!table) return [];
    const items = [];
    // Guaranteed drop
    if (table.guaranteed) items.push({ itemId: table.guaranteed, qty: 1 });
    // Chance drops
    for (const drop of (table.drops || [])) {
      if (Math.random() < drop.chance) {
        items.push({ itemId: drop.itemId, qty: drop.qty || 1, wearable: !!drop.wearable });
      }
    }
    return items;
  }

  // ── Achievement checker ──────────────────
  checkAchievements(username) {
    const p = this.player(username);
    const newAch = [];
    for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
      if (!p.achievements.includes(id) && ach.check(p)) {
        p.achievements.push(id);
        newAch.push({ id, name: ach.name, desc: ach.desc });
      }
    }
    return newAch;
  }

  emitAchievements(username) {
    for (const a of this.checkAchievements(username)) {
      this.emit('achievement', { username, ...a });
    }
  }

  // ── Cooldowns ────────────────────────────
  checkCD(user, type) {
    const key = `${user}:${type}`;
    const now = Date.now();
    let dur = { attack: CONFIG.attackCooldown, stats: CONFIG.statsCooldown, boss: CONFIG.bossCooldown, thegame: CONFIG.theGameCooldown }[type] || 0;
    if (type === 'attack') {
      if (this.playerBuffs[user] && this.playerBuffs[user].speed_boost) dur = Math.floor(dur / 2);
      const p = this.players[user];
      if (p) dur = Math.floor(dur * (1 - this.cooldownReduce(p)));
    }
    if (!this.cooldowns[key]) this.cooldowns[key] = 0;
    const left = this.cooldowns[key] + dur - now;
    if (left > 0) return left;
    this.cooldowns[key] = now;
    return 0;
  }

  checkGlobalCD(type) {
    const now = Date.now();
    const dur = { thegame: CONFIG.theGameCooldown }[type] || 0;
    if (!this.globalCD[type]) this.globalCD[type] = 0;
    const left = this.globalCD[type] + dur - now;
    if (left > 0) return left;
    this.globalCD[type] = now;
    return 0;
  }

  activeCount() {
    const cutoff = Date.now() - CONFIG.activeWindow;
    return Object.values(this.recentAttackers).filter(t => t > cutoff).length;
  }

  // ── Boss management ──────────────────────
  spawnBoss(number) {
    const a = this.activeCount();
    const hp = number === 1
      ? CONFIG.boss1BaseHP + a * CONFIG.boss1PerPlayer
      : CONFIG.boss2BaseHP + a * CONFIG.boss2PerPlayer;
    const name = pick(number === 1 ? BOSS1_NAMES : BOSS2_NAMES);
    this.boss = { name, hp, maxHP: hp, number, phases: { 50: false, 25: false, 10: false } };
    this.bossNumber = number;
    this.damageMap = {};
    this.state = 'boss_active';
    this.emit('boss_spawn', { name, hp, maxHP: hp, number });
    console.log(`⚔️  Boss #${number} "${name}" spawned — HP: ${hp}`);
  }

  // ── Attack ───────────────────────────────
  handleAttack(username) {
    if (this.state !== 'boss_active' || !this.boss) return null;
    const cd = this.checkCD(username, 'attack');
    if (cd > 0) return { error: 'cooldown', remaining: cd };

    const p = this.player(username);
    this.recentAttackers[username] = Date.now();

    let lo = this.minDmg(p), hi = this.maxDmg(p);
    if (Date.now() < this.doubleDmgUntil) { lo *= 2; hi *= 2; }
    const buffs = this.playerBuffs[username] || {};
    if (buffs.dmg_boost) { lo += buffs.dmg_boost; hi += buffs.dmg_boost; }
    if (buffs.mega_dmg) { lo *= 2; hi *= 2; }

    let damage = rand(lo, hi);
    let isCrit = false;
    const extraCrit = buffs.crit_boost || 0;
    if (Math.random() < this.critChance(p) + extraCrit) {
      damage = Math.floor(damage * this.critMultiplier(p));
      isCrit = true;
    }

    this.boss.hp = Math.max(0, this.boss.hp - damage);
    this.damageMap[username] = (this.damageMap[username] || 0) + damage;
    p.totalDamage += damage;
    const hitGold = this.addGold(p, CONFIG.goldPerHit);

    const pct = (this.boss.hp / this.boss.maxHP) * 100;
    const phases = [];
    for (const t of [50, 25, 10]) {
      if (!this.boss.phases[t] && pct <= t) { this.boss.phases[t] = true; phases.push(t); }
    }

    const cos = p.activeCosmetics || {};
    this.emit('hit', {
      username, damage, isCrit,
      bossHP: this.boss.hp, bossMaxHP: this.boss.maxHP, bossName: this.boss.name,
      hitEffect: cos.hitEffect || null, badge: cos.badge || null, title: cos.title || null,
      goldEarned: hitGold,
    });
    for (const phase of phases) this.emit('boss_phase', { phase, bossHP: this.boss.hp, bossMaxHP: this.boss.maxHP, bossName: this.boss.name });

    // Combo
    if (this.lastAttacker !== username) {
      this.comboCount++;
      this.lastAttacker = username;
      if (this.comboTimer) clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(() => { this.comboCount = 0; this.lastAttacker = null; }, 10000);
      if (this.comboCount >= 3) this.emit('combo', { count: this.comboCount, username });
    }

    // Streak
    p.streak = (p.streak || 0) + 1;
    if (p.streak > (p.bestStreak || 0)) p.bestStreak = p.streak;
    if (p.streak % 5 === 0) p.gold += 1;

    this.emitLeaderboard();
    this.emitAchievements(username);
    if (this.boss.hp <= 0) this.bossDeath();
    return { damage, isCrit, phases, bossHP: this.boss.hp };
  }

  // ── Boss Death & Loot ────────────────────
  bossDeath() {
    const num = this.bossNumber;
    const name = this.boss.name;
    const sorted = Object.entries(this.damageMap).sort((a, b) => b[1] - a[1]);
    const mvp = sorted[0] ? sorted[0][0] : null;
    const top5 = sorted.slice(0, 5).map(([u, d]) => ({ username: u, damage: d }));
    const all = sorted.map(([u]) => u);
    const lootResults = [];

    // Boss prize: top 3 attackers get gold
    const prizeGold = num === 1 ? 500 : 800;

    // Base rewards (XP + participation gold)
    for (const u of all) {
      const p = this.player(u);
      if (this.addXP(p, CONFIG.baseXP)) this.emit('level_up', { username: u, level: p.level });
      this.addGold(p, CONFIG.baseGold);
      p.bossKills = (p.bossKills || 0) + 1;
      this.logAction(u, 'boss_kill', this.boss.name + ' +' + CONFIG.baseGold + 'g +' + CONFIG.baseXP + 'xp');
    }

    // MVP: full prize gold + XP + legendary loot (fixed amount, no goldFind)
    if (mvp) {
      const p = this.player(mvp);
      this.addXP(p, CONFIG.mvpXP);
      p.gold += prizeGold;
      p.mvpCount = (p.mvpCount || 0) + 1;
      const loot = pick(BOSS_LOOT.mvp);
      const item = { ...loot, uid: crypto.randomUUID() };
      p.inventory.push(item);
      lootResults.push({ username: mvp, item, rank: 1 });
      this.logAction(mvp, 'boss_mvp', this.boss.name + ' MVP! +' + prizeGold + 'g +' + item.name);
    }

    // Top 2-3: 60% of prize gold + XP + loot (fixed amount, no goldFind)
    const top3Prize = Math.floor(prizeGold * 0.6);
    for (let i = 1; i < Math.min(3, sorted.length); i++) {
      const u = sorted[i][0], p = this.player(u);
      this.addXP(p, CONFIG.top5XP);
      p.gold += top3Prize;
      const loot = pick(BOSS_LOOT.top3);
      const item = { ...loot, uid: crypto.randomUUID() };
      p.inventory.push(item);
      lootResults.push({ username: u, item, rank: i + 1 });
    }

    // Top 4-5 XP
    for (let i = 3; i < Math.min(5, sorted.length); i++) {
      const p = this.player(sorted[i][0]);
      this.addXP(p, CONFIG.top5XP);
    }

    // Loot for top 4-15
    const lootCap = Math.min(15, sorted.length);
    for (let i = 3; i < lootCap; i++) {
      const u = sorted[i][0], p = this.player(u);
      const loot = pick(BOSS_LOOT.rest);
      const item = { ...loot, uid: crypto.randomUUID() };
      p.inventory.push(item);
      lootResults.push({ username: u, item, rank: i + 1 });
    }

    this.saveData();
    this.state = num === 1 ? 'break' : 'wheel_ready';
    this.boss = null;
    this.comboCount = 0;
    this.lastAttacker = null;
    this.playerBuffs = {};
    for (const u of all) this.player(u).streak = 0;

    this.emit('boss_dead', {
      bossNumber: num, bossName: name, mvp, top5, lootResults,
      isRaidBoss: num === 2, allAttackers: all,
      prizeMultiplier: this.prizeMultiplier, prizeGold,
    });

    for (const u of all) this.emitAchievements(u);

    if (num === 1) {
      this.emit('break_start', { duration: CONFIG.breakDuration });
      this.breakTimer = setTimeout(() => this.spawnBoss(2), CONFIG.breakDuration);
    } else {
      this.emit('wheel_ready', { rewards: this.wheelRewards, mvp });
    }
    console.log(`💀 Boss #${num} "${name}" defeated! MVP: ${mvp} | ${lootResults.length} loot drops`);
  }

  // ── Boss Fights Back (manual !bossattack) ─
  handleBossAttack(username) {
    if (username !== this.admin) return { error: 'not_admin' };
    if (this.state !== 'boss_active' || !this.boss) return { error: 'no_boss' };
    if (this.bossAttackActive) return { error: 'already_attacking' };

    const attack = pick(BOSS_ATTACKS);
    this.bossAttackActive = true;
    this.bossAttackDodgers = new Set();

    const targets = Object.keys(this.recentAttackers).filter(u =>
      Date.now() - this.recentAttackers[u] < CONFIG.activeWindow
    );

    this.emit('boss_attack', {
      attack: attack.name, emoji: attack.emoji,
      bossName: this.boss.name, dodgeWindow: CONFIG.dodgeWindow, targets,
    });
    console.log(`🐉 ${this.boss.name} uses ${attack.emoji} ${attack.name}! Type !dodge!`);

    this.bossAttackTimer = setTimeout(() => this.resolveBossAttack(targets), CONFIG.dodgeWindow);
    return { success: true, attack: attack.name };
  }

  handleDodge(username) {
    if (!this.bossAttackActive) return null;
    this.bossAttackDodgers.add(username);
    return { dodged: true, username };
  }

  resolveBossAttack(targets) {
    this.bossAttackActive = false;
    const results = { dodged: [], hit: [] };
    for (const u of targets) {
      const p = this.player(u);
      if (this.bossAttackDodgers.has(u) || Math.random() < this.dodgeChance(p)) {
        results.dodged.push(u);
        p.dodgeCount = (p.dodgeCount || 0) + 1;
      } else {
        p.gold = Math.max(0, p.gold - CONFIG.dodgePenalty);
        results.hit.push({ username: u, goldLost: CONFIG.dodgePenalty });
      }
    }
    this.emit('boss_attack_result', results);
    this.saveData();
    for (const u of results.dodged) this.emitAchievements(u);
    console.log(`🛡️ Attack resolved: ${results.dodged.length} dodged, ${results.hit.length} hit`);
  }

  // ── Sub = Instant Boss Kill ──────────────
  handleSubKill(subscriberName) {
    if (this.state !== 'boss_active' || !this.boss) return null;
    this.damageMap[subscriberName] = (this.damageMap[subscriberName] || 0) + 999;
    this.boss.hp = 0;
    this.emit('sub_kill', { subscriber: subscriberName, bossName: this.boss.name, bossNumber: this.bossNumber });
    this.emit('hit', { username: `⭐ ${subscriberName} (SUB!)`, damage: 9999, isCrit: true, bossHP: 0, bossMaxHP: this.boss.maxHP, bossName: this.boss.name });
    console.log(`🌟 ${subscriberName} SUBSCRIBED → Boss instantly killed!`);
    this.bossDeath();
    return { success: true, subscriber: subscriberName };
  }

  // ── Inventory & Equipment ────────────────
  handleInventory(username) {
    const p = this.player(username);
    return { username, inventory: p.inventory, equipped: p.equipped, cosmetics: p.cosmetics, activeCosmetics: p.activeCosmetics };
  }

  handleEquip(username, itemUid) {
    const p = this.player(username);
    const idx = p.inventory.findIndex(i => i.uid === itemUid);
    if (idx === -1) return { error: 'not_found' };
    const item = p.inventory[idx];
    const slot = item.type;
    if (slot !== 'weapon' && slot !== 'armor') return { error: 'not_equippable' };
    const old = p.equipped[slot];
    if (old) p.inventory.push(old);
    p.equipped[slot] = item;
    p.inventory.splice(idx, 1);
    this.saveData();
    return { username, equipped: item, unequipped: old || null };
  }

  handleUnequip(username, slot) {
    const p = this.player(username);
    const item = p.equipped[slot];
    if (!item) return { error: 'nothing_equipped' };
    p.inventory.push(item);
    p.equipped[slot] = null;
    this.saveData();
    return { username, unequipped: item };
  }

  // ── Cosmetics ────────────────────────────
  handleCosmeticShop(username) {
    const p = this.player(username);
    const items = Object.entries(COSMETICS).map(([key, c]) => ({
      key, name: c.name, cost: c.cost, desc: c.desc, type: c.type, owned: p.cosmetics.includes(key),
    }));
    return { username, items, gold: p.gold };
  }

  handleBuyCosmetic(username, cosmeticKey) {
    const key = (cosmeticKey || '').toLowerCase();
    const cosmetic = COSMETICS[key];
    if (!cosmetic) return { error: 'not_found' };
    const p = this.player(username);
    if (p.cosmetics.includes(key)) return { error: 'already_owned' };
    if (p.gold < cosmetic.cost) return { error: 'broke', gold: p.gold, cost: cosmetic.cost };
    p.gold -= cosmetic.cost;
    p.cosmetics.push(key);
    this.logAction(username, 'cosmetic_buy', cosmetic.name + ' for ' + cosmetic.cost + 'g');
    this.saveData();
    this.emitAchievements(username);
    return { username, item: cosmetic.name, cost: cosmetic.cost, gold: p.gold, key };
  }

  handleEquipCosmetic(username, cosmeticKey) {
    const key = (cosmeticKey || '').toLowerCase();
    const cosmetic = COSMETICS[key];
    if (!cosmetic) return { error: 'not_found' };
    const p = this.player(username);
    if (!p.cosmetics.includes(key)) return { error: 'not_owned' };
    p.activeCosmetics[cosmetic.type] = key;
    this.saveData();
    return { username, equipped: cosmetic.name, type: cosmetic.type };
  }

  // ── Market (buy/sell/trade) ──────────────
  handleSellItem(username, itemUid, price) {
    const p = this.player(username);
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    // Max 3 listings per player (panel marketplace)
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 3) return { error: 'max_listings', message: 'Max 3 active listings (rent a stall for more!)' };
    const idx = p.inventory.findIndex(i => i.uid === itemUid);
    if (idx === -1) return { error: 'not_found' };
    // Block quest items from being sold
    if (p.inventory[idx].id === 'goblin_key') return { error: 'quest_item', message: 'Quest items cannot be sold.' };
    // 5% listing fee
    const listFee = Math.max(1, Math.floor(priceNum * 0.05));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    const item = p.inventory.splice(idx, 1)[0];
    const listing = { id: this.marketIdCounter++, seller: username, type: 'equipment', itemData: item, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
    this.logAction(username, 'market_list', (item.icon||'') + ' ' + item.name + ' for ' + priceNum + 'g (fee:' + listFee + 'g)');
    this.saveData();
    return { username, listing, fee: listFee, gold: p.gold };
  }

  handleSellMaterial(username, itemId, qty, price) {
    const p = this.player(username);
    const priceNum = parseInt(price);
    const qtyNum = parseInt(qty);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    if (isNaN(qtyNum) || qtyNum < 1) return { error: 'invalid_qty' };
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 3) return { error: 'max_listings', message: 'Max 3 active listings (rent a stall for more!)' };
    if (this.getStackCount(p, itemId) < qtyNum) return { error: 'not_enough', have: this.getStackCount(p, itemId) };
    const template = ITEMS[itemId];
    if (!template) return { error: 'invalid_item' };
    // Block quest items from being sold
    if (itemId === 'goblin_key') return { error: 'quest_item', message: 'Quest items cannot be sold.' };
    const listFee = Math.max(1, Math.floor(priceNum * 0.05));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    this.removeStackable(p, itemId, qtyNum);
    const listing = {
      id: this.marketIdCounter++, seller: username, type: 'material',
      itemData: { id: itemId, name: template.name, icon: template.icon, rarity: template.rarity, qty: qtyNum },
      price: priceNum, listFee, listedAt: Date.now(),
    };
    this.market.push(listing);
    this.logAction(username, 'market_list', (template.icon||'') + ' ' + template.name + ' x' + qtyNum + ' for ' + priceNum + 'g (fee:' + listFee + 'g)');
    this.saveData();
    return { username, listing, fee: listFee, gold: p.gold };
  }

  handleSellCosmetic(username, cosmeticKey, price) {
    const p = this.player(username);
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 3) return { error: 'max_listings', message: 'Max 3 active listings (rent a stall for more!)' };
    const key = (cosmeticKey || '').toLowerCase();
    if (!p.cosmetics.includes(key)) return { error: 'not_owned' };
    for (const v of Object.values(p.activeCosmetics)) { if (v === key) return { error: 'unequip_first' }; }
    const listFee = Math.max(1, Math.floor(priceNum * 0.05));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    p.cosmetics = p.cosmetics.filter(c => c !== key);
    const listing = { id: this.marketIdCounter++, seller: username, type: 'cosmetic', itemData: { key, ...COSMETICS[key] }, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
    this.logAction(username, 'market_list', COSMETICS[key].name + ' (cosmetic) for ' + priceNum + 'g');
    this.saveData();
    return { username, listing, fee: listFee, gold: p.gold };
  }

  // ── Wearable handlers ───────────────────
  handleEquipWearable(username, wearableKey) {
    const key = (wearableKey || '').toLowerCase();
    const w = WEARABLES[key];
    if (!w) return { error: 'not_found' };
    const p = this.player(username);
    if (!p.wearables.includes(key)) return { error: 'not_owned' };
    p.activeWearables[w.slot] = key;
    this.saveData();
    return { username, equipped: w.name, slot: w.slot, key };
  }

  handleUnequipWearable(username, slot) {
    const s = (slot || '').toLowerCase();
    if (!['hat','cape','wrist','face'].includes(s)) return { error: 'invalid_slot' };
    const p = this.player(username);
    const key = p.activeWearables[s];
    if (!key) return { error: 'nothing_equipped' };
    p.activeWearables[s] = null;
    this.saveData();
    return { username, slot: s, unequipped: (WEARABLES[key] || {}).name };
  }

  handleSellWearable(username, wearableKey, price) {
    const p = this.player(username);
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 3) return { error: 'max_listings', message: 'Max 3 active listings (rent a stall for more!)' };
    const key = (wearableKey || '').toLowerCase();
    if (!p.wearables.includes(key)) return { error: 'not_owned' };
    for (const v of Object.values(p.activeWearables)) { if (v === key) return { error: 'unequip_first' }; }
    const listFee = Math.max(1, Math.floor(priceNum * 0.05));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    p.wearables = p.wearables.filter(w => w !== key);
    const wData = WEARABLES[key];
    const listing = { id: this.marketIdCounter++, seller: username, type: 'wearable', itemData: { key, name: wData.name, icon: wData.icon, rarity: wData.rarity, slot: wData.slot }, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
    this.logAction(username, 'market_list', wData.name + ' (wearable) for ' + priceNum + 'g');
    this.saveData();
    return { username, listing, fee: listFee, gold: p.gold };
  }

  getWearables(username) {
    const p = this.player(username);
    return {
      username,
      wearables: p.wearables.map(key => ({ key, ...WEARABLES[key] })),
      activeWearables: p.activeWearables,
    };
  }

  handleMarket(username) {
    return {
      username,
      listings: this.market.slice(-50).map(l => {
        const tpl = ITEMS[l.itemData.id] || {};
        return {
          id: l.id, seller: l.seller, type: l.type,
          name: l.itemData.name || tpl.name || l.itemData.id || 'Item', rarity: l.itemData.rarity || tpl.rarity || null, price: l.price,
          icon: l.itemData.icon || tpl.icon || null, qty: l.itemData.qty || null,
        };
      }),
    };
  }

  handleBuyMarket(username, listingId) {
    const lid = parseInt(listingId);
    const idx = this.market.findIndex(l => l.id === lid);
    if (idx === -1) return { error: 'not_found' };
    const listing = this.market[idx];
    if (listing._buying) return { error: 'not_found' }; // already being purchased
    if (listing.seller === username) return { error: 'own_listing' };
    const buyer = this.player(username);
    if (buyer.gold < listing.price) return { error: 'broke', gold: buyer.gold, cost: listing.price };
    listing._buying = true; // lock to prevent double-buy race condition
    buyer.gold -= listing.price;
    const seller = this.player(listing.seller);
    // 10% sale tax taken from seller's proceeds (panel marketplace)
    const tax = Math.max(1, Math.floor(listing.price * 0.10));
    seller.gold += listing.price - tax;
    if (listing.type === 'equipment') buyer.inventory.push(listing.itemData);
    else if (listing.type === 'material') this.addItemToInventory(buyer, listing.itemData.id, listing.itemData.qty || 1);
    else if (listing.type === 'cosmetic') buyer.cosmetics.push(listing.itemData.key);
    else if (listing.type === 'wearable') { if (!buyer.wearables.includes(listing.itemData.key)) buyer.wearables.push(listing.itemData.key); }
    this.market.splice(idx, 1);
    buyer.tradeCount = (buyer.tradeCount || 0) + 1;
    seller.tradeCount = (seller.tradeCount || 0) + 1;
    this.logAction(username, 'market_buy', (listing.itemData.icon||'') + ' ' + listing.itemData.name + ' from ' + listing.seller + ' for ' + listing.price + 'g');
    this.logAction(listing.seller, 'market_sold', (listing.itemData.icon||'') + ' ' + listing.itemData.name + ' to ' + username + ' for ' + (listing.price - tax) + 'g (tax:' + tax + 'g)');
    this.tradeLog.push({ type: 'sale', buyer: username, seller: listing.seller, item: listing.itemData.name, icon: listing.itemData.icon || '', rarity: listing.itemData.rarity || 'common', price: listing.price, tax, time: Date.now() });
    if (this.tradeLog.length > 500) this.tradeLog = this.tradeLog.slice(-500);
    this.saveData();
    this.emitAchievements(username);
    this.emitAchievements(listing.seller);
    return { buyer: username, seller: listing.seller, item: listing.itemData.name, price: listing.price, tax, buyerGold: buyer.gold };
  }

  handleCancelListing(username, listingId) {
    const lid = parseInt(listingId);
    const idx = this.market.findIndex(l => l.id === lid && l.seller === username);
    if (idx === -1) return { error: 'not_found' };
    const listing = this.market.splice(idx, 1)[0];
    const p = this.player(username);
    if (listing.type === 'equipment') p.inventory.push(listing.itemData);
    else if (listing.type === 'material') this.addItemToInventory(p, listing.itemData.id, listing.itemData.qty || 1);
    else if (listing.type === 'cosmetic') p.cosmetics.push(listing.itemData.key);
    else if (listing.type === 'wearable') { if (!p.wearables.includes(listing.itemData.key)) p.wearables.push(listing.itemData.key); }
    this.saveData();
    return { username, cancelled: listing.itemData.name };
  }

  // ── Listing expiry (24h) ─────────────────
  _expireMarketListings() {
    const now = Date.now();
    const expired = [];
    this.market = this.market.filter(l => {
      if (now - (l.listedAt || 0) > 86400000) { expired.push(l); return false; }
      return true;
    });
    for (const l of expired) {
      const p = this.player(l.seller);
      if (l.type === 'equipment') p.inventory.push(l.itemData);
      else if (l.type === 'material') this.addItemToInventory(p, l.itemData.id, l.itemData.qty || 1);
      else if (l.type === 'cosmetic') p.cosmetics.push(l.itemData.key);
      else if (l.type === 'wearable') { if (!p.wearables.includes(l.itemData.key)) p.wearables.push(l.itemData.key); }
      this.logAction(l.seller, 'market_expired', (l.itemData.icon||'') + ' ' + l.itemData.name + ' listing expired — item returned');
    }
    if (expired.length) this.saveData();
  }

  // ── Player-Owned Stalls ──────────────────
  _getStallTier(stallId) {
    if (stallId.startsWith('sm')) return 'small';
    if (stallId.startsWith('md')) return 'medium';
    if (stallId.startsWith('lg')) return 'large';
    return null;
  }
  _getStallMaxItems(tier) {
    return tier === 'small' ? 4 : tier === 'medium' ? 8 : tier === 'large' ? 16 : 0;
  }
  _getStallCost(tier) {
    return tier === 'small' ? 1500 : tier === 'medium' ? 5000 : tier === 'large' ? 20000 : 0;
  }
  _getPlayerStall(username) {
    for (const [id, stall] of Object.entries(this.marketStalls)) {
      if (stall && stall.owner === username) return { id, ...stall };
    }
    return null;
  }

  handleRentStall(username, stallId) {
    const p = this.player(username);
    const tier = this._getStallTier(stallId);
    if (!tier) return { error: 'invalid_stall' };
    // Check stall exists in zone config
    const zone = RPG_ZONES.market;
    if (!zone) return { error: 'invalid_zone' };
    const allSlots = [...zone.stallSlots.small, ...zone.stallSlots.medium, ...zone.stallSlots.large];
    if (!allSlots.find(s => s.id === stallId)) return { error: 'invalid_stall' };
    // Check not already rented
    if (this.marketStalls[stallId]) return { error: 'already_rented', owner: this.marketStalls[stallId].owner };
    // Max 1 stall per player
    const existing = this._getPlayerStall(username);
    if (existing) return { error: 'already_own', message: 'You already own stall ' + existing.id + '. Release it first.' };
    const cost = this._getStallCost(tier);
    if (p.gold < cost) return { error: 'cant_afford', cost, gold: p.gold };
    p.gold -= cost;
    this.marketStalls[stallId] = { owner: username, color: '#aa3333', tier, items: [], rentedAt: Date.now() };
    this.logAction(username, 'stall_rent', 'Rented ' + tier + ' stall ' + stallId + ' for ' + cost + 'g');
    this.saveData();
    return { username, stallId, tier, cost, gold: p.gold, stall: this.marketStalls[stallId] };
  }

  handleReleaseStall(username) {
    const existing = this._getPlayerStall(username);
    if (!existing) return { error: 'no_stall', message: 'You don\'t own a stall.' };
    const p = this.player(username);
    // Return stocked items to inventory
    for (const si of existing.items) {
      if (si.uid) { p.inventory.push(si.itemData); } // equipment
      else { this.addItemToInventory(p, si.id, si.qty || 1); } // stackable
    }
    // 50% refund
    const refund = Math.floor(this._getStallCost(existing.tier) * 0.5);
    p.gold += refund;
    delete this.marketStalls[existing.id];
    this.logAction(username, 'stall_release', 'Released stall ' + existing.id + ', refund ' + refund + 'g, ' + existing.items.length + ' items returned');
    this.saveData();
    return { username, stallId: existing.id, refund, gold: p.gold, itemsReturned: existing.items.length };
  }

  handleStallSetColor(username, color) {
    const existing = this._getPlayerStall(username);
    if (!existing) return { error: 'no_stall' };
    const validColors = ['#aa3333','#3333aa','#33aa33','#aa8833','#8833aa','#33aaaa'];
    if (!validColors.includes(color)) return { error: 'invalid_color' };
    this.marketStalls[existing.id].color = color;
    this.saveData();
    return { username, stallId: existing.id, color };
  }

  handleStallStock(username, itemUid, itemId, qty, price) {
    const existing = this._getPlayerStall(username);
    if (!existing) return { error: 'no_stall', message: 'Rent a stall first!' };
    const p = this.player(username);
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    const maxItems = this._getStallMaxItems(existing.tier);
    if (existing.items.length >= maxItems) return { error: 'stall_full', max: maxItems };

    if (itemUid) {
      // Equipment / non-stackable
      const idx = p.inventory.findIndex(i => i.uid === itemUid);
      if (idx === -1) return { error: 'not_found' };
      if (p.inventory[idx].id === 'goblin_key') return { error: 'quest_item' };
      const item = p.inventory.splice(idx, 1)[0];
      const stallItem = { uid: item.uid, id: item.id, itemData: item, price: priceNum, name: item.name || (ITEMS[item.id]||{}).name, icon: item.icon || (ITEMS[item.id]||{}).icon, rarity: item.rarity || (ITEMS[item.id]||{}).rarity };
      this.marketStalls[existing.id].items.push(stallItem);
    } else if (itemId) {
      // Stackable material / consumable
      const qtyNum = parseInt(qty) || 1;
      if (this.getStackCount(p, itemId) < qtyNum) return { error: 'not_enough' };
      if (itemId === 'goblin_key') return { error: 'quest_item' };
      const template = ITEMS[itemId];
      if (!template) return { error: 'invalid_item' };
      this.removeStackable(p, itemId, qtyNum);
      const stallItem = { id: itemId, qty: qtyNum, price: priceNum, name: template.name, icon: template.icon, rarity: template.rarity };
      this.marketStalls[existing.id].items.push(stallItem);
    } else {
      return { error: 'no_item' };
    }
    this.saveData();
    return { username, stallId: existing.id, stall: this.marketStalls[existing.id], gold: p.gold };
  }

  handleStallUnstock(username, slotIndex) {
    const existing = this._getPlayerStall(username);
    if (!existing) return { error: 'no_stall' };
    const idx = parseInt(slotIndex);
    if (isNaN(idx) || idx < 0 || idx >= existing.items.length) return { error: 'invalid_slot' };
    const p = this.player(username);
    const stallItem = this.marketStalls[existing.id].items.splice(idx, 1)[0];
    if (stallItem.uid) { p.inventory.push(stallItem.itemData); }
    else { this.addItemToInventory(p, stallItem.id, stallItem.qty || 1); }
    this.saveData();
    return { username, stallId: existing.id, stall: this.marketStalls[existing.id], returned: stallItem.name };
  }

  handleStallBuy(buyerName, stallId, slotIndex) {
    const stall = this.marketStalls[stallId];
    if (!stall) return { error: 'stall_not_found' };
    const idx = parseInt(slotIndex);
    if (isNaN(idx) || idx < 0 || idx >= stall.items.length) return { error: 'invalid_slot' };
    if (stall.owner === buyerName) return { error: 'own_stall', message: 'Use unstock to remove your own items.' };
    const buyer = this.player(buyerName);
    const stallItem = stall.items[idx];
    if (buyer.gold < stallItem.price) return { error: 'broke', gold: buyer.gold, cost: stallItem.price };
    // Process purchase — 3% stall tax (much lower than 10% panel tax)
    buyer.gold -= stallItem.price;
    const tax = Math.max(1, Math.floor(stallItem.price * 0.03));
    const seller = this.player(stall.owner);
    seller.gold += stallItem.price - tax;
    // Give item to buyer
    if (stallItem.uid) { buyer.inventory.push(stallItem.itemData); }
    else { this.addItemToInventory(buyer, stallItem.id, stallItem.qty || 1); }
    stall.items.splice(idx, 1);
    buyer.tradeCount = (buyer.tradeCount || 0) + 1;
    seller.tradeCount = (seller.tradeCount || 0) + 1;
    this.logAction(buyerName, 'stall_buy', (stallItem.icon||'') + ' ' + stallItem.name + ' from ' + stall.owner + '\'s stall for ' + stallItem.price + 'g');
    this.logAction(stall.owner, 'stall_sold', (stallItem.icon||'') + ' ' + stallItem.name + ' to ' + buyerName + ' for ' + (stallItem.price - tax) + 'g (tax:' + tax + 'g)');
    this.tradeLog.push({ type: 'stall_sale', buyer: buyerName, seller: stall.owner, item: stallItem.name, icon: stallItem.icon || '', rarity: stallItem.rarity || 'common', price: stallItem.price, tax, stallId, time: Date.now() });
    if (this.tradeLog.length > 500) this.tradeLog = this.tradeLog.slice(-500);
    this.saveData();
    return { buyer: buyerName, seller: stall.owner, item: stallItem.name, price: stallItem.price, tax, buyerGold: buyer.gold, stallId, stall };
  }

  getMarketStalls() {
    // Return all stalls with public info (for client rendering & browsing)
    const result = {};
    for (const [id, stall] of Object.entries(this.marketStalls)) {
      if (!stall) continue;
      result[id] = {
        owner: stall.owner, color: stall.color, tier: stall.tier,
        items: stall.items.map(si => ({ name: si.name, icon: si.icon, rarity: si.rarity, price: si.price, qty: si.qty, id: si.id })),
      };
    }
    return result;
  }

  // ── Cash Balance ─────────────────────────
  handleCashBalance(username) {
    const p = this.player(username);
    return { username, gold: p.gold, vaultGold: p.vaultGold || 0, cashValue: ((p.vaultGold || 0) / CONFIG.goldPerDollar).toFixed(2), rate: CONFIG.goldPerDollar, lastVgConvert: p.lastVgConvert || 0 };
  }

  // ── Stats / Info ─────────────────────────
  handleStats(username) {
    const cd = this.checkCD(username, 'stats');
    if (cd > 0) return { error: 'cooldown', remaining: cd };
    const p = this.player(username);
    return {
      username, level: p.level, xp: p.xp, xpNeeded: this.xpNeeded(p),
      gold: p.gold, totalDamage: p.totalDamage,
      vaultGold: p.vaultGold || 0,
      minDmg: this.minDmg(p), maxDmg: this.maxDmg(p),
      critChance: Math.round(this.critChance(p) * 100),
      streak: p.streak || 0, bestStreak: p.bestStreak || 0,
      equipped: p.equipped, achievements: p.achievements.length,
      cashValue: ((p.vaultGold || 0) / CONFIG.goldPerDollar).toFixed(2),
      inventoryCount: p.inventory.length, cosmeticCount: p.cosmetics.length,
    };
  }

  handleDaily(username) {
    const p = this.player(username);
    const since = Date.now() - (p.lastDaily || 0);
    if (since < CONFIG.dailyCooldown) return { error: 'cooldown', remaining: CONFIG.dailyCooldown - since };
    p.lastDaily = Date.now();
    const leveled = this.addXP(p, CONFIG.dailyXP);
    p.gold += CONFIG.dailyGold;
    this.logAction(username, 'daily', '+' + CONFIG.dailyGold + 'g +' + CONFIG.dailyXP + 'xp');
    this.saveData();
    this.emitAchievements(username);
    return { username, xp: CONFIG.dailyXP, gold: CONFIG.dailyGold, leveled, level: p.level };
  }

  handleBossInfo(username) {
    if (username) { const cd = this.checkCD(username, 'boss'); if (cd > 0) return { error: 'cooldown', remaining: cd }; }
    if (!this.boss) return { active: false, state: this.state };
    return { active: true, name: this.boss.name, hp: this.boss.hp, maxHP: this.boss.maxHP, number: this.boss.number, percent: Math.round((this.boss.hp / this.boss.maxHP) * 100) };
  }

  handleLeaderboard() {
    const sorted = Object.entries(this.damageMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const top5 = sorted.map(([u, d], i) => {
      const p = this.players[u];
      const cosmetics = p ? p.activeCosmetics || {} : {};
      return { rank: i + 1, username: u, damage: d, cosmetics, rankBadge: getRankBadge(p ? p.level : 1).badge };
    });
    // Portal-friendly entries with full player data
    const entries = Object.entries(this.players)
      .map(([u, p]) => ({
        username: u,
        level: p.level,
        totalDamage: p.totalDamage,
        gold: p.gold,
        rankBadge: getRankBadge(p.level).badge,
      }))
      .sort((a, b) => b.totalDamage - a.totalDamage)
      .slice(0, 20);
    return { top5, entries };
  }

  handleTheGame(username) {
    if (this.checkGlobalCD('thegame') > 0) return { error: 'global_cooldown' };
    if (this.checkCD(username, 'thegame') > 0) return { error: 'cooldown' };
    return { rules: '⚔️ !attack !stats !daily !inv !equip !shop !cosmetics !market !gamble !gift !dodge !achievements | Gold = real $$$!' };
  }

  handleAchievementList(username) {
    const p = this.player(username);
    const all = Object.entries(ACHIEVEMENTS).map(([id, a]) => ({
      id, name: a.name, desc: a.desc, unlocked: p.achievements.includes(id),
    }));
    return { username, achievements: all, unlocked: p.achievements.length, total: all.length };
  }

  emitLeaderboard() { this.emit('leaderboard', this.handleLeaderboard()); }

  handleGamble(username, amount) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    // 35% win chance, 1.8x payout (house edge ~37%)
    if (Math.random() < 0.35) {
      const payout = Math.floor(bet * 1.8);
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
      this.saveData();
      this.emitAchievements(username);
      this.logAction(username, 'gamble_win', 'Coinflip +' + (payout-bet) + 'g (bet:' + bet + 'g)');
      return { username, won: true, bet, payout, gold: p.gold, game: 'coinflip' };
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
      this.logAction(username, 'gamble_lose', 'Coinflip -' + bet + 'g');
      this.saveData();
      return { username, won: false, bet, gold: p.gold, game: 'coinflip' };
    }
  }

  handleDiceRoll(username, amount, target) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    const tgt = parseFloat(target);
    if (isNaN(tgt) || tgt < 5 || tgt > 95) return { error: 'invalid_target' };
    // Stake-style dice: roll 0.00-99.99, win if roll > target
    // Win chance = (100 - target) / 100
    // Multiplier = (100 / winChance) * 0.88  (12% house edge)
    const winChance = (100 - tgt) / 100;
    const mult = parseFloat(((1 / winChance) * 0.88).toFixed(4));
    const roll = parseFloat((Math.random() * 100).toFixed(2));
    const won = roll > tgt;
    const payout = won ? Math.floor(bet * mult) : 0;
    if (won) {
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
    }
    this.saveData();
    if (won) this.emitAchievements(username);
    this.logAction(username, won ? 'gamble_win' : 'gamble_lose', 'Dice ' + (won ? '+' + (payout-bet) : '-' + bet) + 'g (roll:' + roll + ')');
    return { username, roll, target: tgt, mult, winChance: parseFloat((winChance * 100).toFixed(2)), bet, payout, won, gold: p.gold, game: 'dice' };
  }

  handleSlots(username, amount) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    // 8 symbols = much harder to match. Pair ~27%, triple ~1.6%
    const symbols = ['🍒','🍋','🔔','💎','7️⃣','🍀','⭐','🎯'];
    const pick = () => symbols[Math.floor(Math.random() * symbols.length)];
    const reels = [pick(), pick(), pick()];
    let mult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      if (reels[0] === '7️⃣') mult = 20;
      else if (reels[0] === '💎') mult = 12;
      else if (reels[0] === '⭐') mult = 10;
      else if (reels[0] === '🍀') mult = 8;
      else mult = 5;
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      mult = 1.5; // pair pays less
    }
    const payout = Math.floor(bet * mult);
    if (mult > 0) {
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
    }
    this.saveData();
    if (mult > 0) this.emitAchievements(username);
    this.logAction(username, mult > 0 ? 'gamble_win' : 'gamble_lose', 'Slots ' + (mult > 0 ? '+' + (payout-bet) : '-' + bet) + 'g ' + reels.join(''));
    return { username, reels, mult, bet, payout, won: mult > 0, gold: p.gold, game: 'slots' };
  }

  handleBlackjack(username, amount) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    // Simplified instant blackjack — deal 2 cards each, highest wins
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const val = c => c === 'A' ? 11 : ['J','Q','K'].includes(c) ? 10 : parseInt(c);
    const suits = ['♠','♥','♦','♣'];
    // Build a full deck and draw without replacement
    const shoe = [];
    for (const r of ranks) for (const s of suits) shoe.push({ card: r + s, value: val(r) });
    for (let i = shoe.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
    const pc = [shoe[0], shoe[1]];
    const dc = [shoe[2], shoe[3]];
    let pTotal = pc[0].value + pc[1].value;
    let dTotal = dc[0].value + dc[1].value;
    // Ace adjustment: if bust, count each Ace as 1 instead of 11
    let pAces = pc.filter(c => c.card.startsWith('A')).length;
    while (pTotal > 21 && pAces > 0) { pTotal -= 10; pAces--; }
    let dAces = dc.filter(c => c.card.startsWith('A')).length;
    while (dTotal > 21 && dAces > 0) { dTotal -= 10; dAces--; }
    const playerBJ = pTotal === 21;
    const dealerBJ = dTotal === 21;
    let won = false, push = false, payout = 0, result = 'lose';
    if (playerBJ && dealerBJ) { push = true; payout = bet; result = 'push'; }
    else if (playerBJ) { won = true; payout = Math.floor(bet * 2.5); result = 'blackjack'; }
    else if (dealerBJ) { result = 'dealer_bj'; }
    else if (pTotal > dTotal) { won = true; payout = bet * 2; result = 'win'; }
    else if (pTotal === dTotal) { push = true; payout = bet; result = 'push'; }
    else { result = 'lose'; }
    if (won) {
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
    } else if (!push) {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
    }
    this.saveData();
    if (won) this.emitAchievements(username);
    this.logAction(username, won ? 'gamble_win' : (push ? 'gamble_push' : 'gamble_lose'), 'Blackjack ' + (won ? '+' + (payout-bet) : push ? '±0' : '-' + bet) + 'g (' + result + ')');
    return { username, playerCards: pc.map(c => c.card), dealerCards: dc.map(c => c.card), playerTotal: pTotal, dealerTotal: dTotal, result, won, bet, payout, gold: p.gold, game: 'blackjack' };
  }

  handleCrash(username, amount, cashout) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    const target = parseFloat(cashout);
    if (isNaN(target) || target < 1.2 || target > 20) return { error: 'invalid_cashout' };
    // Crash point: house edge built in — crash follows inverse distribution
    // Lower crash points are more likely. Median crash ~1.8x
    const r = Math.random();
    const crashAt = Math.max(1.0, parseFloat((1 / (1 - r * 0.94)).toFixed(2)));
    const won = target <= crashAt;
    let payout = 0;
    if (won) {
      payout = Math.floor(bet * target);
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
    }
    this.saveData();
    if (won) this.emitAchievements(username);
    this.logAction(username, won ? 'gamble_win' : 'gamble_lose', 'Crash ' + (won ? '+' + (payout-bet) : '-' + bet) + 'g (' + target + 'x, crashed:' + crashAt + 'x)');
    return { username, crashAt, target, won, bet, payout, gold: p.gold, game: 'crash' };
  }

  handleRoulette(username, amount, choice) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    const pick = (choice || '').toLowerCase();
    const valid = ['red','black','green','low','high','odd','even'];
    if (!valid.includes(pick)) return { error: 'invalid_choice' };
    // 0-36 wheel, 0=green. Red/Black each cover 18 numbers.
    // Added 00 slot (index 37) for extra house edge
    const spin = Math.floor(Math.random() * 38); // 0-37 (0=green, 37=00 green)
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const isGreen = spin === 0 || spin === 37;
    const isRed = !isGreen && reds.includes(spin);
    const isBlack = !isGreen && !isRed;
    const num = isGreen ? (spin === 0 ? 0 : '00') : spin;
    let won = false, mult = 0;
    if (pick === 'green' && isGreen) { won = true; mult = 17; }
    else if (pick === 'red' && isRed) { won = true; mult = 2; }
    else if (pick === 'black' && isBlack) { won = true; mult = 2; }
    else if (pick === 'low' && !isGreen && spin >= 1 && spin <= 18) { won = true; mult = 2; }
    else if (pick === 'high' && !isGreen && spin >= 19 && spin <= 36) { won = true; mult = 2; }
    else if (pick === 'odd' && !isGreen && spin % 2 === 1) { won = true; mult = 2; }
    else if (pick === 'even' && !isGreen && spin % 2 === 0) { won = true; mult = 2; }
    const payout = won ? Math.floor(bet * mult) : 0;
    if (won) {
      p.gold += payout - bet;
      p.gamblesWon = (p.gamblesWon || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) + (payout - bet);
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
    }
    this.saveData();
    if (won) this.emitAchievements(username);
    this.logAction(username, won ? 'gamble_win' : 'gamble_lose', 'Roulette ' + (won ? '+' + (payout-bet) : '-' + bet) + 'g (' + pick + ', landed:' + num + ')');
    return { username, spin: num, color: isGreen ? 'green' : isRed ? 'red' : 'black', choice: pick, won, mult, bet, payout, gold: p.gold, game: 'roulette' };
  }

  handleGift(from, to, amount) {
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (from === to) return { error: 'self_gift' };
    if (!this.players[to]) return { error: 'not_found' };
    const pFrom = this.player(from);
    if (bet > pFrom.gold) return { error: 'broke', gold: pFrom.gold };
    const pTo = this.player(to);
    pFrom.gold -= bet;
    pTo.gold += bet;
    this.logAction(from, 'gift_sent', bet + 'g to ' + to);
    this.logAction(to, 'gift_recv', bet + 'g from ' + from);
    this.saveData();
    return { from, to, amount: bet, fromGold: pFrom.gold, toGold: pTo.gold };
  }

  handleShop(username) {
    const p = this.player(username);
    return { username, items: Object.entries(this.shopItems).map(([key, item]) => ({ key, name: item.name, cost: item.cost, desc: item.desc })), gold: p.gold };
  }

  handleBuy(username, itemKey) {
    const key = (itemKey || '').toLowerCase();
    const item = this.shopItems[key];
    if (!item) return { error: 'not_found', available: Object.keys(this.shopItems) };
    const p = this.player(username);
    if (p.gold < item.cost) return { error: 'broke', gold: p.gold, cost: item.cost };
    if (!this.playerBuffs[username]) this.playerBuffs[username] = {};
    if (this.playerBuffs[username][item.type]) return { error: 'already_active' };
    p.gold -= item.cost;
    this.playerBuffs[username][item.type] = item.value || true;
    this.saveData();
    return { username, item: item.name, cost: item.cost, gold: p.gold, type: item.type };
  }

  // ── Admin ─────────────────────────────────
  handleAdmin(username, cmd) {
    if (username !== this.admin) return { error: 'not_admin' };
    switch (cmd) {
      case '!kill': {
        if (!this.boss) return { error: 'no_boss' };
        if (Object.keys(this.damageMap).length === 0) this.damageMap[this.admin] = 9999;
        this.boss.hp = 0;
        this.emit('hit', { username: '💀 ADMIN', damage: 9999, isCrit: true, bossHP: 0, bossMaxHP: this.boss.maxHP, bossName: this.boss.name });
        this.bossDeath();
        return { success: true, action: 'kill' };
      }
      case '!spawn1': {
        if (this.breakTimer) clearTimeout(this.breakTimer);
        this.boss = null; this.state = 'idle'; this.spawnBoss(1);
        return { success: true, action: 'spawn1' };
      }
      case '!spawn2': {
        if (this.breakTimer) clearTimeout(this.breakTimer);
        this.boss = null; this.state = 'idle'; this.spawnBoss(2);
        return { success: true, action: 'spawn2' };
      }
      case '!wheel': {
        this.state = 'wheel_ready'; this.boss = null;
        this.emit('wheel_ready', { rewards: this.wheelRewards, mvp: this.admin });
        return { success: true, action: 'wheel' };
      }
      case '!sethp': return 'needs_value';
      case '!skip': {
        if (this.breakTimer) { clearTimeout(this.breakTimer); this.breakTimer = null; }
        if (this.state === 'break') this.spawnBoss(2);
        return { success: true, action: 'skip' };
      }
      case '!reset': { this.resetForNewStream(); return { success: true, action: 'reset' }; }
      case '!fullreset': { this.fullReset(); return { success: true, action: 'fullreset' }; }
      case '!bossattack': return this.handleBossAttack(username);
      default: return { error: 'unknown' };
    }
  }

  handleSetHP(username, value) {
    if (username !== this.admin) return { error: 'not_admin' };
    if (!this.boss) return { error: 'no_boss' };
    const hp = parseInt(value);
    if (isNaN(hp) || hp < 1) return { error: 'invalid_hp' };
    this.boss.hp = hp;
    this.boss.maxHP = Math.max(this.boss.maxHP, hp);
    this.emit('boss_spawn', { name: this.boss.name, hp: this.boss.hp, maxHP: this.boss.maxHP, number: this.boss.number });
    return { success: true };
  }

  getFullState() {
    return { state: this.state, boss: this.boss, bossNumber: this.bossNumber, leaderboard: this.handleLeaderboard(), wheelRewards: this.wheelRewards, rpgEnabled: this.rpgEnabled, gamblingEnabled: this.gamblingEnabled };
  }

  spinWheel() {
    if (this.state !== 'wheel_ready') return null;
    const index = Math.floor(Math.random() * this.wheelRewards.length);
    const reward = this.wheelRewards[index];
    if (reward === 'Re-spin!') { this.emit('wheel_result', { reward, index }); return { reward, index }; }
    if (reward === 'Double / Re-spin') {
      this.prizeMultiplier *= 2;
      this.emit('wheel_result', { reward, index, newMultiplier: this.prizeMultiplier });
      return { reward, index };
    }
    // Distribute gold for gold-based wheel prizes
    const m = this.prizeMultiplier;
    const sorted = Object.entries(this.damageMap).sort((a, b) => b[1] - a[1]);
    const all = sorted.map(([u]) => u);
    const goldWinners = [];

    if (reward.includes('Gold Rain')) {
      const totalGold = 10000 * m;
      const perPlayer = Math.floor(totalGold / 2);
      // Pick 2 random hitters
      const shuffled = all.sort(() => Math.random() - 0.5);
      const winners2 = shuffled.slice(0, Math.min(2, shuffled.length));
      for (const u of winners2) {
        this.player(u).gold += perPlayer;
        goldWinners.push({ username: u, gold: perPlayer });
      }
    } else if (reward.includes('Jackpot')) {
      const totalGold = 5000 * m;
      const winner = all.length > 0 ? pick(all) : null;
      if (winner) {
        this.player(winner).gold += totalGold;
        goldWinners.push({ username: winner, gold: totalGold });
      }
    }
    // Random Viewer Pick — streamer handles manually, no auto gold

    this.state = 'idle';
    this.emit('wheel_result', { reward, index, prizeMultiplier: this.prizeMultiplier, goldWinners });
    this.saveData();
    this.prizeMultiplier = 1;
    return { reward, index, goldWinners };
  }

  resetForNewStream() {
    if (this.breakTimer) clearTimeout(this.breakTimer);
    this.boss = null; this.bossNumber = 0; this.state = 'idle'; this.damageMap = {};
    this.recentAttackers = {}; this.doubleXPUntil = 0; this.doubleDmgUntil = 0;
    this.prizeMultiplier = 1; this.comboCount = 0; this.lastAttacker = null;
    this.spawnBoss(1);
  }

  fullReset() {
    // Wipe ALL player data, market, payouts — clean slate
    this.players = {};
    this.market = [];
    this.marketIdCounter = 1;
    this.payoutQueue = [];
    this.payoutIdCounter = 1;
    this.activeDuels = {};
    this.duelIdCounter = 0;
    this.duelCooldowns = {};
    // Clear RPG timers before reset reinitializes them
    if (this.rpgTickTimer) clearInterval(this.rpgTickTimer);
    if (this.rpgBossTickTimer) clearInterval(this.rpgBossTickTimer);
    if (this.rpgMobAITimer) clearInterval(this.rpgMobAITimer);
    this.resetForNewStream();
    this.saveData(true);
    console.log('🔥 FULL RESET — all player data wiped!');
  }

  applyRewardEffect(effect) {
    if (effect === 'double_buff') {
      const dur = 300000;
      this.doubleXPUntil = Date.now() + dur;
      this.doubleDmgUntil = Date.now() + dur;
      this.emit('buff_active', { type: 'double', duration: dur });
    }
  }

  // ── Admin API ─────────────────────────────
  getPlayers() { return { ...this.players }; }
  setPlayer(username, data) {
    const p = this.player(username);
    if (data.level !== undefined) p.level = Math.max(1, data.level);
    if (data.xp !== undefined) p.xp = Math.max(0, data.xp);
    if (data.gold !== undefined) p.gold = Math.max(0, data.gold);
    if (data.totalDamage !== undefined) p.totalDamage = Math.max(0, data.totalDamage);
    if (data.trust !== undefined) { if (!p.rpg) p.rpg = {}; p.rpg.trust = Math.max(0, Math.min(200, data.trust)); }
    this.saveData();
    return { username, player: p };
  }
  getConfig() { return { ...CONFIG }; }
  setConfig(updates) {
    for (const [key, val] of Object.entries(updates)) {
      if (CONFIG.hasOwnProperty(key) && typeof val === 'number' && isFinite(val)) CONFIG[key] = val;
    }
    return { ...CONFIG };
  }
  getAdminState() {
    return {
      state: this.state, boss: this.boss, bossNumber: this.bossNumber,
      prizeMultiplier: this.prizeMultiplier, activePlayers: this.activeCount(),
      leaderboard: this.handleLeaderboard(), marketListings: this.market.length,
    };
  }
  getLootTables() { return BOSS_LOOT; }
  getCosmetics() { return COSMETICS; }
  getAchievementDefs() { return ACHIEVEMENTS; }

  // ── Admin: Market & Trades ──────────────
  adminGetMarket() {
    return this.market.map(l => ({
      id: l.id, seller: l.seller, type: l.type,
      name: l.itemData.name, icon: l.itemData.icon || '', rarity: l.itemData.rarity || 'common',
      price: l.price, listFee: l.listFee, listedAt: l.listedAt,
    }));
  }
  adminGetTradeLog() { return this.tradeLog.slice(-200).reverse(); }
  getTradeLog() { return this.tradeLog.slice(-100).reverse(); }
  adminGetPlayerFull(username) {
    if (!this.players[username]) return null;
    const p = this.players[username];
    return {
      username,
      level: p.level, xp: p.xp, gold: p.gold, totalDamage: p.totalDamage,
      prestige: p.prestige, prestigeBonus: p.prestigeBonus,
      mvpCount: p.mvpCount, bossKills: p.bossKills, gamblesWon: p.gamblesWon,
      tradeCount: p.tradeCount || 0, dodgeCount: p.dodgeCount,
      duelsWon: p.duelsWon, duelsLost: p.duelsLost, arenaRating: p.arenaRating,
      inventory: p.inventory, equipped: p.equipped,
      wearables: p.wearables, activeWearables: p.activeWearables,
      cosmetics: p.cosmetics, activeCosmetics: p.activeCosmetics,
      achievements: p.achievements,
      miningLevel: p.miningLevel || 0, miningXp: p.miningXp || 0,
      trust: (p.rpg && p.rpg.trust) || 0,
    };
  }
  adminRemoveItem(username, uid) {
    const p = this.players[username];
    if (!p) return { error: 'player_not_found' };
    // check equipped slots
    for (const [slot, item] of Object.entries(p.equipped)) {
      if (item && item.uid === uid) { p.equipped[slot] = null; this.saveData(); return { success: true, removed: item.name, from: 'equipped:' + slot }; }
    }
    const idx = p.inventory.findIndex(i => i.uid === uid);
    if (idx === -1) return { error: 'item_not_found' };
    const removed = p.inventory.splice(idx, 1)[0];
    this.saveData();
    return { success: true, removed: removed.name };
  }
  adminAddItem(username, itemId, qty) {
    const p = this.player(username);
    const added = this.addItemToInventory(p, itemId, qty || 1);
    if (!added) return { error: 'invalid_item' };
    this.saveData();
    return { success: true, added: added.name, qty: qty || 1 };
  }
  adminAddWearable(username, key) {
    const p = this.player(username);
    if (!WEARABLES[key]) return { error: 'invalid_wearable' };
    if (p.wearables.includes(key)) return { error: 'already_owned' };
    p.wearables.push(key);
    this.saveData();
    return { success: true, added: WEARABLES[key].name };
  }
  adminRemoveWearable(username, key) {
    const p = this.players[username];
    if (!p) return { error: 'player_not_found' };
    const idx = p.wearables.indexOf(key);
    if (idx === -1) return { error: 'not_owned' };
    p.wearables.splice(idx, 1);
    // unequip if active
    for (const [slot, val] of Object.entries(p.activeWearables)) {
      if (val === key) p.activeWearables[slot] = null;
    }
    this.saveData();
    return { success: true, removed: WEARABLES[key]?.name || key };
  }
  adminAddCosmetic(username, cosmeticId) {
    const p = this.player(username);
    if (!COSMETICS[cosmeticId]) return { error: 'invalid_cosmetic' };
    if (p.cosmetics.includes(cosmeticId)) return { error: 'already_owned' };
    p.cosmetics.push(cosmeticId);
    this.saveData();
    return { success: true, added: COSMETICS[cosmeticId].name };
  }
  adminRemoveCosmetic(username, cosmeticId) {
    const p = this.players[username];
    if (!p) return { error: 'player_not_found' };
    const idx = p.cosmetics.indexOf(cosmeticId);
    if (idx === -1) return { error: 'not_owned' };
    p.cosmetics.splice(idx, 1);
    for (const [slot, val] of Object.entries(p.activeCosmetics)) {
      if (val === cosmeticId) p.activeCosmetics[slot] = null;
    }
    this.saveData();
    return { success: true, removed: COSMETICS[cosmeticId]?.name || cosmeticId };
  }
  adminCancelListing(listingId) {
    const lid = parseInt(listingId);
    const idx = this.market.findIndex(l => l.id === lid);
    if (idx === -1) return { error: 'not_found' };
    const listing = this.market.splice(idx, 1)[0];
    const p = this.player(listing.seller);
    if (listing.type === 'equipment') p.inventory.push(listing.itemData);
    else if (listing.type === 'material') this.addItemToInventory(p, listing.itemData.id, listing.itemData.qty || 1);
    else if (listing.type === 'cosmetic') p.cosmetics.push(listing.itemData.key);
    else if (listing.type === 'wearable') { if (!p.wearables.includes(listing.itemData.key)) p.wearables.push(listing.itemData.key); }
    this.saveData();
    return { success: true, cancelled: listing.itemData.name, seller: listing.seller };
  }
  adminGetPlayerLog(username) {
    const p = this.players[username];
    if (!p) return [];
    return (p.activityLog || []).slice(-150).reverse();
  }
  softWipe() {
    for (const [name, p] of Object.entries(this.players)) {
      p.xp = 0; p.gold = 0; p.level = 1; p.totalDamage = 0;
      p.streak = 0; p.bestStreak = 0; p.mvpCount = 0; p.gamblesWon = 0;
      p.bossKills = 0; p.dodgeCount = 0; p.tradeCount = 0;
      p.prestigeBonus = 0; p.prestige = 0;
      p.duelsWon = 0; p.duelsLost = 0; p.duelWinStreak = 0; p.bestDuelStreak = 0; p.arenaRating = 1000;
      p.pvpTokens = 0; p.arenaKills = 0; p.arenaDeaths = 0;
      p.vaultGold = 0; p.lastVgConvert = 0;
      p.inventory = []; p.equipped = {};
      p.wearables = []; p.activeWearables = { hat: null, cape: null, wrist: null, face: null };
      p.cosmetics = []; p.activeCosmetics = { border: null, title: null, hitEffect: null, badge: null, killEffect: null };
      p.achievements = [];
      p.activityLog = [{ t: Date.now(), a: 'wipe', d: 'Admin wiped all progress' }];
      p.rpg = { miningLevel: 1, miningXP: 0, totalMined: 0, mobKills: 0, pickaxeTier: 1, trust: 0, buffDef: null, buffAtk: null, goblinChestOpened: false, miningGear: { helmet: null, gloves: null, boots: null }, house: null, stats: {} };
      p.ghostDefeated = false;
      p.lastDaily = 0;
      p.appearance = this.randomAppearance();
    }
    this.market = []; this.marketIdCounter = 1;
    this.tradeLog = [];
    // Reset all RPG world state (respawn mobs, bosses, nodes)
    this.rpgSpawnAll();
    // Cancel any pending trades
    this.pendingTrades = {};
    // Broadcast wipe to all RPG clients so they clear quest progress
    this.rpgBroadcastAll({ type: 'rpg_wipe', data: {} });
    // Kick all RPG players back to hub with full HP
    for (const [u, rp] of Object.entries(this.rpgPlayers)) {
      const pp = this.player(u);
      const maxHP = 50 + pp.level * 5;
      rp.zone = 'hub'; rp.hp = maxHP; rp.maxHP = maxHP; rp.x = 1200; rp.y = 700; rp.sitting = null;
    }
    this.saveData();
    console.log('🧹 SOFT WIPE — all player progress reset (accounts kept)');
    return { success: true, playersWiped: Object.keys(this.players).length };
  }

  // ── Player Portal Auth ────────────────────
  generateLinkCode(username) {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 char hex like A1B2C3
    this.pendingLinkCodes[username] = { code, created: Date.now() };
    return code;
  }

  handleLink(username, code) {
    const pending = this.pendingLinkCodes[username];
    // If no code provided but there's a pending link from someone, that's the old flow — block it
    if (!code) return { error: 'missing_code', message: 'Usage: !link <CODE> — get your code at the player portal' };
    if (!pending) return { error: 'no_pending', message: 'No pending link request. Go to the player portal first!' };
    // Codes expire after 5 minutes
    if (Date.now() - pending.created > 300000) { delete this.pendingLinkCodes[username]; return { error: 'expired', message: 'Code expired. Click Link Account again on the portal.' }; }
    if (pending.code !== code.toUpperCase()) return { error: 'wrong_code', message: 'Wrong code! Check the portal and try again.' };
    // Code matches — generate token
    delete this.pendingLinkCodes[username];
    const token = crypto.randomBytes(16).toString('hex');
    this.linkTokens[username] = { token, created: Date.now() };
    this.saveData();
    return { success: true, username, token };
  }

  validateToken(username, token) {
    const entry = this.linkTokens[username];
    if (!entry) return false;
    // Tokens expire after 7 days
    if (Date.now() - entry.created > 7 * 24 * 60 * 60 * 1000) { delete this.linkTokens[username]; return false; }
    if (entry.token.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(entry.token), Buffer.from(token));
  }

  registerAccount(username, password) {
    username = (username || '').toLowerCase().trim();
    if (!username || username.length < 3 || username.length > 20) return { error: 'Username must be 3-20 characters.' };
    if (!/^[a-z0-9_]+$/.test(username)) return { error: 'Username: letters, numbers, underscores only.' };
    if (!password || password.length < 4) return { error: 'Password must be at least 4 characters.' };
    if (this.authAccounts[username]) return { error: 'Username already taken.' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    this.authAccounts[username] = { hash, salt };
    // Create player data
    this.player(username);
    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    this.linkTokens[username] = { token, created: Date.now() };
    this.saveData();
    return { success: true, username, token };
  }

  loginAccount(username, password) {
    username = (username || '').toLowerCase().trim();
    if (!username || !password) return { error: 'Username and password required.' };
    const acct = this.authAccounts[username];
    if (!acct) return { error: 'Invalid username or password.' };
    const hash = crypto.scryptSync(password, acct.salt, 64).toString('hex');
    if (hash.length !== acct.hash.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(acct.hash))) {
      return { error: 'Invalid username or password.' };
    }
    const token = crypto.randomBytes(32).toString('hex');
    this.linkTokens[username] = { token, created: Date.now() };
    this.saveData();
    return { success: true, username, token };
  }

  getPlayerProfile(username) {
    if (!this.players[username]) return null;
    const p = this.player(username);
    return {
      username,
      level: p.level,
      xp: p.xp,
      xpNeeded: p.level * CONFIG.xpPerLevel,
      gold: p.gold,
      vaultGold: p.vaultGold || 0,
      totalDamage: p.totalDamage,
      minDmg: this.minDmg(p),
      maxDmg: this.maxDmg(p),
      critChance: this.critChance(p),
      critMultiplier: CONFIG.critMultiplier + this.equipStat(p, 'critMult'),
      cashValue: ((p.vaultGold || 0) / CONFIG.goldPerDollar).toFixed(2),
      lastVgConvert: p.lastVgConvert || 0,
      streak: p.streak || 0,
      bestStreak: p.bestStreak || 0,
      mvpCount: p.mvpCount || 0,
      gamblesWon: p.gamblesWon || 0,
      gamblesLost: p.gamblesLost || 0,
      totalGambleProfit: p.totalGambleProfit || 0,
      bossKills: p.bossKills || 0,
      duelsWon: p.duelsWon || 0,
      duelsLost: p.duelsLost || 0,
      duelWinStreak: p.duelWinStreak || 0,
      bestDuelStreak: p.bestDuelStreak || 0,
      arenaRating: p.arenaRating || 1000,
      prestige: p.prestige || 0,
      prestigeBonus: p.prestigeBonus || 0,
      dodgeCount: p.dodgeCount || 0,
      tradeCount: p.tradeCount || 0,
      inventory: p.inventory || [],
      equipped: p.equipped || {},
      cosmetics: p.cosmetics || [],
      activeCosmetics: p.activeCosmetics || {},
      achievements: p.achievements || [],
      wearables: p.wearables || [],
      activeWearables: p.activeWearables || { hat: null, cape: null, wrist: null, face: null },
      appearance: p.appearance || this.randomAppearance(),
      rankBadge: getRankBadge(p.level),
    };
  }

  getBossStatus() {
    if (!this.boss) return { alive: false, state: this.state };
    return {
      alive: true,
      name: this.boss.name,
      hp: this.boss.hp,
      maxHP: this.boss.maxHP,
      number: this.boss.number,
      tier: this.boss.tier,
      bossAttackActive: this.bossAttackActive,
    };
  }

  getMarketListings() {
    return this.market.map(l => {
      const tpl = ITEMS[l.itemData.id] || {};
      return {
        id: l.id, seller: l.seller, type: l.type,
        name: l.itemData.name || tpl.name || l.itemData.id || 'Unknown Item',
        rarity: l.itemData.rarity || tpl.rarity || 'common',
        price: l.price,
        icon: l.itemData.icon || tpl.icon || '📦',
        qty: l.itemData.qty || null,
        desc: l.itemData.desc || tpl.desc || '',
      };
    });
  }

  // ── Item Value Lookup (display only — no NPC selling) ──
  getItemValue(itemId) {
    const item = ITEMS[itemId];
    if (!item) return 0;
    return VENDOR_PRICE[item.rarity] || 50;
  }

  // ── Portal Chat ───────────────────────────
  addChatMessage(username, message, source) {
    const msg = { id: Date.now(), username, message: message.slice(0, 300), time: Date.now(), source: source || 'portal' };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > 100) this.chatMessages.shift();
    return msg;
  }
  getChatHistory() { return this.chatMessages.slice(-50); }

  // ── Payout Queue ──────────────────────────
  handleRedeemRequest(username, method, address, goldAmount) {
    const validMethods = ['solana', 'discord'];
    if (!validMethods.includes(method)) return { error: 'invalid_method', message: 'Nah fam, only Solana or Discord. We ain\'t PayPal over here 😤' };
    const p = this.player(username);
    const amt = parseInt(goldAmount);
    const minRedeem = 1000;           // $1 minimum (1000 VG)
    const maxRedeemPerDay = 15000;    // $15/day max (15000 VG)
    const WITHDRAW_COOLDOWN = 3 * 60 * 60 * 1000;  // 3hr between any withdrawal
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (isNaN(amt) || amt < minRedeem) return { error: 'min_redeem', minimum: minRedeem, message: `Minimum withdrawal is ${minRedeem.toLocaleString()} Vault Gold ($${(minRedeem/CONFIG.goldPerDollar).toFixed(0)})` };
    if (amt > maxRedeemPerDay) return { error: 'max_redeem', message: `Max withdrawal is ${maxRedeemPerDay.toLocaleString()} VG ($${(maxRedeemPerDay/CONFIG.goldPerDollar).toFixed(0)}) per day 🚫`, maximum: maxRedeemPerDay };
    const vg = p.vaultGold || 0;
    if (vg < amt) return { error: 'broke', vaultGold: vg, message: `Not enough Vault Gold! You have ${vg.toLocaleString()} VG. Convert gold → VG first! 💎` };
    if (this.payoutQueue.find(r => r.username === username && r.status === 'pending')) return { error: 'already_pending', message: 'Chill, you already got one cooking 🍳' };
    // 3hr cooldown between any withdrawal
    const lastWithdraw = this.payoutQueue
      .filter(r => r.username === username && (r.status === 'approved' || r.status === 'pending'))
      .reduce((latest, r) => Math.max(latest, r.date), 0);
    if (lastWithdraw && Date.now() - lastWithdraw < WITHDRAW_COOLDOWN) {
      const remaining = WITHDRAW_COOLDOWN - (Date.now() - lastWithdraw);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.ceil((remaining % 3600000) / 60000);
      return { error: 'cooldown', message: `Withdraw cooldown: ${hrs}h ${mins}m remaining ⏰`, remaining };
    }
    // Check 24h rolling window: total approved + pending in last 24h
    const dayAgo = Date.now() - DAY_MS;
    const recentTotal = this.payoutQueue
      .filter(r => r.username === username && r.date > dayAgo && (r.status === 'approved' || r.status === 'pending'))
      .reduce((sum, r) => sum + r.goldAmount, 0);
    if (recentTotal + amt > maxRedeemPerDay) {
      const remaining = Math.max(0, maxRedeemPerDay - recentTotal);
      return { error: 'daily_limit', message: `Daily limit hit ($15/day)! ${remaining > 0 ? remaining.toLocaleString() + ' VG remaining today' : 'Try again in 24hrs'} ⏰`, remaining };
    }
    const dollarValue = parseFloat((amt / CONFIG.goldPerDollar).toFixed(2));
    p.vaultGold -= amt;
    const request = {
      id: this.payoutIdCounter++, username, method, address,
      goldAmount: amt, dollarValue, status: 'pending', date: Date.now(),
    };
    this.payoutQueue.push(request);
    this.logAction(username, 'redeem', amt + ' VG ($' + dollarValue + ') via ' + method);
    this.saveData();
    return { success: true, request };
  }

  getPayoutQueue() { return this.payoutQueue; }

  processPayoutRequest(requestId, action) {
    const idx = this.payoutQueue.findIndex(r => r.id === requestId);
    if (idx === -1) return { error: 'not_found' };
    const req = this.payoutQueue[idx];
    if (req.status !== 'pending') return { error: 'already_processed' };
    if (action === 'approve') {
      req.status = 'approved';
      req.processedAt = Date.now();
    } else if (action === 'deny') {
      req.status = 'denied';
      req.processedAt = Date.now();
      const p = this.player(req.username);
      p.vaultGold = (p.vaultGold || 0) + req.goldAmount;
    }
    this.saveData();
    return { success: true, request: req };
  }

  setDiscordWebhook(url) { this.discordWebhook = url; this.saveData(); }
  getDiscordWebhook() { return this.discordWebhook; }

  // ═══════════════════════════════════════════
  // PvP Arena System
  // ═══════════════════════════════════════════
  ARENA_MAPS = [
    { id: 'colosseum', name: '🏛️ The Colosseum', desc: 'Classic arena, no modifiers', bonus: null },
    { id: 'volcano', name: '🌋 Volcanic Pit', desc: 'Fire damage — crits deal +50%', bonus: 'crit_boost' },
    { id: 'ice_cavern', name: '❄️ Ice Cavern', desc: 'Frozen ground — dodge chance +20%', bonus: 'dodge_boost' },
    { id: 'shadow_realm', name: '🌑 Shadow Realm', desc: 'Darkness — all damage +25%', bonus: 'dmg_boost' },
    { id: 'sky_platform', name: '⛅ Sky Platform', desc: 'High ground — lower level gets +30% dmg', bonus: 'underdog' },
    { id: 'dragons_lair', name: '🐉 Dragon\'s Lair', desc: 'Dragon breathes fire — random bonus hits', bonus: 'dragon' },
  ];

  // ═══ Portal Duel System (player.html REST API — challenge/accept/decline with gold bets) ═══
  // NOTE: Separate from rpgDuel* queue-based system used by rpg.html WebSocket clients.
  // Both share the same player stats (arenaRating, duelsWon, duelsLost, etc.)
  challengeDuel(challenger, defender, betAmount) {
    const chal = this.player(challenger);
    const def = this.player(defender);
    if (challenger === defender) return { error: 'self_duel' };
    if (!this.players[defender]) return { error: 'not_found' };
    const bet = parseInt(betAmount) || 0;
    if (bet < 0) return { error: 'invalid_bet' };
    if (bet > chal.gold) return { error: 'broke', gold: chal.gold };
    if (bet > def.gold) return { error: 'defender_broke', defGold: def.gold };
    // Cooldown check (30s)
    const now = Date.now();
    if (this.duelCooldowns[challenger] && now - this.duelCooldowns[challenger] < 30000) {
      return { error: 'cooldown', remaining: 30000 - (now - this.duelCooldowns[challenger]) };
    }
    // Check for existing pending duel from this challenger
    const existing = Object.values(this.activeDuels).find(d =>
      d.status === 'pending' && (d.challenger === challenger || d.defender === challenger)
    );
    if (existing) return { error: 'already_pending' };

    const arena = this.ARENA_MAPS[Math.floor(Math.random() * this.ARENA_MAPS.length)];
    const id = this.duelIdCounter++;
    this.activeDuels[id] = {
      id, challenger, defender, bet, arena,
      created: now, status: 'pending', expires: now + 60000, // 60s to accept
    };
    return { success: true, duel: this.activeDuels[id] };
  }

  acceptDuel(username, duelId) {
    const duel = this.activeDuels[duelId];
    if (!duel) return { error: 'not_found' };
    if (duel.defender !== username) return { error: 'not_yours' };
    if (duel.status !== 'pending') return { error: 'not_pending' };
    if (Date.now() > duel.expires) { delete this.activeDuels[duelId]; return { error: 'expired' }; }
    // Verify gold
    const chal = this.player(duel.challenger);
    const def = this.player(duel.defender);
    if (duel.bet > chal.gold || duel.bet > def.gold) { delete this.activeDuels[duelId]; return { error: 'insufficient_gold' }; }
    duel.status = 'fighting';
    return this.executeDuel(duelId);
  }

  declineDuel(username, duelId) {
    const duel = this.activeDuels[duelId];
    if (!duel) return { error: 'not_found' };
    if (duel.defender !== username && duel.challenger !== username) return { error: 'not_yours' };
    if (duel.status !== 'pending') return { error: 'not_pending' };
    delete this.activeDuels[duelId];
    return { success: true, declined: true, challenger: duel.challenger, defender: duel.defender };
  }

  executeDuel(duelId) {
    const duel = this.activeDuels[duelId];
    const p1 = this.player(duel.challenger);
    const p2 = this.player(duel.defender);
    const arena = duel.arena;

    // Simulate multi-round fight — equipment HP bonus applies here too
    let hp1 = 100 + (p1.level * 5) + ((p1.prestige || 0) * 10) + this.equipStat(p1, 'maxHP');
    let hp2 = 100 + (p2.level * 5) + ((p2.prestige || 0) * 10) + this.equipStat(p2, 'maxHP');
    const maxHp1 = hp1, maxHp2 = hp2;
    const rounds = [];
    let round = 0;

    while (hp1 > 0 && hp2 > 0 && round < 20) {
      round++;
      // P1 attacks P2
      const atk1 = this.duelAttack(p1, p2, duel.challenger, duel.defender, arena);
      hp2 -= atk1.damage;
      rounds.push({ round, attacker: duel.challenger, ...atk1, defenderHP: Math.max(0, hp2), defenderMaxHP: maxHp2 });
      if (hp2 <= 0) break;
      // P2 attacks P1
      const atk2 = this.duelAttack(p2, p1, duel.defender, duel.challenger, arena);
      hp1 -= atk2.damage;
      rounds.push({ round, attacker: duel.defender, ...atk2, defenderHP: Math.max(0, hp1), defenderMaxHP: maxHp1 });
      if (hp1 <= 0) break;
    }

    const winner = hp1 > 0 ? duel.challenger : hp2 > 0 ? duel.defender : (Math.random() < 0.5 ? duel.challenger : duel.defender);
    const loser = winner === duel.challenger ? duel.defender : duel.challenger;

    // Transfer gold (guard against negative)
    if (duel.bet > 0) {
      this.player(winner).gold += duel.bet;
      this.player(loser).gold = Math.max(0, this.player(loser).gold - duel.bet);
    }
    this.logAction(winner, 'duel_win', 'Beat ' + loser + (duel.bet > 0 ? ' +' + duel.bet + 'g' : ''));
    this.logAction(loser, 'duel_lose', 'Lost to ' + winner + (duel.bet > 0 ? ' -' + duel.bet + 'g' : ''));

    // Update stats
    const w = this.player(winner);
    const l = this.player(loser);
    w.duelsWon = (w.duelsWon || 0) + 1;
    w.duelWinStreak = (w.duelWinStreak || 0) + 1;
    if (w.duelWinStreak > (w.bestDuelStreak || 0)) w.bestDuelStreak = w.duelWinStreak;
    l.duelsLost = (l.duelsLost || 0) + 1;
    l.duelWinStreak = 0;

    // Arena rating (Elo-ish)
    const ratingChange = Math.max(5, Math.floor(20 - (w.arenaRating - l.arenaRating) / 50));
    w.arenaRating = (w.arenaRating || 1000) + ratingChange;
    l.arenaRating = Math.max(0, (l.arenaRating || 1000) - ratingChange);

    // XP reward
    this.addXP(w, 15);
    this.addXP(l, 5);

    // Cooldown
    this.duelCooldowns[duel.challenger] = Date.now();
    this.duelCooldowns[duel.defender] = Date.now();

    duel.status = 'complete';
    duel.winner = winner;
    duel.loser = loser;
    duel.rounds = rounds;
    duel.ratingChange = ratingChange;

    this.saveData();
    this.emitAchievements(winner);
    this.emitAchievements(loser);

    const result = {
      ...duel,
      winnerHP: winner === duel.challenger ? Math.max(0, hp1) : Math.max(0, hp2),
      challengerData: { appearance: p1.appearance, equipped: p1.equipped || {}, level: p1.level, prestige: p1.prestige || 0, rankBadge: getRankBadge(p1.level).badge },
      defenderData: { appearance: p2.appearance, equipped: p2.equipped || {}, level: p2.level, prestige: p2.prestige || 0, rankBadge: getRankBadge(p2.level).badge },
    };
    // Cleanup (keep in memory briefly for UI)
    setTimeout(() => { delete this.activeDuels[duelId]; }, 60000);
    return { success: true, result };
  }

  duelAttack(attacker, defender, attackerName, defenderName, arena) {
    let lo = this.minDmg(attacker), hi = this.maxDmg(attacker);
    // Arena bonuses
    if (arena.bonus === 'dmg_boost') { lo = Math.floor(lo * 1.25); hi = Math.floor(hi * 1.25); }
    if (arena.bonus === 'underdog' && attacker.level < defender.level) { lo = Math.floor(lo * 1.3); hi = Math.floor(hi * 1.3); }
    let damage = rand(lo, hi);
    let isCrit = Math.random() < this.critChance(attacker) + (arena.bonus === 'crit_boost' ? 0.15 : 0);
    if (isCrit) damage = Math.floor(damage * this.critMultiplier(attacker));
    let dodged = false;
    const dodgeCh = this.dodgeChance(defender) + (arena.bonus === 'dodge_boost' ? 0.2 : 0);
    if (Math.random() < dodgeCh) { dodged = true; damage = 0; }
    // Dragon bonus: random extra hit
    let dragonHit = 0;
    if (arena.bonus === 'dragon' && Math.random() < 0.2) {
      dragonHit = rand(5, 25);
      damage += dragonHit;
    }
    return { damage, isCrit, dodged, dragonHit };
  }

  getPendingDuels(username) {
    const now = Date.now();
    const pending = [];
    for (const [id, d] of Object.entries(this.activeDuels)) {
      if (d.status !== 'pending') continue;
      if (now > d.expires) { delete this.activeDuels[id]; continue; }
      if (d.challenger === username || d.defender === username) pending.push(d);
    }
    return pending;
  }

  getArenaLeaderboard() {
    return Object.entries(this.players)
      .filter(([, p]) => (p.duelsWon || 0) + (p.duelsLost || 0) > 0)
      .map(([u, p]) => ({
        username: u,
        rating: p.arenaRating || 1000,
        wins: p.duelsWon || 0,
        losses: p.duelsLost || 0,
        winStreak: p.duelWinStreak || 0,
        prestige: p.prestige || 0,
        rankBadge: getRankBadge(p.level).badge,
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 20);
  }

  getArenaStats(username) {
    const p = this.player(username);
    return {
      username,
      rating: p.arenaRating || 1000,
      wins: p.duelsWon || 0,
      losses: p.duelsLost || 0,
      winStreak: p.duelWinStreak || 0,
      bestStreak: p.bestDuelStreak || 0,
      prestige: p.prestige || 0,
    };
  }

  // ═══════════════════════════════════════════
  // Prestige System
  // ═══════════════════════════════════════════
  PRESTIGE_LEVELS = [
    { rank: 1, name: 'Certified Grinder',  minLevel: 30, goldReward: 2500,    dmgBonus: 0.05, icon: '⚒️' },
    { rank: 2, name: 'Touch Grass? Never',  minLevel: 35, goldReward: 5000,   dmgBonus: 0.12, icon: '🌿' },
    { rank: 3, name: 'Built Different',     minLevel: 40, goldReward: 10000,   dmgBonus: 0.20, icon: '💪' },
    { rank: 4, name: 'No Life Speedrun',    minLevel: 45, goldReward: 20000,   dmgBonus: 0.30, icon: '💀' },
    { rank: 5, name: 'Actual Legend',        minLevel: 50, goldReward: 40000,   dmgBonus: 0.45, icon: '☀️' },
    { rank: 6, name: 'Mikey X',              minLevel: 60, goldReward: 75000,  dmgBonus: 0.60, icon: '🔥' },
  ];

  canPrestige(username) {
    const p = this.player(username);
    const current = p.prestige || 0;
    if (current >= this.PRESTIGE_LEVELS.length) return { canPrestige: false, maxed: true };
    const next = this.PRESTIGE_LEVELS[current];
    return {
      canPrestige: p.level >= next.minLevel,
      currentPrestige: current,
      nextPrestige: next,
      currentLevel: p.level,
      requiredLevel: next.minLevel,
    };
  }

  doPrestige(username) {
    const p = this.player(username);
    const current = p.prestige || 0;
    if (current >= this.PRESTIGE_LEVELS.length) return { error: 'max_prestige' };
    const next = this.PRESTIGE_LEVELS[current];
    if (p.level < next.minLevel) return { error: 'level_too_low', required: next.minLevel, current: p.level };

    // Reset level and XP
    const oldLevel = p.level;
    p.level = 1;
    p.xp = 0;
    // Grant prestige
    p.prestige = current + 1;
    p.prestigeBonus = next.dmgBonus;
    // Gold reward
    p.gold += next.goldReward;
    this.logAction(username, 'prestige', next.icon + ' ' + next.name + ' (Lv' + oldLevel + '→1) +' + next.goldReward + 'g');

    this.saveData();
    this.emitAchievements(username);

    return {
      success: true,
      username,
      oldLevel,
      newPrestige: p.prestige,
      prestigeName: next.name,
      prestigeIcon: next.icon,
      goldReward: next.goldReward,
      dmgBonus: next.dmgBonus,
      gold: p.gold,
    };
  }

  getPrestigeInfo(username) {
    const p = this.player(username);
    const current = p.prestige || 0;
    const currentInfo = current > 0 ? this.PRESTIGE_LEVELS[current - 1] : null;
    const nextInfo = current < this.PRESTIGE_LEVELS.length ? this.PRESTIGE_LEVELS[current] : null;
    return {
      prestige: current,
      currentRank: currentInfo ? currentInfo.name : 'None',
      currentIcon: currentInfo ? currentInfo.icon : '',
      dmgBonus: p.prestigeBonus || 0,
      nextRank: nextInfo ? nextInfo.name : 'MAX',
      nextDmgBonus: nextInfo ? nextInfo.dmgBonus : null,
      nextGoldReward: nextInfo ? nextInfo.goldReward : null,
      requiredLevel: nextInfo ? nextInfo.minLevel : null,
      currentLevel: p.level,
      canPrestige: nextInfo ? p.level >= nextInfo.minLevel : false,
      allRanks: this.PRESTIGE_LEVELS,
    };
  }

  shutdown() {
    this._flushSave();
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.breakTimer) clearTimeout(this.breakTimer);
    if (this.bossAttackTimer) clearTimeout(this.bossAttackTimer);
    if (this.rpgTickTimer) clearInterval(this.rpgTickTimer);
    if (this.rpgBossTickTimer) clearInterval(this.rpgBossTickTimer);
    if (this.rpgMobAITimer) clearInterval(this.rpgMobAITimer);
  }

  // ═══════════════════════════════════════════
  // RPG — Offline 2D Dungeon / Mining System
  // ═══════════════════════════════════════════
  initRPG() {
    if (!this.rpgWorld) {
      this.rpgWorld = {};
      for (const zoneId of Object.keys(RPG_ZONES)) {
        this.rpgWorld[zoneId] = { nodes: [], lastTick: Date.now(), tileMap: this.rpgGenerateTileMap(zoneId) };
      }
    }
    this.rpgPlayers = {}; // username -> { zone, ws, x, y, hp, maxHP }
    this.rpgDuelQueue = []; // [username, ...]
    this.rpgDuels = {}; // duelId -> duel state
    this.rpgDuelId = 0;
    // ── Party System ──
    this.rpgParties = {};       // partyId -> { leader, members: [username], invites: {username: timestamp} }
    this.rpgPartyId = 0;
    this.rpgPlayerParty = {};   // username -> partyId (quick lookup)
    // ── Party Dungeon Instances ──
    this.rpgDungeonInstances = {};  // instanceId -> { id, partyId, members, boss, mobs, tileMap, startTime, timeLimit, phase }
    this.rpgDungeonInstanceId = 0;
    // ── Community Milestones ──
    this.communityMilestonesCompleted = []; // array of milestone ids
    this.communityMilestoneData = { bossKills: 0 }; // extra counters
    // ── World Events ──
    this.activeWorldEvent = null;  // { id, eventType, config, startedAt, expiresAt, bountyTarget, participants }
    this.nextWorldEventAt = Date.now() + WORLD_EVENT_CONFIG.intervalMin + Math.random() * (WORLD_EVENT_CONFIG.intervalMax - WORLD_EVENT_CONFIG.intervalMin);
    this.worldEventId = 0;
    // ── Duel Challenges (direct player-to-player) ──
    this.rpgDuelChallenges = {}; // challengeId -> { challenger, defender, timestamp }
    this.rpgSpawnAll();
    // Clear any existing RPG timers to prevent duplicates on re-init
    if (this.rpgTickTimer) clearInterval(this.rpgTickTimer);
    if (this.rpgBossTickTimer) clearInterval(this.rpgBossTickTimer);
    if (this.rpgMobAITimer) clearInterval(this.rpgMobAITimer);
    if (this.rpgDungeonTickTimer) clearInterval(this.rpgDungeonTickTimer);
    this.rpgTickTimer = setInterval(() => this.rpgTick(), 3000);
    this.rpgBossTickTimer = setInterval(() => this.rpgBossTick(), 200);
    this.rpgMobAITimer = setInterval(() => this.rpgMobAI(), 200);
    this.rpgDungeonTickTimer = setInterval(() => this.rpgDungeonTick(), 200);
  }

  rpgSpawnAll() {
    for (const [zoneId, zone] of Object.entries(RPG_ZONES)) {
      const w = this.rpgWorld[zoneId];
      // Spawn mine nodes
      if (zone.nodes) {
        w.nodes = [];
        for (let i = 0; i < zone.nodes; i++) {
          w.nodes.push(this.rpgMakeNode(zoneId, i));
        }
      }
      // Spawn mobs — per-player instances (created on zone join)
      if (zone.mobs) {
        w.playerMobs = {};
      }
      // Spawn boss — per-player instances (created on zone join)
      if (zone.boss) {
        w.playerBosses = {};
      }
      // Spawn secondary bosses — per-player instances (created on zone join)
      if (zone.secondaryBosses) {
        if (!w.playerBosses) w.playerBosses = {};
      }
    }
  }

  rpgMakeSecondaryBoss(zoneId, sbCfg) {
    return {
      id: `${zoneId}_sb_${sbCfg.id}`,
      cfgId: sbCfg.id,
      name: sbCfg.name,
      maxHP: sbCfg.maxHP,
      hp: sbCfg.maxHP,
      color: sbCfg.color,
      x: sbCfg.arenaX,
      y: sbCfg.arenaY,
      homeX: sbCfg.arenaX,
      homeY: sbCfg.arenaY,
      arenaRadius: sbCfg.arenaRadius,
      dead: false,
      respawnAt: 0,
      sleeping: sbCfg.sleeping || false,
      wakeRadius: sbCfg.wakeRadius || 120,
      phase: 'idle',
      phaseName: sbCfg.sleeping ? 'Sleeping' : '',
      targetPlayer: null,
      attackCooldowns: {},
      currentAttack: null,
      attackTimer: 0,
      globalCD: 0,
    };
  }

  rpgMakeBoss(zoneId) {
    const zone = RPG_ZONES[zoneId];
    const b = zone.boss;
    return {
      id: `${zoneId}_boss`,
      cfgId: b.cfgId || `${zoneId}_boss`,
      name: b.name,
      maxHP: b.maxHP,
      hp: b.maxHP,
      color: b.color,
      x: b.arenaX,
      y: b.arenaY,
      homeX: b.arenaX,
      homeY: b.arenaY,
      arenaRadius: b.arenaRadius,
      dead: false,
      respawnAt: 0,
      phase: 'idle',
      phaseName: b.sleeping ? 'Sleeping' : '',
      sleeping: b.sleeping || false,
      wakeRadius: b.wakeRadius || 200,
      targetPlayer: null,
      attackCooldowns: {},
      currentAttack: null,
      attackTimer: 0,
      globalCD: 0,
    };
  }

  rpgMakeSapling(zoneId, bossX, bossY, idx) {
    const angle = (Math.PI * 2 / 3) * idx + Math.random() * 0.5;
    const dist = 60 + Math.random() * 40;
    return {
      id: `${zoneId}_sap${Date.now()}_${idx}`,
      name: 'Sapling',
      maxHP: 80,
      hp: 80,
      atk: 8,
      color: '#5a8a2e',
      x: bossX + Math.cos(angle) * dist,
      y: bossY + Math.sin(angle) * dist,
      dead: false,
      respawnAt: 0,
      goldMin: 0, goldMax: 2, xpReward: 5,
      chaseSpeed: 1.8,
    };
  }

  rpgEnsurePlayerBoss(zoneId, username) {
    const w = this.rpgWorld[zoneId];
    if (!w || !w.playerBosses) return;
    if (w.playerBosses[username]) {
      // Respawn any dead secondary bosses whose timer expired (fixes re-entry after death)
      const pb = w.playerBosses[username];
      const now = Date.now();
      if (pb.secondaryBosses) {
        const zone = RPG_ZONES[zoneId];
        for (let i = 0; i < pb.secondaryBosses.length; i++) {
          const sb = pb.secondaryBosses[i];
          if (sb.dead && now >= sb.respawnAt) {
            const sbCfg = zone.secondaryBosses && zone.secondaryBosses.find(c => c.id === sb.cfgId);
            if (sbCfg) Object.assign(sb, this.rpgMakeSecondaryBoss(zoneId, sbCfg));
          }
        }
      }
      return;
    }
    const zone = RPG_ZONES[zoneId];
    const pb = { boss: null, secondaryBosses: null, saplings: [] };
    if (zone.boss) pb.boss = this.rpgMakeBoss(zoneId);
    if (zone.secondaryBosses) pb.secondaryBosses = zone.secondaryBosses.map(sb => this.rpgMakeSecondaryBoss(zoneId, sb));
    w.playerBosses[username] = pb;
  }

  rpgCleanupPlayerBoss(username) {
    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      if (w.playerBosses) delete w.playerBosses[username];
    }
  }

  rpgCleanupPlayerMobs(username) {
    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      if (w.playerMobs) delete w.playerMobs[username];
    }
  }

  rpgEnsurePlayerMobs(zoneId, username) {
    const w = this.rpgWorld[zoneId];
    if (!w || !w.playerMobs) return;
    if (w.playerMobs[username]) return;
    const zone = RPG_ZONES[zoneId];
    if (!zone || !zone.mobs) return;
    const rp = this.rpgPlayers[username];
    const questBias = rp ? rp.questBias : null;
    w.playerMobs[username] = [];
    for (let i = 0; i < zone.mobCount; i++) {
      w.playerMobs[username].push(this.rpgMakeMob(zoneId, i, null, questBias));
    }
  }

  rpgResetBossesOnDeath(username, zone) {
    const w = this.rpgWorld[zone];
    if (w && w.playerBosses && w.playerBosses[username]) {
      delete w.playerBosses[username];
    }
  }

  // Generate a deterministic tile map for a zone. Returns 2D array [y][x] of tile IDs.
  rpgGenerateTileMap(zoneId) {
    const zone = RPG_ZONES[zoneId];
    function sRng(seed) { let s = Math.abs(seed) || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
    function hStr(str) { let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0; return Math.abs(h) || 1; }
    const rng = sRng(hStr(zoneId + '_tiles'));
    const map = [];
    const defTile = zone.type === 'combat' ? (zoneId === 'dungeon' ? TILE.STONE : TILE.GRASS) :
                    zone.type === 'mine' ? TILE.STONE : TILE.FLOOR;
    for (let y = 0; y < MAP_H; y++) { map[y] = []; for (let x = 0; x < MAP_W; x++) map[y][x] = defTile; }

    // Border walls (2 tiles thick)
    for (let x = 0; x < MAP_W; x++) { map[0][x] = TILE.WALL; map[1][x] = TILE.WALL; map[MAP_H - 1][x] = TILE.WALL; map[MAP_H - 2][x] = TILE.WALL; }
    for (let y = 0; y < MAP_H; y++) { map[y][0] = TILE.WALL; map[y][1] = TILE.WALL; map[y][MAP_W - 1] = TILE.WALL; map[y][MAP_W - 2] = TILE.WALL; }

    // Helper to fill a rectangular region with a tile type (shared across all zones)
    const fill = (x1, y1, x2, y2, t) => {
      for (let y = Math.max(2, y1); y <= Math.min(MAP_H - 3, y2); y++)
        for (let x = Math.max(2, x1); x <= Math.min(MAP_W - 3, x2); x++) map[y][x] = t;
    };

    if (zone.type === 'hub') {
      // ═══════════════════════════════════════════════════════════
      // HUB TOWN — Hand-crafted structured starter area
      // ═══════════════════════════════════════════════════════════
      //
      //  60 tiles wide x 35 tiles tall (2400 x 1400 px)
      //
      //  Three vertical sections separated by wall dividers:
      //    LEFT   (cols 3-18):   Mining Quarter  — sand/stone terrain
      //    CENTER (cols 21-39):  Main Town Area
      //    RIGHT  (cols 42-57):  Combat Road     — grass terrain
      //
      //  Center sub-areas (top to bottom):
      //    Portal Court  (rows 3-9)   — future dungeon portals
      //    Spawn Plaza   (rows 13-21) — safe player spawn + fountain
      //    Market Square (rows 25-31) — future shops/vendors
      //
      //  Stone paths form a cross connecting all sections.
      //  Doorways in divider walls allow passage between areas.
      //  Player spawns at tile (30,17) = center of the cross.
      //
      //  To edit: adjust fill() calls below. Each defines a
      //  rectangular region: fill(x1, y1, x2, y2, TILE_TYPE).
      // ═══════════════════════════════════════════════════════════

      // --- Section base fills ---
      fill(3,  3,  18, 31, TILE.SAND);    // Mining Quarter (warm sand terrain)
      fill(21, 3,  39, 31, TILE.FLOOR);   // Central town (dark interior floor)
      fill(42, 3,  57, 31, TILE.GRASS);   // Combat Road (grass, leads to danger)

      // --- Divider walls (separate the three vertical sections) ---
      fill(19, 3,  20, 31, TILE.WALL);    // Left divider
      fill(40, 3,  41, 31, TILE.WALL);    // Right divider

      // --- Doorways in dividers (3-tile-tall stone openings) ---
      fill(19, 16, 20, 18, TILE.STONE);   // Cross-road level (main passage)
      fill(40, 16, 41, 18, TILE.STONE);
      fill(19, 5,  20, 7,  TILE.STONE);   // Portal level (north passage)
      fill(40, 5,  41, 7,  TILE.STONE);
      fill(19, 27, 20, 29, TILE.STONE);   // Market level (south passage)
      fill(40, 27, 41, 29, TILE.STONE);

      // --- Main stone paths (cross shape through entire map) ---
      fill(29, 3,  31, 31, TILE.STONE);   // North-South central avenue
      fill(3,  16, 57, 18, TILE.STONE);   // East-West main boulevard

      // --- Spawn Plaza (safe center area) ---
      fill(24, 13, 36, 21, TILE.STONE);   // Stone plaza floor
      // Fountain — south of spawn tile (30,17) so player doesn't spawn in water
      fill(29, 19, 31, 21, TILE.WATER);   // Wishing well / fountain pool

      // --- Tavern Building (top center, replaces portal court) ---
      fill(24, 3,  36, 12, TILE.STONE);   // Tavern exterior courtyard
      fill(24, 4,  36, 4,  TILE.WALL);    // Tavern north wall
      fill(24, 4,  24, 11, TILE.WALL);    // Tavern west wall
      fill(36, 4,  36, 11, TILE.WALL);    // Tavern east wall
      fill(24, 11, 36, 11, TILE.WALL);    // Tavern south wall
      fill(25, 5,  35, 10, TILE.WOOD);    // Tavern interior wooden plank floor
      fill(29, 11, 31, 11, TILE.STONE);   // Tavern doorway (south wall gap)
      fill(29, 12, 31, 12, TILE.STONE);   // Tavern entrance path
      // Bar counter area (top of interior)
      fill(26, 5,  34, 5,  TILE.STONE);   // Bar counter (walkable, decorative)

      // --- Market Square (bottom center, future shop/vendor area) ---
      fill(22, 25, 38, 31, TILE.STONE);   // Market floor
      fill(24, 27, 25, 28, TILE.FLOOR);   // Market stall 1
      fill(28, 27, 29, 28, TILE.FLOOR);   // Market stall 2
      fill(31, 27, 32, 28, TILE.FLOOR);   // Market stall 3
      fill(35, 27, 36, 28, TILE.FLOOR);   // Market stall 4

      // --- Mining Quarter details (cols 3-18) ---
      // Rock outcrops (impassable wall clusters for terrain variety)
      fill(5,  8,  7,  10, TILE.WALL);    // Boulder cluster NW
      fill(12, 20, 14, 22, TILE.WALL);    // Boulder cluster SE
      fill(8,  14, 9,  15, TILE.WALL);    // Small rock mid
      fill(15, 7,  16, 8,  TILE.WALL);    // Small rock NE
      // Stone deposits (walkable, resource-themed terrain)
      fill(4,  6,  6,  7,  TILE.STONE);   // Ore patch 1
      fill(10, 10, 12, 11, TILE.STONE);   // Ore patch 2
      fill(15, 25, 17, 26, TILE.STONE);   // Ore patch 3
      fill(4,  24, 5,  25, TILE.STONE);   // Ore patch 4
      fill(6,  26, 7,  27, TILE.WATER);   // Underground water seep
      // Sub-path connecting to main boulevard
      fill(10, 10, 18, 11, TILE.STONE);   // Mining quarter cross-path

      // --- Combat Road details (cols 42-57) ---
      // Dense thicket walls (impassable tree/bush clusters)
      fill(45, 7,  47, 9,  TILE.WALL);    // Thicket NW
      fill(50, 14, 52, 15, TILE.WALL);    // Thicket center
      fill(54, 22, 56, 24, TILE.WALL);    // Thicket SE
      fill(44, 25, 46, 27, TILE.WALL);    // Thicket SW
      fill(48, 28, 49, 29, TILE.WALL);    // Small thicket
      // Dirt trails (sand patches in the grass)
      fill(48, 10, 50, 11, TILE.SAND);
      fill(44, 19, 46, 20, TILE.SAND);
      fill(52, 28, 54, 29, TILE.SAND);
      // Sub-path connecting to main boulevard
      fill(42, 10, 50, 11, TILE.STONE);   // Combat road cross-path

      // --- Subtle scatter variation (prevents flat uniform regions) ---
      for (let y = 3; y <= 31; y++) {
        for (let x = 3; x <= 57; x++) {
          if (map[y][x] === TILE.SAND && rng() < 0.10) map[y][x] = TILE.STONE;
          if (map[y][x] === TILE.GRASS && rng() < 0.06) map[y][x] = TILE.SAND;
          if (map[y][x] === TILE.FLOOR && rng() < 0.12) map[y][x] = TILE.STONE;
        }
      }

      // --- Road tiles leading to zone portals ---
      // Single-tile-wide textured paths with occasional SAND edge accents
      const road = (x1, y1, x2, y2) => {
        if (y1 === y2) { // horizontal
          const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
          for (let x = lo; x <= hi; x++) {
            if (y1 >= 2 && y1 < MAP_H - 2 && x >= 2 && x < MAP_W - 2) {
              map[y1][x] = TILE.STONE;
              // Occasional sand accent beside the path for texture
              if (rng() < 0.25) {
                const side = rng() > 0.5 ? 1 : -1;
                const sy = y1 + side;
                if (sy >= 2 && sy < MAP_H - 2 && map[sy][x] !== TILE.WALL && map[sy][x] !== TILE.WATER && map[sy][x] !== TILE.WOOD)
                  map[sy][x] = TILE.SAND;
              }
            }
          }
        } else { // vertical
          const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
          for (let y = lo; y <= hi; y++) {
            if (y >= 2 && y < MAP_H - 2 && x1 >= 2 && x1 < MAP_W - 2) {
              map[y][x1] = TILE.STONE;
              if (rng() < 0.25) {
                const side = rng() > 0.5 ? 1 : -1;
                const sx = x1 + side;
                if (sx >= 2 && sx < MAP_W - 2 && map[y][sx] !== TILE.WALL && map[y][sx] !== TILE.WATER && map[y][sx] !== TILE.WOOD)
                  map[y][sx] = TILE.SAND;
              }
            }
          }
        }
      };
      // Forest portal (tx:50, ty:17) — east from main boulevard
      road(32, 17, 50, 17);
      // Quarry portal (tx:10, ty:17) — west from main boulevard
      road(3, 17, 28, 17);
      // Deep Mine portal (tx:10, ty:10) — from quarry road junction north
      road(10, 10, 10, 16);
      // Gold Vein portal (tx:10, ty:24) — from quarry road junction south
      road(10, 18, 10, 24);
      // Housing gate (tx:30, ty:35) — south from market square
      road(30, 31, 30, 36);
      fill(28, 33, 32, 36, TILE.STONE);   // Housing approach plaza

      // --- Tavern Secret Stairway Entrance (lever-controlled) ---
      fill(36, 5, 36, 6, TILE.WOOD);      // Tavern east wall opening (lever-controlled)
      fill(37, 5, 37, 6, TILE.STONE);     // Small landing/stairway entrance

      // --- Underground Basement (dungeon entrance beneath tavern) ---
      // Entire basement block — walls first, then carve interior
      fill(47, 19, 57, 28, TILE.WALL);    // Stairway wall envelope
      fill(49, 20, 55, 28, TILE.WOOD);    // Stairway area (wood for warm stairs)
      fill(49, 28, 55, 28, TILE.STONE);   // Door threshold (stone)
      fill(52, 20, 52, 20, TILE.WOOD);    // Return stairs marker tile at top

      // --- EXPANDED DUNGEON (massive underground complex) ---
      // Full dungeon wall envelope
      fill(36, 29, 57, 57, TILE.WALL);
      // Entry corridor from stairs (connects to stairway)
      fill(49, 29, 55, 31, TILE.STONE);
      // Grand hall (wide central chamber)
      fill(40, 32, 55, 40, TILE.STONE);
      // Western corridor to treasure room
      fill(38, 35, 40, 37, TILE.STONE);
      // Treasure room (west wing)
      fill(38, 38, 44, 45, TILE.STONE);
      // Eastern corridor to crypt
      fill(52, 38, 54, 40, TILE.STONE);
      // Skeleton crypt (east wing)
      fill(48, 41, 56, 48, TILE.STONE);
      // Southern corridor to boss chamber
      fill(45, 40, 48, 49, TILE.STONE);
      // Boss chamber (large room at bottom)
      fill(40, 49, 54, 55, TILE.STONE);
      // Side alcoves in grand hall
      fill(38, 33, 40, 34, TILE.STONE);
      fill(38, 38, 40, 39, TILE.STONE);
      // Connecting passages
      fill(44, 45, 48, 45, TILE.STONE);   // Crypt to boss corridor
      fill(40, 45, 42, 49, TILE.STONE);   // Treasure to boss corridor
      // Water features in dungeon
      fill(42, 36, 43, 37, TILE.WATER);   // Flooded pit in grand hall
      fill(50, 44, 51, 45, TILE.WATER);   // Crypt water seep
      // Decorative floor variation
      fill(45, 51, 49, 53, TILE.FLOOR);   // Boss room center (dark tile)
    } else if (zoneId === 'quarry') {
      // ═══════════════════════════════════════════════════════════
      // QUARRY — Mining Lodge building (center) + Open Pit around it
      // ═══════════════════════════════════════════════════════════
      //  Center (rows 24-35): Grizzle's Mining Lodge (cozy stone interior)
      //    - Stone walls, warm wood floor, fireplace, bar, furniture
      //    - Doorway at center bottom (cols 28-32, row 34-35)
      //    - When inside, outside dims + stone roof covers building
      //  Surrounding area: Open Quarry Pit (north + south)
      //    - Stone/sand terrain, mining nodes, no mobs
      //    - Cart tracks, scaffolding, water puddles
      //  Player spawns at (30, 37) just outside the lodge door
      // ═══════════════════════════════════════════════════════════

      // Default ground — stone/sand quarry terrain
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) {
          const r = rng();
          map[y][x] = r < 0.03 ? TILE.WALL : r < 0.08 ? TILE.SAND : TILE.STONE;
        }

      // ── MINING LODGE BUILDING (center of map) ──
      // Outer walls
      fill(22, 24, 38, 35, TILE.WALL);
      // Interior floor — warm wood planks
      fill(23, 25, 37, 34, TILE.WOOD);
      // Doorway (center bottom of lodge)
      fill(28, 34, 32, 35, TILE.STONE);
      fill(28, 35, 32, 36, TILE.STONE);
      // Back wall stone strip (bar area)
      fill(23, 25, 37, 25, TILE.STONE);

      // ── Lodge Interior Rooms ──
      // Grizzle's desk area (left)
      fill(24, 26, 26, 26, TILE.STONE);
      // Equipment counter (right)
      fill(35, 26, 37, 26, TILE.STONE);
      // Central stone path inside
      fill(29, 26, 31, 33, TILE.STONE);

      // ── Stone paths outside ──
      // North path to lodge
      fill(29, 3, 31, 23, TILE.STONE);
      // South path from lodge exit
      fill(29, 37, 31, 55, TILE.STONE);
      // East-west mining corridors (north and south of lodge)
      fill(5, 12, 55, 14, TILE.STONE);
      fill(5, 45, 55, 47, TILE.STONE);
      // Branch corridors (split around lodge)
      fill(10, 4, 12, 22, TILE.STONE);
      fill(10, 37, 12, 55, TILE.STONE);
      fill(48, 4, 50, 22, TILE.STONE);
      fill(48, 37, 50, 55, TILE.STONE);

      // ── Water puddles in the pit ──
      for (let i = 0; i < 4; i++) {
        const wx = 6 + Math.floor(rng() * (MAP_W - 14));
        let wy = 3 + Math.floor(rng() * (MAP_H - 8));
        if (wy >= 23 && wy <= 36) wy = wy < 30 ? 8 : 42;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 3; dx++)
            if (wy + dy < MAP_H - 2 && wx + dx < MAP_W - 2) map[wy + dy][wx + dx] = TILE.WATER;
      }

      // Mine entrance area (bottom center — portal to underground mine)
      fill(27, 52, 33, 55, TILE.STONE);
      fill(28, 53, 32, 55, TILE.SAND);

      // Scattered rock pillars in quarry pit (avoiding lodge area)
      const pillarSpots = [[8,8],[15,16],[22,45],[35,45],[42,48],[50,10],[18,6],[40,6],[25,50],[38,55]];
      for (const [px, py] of pillarSpots) {
        if (py < MAP_H - 2 && px < MAP_W - 2) fill(px, py, px + 1, py + 1, TILE.WALL);
      }

    } else if (zoneId === 'underground_mine') {
      // ═══════════════════════════════════════════════════════════
      // UNDERGROUND MINE — Dark twisting mine tunnels with rails
      // ═══════════════════════════════════════════════════════════
      for (let y = 0; y < MAP_H; y++)
        for (let x = 0; x < MAP_W; x++) map[y][x] = TILE.WALL;

      // Central Cavern (spawn)
      fill(22, 22, 38, 38, TILE.STONE);
      for (let y = 23; y <= 37; y++)
        for (let x = 23; x <= 37; x++)
          if (rng() < 0.15) map[y][x] = TILE.SAND;

      // North Tunnel → Crystal Cavern
      fill(28, 6, 32, 22, TILE.STONE);
      fill(20, 3, 40, 10, TILE.STONE);
      fill(26, 5, 28, 7, TILE.WATER);
      fill(33, 5, 35, 7, TILE.WATER);
      map[5][22] = TILE.WALL; map[5][38] = TILE.WALL;
      map[8][22] = TILE.WALL; map[8][38] = TILE.WALL;

      // South Tunnel
      fill(28, 38, 32, 55, TILE.STONE);
      fill(22, 50, 38, 56, TILE.STONE);
      fill(24, 52, 26, 54, TILE.WALL);
      fill(35, 51, 37, 53, TILE.WALL);

      // East Tunnel → Minecart Hub (Burrower boss arena)
      fill(38, 28, 55, 32, TILE.STONE);
      fill(44, 18, 58, 42, TILE.STONE);
      for (let y = 20; y <= 40; y++)
        for (let x = 46; x <= 56; x++)
          if (rng() < 0.08) map[y][x] = TILE.SAND;

      // West Tunnel → Ore-Rich Corridor
      fill(5, 28, 22, 32, TILE.STONE);
      fill(3, 22, 14, 38, TILE.STONE);
      for (let y = 24; y <= 36; y++)
        for (let x = 5; x <= 12; x++)
          if (rng() < 0.2) map[y][x] = TILE.SAND;

      // NE diagonal passage
      fill(36, 16, 38, 22, TILE.STONE);
      fill(38, 14, 48, 18, TILE.STONE);
      fill(44, 8, 52, 16, TILE.STONE);
      fill(47, 11, 49, 13, TILE.WATER);

      // SW diagonal passage
      fill(18, 38, 22, 42, TILE.STONE);
      fill(8, 40, 20, 44, TILE.STONE);
      fill(4, 42, 12, 50, TILE.STONE);
      map[44][6] = TILE.WALL; map[44][7] = TILE.WALL;
      map[47][10] = TILE.WALL; map[47][11] = TILE.WALL;

      // Main rail tracks (wider stone)
      fill(5, 29, 55, 31, TILE.STONE);
      fill(29, 6, 31, 55, TILE.STONE);

      // Scatter sand variation
      for (let y = 3; y < MAP_H - 2; y++)
        for (let x = 3; x < MAP_W - 2; x++)
          if (map[y][x] === TILE.STONE && rng() < 0.06) map[y][x] = TILE.SAND;

    } else if (zoneId === 'deep_mine') {
      // ═══════════════════════════════════════════════════════════
      // DEEP MINE — Endgame: ancient ruins + crystal caverns + boss
      // ═══════════════════════════════════════════════════════════
      for (let y = 0; y < MAP_H; y++)
        for (let x = 0; x < MAP_W; x++) map[y][x] = TILE.WALL;

      // Central Ruins (spawn)
      fill(20, 24, 40, 36, TILE.STONE);
      fill(24, 26, 36, 34, TILE.FLOOR);
      map[26][24] = TILE.WALL; map[26][36] = TILE.WALL;
      map[34][24] = TILE.WALL; map[34][36] = TILE.WALL;
      map[30][22] = TILE.WALL; map[30][38] = TILE.WALL;

      // North Corridor → Boss Arena
      fill(28, 6, 32, 24, TILE.STONE);
      fill(18, 3, 42, 14, TILE.STONE);
      fill(22, 4, 38, 12, TILE.FLOOR);
      map[5][22] = TILE.WALL; map[5][38] = TILE.WALL;
      map[11][22] = TILE.WALL; map[11][38] = TILE.WALL;
      map[8][20] = TILE.WALL; map[8][40] = TILE.WALL;
      fill(28, 7, 32, 9, TILE.SAND);

      // Crystal Cavern (east)
      fill(40, 28, 55, 32, TILE.STONE);
      fill(46, 20, 56, 40, TILE.STONE);
      fill(48, 22, 54, 38, TILE.FLOOR);
      fill(50, 26, 52, 28, TILE.WATER);
      fill(50, 32, 52, 34, TILE.WATER);

      // Collapsed Tunnel (west)
      fill(5, 28, 20, 32, TILE.STONE);
      fill(3, 22, 14, 38, TILE.STONE);
      fill(6, 26, 8, 28, TILE.WALL);
      fill(10, 33, 12, 35, TILE.WALL);
      for (let y = 24; y <= 36; y++)
        for (let x = 5; x <= 12; x++)
          if (map[y][x] === TILE.STONE && rng() < 0.3) map[y][x] = TILE.SAND;

      // South Ancient Passage
      fill(28, 36, 32, 52, TILE.STONE);
      fill(22, 46, 38, 54, TILE.STONE);
      fill(24, 48, 36, 52, TILE.FLOOR);
      fill(26, 49, 28, 51, TILE.WATER);
      fill(33, 49, 35, 51, TILE.WATER);

      // NW chamber
      fill(22, 16, 26, 24, TILE.STONE);
      fill(8, 12, 22, 20, TILE.STONE);
      fill(10, 14, 20, 18, TILE.FLOOR);

      // SE chamber
      fill(36, 36, 40, 42, TILE.STONE);
      fill(40, 42, 52, 50, TILE.STONE);
      fill(42, 44, 50, 48, TILE.FLOOR);

      // Scatter variation
      for (let y = 3; y < MAP_H - 2; y++)
        for (let x = 3; x < MAP_W - 2; x++) {
          if (map[y][x] === TILE.STONE && rng() < 0.08) map[y][x] = TILE.SAND;
          if (map[y][x] === TILE.FLOOR && rng() < 0.1) map[y][x] = TILE.STONE;
        }

    } else if (zone.type === 'housing') {
      // Housing District — stone streets with plot areas
      const mx = Math.floor(MAP_W / 2), my = Math.floor(MAP_H / 2);
      // Base floor
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) map[y][x] = TILE.GRASS;
      // Central street (east-west)
      fill(4, my - 1, MAP_W - 5, my + 1, TILE.STONE);
      // North-south avenue
      fill(mx - 1, 4, mx + 1, MAP_H - 5, TILE.STONE);
      // Plot areas (8 plots — 4 north, 4 south of street)
      const plotW = 8, plotH = 6, gap = 2;
      for (let i = 0; i < 4; i++) {
        const px1 = 6 + i * (plotW + gap);
        // North plots
        fill(px1, my - 3 - plotH, px1 + plotW - 1, my - 3, TILE.FLOOR);
        fill(px1, my - 3 - plotH, px1 + plotW - 1, my - 3 - plotH, TILE.WALL);
        fill(px1, my - 3, px1 + plotW - 1, my - 3, TILE.WALL);
        fill(px1, my - 3 - plotH, px1, my - 3, TILE.WALL);
        fill(px1 + plotW - 1, my - 3 - plotH, px1 + plotW - 1, my - 3, TILE.WALL);
        // Door opening
        fill(px1 + 3, my - 3, px1 + 4, my - 3, TILE.STONE);
        // South plots
        fill(px1, my + 3, px1 + plotW - 1, my + 3 + plotH, TILE.FLOOR);
        fill(px1, my + 3, px1 + plotW - 1, my + 3, TILE.WALL);
        fill(px1, my + 3 + plotH, px1 + plotW - 1, my + 3 + plotH, TILE.WALL);
        fill(px1, my + 3, px1, my + 3 + plotH, TILE.WALL);
        fill(px1 + plotW - 1, my + 3, px1 + plotW - 1, my + 3 + plotH, TILE.WALL);
        // Door opening
        fill(px1 + 3, my + 3, px1 + 4, my + 3, TILE.STONE);
      }
      // Return portal area
      fill(3, 6, 6, 10, TILE.STONE);
      // Scatter some sand on paths
      for (let y = 4; y < MAP_H - 4; y++)
        for (let x = 4; x < MAP_W - 4; x++) {
          if (map[y][x] === TILE.GRASS && rng() < 0.05) map[y][x] = TILE.SAND;
        }

    } else if (zone.type === 'market') {
      // ═══ MARKETPLACE — massive outdoor marketplace ═══
      const mx = Math.floor(MAP_W / 2); // 30
      const my = Math.floor(MAP_H / 2); // 30
      // Base: sand everywhere
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) map[y][x] = TILE.SAND;

      // ── Grand Boulevard (north-south, center) ──
      fill(mx - 3, 4, mx + 3, MAP_H - 5, TILE.STONE);
      // Boulevard decorative edges (wood planks)
      fill(mx - 4, 4, mx - 4, MAP_H - 5, TILE.WOOD);
      fill(mx + 4, 4, mx + 4, MAP_H - 5, TILE.WOOD);

      // ── Cross streets (east-west) ──
      fill(4, 16, MAP_W - 5, 17, TILE.STONE); // Upper market row
      fill(4, 26, MAP_W - 5, 27, TILE.STONE); // Middle market row
      fill(4, 38, MAP_W - 5, 39, TILE.STONE); // Lower market row

      // ── Grand entrance plaza (south) ──
      fill(mx - 8, MAP_H - 10, mx + 8, MAP_H - 5, TILE.STONE);
      fill(mx - 6, MAP_H - 12, mx + 6, MAP_H - 10, TILE.STONE);

      // ── Central fountain plaza ──
      fill(mx - 5, my - 4, mx + 5, my + 4, TILE.STONE);
      // Fountain water
      fill(mx - 2, my - 2, mx + 2, my + 2, TILE.WATER);
      // Fountain rim (stone walkable around water)
      fill(mx - 2, my - 3, mx + 2, my - 3, TILE.STONE);
      fill(mx - 2, my + 3, mx + 2, my + 3, TILE.STONE);
      fill(mx - 3, my - 2, mx - 3, my + 2, TILE.STONE);
      fill(mx + 3, my - 2, mx + 3, my + 2, TILE.STONE);

      // ── Northern premium wing (large stalls) ──
      fill(6, 4, MAP_W - 7, 6, TILE.STONE); // Top promenade
      // Large stall plots — walled enclosures with door openings
      // Left large stall
      fill(14, 8, 23, 13, TILE.FLOOR);
      fill(14, 7, 23, 7, TILE.WALL); fill(14, 14, 23, 14, TILE.WALL);
      fill(13, 7, 13, 14, TILE.WALL); fill(24, 7, 24, 14, TILE.WALL);
      fill(18, 14, 19, 14, TILE.STONE); // door
      // Right large stall
      fill(36, 8, 45, 13, TILE.FLOOR);
      fill(36, 7, 45, 7, TILE.WALL); fill(36, 14, 45, 14, TILE.WALL);
      fill(35, 7, 35, 14, TILE.WALL); fill(46, 7, 46, 14, TILE.WALL);
      fill(40, 14, 41, 14, TILE.STONE); // door

      // ── Side stall rows (small stalls along cross streets) ──
      const smallStalls = [
        [10, 18, 14, 21], [18, 18, 22, 21],   // Upper left
        [42, 18, 46, 21], [50, 18, 54, 21],   // Upper right
        [10, 40, 14, 43],                      // Lower left
        [50, 40, 54, 43],                      // Lower right
      ];
      for (const [sx1, sy1, sx2, sy2] of smallStalls) {
        fill(sx1, sy1, sx2, sy2, TILE.FLOOR);
        fill(sx1, sy1 - 1, sx2, sy1 - 1, TILE.WALL);
        fill(sx1 - 1, sy1 - 1, sx1 - 1, sy2, TILE.WALL);
        fill(sx2 + 1, sy1 - 1, sx2 + 1, sy2, TILE.WALL);
        const doorX = Math.floor((sx1 + sx2) / 2);
        fill(doorX, sy1 - 1, doorX + 1, sy1 - 1, TILE.FLOOR); // door
      }

      // ── Medium stall plots (along middle cross street) ──
      const medStalls = [
        [10, 28, 16, 32], [43, 28, 49, 32],   // Middle row
        [18, 40, 24, 44], [35, 40, 41, 44],   // Lower middle
      ];
      for (const [sx1, sy1, sx2, sy2] of medStalls) {
        fill(sx1, sy1, sx2, sy2, TILE.FLOOR);
        fill(sx1, sy1 - 1, sx2, sy1 - 1, TILE.WALL);
        fill(sx1 - 1, sy1 - 1, sx1 - 1, sy2 + 1, TILE.WALL);
        fill(sx2 + 1, sy1 - 1, sx2 + 1, sy2 + 1, TILE.WALL);
        fill(sx1, sy2 + 1, sx2, sy2 + 1, TILE.WALL);
        const doorX = Math.floor((sx1 + sx2) / 2);
        fill(doorX, sy1 - 1, doorX + 1, sy1 - 1, TILE.FLOOR); // door
      }

      // ── Decorative walls along edges (bazaar boundary) ──
      for (let x = 3; x < MAP_W - 3; x++) {
        if (map[3][x] !== TILE.STONE && map[3][x] !== TILE.WALL) map[3][x] = TILE.WALL;
        if (map[MAP_H - 4][x] !== TILE.STONE && map[MAP_H - 4][x] !== TILE.WALL) map[MAP_H - 4][x] = TILE.WALL;
      }
      for (let y = 3; y < MAP_H - 3; y++) {
        if (map[y][3] !== TILE.STONE && map[y][3] !== TILE.WALL) map[y][3] = TILE.WALL;
        if (map[y][MAP_W - 4] !== TILE.STONE && map[y][MAP_W - 4] !== TILE.WALL) map[y][MAP_W - 4] = TILE.WALL;
      }
      // Gate openings in south wall
      fill(mx - 3, MAP_H - 4, mx + 3, MAP_H - 4, TILE.STONE);
      // Gate openings in east/west walls
      fill(3, 26, 3, 27, TILE.STONE);
      fill(MAP_W - 4, 26, MAP_W - 4, 27, TILE.STONE);

      // ── Scatter variation ──
      for (let y = 4; y < MAP_H - 4; y++)
        for (let x = 4; x < MAP_W - 4; x++) {
          if (map[y][x] === TILE.SAND && rng() < 0.06) map[y][x] = TILE.GRASS; // weeds growing through sand
          if (map[y][x] === TILE.STONE && rng() < 0.04) map[y][x] = TILE.SAND; // worn cobble
        }

    } else if (zone.type === 'mine') {
      // Cavern with scattered wall pillars and water pools
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) {
          const r = rng();
          map[y][x] = r < 0.04 ? TILE.WALL : r < 0.07 ? TILE.SAND : TILE.STONE;
        }
      for (let i = 0; i < 3; i++) {
        const wx = 4 + Math.floor(rng() * (MAP_W - 10)), wy = 4 + Math.floor(rng() * (MAP_H - 10));
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 3; dx++)
            if (wy + dy < MAP_H - 2 && wx + dx < MAP_W - 2) map[wy + dy][wx + dx] = TILE.WATER;
      }
    } else if (zoneId === 'dungeon') {
      // ═══ DARK DUNGEON — elaborate multi-room layout ═══
      // Fill with walls, then carve rooms and corridors
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) map[y][x] = TILE.WALL;
      const mx = Math.floor(MAP_W / 2), my = Math.floor(MAP_H / 2);

      // ── Central Grand Hall (spawn area) ──
      fill(mx - 6, my - 4, mx + 6, my + 4, TILE.STONE);
      // Pillared edges
      fill(mx - 6, my - 4, mx - 6, my - 4, TILE.WALL);
      fill(mx + 6, my - 4, mx + 6, my - 4, TILE.WALL);
      fill(mx - 6, my + 4, mx - 6, my + 4, TILE.WALL);
      fill(mx + 6, my + 4, mx + 6, my + 4, TILE.WALL);
      // Floor variation in center
      fill(mx - 2, my - 1, mx + 2, my + 1, TILE.FLOOR);

      // ── North Corridor → Crypt Chamber ──
      fill(mx - 2, my - 12, mx + 2, my - 4, TILE.STONE); // corridor
      fill(mx - 7, my - 18, mx + 7, my - 12, TILE.STONE); // Crypt of the Fallen
      fill(mx - 1, my - 15, mx + 1, my - 13, TILE.FLOOR); // altar area
      // Crypt alcoves
      fill(mx - 10, my - 16, mx - 7, my - 13, TILE.STONE); // west alcove
      fill(mx + 7, my - 16, mx + 10, my - 13, TILE.STONE); // east alcove

      // ── South Corridor → Throne Room ──
      fill(mx - 2, my + 4, mx + 2, my + 14, TILE.STONE); // corridor
      fill(mx - 8, my + 14, mx + 8, my + 22, TILE.STONE); // Throne Room
      fill(mx - 2, my + 19, mx + 2, my + 21, TILE.FLOOR); // throne dais
      // Throne room side alcoves
      fill(mx - 11, my + 16, mx - 8, my + 20, TILE.STONE); // west treasury
      fill(mx + 8, my + 16, mx + 11, my + 20, TILE.STONE); // east armory

      // ── East Corridor → Torture Chamber ──
      fill(mx + 6, my - 2, mx + 16, my + 2, TILE.STONE); // corridor
      fill(mx + 16, my - 5, mx + 23, my + 5, TILE.STONE); // Torture Chamber
      // Water pit (blood pool)
      fill(mx + 18, my - 1, mx + 20, my + 1, TILE.WATER);
      // Small cells off torture chamber
      fill(mx + 23, my - 3, mx + 26, my - 1, TILE.STONE); // cell 1
      fill(mx + 23, my + 1, mx + 26, my + 3, TILE.STONE); // cell 2

      // ── West Corridor → Library/Archives ──
      fill(mx - 16, my - 2, mx - 6, my + 2, TILE.STONE); // corridor
      fill(mx - 23, my - 5, mx - 16, my + 5, TILE.STONE); // Library
      fill(mx - 21, my - 3, mx - 18, my + 3, TILE.FLOOR); // reading area
      // Library alcove
      fill(mx - 26, my - 2, mx - 23, my + 2, TILE.STONE); // forbidden section

      // ── NE diagonal → Alchemy Lab ──
      fill(mx + 4, my - 8, mx + 6, my - 5, TILE.STONE); // connector
      fill(mx + 6, my - 12, mx + 14, my - 6, TILE.STONE); // Alchemy Lab
      fill(mx + 9, my - 10, mx + 11, my - 8, TILE.WATER); // acid pool

      // ── SW diagonal → Catacombs ──
      fill(mx - 6, my + 6, mx - 4, my + 10, TILE.STONE); // connector
      fill(mx - 14, my + 8, mx - 4, my + 16, TILE.STONE); // Catacombs
      // Catacomb bone pits
      fill(mx - 12, my + 10, mx - 10, my + 12, TILE.SAND);
      fill(mx - 8, my + 12, mx - 6, my + 14, TILE.SAND);

      // ── SE passage → Arena ──
      fill(mx + 4, my + 6, mx + 6, my + 10, TILE.STONE); // connector
      fill(mx + 6, my + 8, mx + 16, my + 16, TILE.STONE); // Arena
      fill(mx + 9, my + 10, mx + 13, my + 14, TILE.FLOOR); // arena pit floor
      // Arena pillars
      fill(mx + 7, my + 9, mx + 7, my + 9, TILE.WALL);
      fill(mx + 15, my + 9, mx + 15, my + 9, TILE.WALL);
      fill(mx + 7, my + 15, mx + 7, my + 15, TILE.WALL);
      fill(mx + 15, my + 15, mx + 15, my + 15, TILE.WALL);

      // ── NW passage → Shrine ──
      fill(mx - 6, my - 6, mx - 4, my - 5, TILE.STONE); // connector
      fill(mx - 14, my - 14, mx - 4, my - 6, TILE.STONE); // Shrine
      fill(mx - 10, my - 11, mx - 8, my - 9, TILE.FLOOR); // ritual circle
      fill(mx - 12, my - 8, mx - 12, my - 8, TILE.WATER); // holy water basin
    } else if (zone.type === 'combat') {
      // Forest: grass with tree clusters and ponds
      for (let y = 2; y < MAP_H - 2; y++)
        for (let x = 2; x < MAP_W - 2; x++) {
          const r = rng();
          map[y][x] = r < 0.03 ? TILE.WALL : r < 0.05 ? TILE.SAND : TILE.GRASS;
        }
      for (let i = 0; i < 6; i++) {
        const cx = 5 + Math.floor(rng() * (MAP_W - 10)), cy = 5 + Math.floor(rng() * (MAP_H - 10));
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++)
            if (cy + dy < MAP_H - 2 && cx + dx < MAP_W - 2 && rng() < 0.7) map[cy + dy][cx + dx] = TILE.WALL;
      }
      for (let i = 0; i < 2; i++) {
        const wx = 6 + Math.floor(rng() * (MAP_W - 14)), wy = 6 + Math.floor(rng() * (MAP_H - 14));
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 4; dx++)
            if (wy + dy < MAP_H - 2 && wx + dx < MAP_W - 2) map[wy + dy][wx + dx] = TILE.WATER;
      }

      // ═══ BOSS ARENA (top-left corner) ═══
      if (zoneId === 'forest') {
        // Arena bounds in tiles (centered around arenaX:360, arenaY:360 → tile 9,9)
        const ax1 = 3, ay1 = 3, ax2 = 17, ay2 = 17;
        // Outer wall border (thick tree/stone perimeter)
        for (let y = ay1; y <= ay2; y++)
          for (let x = ax1; x <= ax2; x++) {
            if (y <= ay1 + 1 || y >= ay2 - 1 || x <= ax1 + 1 || x >= ax2 - 1)
              map[y][x] = TILE.WALL;
          }
        // Inner arena floor (cleared grass with stone accents)
        for (let y = ay1 + 2; y <= ay2 - 2; y++)
          for (let x = ax1 + 2; x <= ax2 - 2; x++)
            map[y][x] = TILE.GRASS;
        // Stone ring around the center (decorative circular pattern)
        const acx = 10, acy = 10; // arena center tile
        for (let y = ay1 + 2; y <= ay2 - 2; y++)
          for (let x = ax1 + 2; x <= ax2 - 2; x++) {
            const dist = Math.sqrt((x - acx) * (x - acx) + (y - acy) * (y - acy));
            if (dist >= 4.5 && dist <= 5.5) map[y][x] = TILE.STONE;
            if (dist <= 1.5) map[y][x] = TILE.SAND; // center marking
          }
        // Corner stone pillars inside the arena
        map[ay1 + 2][ax1 + 2] = TILE.WALL;
        map[ay1 + 2][ax2 - 2] = TILE.WALL;
        map[ay2 - 2][ax1 + 2] = TILE.WALL;
        map[ay2 - 2][ax2 - 2] = TILE.WALL;
        // Entrance path from the south (gap in the wall)
        for (let y = ay2 - 1; y <= ay2 + 2; y++) {
          map[y][acx - 1] = TILE.STONE;
          map[y][acx] = TILE.STONE;
          map[y][acx + 1] = TILE.STONE;
        }
        // Entrance path from the east (gap in the wall)
        for (let x = ax2 - 1; x <= ax2 + 2; x++) {
          map[acy - 1][x] = TILE.STONE;
          map[acy][x] = TILE.STONE;
          map[acy + 1][x] = TILE.STONE;
        }

        // ═══ GOBLIN KING HUT (right side of map, tiles 47-56, rows 19-31) ═══
        const gx1 = 47, gy1 = 19, gx2 = 56, gy2 = 31;
        // Outer walls
        for (let y = gy1; y <= gy2; y++)
          for (let x = gx1; x <= gx2; x++) {
            if (y === gy1 || y === gy2 || x === gx1 || x === gx2)
              map[y][x] = TILE.WALL;
          }
        // Interior floor (wood)
        for (let y = gy1 + 1; y < gy2; y++)
          for (let x = gx1 + 1; x < gx2; x++)
            map[y][x] = TILE.WOOD;
        // Entrance at bottom center (3 tiles wide)
        const gex = Math.floor((gx1 + gx2) / 2);
        map[gy2][gex - 1] = TILE.STONE;
        map[gy2][gex] = TILE.STONE;
        map[gy2][gex + 1] = TILE.STONE;
        // Path leading to entrance
        for (let y = gy2 + 1; y <= gy2 + 3; y++) {
          map[y][gex - 1] = TILE.STONE;
          map[y][gex] = TILE.STONE;
          map[y][gex + 1] = TILE.STONE;
        }

        // ═══ GOBLIN CAMP (south-west corner, tiles 4-14, rows 44-54) ═══
        const gcx1 = 4, gcy1 = 44, gcx2 = 14, gcy2 = 54;
        // Clear the area to grass/sand
        for (let y = gcy1; y <= gcy2; y++)
          for (let x = gcx1; x <= gcx2; x++) {
            map[y][x] = TILE.GRASS;
          }
        // Dirt perimeter (sand border)
        for (let y = gcy1; y <= gcy2; y++)
          for (let x = gcx1; x <= gcx2; x++) {
            if (y === gcy1 || y === gcy2 || x === gcx1 || x === gcx2)
              map[y][x] = TILE.SAND;
          }
        // Central fire pit
        const gcCx = Math.floor((gcx1 + gcx2) / 2), gcCy = Math.floor((gcy1 + gcy2) / 2);
        map[gcCy][gcCx] = TILE.SAND;
        map[gcCy - 1][gcCx] = TILE.SAND;
        map[gcCy + 1][gcCx] = TILE.SAND;
        map[gcCy][gcCx - 1] = TILE.SAND;
        map[gcCy][gcCx + 1] = TILE.SAND;
      }
    }

    // Ensure spawn area (center) is always walkable
    // Skip hub — its layout is hand-crafted with guaranteed walkable spawn
    if (zoneId !== 'hub') {
      const spx = Math.floor(MAP_W / 2), spy = Math.floor(MAP_H / 2);
      const safeTile = zone.type === 'combat' && zoneId !== 'dungeon' ? TILE.GRASS : zone.type === 'mine' ? TILE.STONE : TILE.FLOOR;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const ty = spy + dy, tx = spx + dx;
          if (ty >= 2 && ty < MAP_H - 2 && tx >= 2 && tx < MAP_W - 2) map[ty][tx] = safeTile;
        }
    }
    return map;
  }

  // Find nearest walkable tile to world coords, returns snapped pixel position
  rpgFindWalkable(tileMap, wx, wy) {
    const tx = Math.min(MAP_W - 1, Math.max(0, Math.floor(wx / TILE_SIZE)));
    const ty = Math.min(MAP_H - 1, Math.max(0, Math.floor(wy / TILE_SIZE)));
    if (TILE_PROPS[tileMap[ty][tx]].walkable) return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
    for (let r = 1; r < Math.max(MAP_W, MAP_H); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const cx = tx + dx, cy = ty + dy;
          if (cx >= 0 && cx < MAP_W && cy >= 0 && cy < MAP_H && TILE_PROPS[tileMap[cy][cx]].walkable)
            return { x: cx * TILE_SIZE + TILE_SIZE / 2, y: cy * TILE_SIZE + TILE_SIZE / 2 };
        }
      }
    }
    return { x: wx, y: wy };
  }

  rpgMakeNode(zoneId, idx) {
    const zone = RPG_ZONES[zoneId];
    const cols = 8;
    const drop = this.rpgWeightedDrop(zone.drops);
    let x, y;
    if (zoneId === 'quarry') {
      // Quarry: nodes in the pit area (avoiding lodge at rows 23-36)
      const pitMinY = 4 * 40, pitMaxY = 55 * 40;
      const pitMinX = 4 * 40, pitMaxX = 56 * 40;
      x = pitMinX + (idx % cols) * ((pitMaxX - pitMinX) / cols) + Math.floor(Math.random() * 60);
      y = pitMinY + Math.floor(idx / cols) * ((pitMaxY - pitMinY) / Math.ceil(zone.nodes / cols)) + Math.floor(Math.random() * 40);
      // Push nodes out of lodge building bounds
      if (x >= 21 * 40 && x <= 39 * 40 && y >= 23 * 40 && y <= 37 * 40) {
        y = y < 30 * 40 ? 8 * 40 + Math.floor(Math.random() * 400) : 42 * 40 + Math.floor(Math.random() * 400);
      }
    } else if (zoneId === 'underground_mine') {
      // Underground mine: nodes spread across tunnels and caverns
      const areas = [
        { x1: 22*40, y1: 22*40, x2: 38*40, y2: 38*40 },  // Central cavern
        { x1: 20*40, y1: 3*40, x2: 40*40, y2: 10*40 },   // North crystal cavern
        { x1: 3*40, y1: 22*40, x2: 14*40, y2: 38*40 },   // West ore corridor
        { x1: 48*40, y1: 22*40, x2: 56*40, y2: 38*40 },  // East minecart hub
        { x1: 22*40, y1: 50*40, x2: 38*40, y2: 56*40 },  // South tunnel
        { x1: 44*40, y1: 8*40, x2: 52*40, y2: 16*40 },   // NE passage
        { x1: 4*40, y1: 42*40, x2: 12*40, y2: 50*40 },   // SW passage
      ];
      const area = areas[idx % areas.length];
      x = area.x1 + Math.floor(Math.random() * (area.x2 - area.x1));
      y = area.y1 + Math.floor(Math.random() * (area.y2 - area.y1));
    } else if (zoneId === 'deep_mine') {
      // Deep mine: nodes in caverns and passages
      const areas = [
        { x1: 20*40, y1: 24*40, x2: 40*40, y2: 36*40 },  // Central ruins
        { x1: 46*40, y1: 20*40, x2: 56*40, y2: 40*40 },  // Crystal cavern east
        { x1: 3*40, y1: 22*40, x2: 14*40, y2: 38*40 },   // Collapsed tunnel west
        { x1: 22*40, y1: 46*40, x2: 38*40, y2: 54*40 },  // South passage
        { x1: 8*40, y1: 12*40, x2: 22*40, y2: 20*40 },   // NW chamber
        { x1: 40*40, y1: 42*40, x2: 52*40, y2: 50*40 },  // SE chamber
      ];
      const area = areas[idx % areas.length];
      x = area.x1 + Math.floor(Math.random() * (area.x2 - area.x1));
      y = area.y1 + Math.floor(Math.random() * (area.y2 - area.y1));
    } else {
      x = 150 + (idx % cols) * 270 + Math.floor(Math.random() * 80);
      y = 120 + Math.floor(idx / cols) * 260 + Math.floor(Math.random() * 60);
    }
    const w = this.rpgWorld[zoneId];
    if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
    return {
      id: `${zoneId}_n${idx}`,
      type: drop.type, color: drop.color, gold: drop.gold, xp: drop.xp,
      hp: drop.hp || 3, maxHP: drop.hp || 3,
      size: drop.size || 1.0,
      x, y, mined: false, respawnAt: 0,
    };
  }

  // ═══════════════════════════════════════════
  // MOB AI TICK — runs every 200ms
  // Handles: idle wander, aggro, chase, telegraph, attack, leash
  // Behavior-specific: swarm, slow_tank, guardian, aggressive, skirmisher, ambusher, relentless, pack_hunter
  // ═══════════════════════════════════════════
  rpgMobAI() {
    const now = Date.now();
    const dt = 0.2; // 200ms in seconds

    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      if (!w.playerMobs) continue;
      const zone = RPG_ZONES[zoneId];
      if (!zone || !zone.mobs) continue;

      // Per-player mob instances — each player has their own mobs
      for (const [ownerUser, mobs] of Object.entries(w.playerMobs)) {
      if (!mobs || mobs.length === 0) continue;
      const ownerRp = this.rpgPlayers[ownerUser];
      if (!ownerRp || ownerRp.zone !== zoneId) continue;

      // The only target for these mobs is the owning player
      const playersInZone = (ownerRp.hp > 0 && !ownerRp.godMode) ? [{ username: ownerUser, x: ownerRp.x || 400, y: ownerRp.y || 200, rp: ownerRp }] : [];

      const movedMobs = [];

      for (const mob of mobs) {
        if (mob.dead) continue;
        const behavior = mob.behavior || 'slow_chase';
        const moveSpd = (mob.moveSpeed || 0.8) * 40 * dt;  // px per tick
        const chaseSpd = (mob.chaseSpeed || 1.4) * 40 * dt;
        const aggroR = mob.aggroRange || 120;
        const leashR = mob.leashRange || 220;
        let atkCD = mob.atkCD || 2500;
        // Elite/Champion attack faster
        if (mob.eliteTier === 'champion') atkCD = Math.floor(atkCD * 0.6);
        else if (mob.eliteTier === 'elite') atkCD = Math.floor(atkCD * 0.8);
        // Blood Moon — scale mob attack
        const mobDmgMult = this.rpgGetWorldEventMultiplier('mobDmg');
        const effectiveAtk = Math.floor(mob.atk * mobDmgMult);
        let moved = false;

        // ── Find nearest player ──
        let nearestPlayer = null, nearestDist = Infinity;
        for (const pl of playersInZone) {
          const dx = pl.x - mob.x, dy = pl.y - mob.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) { nearestDist = dist; nearestPlayer = pl; }
        }

        // ── Swarm behavior: aggro ALL nearby swarm mobs when one aggros ──
        if (behavior === 'swarm' && mob.state === 'idle' || (behavior === 'swarm' && mob.state === 'wander')) {
          for (const other of mobs) {
            if (other.id !== mob.id && !other.dead && other.behavior === 'swarm' &&
                (other.state === 'chase' || other.state === 'attack' || other.state === 'telegraph')) {
              const d = Math.sqrt((other.x - mob.x) ** 2 + (other.y - mob.y) ** 2);
              if (d < 200) { mob.state = 'chase'; mob.targetUser = other.targetUser; break; }
            }
          }
        }

        // ── State transitions ──
        if (mob.state === 'idle' || mob.state === 'wander') {
          if (behavior === 'ambusher' && mob.state === 'idle' && nearestPlayer && nearestDist < aggroR) {
            mob.state = 'chase'; mob.targetUser = nearestPlayer.username;
            // Ambusher surprise — broadcast reveal
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_reveal', data: { mobId: mob.id, x: mob.x, y: mob.y } });
          } else if (behavior !== 'ambusher' && nearestPlayer && nearestDist < aggroR) {
            mob.state = 'chase'; mob.targetUser = nearestPlayer.username;
          }
        } else if (mob.state === 'chase' || mob.state === 'attack' || mob.state === 'telegraph') {
          // Check leash distance
          const dsx = mob.x - mob.spawnX, dsy = mob.y - mob.spawnY;
          const distFromSpawn = Math.sqrt(dsx * dsx + dsy * dsy);
          if (mob.state !== 'telegraph') { // don't interrupt a telegraph mid-windup
            if (distFromSpawn > leashR && behavior !== 'relentless') {
              mob.state = 'leash'; mob.targetUser = null;
            } else if (!nearestPlayer || nearestDist > leashR) {
              if (behavior !== 'relentless') { mob.state = 'leash'; mob.targetUser = null; }
            }
          }
        }

        // ── Skirmisher retreat ──
        if (behavior === 'skirmisher' && mob.retreatUntil > now) {
          if (nearestPlayer) {
            const dx = mob.x - nearestPlayer.x, dy = mob.y - nearestPlayer.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            mob.x += (dx / dist) * chaseSpd * 0.8;
            mob.y += (dy / dist) * chaseSpd * 0.8;
            mob.facing = dx > 0 ? 1 : -1;
            moved = true;
          }
        }
        // ── IDLE / WANDER ──
        else if (mob.state === 'idle') {
          // Ambushers & mimics stay perfectly still
          if (behavior !== 'ambusher' && now >= mob.nextWander) {
            const angle = Math.random() * Math.PI * 2;
            // Guardian patrols wider, slow_tank barely moves
            const wanderDist = behavior === 'guardian' ? (50 + Math.random() * 80) :
                               behavior === 'slow_tank' ? (15 + Math.random() * 25) :
                               (30 + Math.random() * 60);
            mob.wanderX = mob.spawnX + Math.cos(angle) * wanderDist;
            mob.wanderY = mob.spawnY + Math.sin(angle) * wanderDist;
            mob.state = 'wander';
          }
        } else if (mob.state === 'wander') {
          const dx = mob.wanderX - mob.x, dy = mob.wanderY - mob.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 5) {
            mob.state = 'idle';
            // Guardian has short pauses between patrols, others longer
            mob.nextWander = behavior === 'guardian' ? now + 800 + Math.random() * 1500 :
                             now + 2000 + Math.random() * 4000;
          } else {
            const step = Math.min(moveSpd, dist);
            mob.x += (dx / dist) * step;
            mob.y += (dy / dist) * step;
            mob.facing = dx > 0 ? 1 : -1;
            moved = true;
          }
        }
        // ── CHASE ──
        else if (mob.state === 'chase') {
          if (nearestPlayer && nearestDist > 50) {
            const dx = nearestPlayer.x - mob.x, dy = nearestPlayer.y - mob.y;
            const dist = nearestDist || 1;
            // Aggressive mobs charge faster when far away
            let speed = chaseSpd;
            if (behavior === 'aggressive' && nearestDist > 120) speed = chaseSpd * 1.5;
            // Swarm mobs speed up when near other swarm mobs
            if (behavior === 'swarm') {
              let swarmNearby = 0;
              for (const other of mobs) {
                if (other.id !== mob.id && !other.dead && other.behavior === 'swarm') {
                  const sd = Math.sqrt((other.x - mob.x) ** 2 + (other.y - mob.y) ** 2);
                  if (sd < 120) swarmNearby++;
                }
              }
              if (swarmNearby > 0) speed *= 1 + swarmNearby * 0.15;
            }
            const step = Math.min(speed, dist);
            mob.x += (dx / dist) * step;
            mob.y += (dy / dist) * step;
            mob.facing = dx > 0 ? 1 : -1;
            moved = true;
          }
          // Enter telegraph (wind-up) when in range and cooldown ready
          if (nearestPlayer && nearestDist < 60 && now >= mob.nextAttack) {
            mob.state = 'telegraph';
            // Telegraph duration depends on behavior
            const telegraphMs = behavior === 'aggressive' ? 500 :
                                behavior === 'swarm' ? 400 :
                                behavior === 'slow_tank' ? 900 :
                                behavior === 'guardian' ? 700 :
                                600;
            mob.telegraphEnd = now + telegraphMs;
            mob.telegraphTarget = nearestPlayer.username;
            // Broadcast telegraph warning to clients
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_telegraph', data: {
              mobId: mob.id, x: mob.x, y: mob.y, duration: telegraphMs,
              behavior, targetUser: nearestPlayer.username
            }});
          }
        }
        // ── TELEGRAPH (attack wind-up) ──
        else if (mob.state === 'telegraph') {
          // Mob stands still during telegraph (except aggressive lunges forward slightly)
          if (behavior === 'aggressive' && nearestPlayer && nearestDist > 30) {
            const dx = nearestPlayer.x - mob.x, dy = nearestPlayer.y - mob.y;
            const dist = nearestDist || 1;
            mob.x += (dx / dist) * chaseSpd * 0.3;
            mob.y += (dy / dist) * chaseSpd * 0.3;
            moved = true;
          }
          // Telegraph finished — resolve attack
          if (now >= mob.telegraphEnd) {
            // Find the targeted player
            let target = null;
            for (const pl of playersInZone) {
              if (pl.username === mob.telegraphTarget) { target = pl; break; }
            }
            // DODGE CHECK — if player moved out of range during telegraph, attack MISSES
            const attackRange = behavior === 'slow_tank' ? 80 : 70; // slow_tank has wider range
            if (target) {
              const tdx = target.x - mob.x, tdy = target.y - mob.y;
              const tDist = Math.sqrt(tdx * tdx + tdy * tdy);
              if (tDist <= attackRange) {
                // HIT — deal damage
                const targetRp = target.rp;
                const p = this.player(target.username);
                const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && now < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
                let dmg = Math.max(1, effectiveAtk - Math.floor(Math.random() * 3) - def);
                // Slow_tank does bonus damage
                if (behavior === 'slow_tank') dmg = Math.floor(dmg * 1.3);
                // Block / Parry check
                let blocked = false, parried = false;
                if (targetRp.blocking) {
                  if (now - targetRp.blockStart < 250) {
                    parried = true; dmg = 0;
                    mob.nextAttack = now + 1500; // stun mob on parry
                    mob.state = 'idle';
                  } else {
                    blocked = true; dmg = Math.max(1, Math.floor(dmg * 0.5));
                  }
                }
                targetRp.hp = Math.max(0, targetRp.hp - dmg);
                // Life Drain — heal mob for % of damage dealt
                if (mob.abilityActive === 'life_drain' && mob.abilityEnd > now) {
                  mob.hp = Math.min(mob.maxHP, mob.hp + Math.floor(dmg * mob.ability.healPct));
                }
                const armorResult = this.degradeEquipped(p, 'armor', 1);
                this.rpgSendTo(target.username, { type: 'rpg_mob_attack', data: {
                  mobId: mob.id, dmg, hp: targetRp.hp, maxHP: targetRp.maxHP, blocked, parried,
                  armorBroke: armorResult && armorResult.broken ? armorResult.name : null
                }});
                // Skirmisher retreats after hitting
                if (behavior === 'skirmisher') mob.retreatUntil = now + 600 + Math.random() * 400;
                if (targetRp.hp <= 0) {
                  const lost = Math.floor(p.gold * 0.02);
                  p.gold = Math.max(0, p.gold - lost);
                  this.saveData();
                  this.rpgSendTo(target.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
                  this.rpgResetBossesOnDeath(target.username, zoneId);
                  targetRp.zone = 'hub'; targetRp.hp = targetRp.maxHP;
                  mob.state = 'leash'; mob.targetUser = null;
                  mob.nextAttack = now + atkCD;
                  if (moved) movedMobs.push({ id: mob.id, x: Math.round(mob.x), y: Math.round(mob.y), s: mob.state, f: mob.facing });
                  continue;
                }
              } else {
                // DODGED — broadcast miss
                this.rpgSendTo(mob.telegraphTarget, { type: 'rpg_mob_miss', data: { mobId: mob.id } });
              }
            }
            mob.nextAttack = now + atkCD;
            mob.state = 'chase';
          }
        }
        // ── LEASH (return to spawn) ──
        else if (mob.state === 'leash') {
          const dx = mob.spawnX - mob.x, dy = mob.spawnY - mob.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 10) {
            mob.state = 'idle'; mob.nextWander = now + 1000 + Math.random() * 2000;
            // Ambusher resets to hidden
          } else {
            const step = Math.min(chaseSpd * 1.2, dist);
            mob.x += (dx / dist) * step;
            mob.y += (dy / dist) * step;
            mob.facing = dx > 0 ? 1 : -1;
            moved = true;
          }
          // Heal while leashing
          if (mob.hp < mob.maxHP) mob.hp = Math.min(mob.maxHP, mob.hp + mob.maxHP * 0.05 * dt);
        }

        // ── Pack hunter bonus: wolves near same target attack faster ──
        if (behavior === 'pack_hunter' && (mob.state === 'chase' || mob.state === 'telegraph') && nearestPlayer) {
          let packCount = 0;
          for (const other of mobs) {
            if (other.id !== mob.id && !other.dead && other.behavior === 'pack_hunter' &&
                (other.state === 'chase' || other.state === 'telegraph' || other.state === 'attack')) {
              const d = Math.sqrt((other.x - mob.x) ** 2 + (other.y - mob.y) ** 2);
              if (d < 150) packCount++;
            }
          }
          if (packCount >= 1 && mob.nextAttack > now) {
            mob.nextAttack -= packCount * 100 * dt;
          }
        }

        // ── SPECIAL ABILITIES ──
        // Expire active abilities
        if (mob.abilityActive && mob.abilityEnd > 0 && now >= mob.abilityEnd) {
          // Life drain expired — broadcast end
          if (mob.abilityActive === 'life_drain' || mob.abilityActive === 'bone_shield') {
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability_end', data: { mobId: mob.id, ability: mob.abilityActive } });
          }
          mob.abilityActive = null; mob.abilityEnd = 0;
        }

        const ab = mob.ability;
        if (ab && now >= mob.nextAbility && (mob.state === 'chase' || mob.state === 'telegraph' || mob.state === 'attack') && nearestPlayer) {
          let used = false;

          // ── SLIME SPLIT — at 30% HP, splits into 2 mini slimes ──
          if (ab.name === 'split' && !mob.hasSplit && mob.hp <= mob.maxHP * 0.3) {
            mob.hasSplit = true;
            // Spawn 2 mini slimes near this one
            for (let si = 0; si < 2; si++) {
              const miniId = `${mob.id}_mini${si}`;
              const ox = (si === 0 ? -30 : 30) + (Math.random() - 0.5) * 10;
              const miniMob = {
                id: miniId, name: 'Mini Slime', maxHP: Math.floor(mob.maxHP * 0.4), hp: Math.floor(mob.maxHP * 0.4),
                atk: Math.max(1, Math.floor(mob.atk * 0.5)), goldMin: 0, goldMax: 1, xpReward: 2,
                color: '#66ff66', behavior: 'slow_chase', moveSpeed: 0.8, chaseSpeed: 1.2,
                aggroRange: 100, leashRange: 160, atkCD: 2000,
                x: mob.x + ox, y: mob.y + 20, dead: false, respawnAt: 0, templateName: 'Mini Slime',
                spawnX: mob.x + ox, spawnY: mob.y + 20, state: 'chase', targetUser: nearestPlayer.username, facing: 1,
                wanderX: mob.x + ox, wanderY: mob.y + 20, nextWander: now + 9999,
                nextAttack: now + 1500, retreatUntil: 0, telegraphEnd: 0, telegraphTarget: null,
                nextAbility: now + 99999, abilityActive: null, abilityEnd: 0, hasSplit: true,
                ability: null, isMini: true,
              };
              mobs.push(miniMob);
              this.rpgSendTo(ownerUser, { type: 'rpg_mob_spawn', data: miniMob });
            }
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'split', x: mob.x, y: mob.y } });
            used = true;
          }

          // ── GOBLIN THROW DAGGER — ranged attack when player is kiting ──
          if (ab.name === 'throw_dagger' && nearestDist > 80 && nearestDist < ab.range) {
            const p = this.player(nearestPlayer.username);
            const def = this.armorDefBonus(p);
            const dmg = Math.max(1, Math.floor(effectiveAtk * ab.dmgMult) - def);
            nearestPlayer.rp.hp = Math.max(0, nearestPlayer.rp.hp - dmg);
            this.rpgSendTo(nearestPlayer.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg, hp: nearestPlayer.rp.hp, maxHP: nearestPlayer.rp.maxHP } });
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'throw_dagger', x: mob.x, y: mob.y, tx: nearestPlayer.x, ty: nearestPlayer.y } });
            if (nearestPlayer.rp.hp <= 0) {
              const lost = Math.floor(p.gold * 0.02);
              p.gold = Math.max(0, p.gold - lost); this.saveData();
              this.rpgSendTo(nearestPlayer.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
              this.rpgResetBossesOnDeath(nearestPlayer.username, zoneId);
              nearestPlayer.rp.zone = 'hub'; nearestPlayer.rp.hp = nearestPlayer.rp.maxHP;
            }
            used = true;
          }

          // ── WOLF LUNGE — dash forward and deal double damage ──
          if (ab.name === 'lunge' && nearestDist > 40 && nearestDist < 160) {
            // Dash toward player
            const dx = nearestPlayer.x - mob.x, dy = nearestPlayer.y - mob.y;
            const dist = nearestDist || 1;
            const dashPx = Math.min(ab.dashDist, nearestDist - 20);
            mob.x += (dx / dist) * dashPx;
            mob.y += (dy / dist) * dashPx;
            mob.facing = dx > 0 ? 1 : -1;
            moved = true;
            // Check if lunge connects (within 50px after dash)
            const afterDist = Math.sqrt((nearestPlayer.x - mob.x) ** 2 + (nearestPlayer.y - mob.y) ** 2);
            if (afterDist < 55) {
              const p = this.player(nearestPlayer.username);
              const def = this.armorDefBonus(p);
              const dmg = Math.max(1, Math.floor(effectiveAtk * ab.dmgMult) - def);
              nearestPlayer.rp.hp = Math.max(0, nearestPlayer.rp.hp - dmg);
              this.rpgSendTo(nearestPlayer.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg, hp: nearestPlayer.rp.hp, maxHP: nearestPlayer.rp.maxHP } });
              if (nearestPlayer.rp.hp <= 0) {
                const lost = Math.floor(p.gold * 0.02);
                p.gold = Math.max(0, p.gold - lost); this.saveData();
                this.rpgSendTo(nearestPlayer.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
                this.rpgResetBossesOnDeath(nearestPlayer.username, zoneId);
                nearestPlayer.rp.zone = 'hub'; nearestPlayer.rp.hp = nearestPlayer.rp.maxHP;
              }
            }
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'lunge', x: mob.x, y: mob.y, fromX: mob.x - (dx/dist)*dashPx, fromY: mob.y - (dy/dist)*dashPx } });
            used = true;
          }

          // ── SKELETON BONE SHIELD — take 50% reduced damage for duration ──
          if (ab.name === 'bone_shield' && !mob.abilityActive) {
            mob.abilityActive = 'bone_shield';
            mob.abilityEnd = now + ab.duration;
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'bone_shield', duration: ab.duration } });
            used = true;
          }

          // ── ZOMBIE GRAB — root player in place ──
          if (ab.name === 'grab' && nearestDist < 65) {
            this.rpgSendTo(nearestPlayer.username, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'grab', duration: ab.rootDuration, targetUser: nearestPlayer.username } });
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'grab', x: nearestPlayer.x, y: nearestPlayer.y, targetUser: nearestPlayer.username } });
            used = true;
          }

          // ── WRAITH LIFE DRAIN — heals for 50% of damage dealt for duration ──
          if (ab.name === 'life_drain' && !mob.abilityActive && nearestDist < 100) {
            mob.abilityActive = 'life_drain';
            mob.abilityEnd = now + ab.duration;
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'life_drain', duration: ab.duration } });
            used = true;
          }

          // ── DEMON FIRE BREATH — cone AoE, hits all nearby players ──
          if (ab.name === 'fire_breath' && nearestDist < ab.range) {
            const breathDmg = Math.floor(effectiveAtk * ab.dmgMult);
            for (const pl of playersInZone) {
              const pdx = pl.x - mob.x, pdy = pl.y - mob.y;
              const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
              if (pDist < ab.range) {
                // Check cone angle (~90 degrees facing target)
                const toTarget = Math.atan2(nearestPlayer.y - mob.y, nearestPlayer.x - mob.x);
                const toPlayer = Math.atan2(pdy, pdx);
                let angleDiff = Math.abs(toTarget - toPlayer);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                if (angleDiff < Math.PI / 4) {
                  const p2 = this.player(pl.username);
                  const def2 = this.armorDefBonus(p2);
                  const fdmg = Math.max(1, breathDmg - def2);
                  pl.rp.hp = Math.max(0, pl.rp.hp - fdmg);
                  this.rpgSendTo(pl.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg: fdmg, hp: pl.rp.hp, maxHP: pl.rp.maxHP } });
                  if (pl.rp.hp <= 0) {
                    const lost = Math.floor(p2.gold * 0.02);
                    p2.gold = Math.max(0, p2.gold - lost); this.saveData();
                    this.rpgSendTo(pl.username, { type: 'rpg_death', data: { goldLost: lost, gold: p2.gold } });
                    this.rpgResetBossesOnDeath(pl.username, zoneId);
                    pl.rp.zone = 'hub'; pl.rp.hp = pl.rp.maxHP;
                  }
                }
              }
            }
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'fire_breath', x: mob.x, y: mob.y, angle: Math.atan2(nearestPlayer.y - mob.y, nearestPlayer.x - mob.x), range: ab.range } });
            used = true;
          }

          // ── CAVE SPIDER WEB SPIT — ranged slow ──
          if (ab.name === 'web_spit' && nearestDist > 60 && nearestDist < ab.range) {
            this.rpgSendTo(nearestPlayer.username, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'web_spit', duration: ab.slowDuration, slowMult: ab.slowMult, targetUser: nearestPlayer.username } });
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'web_spit', x: mob.x, y: mob.y, tx: nearestPlayer.x, ty: nearestPlayer.y } });
            used = true;
          }

          // ── STONE GOLEM GROUND SLAM — AoE stun + damage ──
          if (ab.name === 'ground_slam' && nearestDist < 70) {
            for (const pl of playersInZone) {
              const pdx = pl.x - mob.x, pdy = pl.y - mob.y;
              const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
              if (pDist < ab.radius) {
                const p2 = this.player(pl.username);
                const def2 = this.armorDefBonus(p2);
                const sdmg = Math.max(1, Math.floor(effectiveAtk * ab.dmgMult) - def2);
                pl.rp.hp = Math.max(0, pl.rp.hp - sdmg);
                this.rpgSendTo(pl.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg: sdmg, hp: pl.rp.hp, maxHP: pl.rp.maxHP } });
                // Stun the player
                this.rpgSendTo(pl.username, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'ground_slam', stunDuration: ab.stunDuration, targetUser: pl.username } });
                if (pl.rp.hp <= 0) {
                  const lost = Math.floor(p2.gold * 0.02);
                  p2.gold = Math.max(0, p2.gold - lost); this.saveData();
                  this.rpgSendTo(pl.username, { type: 'rpg_death', data: { goldLost: lost, gold: p2.gold } });
                  this.rpgResetBossesOnDeath(pl.username, zoneId);
                  pl.rp.zone = 'hub'; pl.rp.hp = pl.rp.maxHP;
                }
              }
            }
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'ground_slam', x: mob.x, y: mob.y, radius: ab.radius } });
            used = true;
          }

          // ── MIMIC ORE GOLD SCATTER — fake gold projectiles that damage ──
          if (ab.name === 'gold_scatter' && nearestDist < 120) {
            const scatterDmg = ab.dmgEach || 2;
            for (const pl of playersInZone) {
              const pdx = pl.x - mob.x, pdy = pl.y - mob.y;
              const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
              if (pDist < 130) {
                const p2 = this.player(pl.username);
                const totalDmg = scatterDmg * ab.count;
                pl.rp.hp = Math.max(0, pl.rp.hp - totalDmg);
                this.rpgSendTo(pl.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg: totalDmg, hp: pl.rp.hp, maxHP: pl.rp.maxHP } });
                if (pl.rp.hp <= 0) {
                  const lost = Math.floor(p2.gold * 0.02);
                  p2.gold = Math.max(0, p2.gold - lost); this.saveData();
                  this.rpgSendTo(pl.username, { type: 'rpg_death', data: { goldLost: lost, gold: p2.gold } });
                  this.rpgResetBossesOnDeath(pl.username, zoneId);
                  pl.rp.zone = 'hub'; pl.rp.hp = pl.rp.maxHP;
                }
              }
            }
            this.rpgSendTo(ownerUser, { type: 'rpg_mob_ability', data: { mobId: mob.id, ability: 'gold_scatter', x: mob.x, y: mob.y, count: ab.count } });
            used = true;
          }

          if (used) {
            // Elite/Champion use abilities more often
            const cdMult = mob.eliteTier === 'champion' ? 0.5 : mob.eliteTier === 'elite' ? 0.7 : 1.0;
            mob.nextAbility = now + Math.floor((ab.cd || 5000) * cdMult);
          }
        }

        // ── Life Drain heal on attack ──
        if (mob.abilityActive === 'life_drain' && mob.abilityEnd > now) {
          // Heal 2% maxHP per tick while life drain is active and chasing/attacking
          if (mob.state === 'chase' || mob.state === 'telegraph') {
            mob.hp = Math.min(mob.maxHP, mob.hp + mob.maxHP * 0.02 * dt);
          }
        }

        // ── Burn DOT tick (fire element) ──
        if (mob.burnEnd && now < mob.burnEnd && now >= mob.burnTickAt && !mob.dead) {
          mob.hp -= mob.burnDamage;
          mob.burnTickAt = now + 500;
          this.rpgSendTo(ownerUser, { type: 'rpg_mob_burn', data: { mobId: mob.id, dmg: mob.burnDamage, hp: mob.hp, maxHP: mob.maxHP } });
          if (mob.hp <= 0 && !mob.dead) {
            mob.dead = true;
            mob.respawnAt = now + 3000;
            const burnOwner = mob.burnOwner ? this.rpgGetPlayerData(mob.burnOwner) : null;
            if (burnOwner) {
              const goldBase = mob.goldMin + Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1));
              const gold = this.addGold(burnOwner, goldBase);
              const leveled = this.addXP(burnOwner, mob.xpReward);
              burnOwner.rpg.mobKills = (burnOwner.rpg.mobKills || 0) + 1;
              this.rpgSendTo(mob.burnOwner, { type: 'rpg_burn_kill', data: { mobId: mob.id, gold, xp: mob.xpReward, leveled, level: burnOwner.level, currentXP: burnOwner.xp, xpNeeded: this.xpNeeded(burnOwner), totalGold: burnOwner.gold } });
              this.rpgSendTo(ownerUser, { type: 'rpg_mob_died', data: { mobId: mob.id, killer: mob.burnOwner, eliteTier: mob.eliteTier || 'normal' } });
              this.saveData();
            }
          }
        }
        // ── Poison DOT tick (poison element) ──
        if (mob.poisonEnd && now < mob.poisonEnd && now >= mob.poisonTickAt && !mob.dead) {
          mob.hp -= mob.poisonDamage;
          mob.poisonTickAt = now + 500;
          this.rpgSendTo(ownerUser, { type: 'rpg_mob_poison', data: { mobId: mob.id, dmg: mob.poisonDamage, hp: mob.hp, maxHP: mob.maxHP } });
          if (mob.hp <= 0 && !mob.dead) {
            mob.dead = true;
            mob.respawnAt = now + 3000;
            const poisonOwner = mob.poisonOwner ? this.rpgGetPlayerData(mob.poisonOwner) : null;
            if (poisonOwner) {
              const goldBase = mob.goldMin + Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1));
              const gold = this.addGold(poisonOwner, goldBase);
              const leveled = this.addXP(poisonOwner, mob.xpReward);
              poisonOwner.rpg.mobKills = (poisonOwner.rpg.mobKills || 0) + 1;
              this.rpgSendTo(mob.poisonOwner, { type: 'rpg_poison_kill', data: { mobId: mob.id, gold, xp: mob.xpReward, leveled, level: poisonOwner.level, currentXP: poisonOwner.xp, xpNeeded: this.xpNeeded(poisonOwner), totalGold: poisonOwner.gold } });
              this.rpgSendTo(ownerUser, { type: 'rpg_mob_died', data: { mobId: mob.id, killer: mob.poisonOwner, eliteTier: mob.eliteTier || 'normal' } });
              this.saveData();
            }
          }
        }

        if (moved) movedMobs.push({ id: mob.id, x: Math.round(mob.x), y: Math.round(mob.y), s: mob.state, f: mob.facing });
      }

      // Send mob movements to the owning player only
      if (movedMobs.length > 0) {
        this.rpgSendTo(ownerUser, { type: 'rpg_mob_move', data: movedMobs });
      }
      } // end per-player mob loop
    }

    // ═══ HORDE MOB AI — shared mobs for mob_invasion event ═══
    if (this.activeWorldEvent && this.activeWorldEvent.eventType === 'mob_invasion' && this.activeWorldEvent.hordeMobs) {
      const now2 = Date.now();
      const dt2 = 0.2;
      const hordeMobs = this.activeWorldEvent.hordeMobs;
      // Gather all players in hub
      const hubPlayers = [];
      for (const [u, urp] of Object.entries(this.rpgPlayers)) {
        if (urp.disconnected || urp.zone !== 'hub' || urp.hp <= 0 || urp.godMode) continue;
        hubPlayers.push({ username: u, x: urp.x || 400, y: urp.y || 200, rp: urp });
      }
      const hordeMovedMobs = [];
      for (const mob of hordeMobs) {
        if (mob.dead) continue;
        const chaseSpd = (mob.chaseSpeed || 1.0) * 40 * dt2;
        const aggroR = mob.aggroRange || 150;
        let moved = false;
        // Find nearest hub player
        let nearest = null, nearDist = Infinity;
        for (const pl of hubPlayers) {
          const dx = pl.x - mob.x, dy = pl.y - mob.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearDist) { nearDist = d; nearest = pl; }
        }
        // Chase nearest player
        if (nearest && nearDist < aggroR && nearDist > 40) {
          const dx = nearest.x - mob.x, dy = nearest.y - mob.y;
          const d = nearDist || 1;
          mob.x += (dx / d) * chaseSpd;
          mob.y += (dy / d) * chaseSpd;
          mob.facing = dx > 0 ? 1 : -1;
          mob.state = 'chase';
          moved = true;
        }
        // Attack if close enough
        if (nearest && nearDist <= 50 && now2 >= (mob.lastAtk || 0)) {
          const p = this.player(nearest.username);
          const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && now2 < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
          let dmg = Math.max(1, mob.atk - Math.floor(Math.random() * 3) - def);
          let blocked = false, parried = false;
          if (nearest.rp.blocking) {
            if (now2 - nearest.rp.blockStart < 250) {
              parried = true; dmg = 0;
              mob.lastAtk = now2 + 1500;
            } else {
              blocked = true; dmg = Math.max(1, Math.floor(dmg * 0.5));
            }
          }
          nearest.rp.hp = Math.max(0, nearest.rp.hp - dmg);
          this.rpgSendTo(nearest.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg, hp: nearest.rp.hp, maxHP: nearest.rp.maxHP, blocked, parried } });
          mob.lastAtk = now2 + (mob.atkCD || 2000);
          mob.state = 'attack';
          if (nearest.rp.hp <= 0) {
            const lost = Math.floor(p.gold * 0.02);
            p.gold = Math.max(0, p.gold - lost); this.saveData();
            this.rpgSendTo(nearest.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
            nearest.rp.zone = 'hub'; nearest.rp.hp = nearest.rp.maxHP;
          }
        }
        // Random wander if no targets
        if (!nearest || nearDist >= aggroR) {
          if (!mob.wanderTarget || now2 > (mob.nextWander || 0)) {
            mob.wanderTarget = { x: mob.homeX + (Math.random() - 0.5) * 200, y: mob.homeY + (Math.random() - 0.5) * 200 };
            mob.nextWander = now2 + 3000 + Math.random() * 3000;
          }
          const wdx = mob.wanderTarget.x - mob.x, wdy = mob.wanderTarget.y - mob.y;
          const wd = Math.sqrt(wdx * wdx + wdy * wdy);
          if (wd > 5) {
            const step = Math.min((mob.moveSpeed || 0.5) * 40 * dt2, wd);
            mob.x += (wdx / wd) * step; mob.y += (wdy / wd) * step;
            mob.facing = wdx > 0 ? 1 : -1;
            mob.state = 'idle';
            moved = true;
          }
        }
        if (moved) hordeMovedMobs.push({ id: mob.id, x: Math.round(mob.x), y: Math.round(mob.y), s: mob.state, f: mob.facing });
      }
      // Broadcast horde mob movements to ALL hub players
      if (hordeMovedMobs.length > 0) {
        for (const [u, urp] of Object.entries(this.rpgPlayers)) {
          if (urp.disconnected || urp.zone !== 'hub') continue;
          this.rpgSendTo(u, { type: 'rpg_mob_move', data: hordeMovedMobs });
        }
      }
    }

    // ═══ BOUNTY BOSS AI — Gilded Hoarder ═══
    if (this.activeWorldEvent && this.activeWorldEvent.eventType === 'bounty_hunt' && this.activeWorldEvent.bountyBoss) {
      const bb = this.activeWorldEvent.bountyBoss;
      if (!bb.dead) {
        const now2 = Date.now();
        const dt2 = 0.2;
        const cfg = this.activeWorldEvent.config;
        const attacks = cfg.attacks || [];
        // Gather all players in boss zone
        const zonePlayers = [];
        for (const [u, urp] of Object.entries(this.rpgPlayers)) {
          if (urp.disconnected || urp.zone !== bb.zone || urp.hp <= 0 || urp.godMode) continue;
          zonePlayers.push({ username: u, x: urp.x || 400, y: urp.y || 200, rp: urp });
        }
        // Phase speed multipliers
        const spdMult = bb.phase === 'desperate' ? 1.2 : bb.phase === 'enraged' ? 1.1 : 1.0;
        const cdMult = bb.phase === 'desperate' ? 0.8 : bb.phase === 'enraged' ? 0.9 : 1.0;
        // Find nearest player
        let nearest = null, nearDist = Infinity;
        for (const pl of zonePlayers) {
          const dx = pl.x - bb.x, dy = pl.y - bb.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearDist) { nearDist = d; nearest = pl; }
        }
        let moved = false;
        // Currently telegraphing an attack
        if (bb.currentAttack) {
          const atk = bb.currentAttack;
          if (now2 >= atk.telegraphEnd) {
            // Execute the attack — damage all players in range
            for (const pl of zonePlayers) {
              const pdx = pl.x - atk.targetX, pdy = pl.y - atk.targetY;
              const pd = Math.sqrt(pdx * pdx + pdy * pdy);
              const r = atk.radius || 120;
              if (pd <= r) {
                const pData = this.player(pl.username);
                const def = this.armorDefBonus(pData) + ((pData.rpg && pData.rpg.buffDef && now2 < pData.rpg.buffDef.expires) ? pData.rpg.buffDef.value : 0);
                let admg = Math.max(1, atk.dmg - def);
                let blocked = false, parried = false;
                if (pl.rp.blocking) {
                  if (now2 - pl.rp.blockStart < 250) { parried = true; admg = 0; }
                  else { blocked = true; admg = Math.max(1, Math.floor(admg * 0.5)); }
                }
                if (bb.phase === 'enraged') admg = Math.floor(admg * 1.15);
                if (bb.phase === 'desperate') admg = Math.floor(admg * 1.3);
                pl.rp.hp = Math.max(0, pl.rp.hp - admg);
                this.rpgSendTo(pl.username, { type: 'rpg_bounty_boss_attack', data: {
                  bossId: bb.id, attack: atk.name, dmg: admg, hp: pl.rp.hp, maxHP: pl.rp.maxHP,
                  blocked, parried, type: atk.type, bossX: Math.round(bb.x), bossY: Math.round(bb.y),
                  targetX: Math.round(atk.targetX), targetY: Math.round(atk.targetY), radius: r,
                }});
                if (pl.rp.hp <= 0) {
                  const lost = Math.floor(pData.gold * 0.02);
                  pData.gold = Math.max(0, pData.gold - lost); this.saveData();
                  this.rpgSendTo(pl.username, { type: 'rpg_death', data: { goldLost: lost, gold: pData.gold } });
                  pl.rp.zone = 'hub'; pl.rp.hp = pl.rp.maxHP;
                }
              }
            }
            // Broadcast attack land to all in zone for VFX
            for (const [u, urp] of Object.entries(this.rpgPlayers)) {
              if (urp.disconnected || urp.zone !== bb.zone) continue;
              this.rpgSendTo(u, { type: 'rpg_bounty_boss_attack_land', data: {
                bossId: bb.id, attack: atk.name, type: atk.type,
                bossX: Math.round(bb.x), bossY: Math.round(bb.y),
                targetX: Math.round(atk.targetX), targetY: Math.round(atk.targetY),
                radius: atk.radius || 120, count: atk.count || 0, range: atk.range || 0,
              }});
            }
            bb.currentAttack = null;
          }
        }
        // Choose next attack
        else if (nearest && nearDist < bb.aggroRange && now2 >= (bb.lastAtk || 0)) {
          // Pick a random available attack
          const available = attacks.filter(a => {
            const lastUsed = bb.lastAbility[a.name] || 0;
            return now2 >= lastUsed + (a.cd * cdMult);
          });
          if (available.length > 0) {
            const atk = available[Math.floor(Math.random() * available.length)];
            bb.lastAbility[atk.name] = now2;
            bb.lastAtk = now2 + atk.telegraph + 500;
            bb.currentAttack = {
              name: atk.name, type: atk.type,
              targetX: nearest.x, targetY: nearest.y,
              radius: atk.radius || 120, dmg: atk.dmg || bb.atk,
              startedAt: now2, telegraphEnd: now2 + atk.telegraph,
              count: atk.count || 0, range: atk.range || 0,
            };
            // Send telegraph to all players in zone
            for (const [u, urp] of Object.entries(this.rpgPlayers)) {
              if (urp.disconnected || urp.zone !== bb.zone) continue;
              this.rpgSendTo(u, { type: 'rpg_bounty_boss_telegraph', data: {
                bossId: bb.id, attack: atk.name, type: atk.type,
                targetX: Math.round(nearest.x), targetY: Math.round(nearest.y),
                radius: atk.radius || 120, duration: atk.telegraph,
                count: atk.count || 0, range: atk.range || 0,
              }});
            }
            bb.state = 'attack';
          }
        }
        // Chase nearest player when not attacking
        if (!bb.currentAttack && nearest && nearDist < bb.aggroRange && nearDist > 60) {
          const chaseSpd = (bb.chaseSpeed * spdMult) * 40 * dt2;
          const dx = nearest.x - bb.x, dy = nearest.y - bb.y;
          const d = nearDist || 1;
          bb.x += (dx / d) * chaseSpd;
          bb.y += (dy / d) * chaseSpd;
          bb.facing = dx > 0 ? 1 : -1;
          bb.state = 'chase';
          moved = true;
        }
        // Wander when no targets
        if (!nearest || nearDist >= bb.aggroRange) {
          if (!bb.currentAttack) {
            if (!bb.wanderTarget || now2 > (bb.nextWander || 0)) {
              bb.wanderTarget = { x: bb.homeX + (Math.random() - 0.5) * 300, y: bb.homeY + (Math.random() - 0.5) * 300 };
              bb.nextWander = now2 + 3000 + Math.random() * 3000;
            }
            const wdx = bb.wanderTarget.x - bb.x, wdy = bb.wanderTarget.y - bb.y;
            const wd = Math.sqrt(wdx * wdx + wdy * wdy);
            if (wd > 5) {
              const step = Math.min(bb.moveSpeed * 40 * dt2, wd);
              bb.x += (wdx / wd) * step; bb.y += (wdy / wd) * step;
              bb.facing = wdx > 0 ? 1 : -1;
              bb.state = 'idle';
              moved = true;
            }
          }
        }
        // Burn/poison DOT
        if (bb.burnEnd && now2 < bb.burnEnd && now2 >= (bb.lastBurnTick || 0) + 1000) {
          bb.hp -= (bb.burnDmg || 8); bb.lastBurnTick = now2;
        }
        if (bb.poisonEnd && now2 < bb.poisonEnd && now2 >= (bb.lastPoisonTick || 0) + 1000) {
          bb.hp -= (bb.poisonDmg || 5); bb.lastPoisonTick = now2;
        }
        // Broadcast movement to all players in zone
        if (moved || bb.currentAttack) {
          for (const [u, urp] of Object.entries(this.rpgPlayers)) {
            if (urp.disconnected || urp.zone !== bb.zone) continue;
            this.rpgSendTo(u, { type: 'rpg_bounty_boss_move', data: {
              id: bb.id, x: Math.round(bb.x), y: Math.round(bb.y), s: bb.state, f: bb.facing, phase: bb.phase,
            }});
          }
        }
      }
    }
  }

  rpgMakeMob(zoneId, idx, preferName, questBias) {
    const zone = RPG_ZONES[zoneId];
    const templates = zone.mobs;
    // ── Elite/Champion tier promotion ──
    // 3% Elite (gold), 0.5% Champion (purple) — stronger stats, better loot
    function rollEliteTier() {
      const r = Math.random();
      if (r < 0.005) return 'champion';
      if (r < 0.035) return 'elite';
      return 'normal';
    }
    function applyEliteTier(mob, tier) {
      mob.eliteTier = tier;
      if (tier === 'elite') {
        mob.name = '⭐ ' + mob.name;
        mob.maxHP = Math.floor(mob.maxHP * 2);
        mob.hp = mob.maxHP;
        mob.atk = Math.floor(mob.atk * 1.5);
        mob.goldMin = Math.floor(mob.goldMin * 2);
        mob.goldMax = Math.floor(mob.goldMax * 2);
        mob.xpReward = Math.floor(mob.xpReward * 2);
      } else if (tier === 'champion') {
        mob.name = '👑 ' + mob.name;
        mob.maxHP = Math.floor(mob.maxHP * 3.5);
        mob.hp = mob.maxHP;
        mob.atk = Math.floor(mob.atk * 2);
        mob.goldMin = Math.floor(mob.goldMin * 3);
        mob.goldMax = Math.floor(mob.goldMax * 3);
        mob.xpReward = Math.floor(mob.xpReward * 3);
      }
      return mob;
    }
    // Goblin camp mobs: last 2 slots in forest are always goblins in the SW camp
    // Spread wider + lower aggro so they don't all rush at once
    if (zoneId === 'forest' && idx >= zone.mobCount - 2) {
      const goblinT = templates.find(t => t.name === 'Goblin') || templates[1];
      const campX1 = 2 * 40, campY1 = 40 * 40, campX2 = 18 * 40, campY2 = 56 * 40;
      let x = campX1 + 40 + Math.random() * (campX2 - campX1 - 80);
      let y = campY1 + 40 + Math.random() * (campY2 - campY1 - 80);
      const now = Date.now();
      const tier = rollEliteTier();
      const mob = {
        id: `${zoneId}_m${idx}`, ...goblinT, hp: goblinT.maxHP, x, y, dead: false, respawnAt: 0, templateName: goblinT.name,
        spawnX: x, spawnY: y, state: 'idle', targetUser: null, facing: 1,
        wanderX: x, wanderY: y, nextWander: now + 2000 + Math.random() * 3000,
        nextAttack: now + (goblinT.atkCD || 2000), retreatUntil: 0,
        telegraphEnd: 0, telegraphTarget: null,
        nextAbility: now + 5000 + Math.random() * 3000, abilityActive: null, abilityEnd: 0, hasSplit: false,
        eliteTier: 'normal',
        aggroRange: 75, leashRange: 160,
      };
      return applyEliteTier(mob, tier);
    }
    // Prefer same mob type on respawn if available
    let t;
    if (preferName) {
      t = templates.find(tp => tp.name === preferName);
    }
    // Quest-biased template selection: 60% chance to pick quest target mob
    if (!t && questBias) {
      const biasT = templates.find(tp => tp.name.toLowerCase() === questBias.toLowerCase());
      if (biasT && Math.random() < 0.6) t = biasT;
    }
    if (!t) t = templates[Math.floor(Math.random() * templates.length)];
    let x = 200 + Math.random() * 2000, y = 150 + Math.random() * 1100;
    const w = this.rpgWorld[zoneId];
    if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
    // Keep mobs out of boss arenas
    if (zone.boss) {
      const dx = x - zone.boss.arenaX, dy = y - zone.boss.arenaY;
      if (Math.sqrt(dx * dx + dy * dy) < zone.boss.arenaRadius + 40) {
        x = 200 + Math.random() * 2000; y = 150 + Math.random() * 1100;
        if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
      }
    }
    if (zone.secondaryBosses) {
      for (const sb of zone.secondaryBosses) {
        const dx = x - sb.arenaX, dy = y - sb.arenaY;
        if (Math.sqrt(dx * dx + dy * dy) < sb.arenaRadius + 40) {
          x = 200 + Math.random() * 2000; y = 150 + Math.random() * 1100;
          if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
          break;
        }
      }
    }
    const now = Date.now();
    const tier = rollEliteTier();
    const mob = {
      id: `${zoneId}_m${idx}`, ...t, hp: t.maxHP, x, y, dead: false, respawnAt: 0, templateName: t.name,
      spawnX: x, spawnY: y, state: 'idle', targetUser: null, facing: 1,
      wanderX: x, wanderY: y, nextWander: now + 2000 + Math.random() * 3000,
      nextAttack: now + (t.atkCD || 2000), retreatUntil: 0,
      telegraphEnd: 0, telegraphTarget: null,
      nextAbility: now + 5000 + Math.random() * 3000, abilityActive: null, abilityEnd: 0, hasSplit: false,
      eliteTier: 'normal',
    };
    return applyEliteTier(mob, tier);
  }

  rpgWeightedDrop(drops) {
    const total = drops.reduce((s, d) => s + d.weight, 0);
    let r = Math.random() * total;
    for (const d of drops) {
      r -= d.weight;
      if (r <= 0) return d;
    }
    return drops[0];
  }

  rpgTick() {
    const now = Date.now();
    const zoneKeys = Object.keys(this.rpgWorld);

    // Expire old market listings (every 60s check, 7-day expiry)
    if (!this._lastMarketCleanup || now - this._lastMarketCleanup > 60000) {
      this._lastMarketCleanup = now;
      const expiryMs = 7 * 24 * 60 * 60 * 1000;
      const before = this.market.length;
      this.market = this.market.filter(l => {
        if (l.listedAt && now - l.listedAt > expiryMs) {
          // Return item to seller's inventory
          const p = this.players[l.seller];
          if (p && l.itemData) { (p.inventory || (p.inventory = [])).push(l.itemData); }
          return false;
        }
        return true;
      });
      if (this.market.length < before) this.saveData();
    }

    // Clean up stale disconnected rpgPlayers entries (10-minute timeout)
    if (!this._lastStaleCleanup || now - this._lastStaleCleanup > 60000) {
      this._lastStaleCleanup = now;
      for (const [u, rp] of Object.entries(this.rpgPlayers)) {
        if (rp.disconnected && rp._savedTime && now - rp._savedTime > 600000) {
          // Don't clean up dungeon players (they have their own cleanup)
          if (rp._savedZone && this.rpgDungeonInstances[rp._savedZone]) continue;
          delete this.rpgPlayers[u];
        }
      }
    }

    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      const zone = RPG_ZONES[zoneId];
      // Respawn mined nodes
      if (w.nodes) {
        for (let i = 0; i < w.nodes.length; i++) {
          if (w.nodes[i].mined && now >= w.nodes[i].respawnAt) {
            w.nodes[i] = this.rpgMakeNode(zoneId, i);
            this.rpgBroadcastZone(zoneId, { type: 'rpg_node_spawn', data: w.nodes[i] });
          }
        }
      }
      // Respawn dead mobs (per-player instances)
      if (w.playerMobs) {
        for (const [pmUser, mobs] of Object.entries(w.playerMobs)) {
          const pmRp = this.rpgPlayers[pmUser];
          if (!pmRp || pmRp.zone !== zoneId) continue;
          const questBias = pmRp.questBias || null;
          for (let i = 0; i < mobs.length; i++) {
            if (mobs[i].dead && now >= mobs[i].respawnAt) {
              mobs[i] = this.rpgMakeMob(zoneId, i, null, questBias);
              this.rpgSendTo(pmUser, { type: 'rpg_mob_spawn', data: mobs[i] });
            }
          }
        }
      }
      // Mob attacks now handled by rpgMobAI() tick
      // Sapling auto-attack nearby players (per-player saplings)
      if (w.playerBosses) {
        for (const [pbUser, pb] of Object.entries(w.playerBosses)) {
          if (!pb.saplings) continue;
          const rp = this.rpgPlayers[pbUser];
          if (!rp || rp.zone !== zoneId || !rp.hp || rp.hp <= 0 || rp.godMode) continue;
          for (const sap of pb.saplings) {
            if (sap.dead) continue;
            const dx = (rp.x || 400) - sap.x, dy = (rp.y || 200) - sap.y;
            if (Math.sqrt(dx * dx + dy * dy) < 80) {
              const p = this.player(pbUser);
              const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
              const dmg = Math.max(1, sap.atk - Math.floor(Math.random() * 2) - def);
              rp.hp = Math.max(0, rp.hp - dmg);
              const armorResult = this.degradeEquipped(p, 'armor', 1);
              this.rpgSendTo(pbUser, { type: 'rpg_mob_attack', data: { mobId: sap.id, dmg, hp: rp.hp, maxHP: rp.maxHP, armorBroke: armorResult && armorResult.broken ? armorResult.name : null } });
              if (rp.hp <= 0) {
                const lost = Math.floor(p.gold * 0.02);
                p.gold = Math.max(0, p.gold - lost);
                this.saveData();
                this.rpgSendTo(pbUser, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
                this.rpgResetBossesOnDeath(pbUser, zoneId);
                rp.zone = 'hub'; rp.hp = rp.maxHP;
              }
            }
          }
          pb.saplings = pb.saplings.filter(s => !s.dead || Date.now() < s.respawnAt);
        }
      }
      // Boss respawn (per-player)
      if (w.playerBosses) {
        for (const [pbUser, pb] of Object.entries(w.playerBosses)) {
          const rp = this.rpgPlayers[pbUser];
          if (!rp || rp.zone !== zoneId) continue;
          if (pb.boss && pb.boss.dead && now >= pb.boss.respawnAt) {
            pb.boss = this.rpgMakeBoss(zoneId);
            pb.saplings = [];
            this.rpgSendTo(pbUser, { type: 'rpg_boss_spawn', data: this.rpgGetBossData(pb.boss) });
          }
          if (pb.secondaryBosses) {
            // Secondary boss respawn handled in rpgBossTick
          }
        }
      }
    }
    // Community milestone check (every tick = ~3s)
    this.rpgCheckMilestones();

    // ── Ore Caravan tick ──
    if (this.activeCaravan && now > this.activeCaravan.expiresAt) {
      this.rpgEndCaravan();
    }
    if (!this.activeCaravan) {
      if (!this.nextCaravanAt) {
        this.nextCaravanAt = now + CARAVAN_CONFIG.intervalMin + Math.random() * (CARAVAN_CONFIG.intervalMax - CARAVAN_CONFIG.intervalMin);
      }
      if (now >= this.nextCaravanAt) {
        this.rpgStartCaravan();
        this.nextCaravanAt = 0; // will reset after caravan ends
      }
    }

    // ── Expire stale pending mines (>10s) ──
    if (this.pendingMines) {
      for (const [u, pm] of Object.entries(this.pendingMines)) {
        if (now - pm.createdAt > 10000) delete this.pendingMines[u];
      }
    }

    // ── World Event tick ──
    if (this.activeWorldEvent && now > this.activeWorldEvent.expiresAt) {
      this.rpgEndWorldEvent();
    }
    if (!this.activeWorldEvent) {
      if (this.nextWorldEventAt && now >= this.nextWorldEventAt) {
        this.rpgStartRandomWorldEvent();
      }
    }

    // ── Duel queue fallback matching (cross-bracket after 5s) ──
    if (this.rpgDuelQueue.length >= 2) {
      const oldest = this.rpgDuelQueue[0];
      const rp0 = this.rpgPlayers[oldest];
      if (rp0 && rp0._duelQueuedAt && now - rp0._duelQueuedAt > 5000) {
        // Match any two players regardless of bracket
        const u1 = this.rpgDuelQueue.shift();
        const u2 = this.rpgDuelQueue.shift();
        if (u1 && u2) this.rpgDuelStart(u1, u2);
      }
    }

    // ── Expire stale duel challenges (30s) ──
    for (const [cId, ch] of Object.entries(this.rpgDuelChallenges)) {
      if (now - ch.timestamp > 30000) {
        this.rpgSendTo(ch.challenger, { type: 'rpg_duel_challenge_expired', data: { target: ch.defender } });
        delete this.rpgDuelChallenges[cId];
      }
    }
  }

  rpgGetBossData(boss) {
    if (!boss || boss.dead) return null;
    return {
      id: boss.id, name: boss.name, hp: boss.hp, maxHP: boss.maxHP,
      x: boss.x, y: boss.y, color: boss.color, phase: boss.phase,
      phaseName: boss.phaseName || '',
      sleeping: boss.sleeping || false,
      currentAttack: boss.currentAttack, attackTimer: boss.attackTimer,
      arenaRadius: boss.arenaRadius, homeX: boss.homeX, homeY: boss.homeY,
    };
  }

  rpgBossTick() {
    const now = Date.now();
    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      const zone = RPG_ZONES[zoneId];
      if (!w.playerBosses) continue;

      for (const [pbUser, pb] of Object.entries(w.playerBosses)) {
        const rp = this.rpgPlayers[pbUser];
        if (!rp || rp.zone !== zoneId || !rp.hp || rp.hp <= 0) continue;
        const nearP = { username: pbUser, rp, dist: 0 };

      // ═══ Main Boss Tick (per-player) ═══
      if (zone.boss && pb.boss && !pb.boss.dead) {
        const boss = pb.boss;
        const bCfg = zone.boss;

        const dx0 = (rp.x || 400) - boss.x, dy0 = (rp.y || 200) - boss.y;
        const nearD = Math.sqrt(dx0 * dx0 + dy0 * dy0);
        nearP.dist = nearD;

        // Sleeping boss — check wake proximity
        if (boss.sleeping) {
          if (nearD < (bCfg.wakeRadius || 120)) {
            boss.sleeping = false;
            boss.phaseName = 'Awakening';
            boss.globalCD = 5000;
            this.rpgSendTo(pbUser, { type: 'rpg_boss_wake', data: { id: boss.id, name: boss.name, cfgId: boss.cfgId } });
          }
        } else if (nearD > bCfg.arenaRadius) {
          boss.phase = 'idle';
          boss.targetPlayer = null;
          const dx = boss.homeX - boss.x, dy = boss.homeY - boss.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 5) {
            boss.x += (dx / d) * bCfg.chaseSpeed * 2;
            boss.y += (dy / d) * bCfg.chaseSpeed * 2;
            this.rpgSendTo(pbUser, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
          }
        } else {
          boss.targetPlayer = pbUser;
          boss.phase = 'combat';
          if (boss.globalCD > 0) boss.globalCD -= 200;

          // Phase system
          let speedMult = 1, dmgMult = 1, currentPhaseName = '';
          if (bCfg.phases) {
            const hpPct = boss.hp / boss.maxHP;
            for (const ph of bCfg.phases) {
              if (hpPct <= ph.hpPercent) { speedMult = ph.speedMult || 1; dmgMult = ph.dmgMult || 1; currentPhaseName = ph.name; }
            }
            if (currentPhaseName && boss.phaseName !== currentPhaseName) {
              boss.phaseName = currentPhaseName;
              this.rpgSendTo(pbUser, { type: 'rpg_boss_phase', data: { bossId: boss.id, phase: currentPhaseName, hp: boss.hp, maxHP: boss.maxHP } });
            }
            boss.dmgMult = dmgMult;
          }

          // Currently executing an attack — count down telegraph
          if (boss.currentAttack) {
            boss.attackTimer -= 200;
            // Burrow: move trail toward player during telegraph
            if (boss.currentAttack.type === 'burrow' && boss.burrowed) {
              const btx = rp.x || 400, bty = rp.y || 200;
              const bdx = btx - boss.currentAttack.burrowTrailX, bdy = bty - boss.currentAttack.burrowTrailY;
              const bd = Math.sqrt(bdx * bdx + bdy * bdy);
              const bspd = (boss.currentAttack.speed || 2.5) * 4;
              if (bd > 10) {
                boss.currentAttack.burrowTrailX += (bdx / bd) * bspd;
                boss.currentAttack.burrowTrailY += (bdy / bd) * bspd;
              }
              // Update snap position to where trail is (eruption point)
              boss.currentAttack.snapX = boss.currentAttack.burrowTrailX;
              boss.currentAttack.snapY = boss.currentAttack.burrowTrailY;
              this.rpgSendTo(pbUser, { type: 'rpg_boss_burrow_trail', data: {
                x: boss.currentAttack.burrowTrailX, y: boss.currentAttack.burrowTrailY,
                timer: boss.attackTimer, radius: boss.currentAttack.radius || 100,
              }});
            }
            if (boss.attackTimer <= 0) {
              const landingAtk = boss.currentAttack;
              boss.attackCooldowns[landingAtk.name] = now + landingAtk.cooldown;
              boss.currentAttack = null;
              boss.globalCD = 1000;
              try { this.rpgBossAttackLand(zoneId, boss, landingAtk, nearP, pbUser); } catch(e) { console.error('[BOSS ATTACK ERROR]', boss.id, landingAtk.name, e.message); }
            } else {
              this.rpgSendTo(pbUser, { type: 'rpg_boss_telegraph', data: {
                attack: boss.currentAttack.name, type: boss.currentAttack.type,
                timer: boss.attackTimer, maxTimer: boss.currentAttack.telegraphTime || 800,
                bossX: boss.x, bossY: boss.y,
                targetX: rp.x, targetY: rp.y,
                radius: boss.currentAttack.radius || 0,
                range: boss.currentAttack.range || 0, width: boss.currentAttack.width || 0,
              }});
            }
          } else {
            // Chase player
            if (nearD > 120) {
              const dx = rp.x - boss.x, dy = rp.y - boss.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              const spd = bCfg.chaseSpeed * speedMult;
              boss.x += (dx / d) * spd;
              boss.y += (dy / d) * spd;
              const adx = boss.x - boss.homeX, ady = boss.y - boss.homeY;
              const adist = Math.sqrt(adx * adx + ady * ady);
              if (adist > bCfg.arenaRadius) {
                boss.x = boss.homeX + (adx / adist) * bCfg.arenaRadius;
                boss.y = boss.homeY + (ady / adist) * bCfg.arenaRadius;
              }
              this.rpgSendTo(pbUser, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
            }

            // Pick an attack
            if (boss.globalCD <= 0) {
              const avail = bCfg.attacks.filter(a => {
                if (now < (boss.attackCooldowns[a.name] || 0)) return false;
                if (a.maxHpPct && (boss.hp / boss.maxHP) > a.maxHpPct) return false;
                return true;
              });
              if (avail.length > 0) {
                const atk = avail[Math.floor(Math.random() * avail.length)];
                if (atk.type === 'summon') {
                  this.rpgBossSummon(zoneId, boss, atk, pbUser);
                  boss.attackCooldowns[atk.name] = now + atk.cooldown;
                  boss.globalCD = 1500;
                } else if (atk.type === 'burrow') {
                  // Burrow: boss goes underground immediately
                  boss.burrowed = true;
                  boss.currentAttack = { ...atk, snapX: rp.x, snapY: rp.y, burrowTrailX: boss.x, burrowTrailY: boss.y };
                  boss.attackTimer = atk.telegraphTime + (atk.burrowDuration || 2200);
                  this.rpgSendTo(pbUser, { type: 'rpg_boss_burrow_start', data: {
                    bossX: boss.x, bossY: boss.y, targetX: rp.x, targetY: rp.y,
                    burrowDuration: atk.burrowDuration || 2200, telegraphTime: atk.telegraphTime || 1200,
                    radius: atk.radius || 100, speed: atk.speed || 2.5,
                  }});
                  boss.attackCooldowns[atk.name] = now + atk.cooldown;
                  boss.globalCD = 500;
                } else {
                  boss.currentAttack = { ...atk, snapX: rp.x, snapY: rp.y };
                  boss.attackTimer = atk.telegraphTime || 800;
                  this.rpgSendTo(pbUser, { type: 'rpg_boss_attack_start', data: {
                    attack: atk.name, type: atk.type,
                    telegraphTime: atk.telegraphTime || 800,
                    bossX: boss.x, bossY: boss.y,
                    targetX: rp.x, targetY: rp.y,
                    radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
                  }});
                }
              }
            }
          }

          // ═══ Acid Pool tick damage ═══
          if (boss.acidPools && boss.acidPools.length > 0) {
            const px2 = rp.x || 400, py2 = rp.y || 200;
            boss.acidPools = boss.acidPools.filter(pool => now < pool.expires);
            for (const pool of boss.acidPools) {
              const pdx = px2 - pool.x, pdy = py2 - pool.y;
              const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
              if (pdist < pool.radius && now - pool.lastTick >= pool.tickRate) {
                pool.lastTick = now;
                if (!rp.godMode) {
                  const p = this.player(pbUser);
                  const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
                  const dmg = Math.max(1, Math.floor(pool.dmg * (boss.dmgMult || 1)) - def);
                  rp.hp = Math.max(0, rp.hp - dmg);
                  this.rpgSendTo(pbUser, { type: 'rpg_boss_hit', data: { dmg, hp: rp.hp, maxHP: rp.maxHP, attack: 'Acid Pool', armorBroke: null }});
                  if (rp.hp <= 0) {
                    const lost = Math.floor(this.player(pbUser).gold * 0.03);
                    this.player(pbUser).gold = Math.max(0, this.player(pbUser).gold - lost);
                    this.saveData();
                    this.rpgSendTo(pbUser, { type: 'rpg_death', data: { goldLost: lost, gold: this.player(pbUser).gold } });
                    this.rpgResetBossesOnDeath(pbUser, zoneId);
                    rp.zone = 'hub'; rp.hp = rp.maxHP;
                  }
                }
              }
            }
            // Notify client of pool expiry
            if (boss.acidPools.length === 0) {
              this.rpgSendTo(pbUser, { type: 'rpg_boss_acid_pools_clear', data: {} });
            }
          }

          // ═══ Constrict ring check ═══
          if (boss.constrict) {
            const c = boss.constrict;
            const elapsed = now - c.startTime;
            if (elapsed >= c.duration && !c.hit) {
              c.hit = true;
              // Check if player is inside the final ring and NOT in the gap
              const px2 = rp.x || 400, py2 = rp.y || 200;
              const cdx = px2 - c.x, cdy = py2 - c.y;
              const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
              const playerAngle = Math.atan2(cdy, cdx);
              let angleDiff = playerAngle - c.gapDirection;
              while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
              while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
              const inGap = Math.abs(angleDiff) < c.gapAngle / 2;
              const trapped = cdist < c.endRadius + 30 && !inGap;
              // Also hit if player is still inside the shrunk ring (didn't escape)
              if (trapped || (cdist < c.startRadius && !inGap && cdist > c.endRadius - 10)) {
                // Player got constricted
                if (!rp.godMode) {
                  const p = this.player(pbUser);
                  const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
                  const dmg = Math.max(1, Math.floor(c.dmg * (boss.dmgMult || 1)) - def);
                  rp.hp = Math.max(0, rp.hp - dmg);
                  this.degradeEquipped(p, 'armor', 3);
                  this.rpgSendTo(pbUser, { type: 'rpg_boss_hit', data: { dmg, hp: rp.hp, maxHP: rp.maxHP, attack: 'Constrict', armorBroke: null }});
                  if (rp.hp <= 0) {
                    const lost = Math.floor(this.player(pbUser).gold * 0.03);
                    this.player(pbUser).gold = Math.max(0, this.player(pbUser).gold - lost);
                    this.saveData();
                    this.rpgSendTo(pbUser, { type: 'rpg_death', data: { goldLost: lost, gold: this.player(pbUser).gold } });
                    this.rpgResetBossesOnDeath(pbUser, zoneId);
                    rp.zone = 'hub'; rp.hp = rp.maxHP;
                  }
                }
              }
              this.rpgSendTo(pbUser, { type: 'rpg_boss_constrict_end', data: { hit: trapped || (cdist < c.startRadius && !inGap) } });
              boss.constrict = null;
            }
          }
        }
        // ── Boss Burn DOT tick ──
        if (boss.burnEnd && now < boss.burnEnd && now >= boss.burnTickAt && !boss.dead) {
          boss.hp -= boss.burnDamage;
          boss.burnTickAt = now + 500;
          this.rpgSendTo(pbUser, { type: 'rpg_boss_burn', data: { bossId: boss.id, dmg: boss.burnDamage, hp: boss.hp, maxHP: boss.maxHP } });
        }
        // ── Boss Poison DOT tick ──
        if (boss.poisonEnd && now < boss.poisonEnd && now >= boss.poisonTickAt && !boss.dead) {
          boss.hp -= boss.poisonDamage;
          boss.poisonTickAt = now + 500;
          this.rpgSendTo(pbUser, { type: 'rpg_boss_poison', data: { bossId: boss.id, dmg: boss.poisonDamage, hp: boss.hp, maxHP: boss.maxHP } });
        }
      } // end main boss tick

      // Sapling chasing — saplings pursue owner player only
      if (pb.saplings) {
        for (const sap of pb.saplings) {
          if (sap.dead) continue;
          const sdx = (rp.x || 400) - sap.x, sdy = (rp.y || 200) - sap.y;
          const sd = Math.sqrt(sdx * sdx + sdy * sdy);
          if (sd > 35 && sd < 350) {
            const spd = sap.chaseSpeed || 1.5;
            sap.x += (sdx / sd) * spd;
            sap.y += (sdy / sd) * spd;
          }
        }
        // Broadcast sapling positions periodically (every ~1s = 5 ticks at 200ms)
        if (!pb._sapBroadcastCD) pb._sapBroadcastCD = 0;
        pb._sapBroadcastCD--;
        if (pb._sapBroadcastCD <= 0) {
          pb._sapBroadcastCD = 5;
          const sapData = pb.saplings.filter(s => !s.dead).map(s => ({ id: s.id, x: s.x, y: s.y, hp: s.hp, maxHP: s.maxHP }));
          if (sapData.length > 0) {
            this.rpgSendTo(pbUser, { type: 'rpg_sapling_move', data: { saplings: sapData } });
          }
        }
      }

      // ═══ Secondary Boss Tick (per-player) ═══
      if (pb.secondaryBosses) {

        for (const sb of pb.secondaryBosses) {
         try {
          if (sb.dead) {
            if (now >= sb.respawnAt) {
              const sbCfg = zone.secondaryBosses.find(c => c.id === sb.cfgId);
              if (sbCfg) {
                Object.assign(sb, this.rpgMakeSecondaryBoss(zoneId, sbCfg));
                this.rpgSendTo(pbUser, { type: 'rpg_sboss_spawn', data: this.rpgGetSecondaryBossData(sb) });
              }
            }
            continue;
          }
          const sbCfg = zone.secondaryBosses.find(c => c.id === sb.cfgId);
          if (!sbCfg) continue;

          // NaN guard — reset to home if position got corrupted
          if (isNaN(sb.x) || isNaN(sb.y)) { sb.x = sb.homeX; sb.y = sb.homeY; sb.currentAttack = null; sb.attackTimer = 0; sb.globalCD = 1000; console.error('[SBOSS NaN RESET]', sb.id); }

          // Distance to owner player
          const sdx = (rp.x || 400) - sb.x, sdy = (rp.y || 200) - sb.y;
          const snearD = Math.sqrt(sdx * sdx + sdy * sdy);
          const snearP = nearP;

          // Sleeping boss — check if player is close enough to wake
          if (sb.sleeping) {
            let canWake = snearD < (sbCfg.wakeRadius || 120);
            if (canWake && sb.cfgId === 'goblin_king') {
              const ptx = Math.floor((rp.x || 400) / 40);
              const pty = Math.floor((rp.y || 200) / 40);
              if (!(ptx >= 48 && ptx <= 55 && pty >= 20 && pty <= 30)) canWake = false;
            }
            if (canWake) {
              sb.sleeping = false;
              sb.phaseName = 'Awakening';
              sb.globalCD = 5000;
              this.rpgSendTo(pbUser, { type: 'rpg_sboss_wake', data: { id: sb.id, name: sb.name, cfgId: sb.cfgId } });
            }
            continue;
          }

          // No player or out of arena — return home
          if (snearD > sbCfg.arenaRadius) {
            if (sb.phase === 'combat') console.log('[SBOSS IDLE]', sb.id, 'dist:', Math.round(snearD), 'arena:', sbCfg.arenaRadius, 'bossXY:', Math.round(sb.x), Math.round(sb.y));
            sb.phase = 'idle'; sb.targetPlayer = null;
            sb.currentAttack = null; sb.attackTimer = 0;
            const dx = sb.homeX - sb.x, dy = sb.homeY - sb.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 5) {
              sb.x += (dx / d) * (sbCfg.chaseSpeed || 1) * 2;
              sb.y += (dy / d) * (sbCfg.chaseSpeed || 1) * 2;
              this.rpgSendTo(pbUser, { type: 'rpg_sboss_move', data: { id: sb.id, x: sb.x, y: sb.y, phase: sb.phase } });
            }
            continue;
          }

          sb.targetPlayer = pbUser;
          sb.phase = 'combat';
          if (sb.globalCD > 0) sb.globalCD -= 200;

          // Debug: periodic state dump every ~5s
          if (!sb._debugTick) sb._debugTick = 0;
          sb._debugTick++;
          if (sb._debugTick % 25 === 0) {
            console.log('[SBOSS STATE]', sb.id, 'hp:', sb.hp+'/'+sb.maxHP, 'gcd:', sb.globalCD, 'atk:', sb.currentAttack ? sb.currentAttack.name : 'none', 'timer:', sb.attackTimer, 'dist:', Math.round(snearD), 'target:', pbUser, 'pos:', Math.round(sb.x)+','+Math.round(sb.y), 'enraged:', sb.enraged);
          }

          // Phase system
          let sSpd = 1, sDmg = 1, sPhaseName = '', sEnraged = false;
          if (sbCfg.phases) {
            const hpPct = sb.hp / sb.maxHP;
            for (const ph of sbCfg.phases) {
              if (hpPct <= ph.hpPercent) { sSpd = ph.speedMult || 1; sDmg = ph.dmgMult || 1; sPhaseName = ph.name; if (ph.enraged) sEnraged = true; }
            }
            if (sPhaseName && sb.phaseName !== sPhaseName) {
              sb.phaseName = sPhaseName;
              this.rpgSendTo(pbUser, { type: 'rpg_sboss_phase', data: { id: sb.id, phase: sPhaseName, hp: sb.hp, maxHP: sb.maxHP, enraged: sEnraged } });
            }
            sb.dmgMult = sDmg;
            sb.enraged = sEnraged;
          }

          // Attack in progress
          if (sb.currentAttack) {
            sb.attackTimer -= 200;
            if (sb.attackTimer <= 0) {
              const landingAtk = sb.currentAttack;
              const cdMult = sb.enraged ? 0.83 : 1;
              sb.attackCooldowns[landingAtk.name] = now + landingAtk.cooldown * cdMult;
              sb.currentAttack = null;
              sb.globalCD = sb.enraged ? 830 : 1000;
              try { this.rpgBossAttackLand(zoneId, sb, landingAtk, snearP, pbUser); } catch(e) { console.error('[SBOSS ATTACK ERROR]', sb.id, landingAtk.name, e.message); }
            } else {
              this.rpgSendTo(pbUser, { type: 'rpg_sboss_telegraph', data: {
                id: sb.id, attack: sb.currentAttack.name, type: sb.currentAttack.type,
                timer: sb.attackTimer, maxTimer: sb.currentAttack.telegraphTime || 800,
                bossX: sb.x, bossY: sb.y, targetX: rp.x, targetY: rp.y,
                radius: sb.currentAttack.radius || 0, range: sb.currentAttack.range || 0, width: sb.currentAttack.width || 0,
              }});
            }
            continue;
          }

          // Chase player (slower than main boss)
          const effSpeed = (sbCfg.chaseSpeed || 1) * sSpd * (sbCfg.moveSpeed || 0.5);
          if (snearD > 100) {
            const dx = rp.x - sb.x, dy = rp.y - sb.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            sb.x += (dx / d) * effSpeed;
            sb.y += (dy / d) * effSpeed;
            const adx = sb.x - sb.homeX, ady = sb.y - sb.homeY;
            const adist = Math.sqrt(adx * adx + ady * ady);
            if (adist > sbCfg.arenaRadius) {
              sb.x = sb.homeX + (adx / adist) * sbCfg.arenaRadius;
              sb.y = sb.homeY + (ady / adist) * sbCfg.arenaRadius;
            }
            this.rpgSendTo(pbUser, { type: 'rpg_sboss_move', data: { id: sb.id, x: sb.x, y: sb.y, phase: sb.phase } });
          }

          // Pick attack — enraged boss prefers dash attacks and has faster telegraphs
          if (sb.globalCD > 0) continue;
          const savail = sbCfg.attacks.filter(a => {
            if (now < (sb.attackCooldowns[a.name] || 0)) return false;
            if (a.maxHpPct && (sb.hp / sb.maxHP) > a.maxHpPct) return false;
            return true;
          });
          if (savail.length === 0) {
            if (sb._debugTick % 10 === 0) console.log('[SBOSS NO ATTACKS]', sb.id, 'cooldowns:', JSON.stringify(Object.fromEntries(Object.entries(sb.attackCooldowns).map(([k,v])=>[k, Math.max(0, v - now)]))));
          }
          if (savail.length > 0) {
            // Enraged: 70% chance to pick dash attacks if available
            let atk;
            if (sb.enraged) {
              const dashes = savail.filter(a => a.type === 'dash');
              atk = (dashes.length > 0 && Math.random() < 0.7) ? dashes[Math.floor(Math.random() * dashes.length)] : savail[Math.floor(Math.random() * savail.length)];
            } else {
              atk = savail[Math.floor(Math.random() * savail.length)];
            }
            const telegraphMult = sb.enraged ? 0.83 : 1;
            sb.currentAttack = { ...atk, snapX: rp.x, snapY: rp.y };
            sb.attackTimer = Math.floor((atk.telegraphTime || 800) * telegraphMult);
            this.rpgSendTo(pbUser, { type: 'rpg_sboss_attack_start', data: {
              id: sb.id, attack: atk.name, type: atk.type,
              telegraphTime: atk.telegraphTime || 800,
              bossX: sb.x, bossY: sb.y, targetX: rp.x, targetY: rp.y,
              radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
              spreadAngle: atk.spreadAngle || 0, knifeCount: atk.knifeCount || 0,
            }});
          }
         } catch (err) {
          console.error('[SBOSS TICK ERROR]', sb && sb.id, err.message, err.stack);
         }
        }
      }
      // ── Secondary Boss Burn/Poison DOT ticks ──
      if (pb.secondaryBosses) {
        for (const sb of pb.secondaryBosses) {
          if (sb.dead) continue;
          if (sb.burnEnd && now < sb.burnEnd && now >= sb.burnTickAt) {
            sb.hp -= sb.burnDamage; sb.burnTickAt = now + 500;
            this.rpgSendTo(pbUser, { type: 'rpg_sboss_burn', data: { bossId: sb.id, dmg: sb.burnDamage, hp: sb.hp, maxHP: sb.maxHP } });
          }
          if (sb.poisonEnd && now < sb.poisonEnd && now >= sb.poisonTickAt) {
            sb.hp -= sb.poisonDamage; sb.poisonTickAt = now + 500;
            this.rpgSendTo(pbUser, { type: 'rpg_sboss_poison', data: { bossId: sb.id, dmg: sb.poisonDamage, hp: sb.hp, maxHP: sb.maxHP } });
          }
        }
      }

      } // end per-player loop
    }
  }

  rpgGetSecondaryBossData(sb) {
    return {
      id: sb.id, cfgId: sb.cfgId, name: sb.name, hp: sb.hp, maxHP: sb.maxHP,
      x: sb.x, y: sb.y, color: sb.color, phase: sb.phase, phaseName: sb.phaseName,
      sleeping: sb.sleeping, arenaRadius: sb.arenaRadius, homeX: sb.homeX, homeY: sb.homeY,
      currentAttack: sb.currentAttack, attackTimer: sb.attackTimer,
    };
  }

  rpgBossAttackLand(zoneId, boss, atk, target, pbUser) {
    const px = target.rp.x || 400, py = target.rp.y || 200;
    let hit = false;
    if (atk.type === 'aoe') {
      const dx = px - boss.x, dy = py - boss.y;
      hit = Math.sqrt(dx * dx + dy * dy) < (atk.radius || 100);
    } else if (atk.type === 'line') {
      const sx = atk.snapX || px, sy = atk.snapY || py;
      const dx = sx - boss.x, dy = sy - boss.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / len, ny = dy / len;
      const ppx = px - boss.x, ppy = py - boss.y;
      const proj = ppx * nx + ppy * ny;
      if (proj > 0 && proj < (atk.range || 180)) {
        const perpDist = Math.sqrt((ppx - proj * nx) ** 2 + (ppy - proj * ny) ** 2);
        hit = perpDist < (atk.width || 40) / 2;
      }
    } else if (atk.type === 'dash') {
      // Dash: boss teleports along a line toward snap position, hits if player is in the dash corridor
      const sx = atk.snapX || px, sy = atk.snapY || py;
      const dx = sx - boss.x, dy = sy - boss.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / len, ny = dy / len;
      const ppx = px - boss.x, ppy = py - boss.y;
      const proj = ppx * nx + ppy * ny;
      if (proj > -30 && proj < (atk.range || 250)) {
        const perpDist = Math.sqrt((ppx - proj * nx) ** 2 + (ppy - proj * ny) ** 2);
        hit = perpDist < (atk.width || 50) / 2;
      }
      // Move boss forward along dash line
      const dashDist = Math.min(len, atk.range || 250);
      boss.x += nx * dashDist * 0.8;
      boss.y += ny * dashDist * 0.8;
      // Clamp to arena
      const arenaR = boss.arenaRadius || 240;
      const adx = boss.x - boss.homeX, ady = boss.y - boss.homeY;
      const adist = Math.sqrt(adx * adx + ady * ady);
      if (adist > arenaR) {
        boss.x = boss.homeX + (adx / adist) * arenaR;
        boss.y = boss.homeY + (ady / adist) * arenaR;
      }
      this.rpgSendTo(pbUser, { type: 'rpg_sboss_move', data: { id: boss.id, x: boss.x, y: boss.y, phase: boss.phase } });
    } else if (atk.type === 'spread') {
      // Spread: multiple projectiles in a fan from boss toward snap position
      const sx = atk.snapX || px, sy = atk.snapY || py;
      const baseAngle = Math.atan2(sy - boss.y, sx - boss.x);
      const count = atk.knifeCount || 3;
      const spread = atk.spreadAngle || 0.5;
      for (let i = 0; i < count; i++) {
        const a = baseAngle + (i - (count - 1) / 2) * spread;
        const nx = Math.cos(a), ny = Math.sin(a);
        const ppx = px - boss.x, ppy = py - boss.y;
        const proj = ppx * nx + ppy * ny;
        if (proj > 0 && proj < (atk.range || 200)) {
          const perpDist = Math.sqrt((ppx - proj * nx) ** 2 + (ppy - proj * ny) ** 2);
          if (perpDist < (atk.width || 30) / 2) { hit = true; break; }
        }
      }
    } else if (atk.type === 'bomb') {
      // Bomb: explosion at snap position
      const sx = atk.snapX || px, sy = atk.snapY || py;
      const dx = px - sx, dy = py - sy;
      hit = Math.sqrt(dx * dx + dy * dy) < (atk.radius || 100);
    } else if (atk.type === 'burrow') {
      // Burrow: boss erupts at current position — player must have dodged the trail
      // Boss teleported to player's snap position during telegraph, now check if player is in eruption radius
      const eruptX = atk.snapX || px, eruptY = atk.snapY || py;
      const dx = px - eruptX, dy = py - eruptY;
      hit = Math.sqrt(dx * dx + dy * dy) < (atk.radius || 100);
      // Move boss to eruption point
      boss.x = eruptX; boss.y = eruptY;
      // Unburrow
      boss.burrowed = false;
      // Clamp to arena
      const arenaR = boss.arenaRadius || 240;
      const adx = boss.x - boss.homeX, ady = boss.y - boss.homeY;
      const adist = Math.sqrt(adx * adx + ady * ady);
      if (adist > arenaR) { boss.x = boss.homeX + (adx / adist) * arenaR; boss.y = boss.homeY + (ady / adist) * arenaR; }
      this.rpgSendTo(pbUser, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
    } else if (atk.type === 'acid_pools') {
      // Acid Pools: spawn persistent pools around player position — no immediate hit
      // Damage comes from tick logic in rpgBossTick
      hit = false;
      const pools = [];
      const count = atk.poolCount || 4;
      const snapX = atk.snapX || px, snapY = atk.snapY || py;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist = 40 + Math.random() * 80;
        pools.push({
          x: snapX + Math.cos(angle) * dist,
          y: snapY + Math.sin(angle) * dist,
          radius: atk.poolRadius || 50,
          dmg: atk.dmg || 5,
          expires: Date.now() + (atk.poolDuration || 8000),
          lastTick: 0,
          tickRate: atk.tickRate || 1000,
        });
      }
      if (!boss.acidPools) boss.acidPools = [];
      boss.acidPools.push(...pools);
      this.rpgSendTo(pbUser, { type: 'rpg_boss_acid_pools', data: { pools: pools.map(p => ({ x: p.x, y: p.y, radius: p.radius, duration: atk.poolDuration || 8000 })) } });
    } else if (atk.type === 'constrict') {
      // Constrict: shrinking ring around player — damage checked after shrink duration via tick
      // Set up constrict state on boss
      const cx = atk.snapX || px, cy = atk.snapY || py;
      boss.constrict = {
        x: cx, y: cy,
        startRadius: atk.radius || 160,
        endRadius: 25,
        gapAngle: atk.gapAngle || 0.8,
        gapDirection: Math.random() * Math.PI * 2,
        startTime: Date.now(),
        duration: atk.shrinkDuration || 3000,
        dmg: atk.dmg || 35,
        hit: false,
      };
      this.rpgSendTo(pbUser, { type: 'rpg_boss_constrict', data: {
        x: cx, y: cy, startRadius: boss.constrict.startRadius, endRadius: boss.constrict.endRadius,
        gapAngle: boss.constrict.gapAngle, gapDirection: boss.constrict.gapDirection,
        duration: boss.constrict.duration
      }});
      hit = false; // Damage applied later
    }
    if (hit && !target.rp.godMode) {
      const p = this.player(target.username);
      const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
      const baseDmg = atk.dmg + Math.floor(Math.random() * 4);
      const scaledDmg = Math.floor(baseDmg * (boss.dmgMult || 1));
      let dmg = Math.max(1, scaledDmg - def);
      // Block / Parry check for boss attacks
      let blocked = false, parried = false;
      if (target.rp.blocking) {
        if (Date.now() - target.rp.blockStart < 250) {
          parried = true; dmg = Math.max(1, Math.floor(dmg * 0.25)); // parry reduces boss dmg by 75%
        } else {
          blocked = true; dmg = Math.max(1, Math.floor(dmg * 0.5));
        }
      }
      target.rp.hp = Math.max(0, target.rp.hp - dmg);
      // Boss hit degrades armor by 3
      const armorResult = this.degradeEquipped(p, 'armor', 3);
      this.rpgSendTo(target.username, { type: 'rpg_boss_hit', data: {
        dmg, hp: target.rp.hp, maxHP: target.rp.maxHP, attack: atk.name, blocked, parried,
        armorBroke: armorResult && armorResult.broken ? armorResult.name : null,
      }});
      if (target.rp.hp <= 0) {
        const lost = Math.floor(p.gold * 0.03);
        p.gold = Math.max(0, p.gold - lost);
        this.saveData();
        this.rpgSendTo(target.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
        this.rpgResetBossesOnDeath(target.username, target.rp.zone);
        target.rp.zone = 'hub'; target.rp.hp = target.rp.maxHP;
      }
    }
    this.rpgSendTo(pbUser, { type: 'rpg_boss_attack_land', data: {
      attack: atk.name, type: atk.type, hit,
      bossX: boss.x, bossY: boss.y,
      targetX: atk.snapX || px, targetY: atk.snapY || py,
      radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
      spreadAngle: atk.spreadAngle || 0, knifeCount: atk.knifeCount || 0,
    }});
  }

  rpgBossSummon(zoneId, boss, atk, pbUser) {
    const w = this.rpgWorld[zoneId];
    const pb = w.playerBosses && w.playerBosses[pbUser];
    if (!pb) return;
    if (!pb.saplings) pb.saplings = [];
    const alive = pb.saplings.filter(s => !s.dead).length;
    const toSpawn = Math.min(atk.count || 3, 6 - alive);
    const newSaps = [];
    for (let i = 0; i < toSpawn; i++) {
      const sap = this.rpgMakeSapling(zoneId, boss.x, boss.y, i);
      pb.saplings.push(sap);
      newSaps.push(sap);
    }
    this.rpgSendTo(pbUser, { type: 'rpg_boss_summon', data: { saplings: newSaps, bossX: boss.x, bossY: boss.y } });
  }

  rpgAttackBoss(username, bossId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const w = this.rpgWorld[rp.zone];
    const pb = w && w.playerBosses && w.playerBosses[username];
    if (!pb || !pb.boss || pb.boss.dead || pb.boss.id !== bossId) return { error: 'boss_gone' };
    if (pb.boss.sleeping) return { error: 'boss_sleeping' };
    if (pb.boss.burrowed) return { error: 'boss_burrowed' };
    const boss = pb.boss;
    const dx = (rp.x || 400) - boss.x, dy = (rp.y || 200) - boss.y;
    if (Math.sqrt(dx * dx + dy * dy) > 120) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);
    boss.hp -= dmg;
    // ── Enchant effects on boss ──
    let burn = false, poison = false, holy = false;
    const wepItem = (p.rpg.equipped && p.rpg.equipped.weapon) || {};
    const weaponId = wepItem.id || '';
    const wepDef = ITEMS[weaponId] || {};
    let activeEnchant = '';
    if (wepDef.enchant) { activeEnchant = wepDef.enchant; }
    else if (wepItem.enchantments) {
      for (const ench of wepItem.enchantments) {
        const edef = ENCHANTMENTS[ench.id];
        if (edef && edef.stat === 'elemental' && Math.random() < (edef.proc || 0.10)) { activeEnchant = edef.value; break; }
      }
    }
    if (activeEnchant === 'fire') {
      boss.burnDamage = 8; boss.burnEnd = Date.now() + 3000; boss.burnTickAt = Date.now() + 500; boss.burnOwner = username; burn = true;
    }
    if (activeEnchant === 'poison') {
      boss.poisonDamage = 5; boss.poisonEnd = Date.now() + 4000; boss.poisonTickAt = Date.now() + 500; boss.poisonOwner = username; poison = true;
    }
    if (activeEnchant === 'holy') {
      const holyDmg = Math.max(3, Math.floor(dmg * 0.15)); boss.hp -= holyDmg; holy = holyDmg;
    }
    // Lifesteal from enchantments
    let lifestealHeal = 0;
    const lsVal = this.equipStat(p, 'lifesteal');
    if (lsVal > 0) {
      lifestealHeal = Math.max(1, Math.floor(dmg * lsVal));
      const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
      rp.hp = Math.min(rp.hp + lifestealHeal, maxHP);
    }
    // Degrade weapon durability (boss hit = -3)
    const wepResult = this.degradeEquipped(p, 'weapon', 3);

    if (boss.hp <= 0) {
      boss.dead = true;
      const bossRespawnMult = this.rpgGetWorldEventMultiplier('bossRespawn');
      boss.respawnAt = Date.now() + Math.floor((RPG_ZONES[rp.zone].boss.respawnTime || 120000) * (bossRespawnMult < 1 ? bossRespawnMult : 1));
      this.communityMilestoneData.bossKills = (this.communityMilestoneData.bossKills || 0) + 1;
      if (pb.saplings) pb.saplings.forEach(s => { s.dead = true; });
      const zone = RPG_ZONES[rp.zone];
      const gold = this.addGold(p, zone.boss.goldReward || 150);
      const xpR = zone.boss.xpReward || 200;
      const leveled = this.addXP(p, xpR);
      // Award Vault Gold for boss kills
      const vgAward = zone.boss.vgReward || 0;
      if (vgAward > 0) { p.vaultGold = (p.vaultGold || 0) + vgAward; }
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      this.addTrust(p, 10);
      // Roll boss loot table
      const bossKey = zone.boss.name.toLowerCase().replace(/\s+/g, '_');
      const lootDrops = this.rollLootTable(bossKey);
      const droppedItems = [];
      const droppedWearables = [];
      for (const drop of lootDrops) {
        if (drop.wearable) {
          const w = WEARABLES[drop.itemId];
          if (w && !p.wearables.includes(drop.itemId)) {
            p.wearables.push(drop.itemId);
            droppedWearables.push({ id: drop.itemId, name: w.name, icon: w.icon, rarity: w.rarity, slot: w.slot });
          }
        } else {
          const added = this.addItemToInventory(p, drop.itemId, drop.qty);
          if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
        }
      }
      // Ancient Treant: guaranteed random epic/legendary/mythic cosmetic
      if (boss.cfgId === 'ancient_treant') {
        const epicPlus = Object.entries(WEARABLES).filter(([id, w]) => (w.rarity === 'epic' || w.rarity === 'legendary' || w.rarity === 'mythic') && !p.wearables.includes(id));
        if (epicPlus.length > 0) {
          const pick = epicPlus[Math.floor(Math.random() * epicPlus.length)];
          const [wId, wDef] = pick;
          p.wearables.push(wId);
          droppedWearables.push({ id: wId, name: wDef.name, icon: wDef.icon, rarity: wDef.rarity, slot: wDef.slot });
        }
      }
      // Crystal Burrower: guaranteed random uncommon+ cosmetic
      if (boss.cfgId === 'crystal_burrower') {
        const pool = Object.entries(WEARABLES).filter(([id, w]) => (w.rarity === 'uncommon' || w.rarity === 'rare' || w.rarity === 'epic') && !p.wearables.includes(id));
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const [wId, wDef] = pick;
          p.wearables.push(wId);
          droppedWearables.push({ id: wId, name: wDef.name, icon: wDef.icon, rarity: wDef.rarity, slot: wDef.slot });
        }
      }
      // Stone Guardian: guaranteed random rare/legendary/mythic cosmetic (harder boss = better loot)
      if (boss.cfgId === 'stone_guardian') {
        const pool = Object.entries(WEARABLES).filter(([id, w]) => (w.rarity === 'rare' || w.rarity === 'legendary' || w.rarity === 'mythic') && !p.wearables.includes(id));
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const [wId, wDef] = pick;
          p.wearables.push(wId);
          droppedWearables.push({ id: wId, name: wDef.name, icon: wDef.icon, rarity: wDef.rarity, slot: wDef.slot });
        }
      }
      // Hollow Sentinel: guaranteed random rare+ cosmetic
      if (boss.cfgId === 'hollow_sentinel') {
        const pool = Object.entries(WEARABLES).filter(([id, w]) => (w.rarity === 'rare' || w.rarity === 'epic' || w.rarity === 'legendary') && !p.wearables.includes(id));
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          const [wId, wDef] = pick;
          p.wearables.push(wId);
          droppedWearables.push({ id: wId, name: wDef.name, icon: wDef.icon, rarity: wDef.rarity, slot: wDef.slot });
        }
      }
      this.saveData();
      this.emitAchievements(username);
      this.logAction(username, 'rpg_boss_kill', boss.name + ' +' + gold + 'g +' + xpR + 'xp' + (vgAward ? ' +' + vgAward + 'VG' : '') + (droppedItems.length ? ' drops:' + droppedItems.map(d=>d.name).join(',') : ''));
      return { killed: true, dmg, crit, gold, xp: xpR, vgAward, leveled, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold, vaultGold: p.vaultGold || 0, mobName: boss.name, cfgId: boss.cfgId, drops: droppedItems, wearableDrops: droppedWearables, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, trust: p.rpg.trust, _zone: rp.zone, _bossId: boss.id };
    }
    return { hit: true, dmg, crit, bossHP: boss.hp, bossMaxHP: boss.maxHP, burn, poison, holy, lifesteal: lifestealHeal, hp: rp.hp, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
  }

  rpgWakeSecondaryBoss(username, sbossId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    const w = this.rpgWorld[rp.zone];
    const pb = w && w.playerBosses && w.playerBosses[username];
    if (!pb || !pb.secondaryBosses) return;
    const sb = pb.secondaryBosses.find(s => s.id === sbossId && !s.dead);
    if (!sb || !sb.sleeping) return;
    // Verify player is close enough
    const dx = (rp.x || 400) - sb.x, dy = (rp.y || 200) - sb.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 300) return; // too far
    sb.sleeping = false;
    sb.phaseName = 'Awakening';
    sb.globalCD = 2000;
    this.rpgSendTo(username, { type: 'rpg_sboss_wake', data: { id: sb.id, name: sb.name, cfgId: sb.cfgId } });
  }

  rpgAttackSecondaryBoss(username, sbossId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const w = this.rpgWorld[rp.zone];
    const pb = w && w.playerBosses && w.playerBosses[username];
    if (!pb || !pb.secondaryBosses) return { error: 'boss_gone' };
    const sb = pb.secondaryBosses.find(s => s.id === sbossId && !s.dead);
    if (!sb) return { error: 'boss_gone' };
    if (sb.sleeping) return { error: 'boss_sleeping' };
    const dx = (rp.x || 400) - sb.x, dy = (rp.y || 200) - sb.y;
    if (Math.sqrt(dx * dx + dy * dy) > 120) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);
    sb.hp -= dmg;
    // ── Enchant effects on secondary boss ──
    let burn = false, poison = false, holy = false;
    const wepItem = (p.rpg.equipped && p.rpg.equipped.weapon) || {};
    const weaponId = wepItem.id || '';
    const wepDef = ITEMS[weaponId] || {};
    let activeEnchant = '';
    if (wepDef.enchant) { activeEnchant = wepDef.enchant; }
    else if (wepItem.enchantments) {
      for (const ench of wepItem.enchantments) {
        const edef = ENCHANTMENTS[ench.id];
        if (edef && edef.stat === 'elemental' && Math.random() < (edef.proc || 0.10)) { activeEnchant = edef.value; break; }
      }
    }
    if (activeEnchant === 'fire') {
      sb.burnDamage = 8; sb.burnEnd = Date.now() + 3000; sb.burnTickAt = Date.now() + 500; sb.burnOwner = username; burn = true;
    }
    if (activeEnchant === 'poison') {
      sb.poisonDamage = 5; sb.poisonEnd = Date.now() + 4000; sb.poisonTickAt = Date.now() + 500; sb.poisonOwner = username; poison = true;
    }
    if (activeEnchant === 'holy') {
      const holyDmg = Math.max(3, Math.floor(dmg * 0.15)); sb.hp -= holyDmg; holy = holyDmg;
    }
    // Lifesteal from enchantments
    let lifestealHeal = 0;
    const lsValSB = this.equipStat(p, 'lifesteal');
    if (lsValSB > 0) {
      lifestealHeal = Math.max(1, Math.floor(dmg * lsValSB));
      const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
      rp.hp = Math.min(rp.hp + lifestealHeal, maxHP);
    }
    const wepResult = this.degradeEquipped(p, 'weapon', 3);

    if (sb.hp <= 0) {
      sb.dead = true;
      const zone = RPG_ZONES[rp.zone];
      const sbCfg = zone.secondaryBosses.find(c => c.id === sb.cfgId);
      sb.respawnAt = Date.now() + (sbCfg ? sbCfg.respawnTime : 120000);
      const gold = this.addGold(p, sbCfg ? sbCfg.goldReward : 100);
      const xpR = sbCfg ? sbCfg.xpReward : 150;
      const leveled = this.addXP(p, xpR);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      this.addTrust(p, 8);
      const bossKey = sb.name.toLowerCase().replace(/\s+/g, '_');
      const lootDrops = this.rollLootTable(bossKey);
      const droppedItems = [], droppedWearables = [];
      for (const drop of lootDrops) {
        if (drop.wearable) {
          const wr = WEARABLES[drop.itemId];
          if (wr && !p.wearables.includes(drop.itemId)) {
            p.wearables.push(drop.itemId);
            droppedWearables.push({ id: drop.itemId, name: wr.name, icon: wr.icon, rarity: wr.rarity, slot: wr.slot });
          }
        } else {
          const added = this.addItemToInventory(p, drop.itemId, drop.qty);
          if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
        }
      }
      this.saveData();
      return { killed: true, dmg, crit, gold, xp: xpR, leveled, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold, mobName: sb.name, drops: droppedItems, wearableDrops: droppedWearables, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, trust: p.rpg.trust, isSecondary: true, bossId: sb.id, cfgId: sb.cfgId, _zone: rp.zone };
    }
    return { hit: true, dmg, crit, bossHP: sb.hp, bossMaxHP: sb.maxHP, burn, poison, holy, lifesteal: lifestealHeal, hp: rp.hp, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, isSecondary: true, bossId: sb.id };
  }

  rpgGetPlayerData(username) {
    const p = this.player(username);
    if (!p.rpg) p.rpg = { miningLevel: 1, miningXP: 0, totalMined: 0, mobKills: 0, pickaxeTier: 1, trust: 0 };
    if (p.rpg.trust === undefined) p.rpg.trust = 0;
    if (!p.rpg.miningGear) p.rpg.miningGear = { helmet: null, gloves: null, boots: null };
    return p;
  }

  openGoblinChest(username) {
    const p = this.rpgGetPlayerData(username);
    const rp = this.rpgPlayers[username];
    if (!rp || rp.zone !== 'forest') return { error: 'wrong_zone' };
    if (p.rpg.goblinChestOpened) return { error: 'already_opened', msg: 'You\'ve already claimed the Goblin King\'s treasure.' };
    const keyIdx = p.inventory.findIndex(i => i.id === 'goblin_key');
    if (keyIdx === -1) return { error: 'no_key', msg: 'The chest is locked tight. You need the Goblin King\'s key.' };
    p.inventory.splice(keyIdx, 1);
    const added = this.addItemToInventory(p, 'kings_bludgeon', 1);
    p.rpg.goblinChestOpened = true;
    this.saveData();
    const item = ITEMS['kings_bludgeon'];
    return { success: true, item: { id: item.id, name: item.name, icon: item.icon, rarity: item.rarity } };
  }

  addTrust(p, amount) {
    if (!p.rpg) p.rpg = {};
    p.rpg.trust = Math.min(100, Math.max(0, (p.rpg.trust || 0) + amount));
    return p.rpg.trust;
  }

  getTrustTier(trust) {
    if (trust >= 75) return 'ally';
    if (trust >= 50) return 'trusted';
    if (trust >= 25) return 'familiar';
    if (trust >= 10) return 'newcomer';
    return 'stranger';
  }

  rpgJoin(username) {
    const p = this.rpgGetPlayerData(username);
    // Give starter kit to brand-new players
    if (!p.rpg.starterKitGiven && p.level <= 1 && p.inventory.length === 0) {
      this.addItemToInventory(p, 'starter_kit');
      p.rpg.starterKitGiven = true;
      this.saveData();
    }
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');

    // Check for dungeon reconnect: if player was in a dungeon and disconnected
    const existingRP = this.rpgPlayers[username];
    if (existingRP && existingRP.disconnected && existingRP._savedZone) {
      const instId = existingRP._savedZone;
      const inst = this.rpgDungeonInstances[instId];
      if (inst && (inst.phase === 'active' || inst.phase === 'boss') && inst.members.includes(username)) {
        // Restore dungeon state
        existingRP.disconnected = false;
        existingRP.hp = Math.min(existingRP._savedHP || maxHP, maxHP);
        existingRP.maxHP = maxHP;
        existingRP.x = existingRP._savedX || 1200;
        existingRP.y = existingRP._savedY || 1200;
        existingRP.zone = instId;
        delete existingRP._savedHP;
        delete existingRP._savedX;
        delete existingRP._savedY;
        delete existingRP._savedZone;
        // Remove from dead members (they're back)
        inst.deadMembers = inst.deadMembers.filter(m => m !== username);
        // Notify party that player is back
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_member_died', data: { username: '__reconnect__', deadMembers: inst.deadMembers } });
        const _partyId = this.rpgPlayerParty[username];
        const _partyData = _partyId != null ? this.rpgGetPartyData(_partyId) : null;
        return {
          rpg: p.rpg, level: p.level, xp: p.xp, xpNeeded: this.xpNeeded(p),
          gold: p.gold, vaultGold: p.vaultGold || 0, maxHP, baseDmg: Math.floor((this.minDmg(p) + this.maxDmg(p)) / 2) || 5,
          appearance: p.appearance, equipped: p.equipped,
          activeWearables: p.activeWearables,
          activeCosmetics: p.activeCosmetics || { border: null, title: null, hitEffect: null, badge: null, killEffect: null },
          zones: Object.entries(RPG_ZONES).map(([id, z]) => ({ id, name: z.name, icon: z.icon, minMiningLevel: z.minMiningLevel || 0, type: z.type })),
          pickaxes: RPG_PICKAXES,
          duelQueueCount: this.rpgDuelQueue.length,
          ghostDefeated: !!p.ghostDefeated, trust: p.rpg.trust || 0,
          goblinChestOpened: !!p.rpg.goblinChestOpened,
          miningGear: p.rpg.miningGear,
          mineSpeedMult: this.getMiningGearStat(p, 'mineSpeedMult'),
          moveSpeedMult: this.getMiningGearStat(p, 'moveSpeedMult'),
          lightRadius: this.getMiningGearStat(p, 'lightRadius'),
          caravan: this.rpgGetCaravan(), achievements: p.achievements || [],
          worldEvent: this.rpgGetWorldEventClientData(),
          party: _partyData,
          dungeonState: this.rpgGetDungeonState(instId, username),
        };
      }
    }

    // Check for zone reconnect: player was in a non-dungeon zone and disconnected
    if (existingRP && existingRP.disconnected && existingRP._savedZone && !this.rpgDungeonInstances[existingRP._savedZone]) {
      const savedZone = existingRP._savedZone;
      const savedX = existingRP._savedX || 1200;
      const savedY = existingRP._savedY || 700;
      const savedHP = existingRP._savedHP || maxHP;
      // Only restore if disconnect was recent (within 10 minutes)
      const elapsed = Date.now() - (existingRP._savedTime || 0);
      if (elapsed < 600000 && RPG_ZONES[savedZone]) {
        existingRP.disconnected = false;
        existingRP.hp = Math.min(savedHP, maxHP);
        existingRP.maxHP = maxHP;
        existingRP.x = savedX;
        existingRP.y = savedY;
        existingRP.zone = savedZone;
        existingRP.ws = null;
        delete existingRP._savedHP;
        delete existingRP._savedX;
        delete existingRP._savedY;
        delete existingRP._savedZone;
        delete existingRP._savedTime;
        const _partyId = this.rpgPlayerParty[username];
        const _partyData = _partyId != null ? this.rpgGetPartyData(_partyId) : null;
        return {
          rpg: p.rpg, level: p.level, xp: p.xp, xpNeeded: this.xpNeeded(p),
          gold: p.gold, vaultGold: p.vaultGold || 0, maxHP, baseDmg: Math.floor((this.minDmg(p) + this.maxDmg(p)) / 2) || 5,
          appearance: p.appearance, equipped: p.equipped,
          activeWearables: p.activeWearables,
          activeCosmetics: p.activeCosmetics || { border: null, title: null, hitEffect: null, badge: null, killEffect: null },
          zones: Object.entries(RPG_ZONES).map(([id, z]) => ({ id, name: z.name, icon: z.icon, minMiningLevel: z.minMiningLevel || 0, type: z.type })),
          pickaxes: RPG_PICKAXES,
          duelQueueCount: this.rpgDuelQueue.length,
          ghostDefeated: !!p.ghostDefeated, trust: p.rpg.trust || 0,
          goblinChestOpened: !!p.rpg.goblinChestOpened,
          miningGear: p.rpg.miningGear,
          mineSpeedMult: this.getMiningGearStat(p, 'mineSpeedMult'),
          moveSpeedMult: this.getMiningGearStat(p, 'moveSpeedMult'),
          lightRadius: this.getMiningGearStat(p, 'lightRadius'),
          caravan: this.rpgGetCaravan(), achievements: p.achievements || [],
          worldEvent: this.rpgGetWorldEventClientData(),
          party: _partyData,
          savedZone: savedZone, savedX: savedX, savedY: savedY, savedHP: Math.min(savedHP, maxHP),
        };
      }
    }

    let spawnX = 1200, spawnY = 700;
    const hubW = this.rpgWorld['hub'];
    if (hubW && hubW.tileMap) { const sp = this.rpgFindWalkable(hubW.tileMap, spawnX, spawnY); spawnX = sp.x; spawnY = sp.y; }
    this.rpgPlayers[username] = { zone: 'hub', x: spawnX, y: spawnY, hp: maxHP, maxHP, username, inDuel: null, sitting: null, blocking: false, blockStart: 0 };
    // Restore party state: if player is still in a party, re-send party data after join
    const _partyId = this.rpgPlayerParty[username];
    const _partyData = _partyId != null ? this.rpgGetPartyData(_partyId) : null;
    return {
      rpg: p.rpg,
      level: p.level,
      xp: p.xp,
      xpNeeded: this.xpNeeded(p),
      gold: p.gold,
      vaultGold: p.vaultGold || 0,
      maxHP,
      baseDmg: Math.floor((this.minDmg(p) + this.maxDmg(p)) / 2) || 5,
      appearance: p.appearance,
      equipped: p.equipped,
      activeWearables: p.activeWearables,
      activeCosmetics: p.activeCosmetics || { border: null, title: null, hitEffect: null, badge: null, killEffect: null },
      zones: Object.entries(RPG_ZONES).map(([id, z]) => ({ id, name: z.name, icon: z.icon, minMiningLevel: z.minMiningLevel || 0, type: z.type })),
      pickaxes: RPG_PICKAXES,
      duelQueueCount: this.rpgDuelQueue.length,
      ghostDefeated: !!p.ghostDefeated,
      trust: p.rpg.trust || 0,
      goblinChestOpened: !!p.rpg.goblinChestOpened,
      miningGear: p.rpg.miningGear,
      mineSpeedMult: this.getMiningGearStat(p, 'mineSpeedMult'),
      moveSpeedMult: this.getMiningGearStat(p, 'moveSpeedMult'),
      lightRadius: this.getMiningGearStat(p, 'lightRadius'),
      caravan: this.rpgGetCaravan(),
      worldEvent: this.rpgGetWorldEventClientData(),
      achievements: p.achievements || [],
      party: _partyData,
    };
  }

  rpgLeave(username) {
    this.rpgDuelLeaveQueue(username);
    // Forfeit any active duel
    const rp = this.rpgPlayers[username];
    if (rp && rp.inDuel) {
      const duel = this.rpgDuels[rp.inDuel];
      if (duel && duel.state === 'active') {
        const winner = duel.p1 === username ? duel.p2 : duel.p1;
        this.rpgDuelEnd(rp.inDuel, winner, username);
      }
    }
    // Clean up dungeon instance if in one
    if (rp) {
      const instId = rp.zone;
      if (instId && this.rpgDungeonInstances[instId]) {
        // Preserve dungeon state for reconnect: don't remove from instance, just mark disconnected
        const inst = this.rpgDungeonInstances[instId];
        rp.ws = null;
        rp.disconnected = true;
        rp._savedHP = rp.hp;
        rp._savedX = rp.x;
        rp._savedY = rp.y;
        rp._savedZone = instId;
        // Add to dead members so mobs/boss don't target phantom player
        if (!inst.deadMembers.includes(username)) inst.deadMembers.push(username);
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_member_died', data: { username, deadMembers: inst.deadMembers } });
      } else {
        // Save zone state for reconnect (full zone persistence)
        rp._savedHP = rp.hp;
        rp._savedX = rp.x;
        rp._savedY = rp.y;
        rp._savedZone = rp.zone || 'hub';
        rp.disconnected = true;
        rp.ws = null;
        rp._savedTime = Date.now();
      }
      // Clear dungeon ready state from party
      const partyId = this.rpgPlayerParty[username];
      if (partyId && this.rpgParties[partyId]) {
        const party = this.rpgParties[partyId];
        if (party.dungeonReady) delete party.dungeonReady[username];
      }
    }
    this.rpgCleanupPlayerBoss(username);
    this.rpgCleanupPlayerMobs(username);
    // Don't delete rpgPlayers entry if in dungeon (needed for reconnect)
    if (rp && rp.disconnected && rp._savedZone) {
      // Keep rp alive for reconnect
    } else {
      delete this.rpgPlayers[username];
    }
    this.rpgBroadcastAll({ type: 'rpg_player_left', data: { username } });
  }

  rpgChangeZone(username, zoneId, questTarget) {
    const zone = RPG_ZONES[zoneId];
    if (!zone) return { error: 'invalid_zone' };
    const p = this.rpgGetPlayerData(username);
    if (zone.minMiningLevel && p.rpg.miningLevel < zone.minMiningLevel) {
      return { error: 'mining_level_low', required: zone.minMiningLevel, current: p.rpg.miningLevel };
    }
    // Trust gate for dungeon
    if (zoneId === 'dungeon' && (p.rpg.trust || 0) < 75) {
      return { error: 'trust_low', required: 75, current: p.rpg.trust || 0 };
    }
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    // Block zone change while in party dungeon
    if (rp.zone && this.rpgDungeonInstances[rp.zone]) {
      return { error: 'in_dungeon' };
    }
    const oldZone = rp.zone;
    if (oldZone && oldZone !== zoneId) {
      // Clean up per-player boss and mobs from old zone
      const oldW = this.rpgWorld[oldZone];
      if (oldW && oldW.playerBosses) delete oldW.playerBosses[username];
      if (oldW && oldW.playerMobs) delete oldW.playerMobs[username];
      this.rpgBroadcastZone(oldZone, { type: 'rpg_player_left', data: { username } }, username);
    }
    rp.sitting = null;
    // If reconnecting to same zone, preserve position
    const isReconnect = oldZone === zoneId;
    rp.zone = zoneId;
    // Zone-specific spawns (skip if reconnecting to same zone)
    if (!isReconnect) {
    if (zoneId === 'quarry') {
      rp.x = 30 * 40; rp.y = 37 * 40;  // Just outside the lodge door
    } else if (zoneId === 'underground_mine') {
      rp.x = 30 * 40; rp.y = 30 * 40;  // Center of main cavern
    } else if (zoneId === 'deep_mine') {
      rp.x = 30 * 40; rp.y = 30 * 40;  // Central ruins
    } else if (zoneId === 'market') {
      rp.x = 30 * 40; rp.y = 52 * 40;  // Near entrance gate
    } else {
      rp.x = 1200; rp.y = 700;
    }
    const zw2 = this.rpgWorld[zoneId];
    if (zw2 && zw2.tileMap) { const sp = this.rpgFindWalkable(zw2.tileMap, rp.x, rp.y); rp.x = sp.x; rp.y = sp.y; }
    } // end isReconnect check
    const zw = this.rpgWorld[zoneId];
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    rp.maxHP = maxHP;
    rp.hp = Math.min(rp.hp || maxHP, maxHP);
    // Broadcast join to all players in same zone
    this.rpgBroadcastZone(zoneId, { type: 'rpg_player_joined', data: { username, x: rp.x, y: rp.y, appearance: p.appearance, equipped: p.equipped, activeWearables: p.activeWearables, activeCosmetics: p.activeCosmetics || null } });
    // Quest-biased mob spawning: bias applied when per-player mobs are created in rpgEnsurePlayerMobs
    rp.questBias = questTarget || null;
    return { success: true, zone: this.rpgGetZoneState(zoneId, username) };
  }

  rpgGetZoneState(zoneId, username) {
    const w = this.rpgWorld[zoneId] || { nodes: [] };
    const zone = RPG_ZONES[zoneId] || {};
    // Ensure per-player boss instances exist
    this.rpgEnsurePlayerBoss(zoneId, username);
    // Ensure per-player mob instances exist
    this.rpgEnsurePlayerMobs(zoneId, username);
    const pb = w.playerBosses && w.playerBosses[username];
    const playerMobs = (w.playerMobs && w.playerMobs[username]) || [];
    // All zones show other players (as ghosts)
    const players = Object.entries(this.rpgPlayers)
      .filter(([u, rp]) => rp.zone === zoneId && u !== username)
      .map(([u, rp]) => {
        const pd = this.players[u];
        return { username: u, x: rp.x, y: rp.y, appearance: pd ? pd.appearance : null, equipped: pd ? pd.equipped : null, activeWearables: pd ? pd.activeWearables : null, activeCosmetics: pd ? (pd.activeCosmetics || null) : null, sitting: rp.sitting || null };
      });
    const pbBoss = pb && pb.boss;
    const bossData = pbBoss && !pbBoss.dead ? {
      id: pbBoss.id, name: pbBoss.name, hp: pbBoss.hp, maxHP: pbBoss.maxHP,
      x: pbBoss.x, y: pbBoss.y, color: pbBoss.color, phase: pbBoss.phase,
      phaseName: pbBoss.phaseName || '', cfgId: pbBoss.cfgId || null,
      sleeping: pbBoss.sleeping || false,
      currentAttack: pbBoss.currentAttack, attackTimer: pbBoss.attackTimer,
      arenaRadius: pbBoss.arenaRadius, homeX: pbBoss.homeX, homeY: pbBoss.homeY,
    } : null;
    const sbData = (pb && pb.secondaryBosses || []).filter(sb => !sb.dead).map(sb => this.rpgGetSecondaryBossData(sb));
    const playerSaplings = pb && pb.saplings ? pb.saplings.filter(s => !s.dead) : [];
    return {
      id: zoneId,
      name: zone.name,
      type: zone.type,
      bg: zone.bg,
      tileMap: w.tileMap || null,
      regions: zone.regions || null,
      landmarks: zone.landmarks || null,
      nodes: (w.nodes || []).filter(n => !n.mined),
      mobs: playerMobs.filter(m => !m.dead).map(m => ({
        id: m.id, name: m.name, hp: m.hp, maxHP: m.maxHP, atk: m.atk, x: m.x, y: m.y,
        color: m.color, state: m.state || 'idle', facing: m.facing || 1,
        goldMin: m.goldMin, goldMax: m.goldMax, xpReward: m.xpReward, templateName: m.templateName,
      })).concat(playerSaplings).concat(
        // Include horde mobs if mob_invasion is active and player is in hub
        (zoneId === 'hub' && this.activeWorldEvent && this.activeWorldEvent.eventType === 'mob_invasion')
          ? this.activeWorldEvent.hordeMobs.filter(m => !m.dead).map(m => ({
              id: m.id, name: m.name, hp: m.hp, maxHP: m.maxHP, atk: m.atk, x: m.x, y: m.y,
              color: m.color, state: m.state || 'idle', facing: m.facing || 1,
              goldMin: 0, goldMax: 0, xpReward: m.xpReward, templateName: m.templateName, isHorde: true,
            }))
          : []
      ),
      players,
      boss: bossData,
      secondaryBosses: sbData.length > 0 ? sbData : null,
      bountyBoss: (this.activeWorldEvent && this.activeWorldEvent.eventType === 'bounty_hunt' && this.activeWorldEvent.bountyBoss && !this.activeWorldEvent.bountyBoss.dead && this.activeWorldEvent.bountyBoss.zone === zoneId) ? this._getBountyBossClientData(this.activeWorldEvent.bountyBoss) : null,
      marketStalls: zoneId === 'market' ? this.getMarketStalls() : undefined,
    };
  }

  rpgMineHit(username, nodeId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const w = this.rpgWorld[rp.zone];
    if (!w) return { error: 'invalid_zone' };
    const node = (w.nodes || []).find(n => n.id === nodeId && !n.mined);
    if (!node) return { error: 'node_gone' };

    const p = this.rpgGetPlayerData(username);
    const pickaxe = RPG_PICKAXES[p.rpg.pickaxeTier - 1] || RPG_PICKAXES[0];

    // Pickaxe tier check — certain ores require higher-tier pickaxes
    const reqTier = ORE_TIER_REQ[node.type] || 1;
    if (pickaxe.tier < reqTier) {
      const reqPick = RPG_PICKAXES.find(pk => pk.tier >= reqTier);
      return { error: 'pickaxe_too_weak', required: reqPick ? reqPick.name : `Tier ${reqTier}`, oreType: node.type };
    }

    // Mining gloves speed bonus (applied client-side for swing CD, but server acknowledges)
    // Hit the node
    node.hp -= pickaxe.power;
    if (node.hp > 0) {
      return { hit: true, hpLeft: node.hp, maxHP: node.maxHP };
    }

    // Node broken — trigger mining mini-game!
    node.mined = true;
    const zone = RPG_ZONES[rp.zone];
    node.respawnAt = Date.now() + (zone.respawnTime || 15000);

    // Store pending mine for the mini-game
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!this.pendingMines) this.pendingMines = {};
    this.pendingMines[username] = {
      token,
      nodeType: node.type,
      nodeGold: node.gold,
      nodeXP: node.xp,
      zone: rp.zone,
      createdAt: Date.now(),
    };

    this.rpgBroadcastZone(rp.zone, { type: 'rpg_node_mined', data: { nodeId, username } });
    return { minigame: true, token, oreType: node.type };
  }

  // Complete mining after mini-game timing result
  rpgMinigameResult(username, token, hitPosition) {
    if (!this.pendingMines || !this.pendingMines[username]) return { error: 'no_pending' };
    const pending = this.pendingMines[username];
    if (pending.token !== token) return { error: 'bad_token' };
    // Expire after 10 seconds
    if (Date.now() - pending.createdAt > 10000) {
      delete this.pendingMines[username];
      return { error: 'expired' };
    }
    delete this.pendingMines[username];

    // Grade the hit: hitPosition is 0-1, center (0.5) is perfect
    const dist = Math.abs(hitPosition - 0.5) * 2; // 0 = perfect center, 1 = edge
    let grade;
    if (dist <= MINING_MINIGAME.perfectZone) grade = 'perfect';
    else if (dist <= MINING_MINIGAME.goodZone) grade = 'good';
    else grade = 'bad';

    const p = this.rpgGetPlayerData(username);

    // Gold & XP
    const goldMult = grade === 'perfect' ? 2 : grade === 'good' ? 1 : 0.5;
    const xpMult = grade === 'perfect' ? 2 : grade === 'good' ? 1 : 0.5;
    // Apply world event mining multipliers
    const eventGoldMult = this.rpgGetWorldEventMultiplier('miningGold');
    const eventXPMult = this.rpgGetWorldEventMultiplier('miningXP');
    const goldInt = pending.nodeGold > 0 ? this.addGold(p, Math.floor(pending.nodeGold * goldMult * eventGoldMult)) : 0;
    const xpGain = Math.floor(pending.nodeXP * xpMult * eventXPMult);
    p.rpg.miningXP += xpGain;
    p.rpg.totalMined++;
    if (p.rpg.totalMined % 5 === 0) this.addTrust(p, 1);

    // Mining level up
    let leveledUp = false;
    let needed = p.rpg.miningLevel * 30;
    while (p.rpg.miningXP >= needed) {
      p.rpg.miningXP -= needed;
      p.rpg.miningLevel++;
      leveledUp = true;
      needed = p.rpg.miningLevel * 30;
    }

    // Loot depends on grade
    const droppedItems = [];
    const droppedWearables = [];
    if (grade === 'bad') {
      // Bad hit: stone_chunk only
      const added = this.addItemToInventory(p, 'stone_chunk', 1, rollOreQuality());
      if (added) droppedItems.push({ id: 'stone_chunk', name: 'Stone Chunk', qty: 1, icon: '🪨', quality: -1 });
    } else {
      // Good/Perfect: roll loot table (perfect = roll twice for double ore)
      const rolls = grade === 'perfect' ? 2 : 1;
      for (let r = 0; r < rolls; r++) {
        const mineTableId = 'mine_' + pending.nodeType;
        const mineDrops = LOOT_TABLES[mineTableId] ? this.rollLootTable(mineTableId) : [];
        for (const drop of mineDrops) {
          if (drop.wearable) {
            const w = WEARABLES[drop.itemId];
            if (w && !p.wearables.includes(drop.itemId)) {
              p.wearables.push(drop.itemId);
              droppedWearables.push({ id: drop.itemId, name: w.name, icon: w.icon, rarity: w.rarity, slot: w.slot });
            }
          } else {
            const def = ITEMS[drop.itemId];
            // Mining gear drops go straight to inventory (not ore quality)
            const isMiningGear = def && def.type === 'mining_gear';
            const quality = (def && def.sellPrice && !isMiningGear) ? rollOreQuality() : -1;
            const added = this.addItemToInventory(p, drop.itemId, drop.qty, quality);
            if (added) {
              const displayName = added.name || (def || {}).name;
              droppedItems.push({ id: drop.itemId, name: displayName, qty: drop.qty, icon: (def || {}).icon, quality });
            }
          }
        }
      }
    }

    this.saveData();
    this.logAction(username, 'mine', pending.nodeType + ' [' + grade + '] +' + goldInt + 'g +' + xpGain + 'mxp' + (droppedItems.length ? ' drops:' + droppedItems.map(d=>d.name).join(',') : ''));

    return {
      success: true,
      grade,
      oreType: pending.nodeType,
      gold: goldInt,
      miningXP: xpGain,
      miningLevel: p.rpg.miningLevel,
      miningXPCurrent: p.rpg.miningXP,
      miningXPNeeded: p.rpg.miningLevel * 30,
      leveledUp,
      totalGold: p.gold,
      drops: droppedItems,
      wearableDrops: droppedWearables,
    };
  }

  rpgAttackMob(username, mobId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const w = this.rpgWorld[rp.zone];
    if (!w) return { error: 'invalid_zone' };
    // Check horde mobs first (shared across all players)
    let mob = null;
    let isHordeMob = false;
    if (this.activeWorldEvent && this.activeWorldEvent.eventType === 'mob_invasion' && this.activeWorldEvent.hordeMobs) {
      mob = this.activeWorldEvent.hordeMobs.find(m => m.id === mobId && !m.dead);
      if (mob) isHordeMob = true;
    }
    if (!mob) {
      const playerMobs = (w.playerMobs && w.playerMobs[username]) || [];
      mob = playerMobs.find(m => m.id === mobId && !m.dead);
    }
    if (!mob) return { error: 'mob_gone' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);
    // Bone Shield — skeleton takes reduced damage while shield is active
    if (mob.abilityActive === 'bone_shield' && mob.abilityEnd > Date.now()) {
      dmg = Math.max(1, Math.floor(dmg * 0.5));
    }
    mob.hp -= dmg;
    // ── Enchant system: fire/poison/holy ──
    // Mythic weapons with native enchant = 100% proc every hit
    // Non-mythic weapons with book enchant = proc at book's % chance
    let burn = false, poison = false, holy = false;
    const wepItem = (p.rpg.equipped && p.rpg.equipped.weapon) || {};
    const weaponId = wepItem.id || '';
    const wepDef = ITEMS[weaponId] || {};
    let activeEnchant = '';
    if (wepDef.enchant) {
      // Mythic native enchant — always procs
      activeEnchant = wepDef.enchant;
    } else if (wepItem.enchantments) {
      // Book enchant — check proc chance
      for (const ench of wepItem.enchantments) {
        const def = ENCHANTMENTS[ench.id];
        if (def && def.stat === 'elemental' && Math.random() < (def.proc || 0.10)) {
          activeEnchant = def.value; // 'fire', 'poison', or 'holy'
          break;
        }
      }
    }
    if (activeEnchant === 'fire') {
      mob.burnDamage = 8;
      mob.burnEnd = Date.now() + 3000;
      mob.burnTickAt = Date.now() + 500;
      mob.burnOwner = username;
      burn = true;
    }
    if (activeEnchant === 'poison') {
      mob.poisonDamage = 5;
      mob.poisonEnd = Date.now() + 4000;
      mob.poisonTickAt = Date.now() + 500;
      mob.poisonOwner = username;
      poison = true;
    }
    if (activeEnchant === 'holy') {
      const holyDmg = Math.max(3, Math.floor(dmg * 0.15));
      mob.hp -= holyDmg;
      holy = holyDmg;
    }
    // Lifesteal from enchantments
    let lifestealHeal = 0;
    const lsVal = this.equipStat(p, 'lifesteal');
    if (lsVal > 0) {
      lifestealHeal = Math.max(1, Math.floor(dmg * lsVal));
      const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
      rp.hp = Math.min(rp.hp + lifestealHeal, maxHP);
    }
    // Degrade weapon durability (mob hit = -1)
    const wepResult = this.degradeEquipped(p, 'weapon', 1);

    if (mob.hp <= 0) {
      mob.dead = true;
      const eliteTier = mob.eliteTier || 'normal';
      mob.respawnAt = isHordeMob ? null : Date.now() + (eliteTier === 'champion' ? 12000 : eliteTier === 'elite' ? 8000 : 3000);

      // Horde mobs: no individual gold, just XP + participation tracking
      if (isHordeMob) {
        const xpBase = Math.floor(mob.xpReward * this.rpgGetWorldEventMultiplier('xp'));
        this.addXP(p, xpBase);
        p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
        this.rpgRecordWorldEventParticipation(username, 1, 0, xpBase);
        this.addTrust(p, 1);
        // Decrement alive counter
        if (this.activeWorldEvent) {
          this.activeWorldEvent.hordeMobsAlive = Math.max(0, (this.activeWorldEvent.hordeMobsAlive || 0) - 1);
        }
        // Broadcast kill to ALL hub players
        for (const [u, urp] of Object.entries(this.rpgPlayers)) {
          if (urp.disconnected) continue;
          if (urp.zone === 'hub') {
            this.rpgSendTo(u, { type: 'rpg_mob_died', data: { mobId, killer: username, eliteTier, isHorde: true } });
          }
        }
        // Broadcast horde progress
        this.rpgBroadcastAll({ type: 'rpg_horde_progress', data: {
          alive: this.activeWorldEvent ? this.activeWorldEvent.hordeMobsAlive : 0,
          total: this.activeWorldEvent ? this.activeWorldEvent.hordeMobs.length : 0,
          killer: username, mobName: mob.name,
        }});
        // If all horde mobs dead, end event early and distribute gold
        if (this.activeWorldEvent && this.activeWorldEvent.hordeMobsAlive <= 0) {
          this.rpgEndWorldEvent();
        }
        this.saveData();
        const _cos = p.activeCosmetics || {};
        return { killed: true, dmg, crit, gold: 0, xp: xpBase, leveled: false, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold, mobName: mob.name, drops: [], wearableDrops: [], weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, trust: p.rpg.trust, killEffect: _cos.killEffect || null, isHorde: true };
      }

      // Normal mob kill
      let goldBase = mob.goldMin + Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1));
      let xpBase = mob.xpReward;
      // World event multipliers
      goldBase = Math.floor(goldBase * this.rpgGetWorldEventMultiplier('gold'));
      xpBase = Math.floor(xpBase * this.rpgGetWorldEventMultiplier('xp'));
      const gold = this.addGold(p, goldBase);
      const leveled = this.addXP(p, xpBase);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      // Track world event participation
      this.rpgRecordWorldEventParticipation(username, 1, gold, xpBase);
      const newTrust = this.addTrust(p, eliteTier === 'champion' ? 3 : eliteTier === 'elite' ? 2 : 1);
      // Roll loot table — use templateName (mob.name has elite prefix)
      const mobKey = (mob.templateName || mob.name).toLowerCase().replace(/\s+/g, '_');
      let lootDrops = this.rollLootTable(mobKey);
      // Elite/Champion: extra loot rolls (elite=2x, champion=3x chance)
      if (eliteTier === 'elite') { lootDrops = lootDrops.concat(this.rollLootTable(mobKey)); }
      else if (eliteTier === 'champion') { lootDrops = lootDrops.concat(this.rollLootTable(mobKey), this.rollLootTable(mobKey)); }
      const droppedItems = [];
      const droppedWearables = [];
      for (const drop of lootDrops) {
        if (drop.wearable) {
          const w = WEARABLES[drop.itemId];
          if (w && !p.wearables.includes(drop.itemId)) {
            p.wearables.push(drop.itemId);
            droppedWearables.push({ id: drop.itemId, name: w.name, icon: w.icon, rarity: w.rarity, slot: w.slot });
          }
        } else {
          const added = this.addItemToInventory(p, drop.itemId, drop.qty);
          if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
        }
      }
      this.saveData();
      this.emitAchievements(username);
      this.rpgSendTo(username, { type: 'rpg_mob_died', data: { mobId, killer: username, eliteTier } });
      this.logAction(username, 'mob_kill', mob.name + ' +' + gold + 'g +' + xpBase + 'xp' + (droppedItems.length ? ' drops:' + droppedItems.map(d=>d.name).join(',') : ''));
      const _cos = p.activeCosmetics || {};
      return { killed: true, dmg, crit, gold, xp: xpBase, leveled, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold, mobName: mob.name, drops: droppedItems, wearableDrops: droppedWearables, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, trust: p.rpg.trust, killEffect: _cos.killEffect || null };
    }

    const _cos2 = p.activeCosmetics || {};
    return { hit: true, dmg, crit, mobHP: mob.hp, mobMaxHP: mob.maxHP, burn, poison, holy, lifesteal: lifestealHeal, hp: rp.hp, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null, hitEffect: _cos2.hitEffect || null };
  }

  rpgQuestTurnIn(username, questId) {
    const quest = TAVERN_QUESTS.find(q => q.id === questId);
    if (!quest) return { error: 'invalid_quest' };
    const p = this.rpgGetPlayerData(username);
    this.addGold(p, quest.goldReward);
    const leveled = this.addXP(p, quest.xpReward);
    const trustGain = quest.trustReward || 3;
    const newTrust = this.addTrust(p, trustGain);
    this.logAction(username, 'quest', quest.id + ' +' + quest.goldReward + 'g +' + quest.xpReward + 'xp +' + trustGain + 'trust');
    this.saveData();
    return { success: true, questId, goldReward: quest.goldReward, xpReward: quest.xpReward, leveled, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold, trust: newTrust, trustGain };
  }

  rpgBuyPickaxe(username, tier) {
    const pickaxe = RPG_PICKAXES[tier - 1];
    if (!pickaxe) return { error: 'invalid' };
    const p = this.rpgGetPlayerData(username);
    if (p.rpg.pickaxeTier >= tier) return { error: 'already_have' };
    if (p.rpg.pickaxeTier < tier - 1) return { error: 'need_previous' };
    if (p.gold < pickaxe.cost) return { error: 'broke', gold: p.gold, cost: pickaxe.cost };
    p.gold -= pickaxe.cost;
    p.rpg.pickaxeTier = tier;
    this.saveData();
    return { success: true, pickaxe: pickaxe.name, tier, gold: p.gold };
  }

  // ═══════════════════════════════════════════
  // Sell Ore Materials to Grizzle NPC
  // ═══════════════════════════════════════════
  rpgSellOre(username, itemId, qty, quality) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const item = ITEMS[itemId];
    if (!item || !item.sellPrice) return { error: 'not_sellable' };
    qty = Math.max(1, Math.floor(qty));
    const q = (quality !== undefined && quality >= 0) ? quality : -1;
    // Find all matching stacks and sum total available
    const matchingStacks = p.inventory.filter(i => i.id === itemId && (i.quality || -1) === q);
    const totalHave = matchingStacks.reduce((s, i) => s + (i.qty || 1), 0);
    if (!matchingStacks.length || totalHave < qty) return { error: 'not_enough', have: totalHave };
    // Calculate price: base × quality multiplier × daily demand multiplier
    const qualMult = (q >= 0 && ORE_QUALITY.sellMult[q]) ? ORE_QUALITY.sellMult[q] : 1.0;
    const demandMult = getDemandMult(itemId);
    const pricePerUnit = Math.max(1, Math.round(item.sellPrice * qualMult * demandMult));
    const totalGold = pricePerUnit * qty;
    // Deplete across stacks
    let remaining = qty;
    for (const stack of matchingStacks) {
      if (remaining <= 0) break;
      const take = Math.min(stack.qty || 1, remaining);
      stack.qty = (stack.qty || 1) - take;
      remaining -= take;
    }
    p.inventory = p.inventory.filter(i => i.qty > 0);
    p.gold += totalGold;
    this.saveData();
    const qlabel = q >= 0 ? (ORE_QUALITY.labels[q] || '') + ' ' : '';
    this.logAction(username, 'sell_ore', qlabel + itemId + ' x' + qty + ' for ' + totalGold + 'g (demand:' + demandMult + 'x)');
    return { success: true, itemId, qty, quality: q, goldEarned: totalGold, totalGold: p.gold, demandMult, pricePerUnit };
  }

  rpgSellAllOre(username) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    let totalEarned = 0;
    let itemsSold = 0;
    const toRemove = [];
    for (const invItem of p.inventory) {
      const item = ITEMS[invItem.id];
      if (!item || !item.sellPrice || item.sellPrice <= 0) continue;
      const q = (invItem.quality !== undefined && invItem.quality >= 0) ? invItem.quality : -1;
      const qualMult = (q >= 0 && ORE_QUALITY.sellMult[q]) ? ORE_QUALITY.sellMult[q] : 1.0;
      const demandMult = getDemandMult(invItem.id);
      const pricePerUnit = Math.max(1, Math.round(item.sellPrice * qualMult * demandMult));
      const qty = invItem.qty || 1;
      totalEarned += pricePerUnit * qty;
      itemsSold++;
      toRemove.push(invItem);
    }
    if (itemsSold === 0) return { error: 'nothing_to_sell' };
    p.inventory = p.inventory.filter(i => !toRemove.includes(i));
    p.gold += totalEarned;
    this.saveData();
    this.logAction(username, 'sell_all_ore', itemsSold + ' stacks for ' + totalEarned + 'g');
    return { success: true, goldEarned: totalEarned, totalGold: p.gold, itemsSold };
  }

  // ═══════════════════════════════════════════
  // Buy Coal from Grizzle
  // ═══════════════════════════════════════════
  rpgBuyCoal(username, qty) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    qty = Math.max(1, Math.floor(qty));
    const cost = ITEMS.coal.shopPrice * qty;
    if (p.gold < cost) return { error: 'broke', gold: p.gold, cost };
    p.gold -= cost;
    this.addItemToInventory(p, 'coal', qty);
    this.saveData();
    return { success: true, qty, cost, totalGold: p.gold };
  }

  // ═══════════════════════════════════════════
  // Mining Gear — buy, equip, unequip
  // ═══════════════════════════════════════════
  rpgBuyMiningGear(username, itemId) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const item = ITEMS[itemId];
    if (!item || item.type !== 'mining_gear') return { error: 'invalid_item' };
    if (!item.shopPrice) return { error: 'not_buyable' };
    if (p.gold < item.shopPrice) return { error: 'broke', gold: p.gold, cost: item.shopPrice };
    p.gold -= item.shopPrice;
    this.addItemToInventory(p, itemId, 1);
    this.saveData();
    return { success: true, itemId, name: item.name, cost: item.shopPrice, totalGold: p.gold };
  }

  rpgEquipMiningGear(username, itemId) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const item = ITEMS[itemId];
    if (!item || item.type !== 'mining_gear') return { error: 'invalid_item' };
    const slot = item.slot; // 'helmet', 'gloves', 'boots'
    // Check they own at least one (stackable has qty, non-stackable has no qty)
    const invItem = p.inventory.find(i => i.id === itemId && (i.qty >= 1 || !i.stackable));
    if (!invItem) return { error: 'not_owned' };
    // Init mining gear slots
    if (!p.rpg.miningGear) p.rpg.miningGear = { helmet: null, gloves: null, boots: null };
    // Unequip current item in that slot (return to inventory)
    if (p.rpg.miningGear[slot]) {
      this.addItemToInventory(p, p.rpg.miningGear[slot], 1);
    }
    // Equip new
    p.rpg.miningGear[slot] = itemId;
    if (invItem.qty !== undefined) {
      invItem.qty -= 1;
      if (invItem.qty <= 0) p.inventory = p.inventory.filter(i => i !== invItem);
    } else {
      // Non-stackable — remove directly
      p.inventory = p.inventory.filter(i => i !== invItem);
    }
    this.saveData();
    return { success: true, slot, itemId, name: item.name, miningGear: p.rpg.miningGear };
  }

  rpgUnequipMiningGear(username, slot) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    if (!p.rpg.miningGear || !p.rpg.miningGear[slot]) return { error: 'nothing_equipped' };
    const itemId = p.rpg.miningGear[slot];
    this.addItemToInventory(p, itemId, 1);
    p.rpg.miningGear[slot] = null;
    this.saveData();
    return { success: true, slot, itemId, miningGear: p.rpg.miningGear };
  }

  rpgGetMiningGear(username) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    if (!p.rpg.miningGear) p.rpg.miningGear = { helmet: null, gloves: null, boots: null };
    const gear = {};
    for (const [slot, id] of Object.entries(p.rpg.miningGear)) {
      gear[slot] = id ? { id, ...ITEMS[id] } : null;
    }
    return { miningGear: gear, shop: MINING_GEAR_SHOP.map(id => ({ id, ...ITEMS[id] })) };
  }

  // Get mining gear stat bonus for a player
  getMiningGearStat(p, stat) {
    if (!p.rpg || !p.rpg.miningGear) return stat === 'mineSpeedMult' ? 1.0 : stat === 'moveSpeedMult' ? 1.0 : 0;
    let val = stat === 'mineSpeedMult' ? 1.0 : stat === 'moveSpeedMult' ? 1.0 : 0;
    for (const itemId of Object.values(p.rpg.miningGear)) {
      if (!itemId) continue;
      const item = ITEMS[itemId];
      if (!item) continue;
      if (stat === 'lightRadius' && item.lightRadius) val += item.lightRadius;
      if (stat === 'mineSpeedMult' && item.mineSpeedMult) val = val * item.mineSpeedMult;
      if (stat === 'moveSpeedMult' && item.moveSpeedMult) val = val * item.moveSpeedMult;
    }
    return val;
  }

  // ═══════════════════════════════════════════
  // Ore Caravan — periodic bulk buyer
  // ═══════════════════════════════════════════
  rpgStartCaravan() {
    const ore = CARAVAN_ORE_POOL[Math.floor(Math.random() * CARAVAN_ORE_POOL.length)];
    const item = ITEMS[ore];
    const basePrice = item ? item.sellPrice : 5;
    const caravanPrice = Math.round(basePrice * CARAVAN_CONFIG.priceMult);
    this.activeCaravan = {
      ore,
      oreName: item ? item.name : ore,
      oreIcon: item ? item.icon : '📦',
      caravanPrice,
      basePricePerUnit: basePrice,
      startedAt: Date.now(),
      expiresAt: Date.now() + CARAVAN_CONFIG.duration,
    };
    // Announce to all RPG players
    this.rpgBroadcastAll({ type: 'rpg_caravan_arrive', data: this.activeCaravan });
    return this.activeCaravan;
  }

  rpgStartCustomCaravan(oreId, price, durationMs) {
    if (this.activeCaravan) this.rpgEndCaravan();
    const item = ITEMS[oreId];
    if (!item) return { error: 'invalid_ore' };
    this.activeCaravan = {
      ore: oreId,
      oreName: item.name,
      oreIcon: item.icon || '📦',
      caravanPrice: Math.max(1, Math.floor(price)),
      basePricePerUnit: item.sellPrice || 1,
      startedAt: Date.now(),
      expiresAt: Date.now() + Math.max(60000, Math.floor(durationMs)),
    };
    this.rpgBroadcastAll({ type: 'rpg_caravan_arrive', data: this.activeCaravan });
    return this.activeCaravan;
  }

  rpgEndCaravan() {
    if (!this.activeCaravan) return;
    this.rpgBroadcastAll({ type: 'rpg_caravan_leave', data: { ore: this.activeCaravan.ore } });
    this.activeCaravan = null;
  }

  rpgSellToCaravan(username, qty, quality) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    if (!this.activeCaravan) return { error: 'no_caravan' };
    const { ore, caravanPrice } = this.activeCaravan;
    qty = Math.max(1, Math.floor(qty));
    const q = (quality !== undefined && quality >= 0) ? quality : -1;
    const qualMult = (q >= 0 && ORE_QUALITY.sellMult[q]) ? ORE_QUALITY.sellMult[q] : 1.0;
    const pricePerUnit = Math.max(1, Math.round(caravanPrice * qualMult));
    const invItem = p.inventory.find(i => i.id === ore && i.qty >= qty && (i.quality || -1) === q);
    if (!invItem) return { error: 'not_enough', have: invItem ? invItem.qty : 0 };
    const totalGold = pricePerUnit * qty;
    invItem.qty -= qty;
    if (invItem.qty <= 0) p.inventory = p.inventory.filter(i => i !== invItem);
    p.gold += totalGold;
    this.saveData();
    this.logAction(username, 'caravan_sell', ore + ' x' + qty + ' for ' + totalGold + 'g');
    return { success: true, ore, qty, quality: q, goldEarned: totalGold, totalGold: p.gold, pricePerUnit };
  }

  rpgGetCaravan() {
    if (!this.activeCaravan || Date.now() > this.activeCaravan.expiresAt) return { active: false };
    return { active: true, ...this.activeCaravan, timeLeft: this.activeCaravan.expiresAt - Date.now() };
  }

  // ═══════════════════════════════════════════
  // Refining / Smelting — start a refine job
  // ═══════════════════════════════════════════
  rpgStartRefine(username, itemId, qty, quality) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const recipe = REFINE_RECIPES[itemId];
    if (!recipe) return { error: 'not_refinable' };
    qty = Math.max(1, Math.floor(qty));
    const q = (quality !== undefined && quality >= 0) ? quality : -1;
    // Check they have the raw material (matching quality)
    const invItem = p.inventory.find(i => i.id === itemId && i.qty >= qty && (i.quality || -1) === q);
    if (!invItem) return { error: 'not_enough_ore', have: invItem ? invItem.qty : 0 };
    // Check coal
    const coalNeeded = recipe.coal * qty;
    if (coalNeeded > 0) {
      const coalCount = this.getStackCount(p, 'coal');
      if (coalCount < coalNeeded) return { error: 'not_enough_coal', need: coalNeeded, have: coalCount };
    }
    // Check no existing refine job active
    if (!p.rpg.refineQueue) p.rpg.refineQueue = [];
    // Max 3 concurrent jobs
    if (p.rpg.refineQueue.length >= 3) return { error: 'queue_full' };
    // Consume raw material + coal
    invItem.qty -= qty;
    if (invItem.qty <= 0) p.inventory = p.inventory.filter(i => i !== invItem);
    if (coalNeeded > 0) this.removeStackable(p, 'coal', coalNeeded);
    // Create refine job
    const job = {
      inputId: itemId,
      outputId: recipe.result,
      qty,
      quality: q,
      startedAt: Date.now(),
      finishAt: Date.now() + recipe.time * qty,
      coalUsed: coalNeeded,
    };
    p.rpg.refineQueue.push(job);
    this.saveData();
    this.logAction(username, 'refine_start', itemId + ' x' + qty + ' → ' + recipe.result + ' (finishes in ' + Math.round(recipe.time * qty / 1000) + 's)');
    return { success: true, job, totalGold: p.gold };
  }

  // Collect finished refine jobs
  rpgCollectRefine(username, jobIndex) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    if (!p.rpg.refineQueue || !p.rpg.refineQueue.length) return { error: 'no_jobs' };
    const idx = Math.max(0, Math.floor(jobIndex));
    const job = p.rpg.refineQueue[idx];
    if (!job) return { error: 'invalid_job' };
    if (Date.now() < job.finishAt) return { error: 'not_ready', remaining: job.finishAt - Date.now() };
    // Give refined output with same quality as input
    const added = this.addItemToInventory(p, job.outputId, job.qty, job.quality);
    p.rpg.refineQueue.splice(idx, 1);
    // Small mining XP for refining
    const xpGain = Math.max(1, Math.floor(job.qty * 2));
    p.rpg.miningXP += xpGain;
    // Check mining level up
    let leveledUp = false;
    let needed = p.rpg.miningLevel * 30;
    while (p.rpg.miningXP >= needed) {
      p.rpg.miningXP -= needed;
      p.rpg.miningLevel++;
      leveledUp = true;
      needed = p.rpg.miningLevel * 30;
    }
    this.saveData();
    this.logAction(username, 'refine_collect', job.outputId + ' x' + job.qty);
    const itemName = added ? added.name : (ITEMS[job.outputId] || {}).name || job.outputId;
    return { success: true, outputId: job.outputId, qty: job.qty, quality: job.quality, name: itemName, itemName, xpGain, miningXP: p.rpg.miningXP, miningXPNeeded: p.rpg.miningLevel * 30, miningLevel: p.rpg.miningLevel, leveledUp };
  }

  // Get refine queue status
  rpgGetRefineQueue(username) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    return { queue: (p.rpg.refineQueue || []).map((j, i) => ({ index: i, inputId: j.inputId, outputId: j.outputId, qty: j.qty, quality: j.quality, finishAt: j.finishAt, remaining: Math.max(0, j.finishAt - Date.now()), ready: Date.now() >= j.finishAt })) };
  }

  // Get daily demand info
  rpgGetDemand() {
    const d = getDailyDemand();
    return {
      dayNum: d.dayNum,
      hot: { itemId: d.hot, name: (ITEMS[d.hot] || {}).name, mult: 1.50 },
      shortage: d.shortage.map(id => ({ itemId: id, name: (ITEMS[id] || {}).name, mult: 1.25 })),
      surplus: d.surplus.map(id => ({ itemId: id, name: (ITEMS[id] || {}).name, mult: 0.85 })),
    };
  }

  // ═══════════════════════════════════════════
  // Apply Enchantment Book to Equipment
  // ═══════════════════════════════════════════
  rpgApplyEnchant(username, bookItemId, equipUid) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const bookDef = ITEMS[bookItemId];
    if (!bookDef || bookDef.type !== 'enchant_book') return { error: 'not_a_book' };
    const enchant = ENCHANTMENTS[bookDef.enchant];
    if (!enchant) return { error: 'invalid_enchant' };
    // Find the book in inventory
    const bookInv = p.inventory.find(i => i.id === bookItemId && i.qty > 0);
    if (!bookInv) return { error: 'no_book' };
    // Find the equipment (check equipped + inventory)
    let equip = null;
    for (const slot of ['weapon', 'armor']) {
      if (p.equipped[slot] && p.equipped[slot].uid === equipUid) { equip = p.equipped[slot]; break; }
    }
    if (!equip) equip = p.inventory.find(i => i.uid === equipUid);
    if (!equip) return { error: 'no_equipment' };
    // Validate slot compatibility
    if (enchant.slot !== 'any' && equip.type !== enchant.slot) return { error: 'wrong_slot', need: enchant.slot, have: equip.type };
    // Check if already has this enchant
    if (equip.enchantments && equip.enchantments.find(e => e.id === bookDef.enchant)) return { error: 'already_enchanted' };
    // Apply enchantment
    if (!equip.enchantments) equip.enchantments = [];
    equip.enchantments.push({ id: bookDef.enchant, name: enchant.name, stat: enchant.stat, value: enchant.value });
    // Apply stat bonuses
    if (enchant.stat === 'dmgBonus' && equip.dmgBonus != null) equip.dmgBonus += enchant.value;
    if (enchant.stat === 'defBonus' && equip.defBonus != null) equip.defBonus += enchant.value;
    if (enchant.stat === 'durability' && equip.maxDurability) {
      const bonus = Math.floor(equip.maxDurability * enchant.value);
      equip.maxDurability += bonus;
      equip.durability = Math.min(equip.durability + bonus, equip.maxDurability);
    }
    // Consume book
    bookInv.qty -= 1;
    if (bookInv.qty <= 0) p.inventory = p.inventory.filter(i => i !== bookInv);
    this.saveData();
    this.logAction(username, 'enchant', enchant.name + ' on ' + (equip.name || equip.id));
    return { success: true, enchant: enchant.name, equipName: equip.name || equip.id, enchantments: equip.enchantments };
  }

  // ═══════════════════════════════════════════
  // Disenchant — remove enchantment from equipment
  // ═══════════════════════════════════════════
  rpgDisenchant(username, equipUid, enchantId) {
    const p = this.rpgGetPlayerData(username);
    if (!p) return { error: 'not_in_rpg' };
    const enchantDef = ENCHANTMENTS[enchantId];
    if (!enchantDef) return { error: 'invalid_enchant' };
    // Find the equipment (check equipped + inventory)
    let equip = null;
    for (const slot of ['weapon', 'armor']) {
      if (p.equipped[slot] && p.equipped[slot].uid === equipUid) { equip = p.equipped[slot]; break; }
    }
    if (!equip) equip = p.inventory.find(i => i.uid === equipUid);
    if (!equip) return { error: 'no_equipment' };
    if (!equip.enchantments || !equip.enchantments.find(e => e.id === enchantId)) return { error: 'not_enchanted' };
    // Gold cost: 50g flat fee
    const cost = 50;
    if (p.gold < cost) return { error: 'no_gold', need: cost, have: p.gold };
    p.gold -= cost;
    // Reverse stat bonuses
    if (enchantDef.stat === 'dmgBonus' && equip.dmgBonus != null) equip.dmgBonus = Math.max(0, equip.dmgBonus - enchantDef.value);
    if (enchantDef.stat === 'defBonus' && equip.defBonus != null) equip.defBonus = Math.max(0, equip.defBonus - enchantDef.value);
    if (enchantDef.stat === 'durability' && equip.maxDurability) {
      const bonus = Math.floor((equip.maxDurability / (1 + enchantDef.value)) * enchantDef.value);
      equip.maxDurability = Math.max(1, equip.maxDurability - bonus);
      equip.durability = Math.min(equip.durability, equip.maxDurability);
    }
    // Remove the enchantment
    equip.enchantments = equip.enchantments.filter(e => e.id !== enchantId);
    this.saveData();
    this.logAction(username, 'disenchant', enchantDef.name + ' from ' + (equip.name || equip.id));
    return { success: true, enchant: enchantDef.name, equipName: equip.name || equip.id, enchantments: equip.enchantments, gold: p.gold };
  }

  // ═══════════════════════════════════════════
  // Grizzle Quest Turn-in (mining quests)
  // ═══════════════════════════════════════════
  rpgGrizzleQuestTurnIn(username, questId) {
    const quest = GRIZZLE_QUESTS.find(q => q.id === questId);
    if (!quest) return { error: 'invalid_quest' };
    const p = this.rpgGetPlayerData(username);
    this.addGold(p, quest.goldReward);
    const leveled = this.addXP(p, quest.xpReward);
    p.rpg.miningXP += Math.floor(quest.xpReward / 2);
    // Mining level up check
    let mLeveledUp = false;
    let needed = p.rpg.miningLevel * 30;
    while (p.rpg.miningXP >= needed) { p.rpg.miningXP -= needed; p.rpg.miningLevel++; mLeveledUp = true; needed = p.rpg.miningLevel * 30; }
    this.logAction(username, 'grizzle_quest', quest.id + ' +' + quest.goldReward + 'g +' + quest.xpReward + 'xp');
    this.saveData();
    return { success: true, questId, goldReward: quest.goldReward, xpReward: quest.xpReward, leveled, mLeveledUp, miningLevel: p.rpg.miningLevel, level: p.level, currentXP: p.xp, xpNeeded: this.xpNeeded(p), totalGold: p.gold };
  }

  rpgMove(username, x, y, facing) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    if (rp.sitting) { rp.sitting = null; } // Stand up on move
    const WORLD_BOUND = MAP_W * TILE_SIZE;
    x = Math.max(0, Math.min(WORLD_BOUND, x));
    y = Math.max(0, Math.min(WORLD_BOUND, y));
    const dir = ['up','down','left','right'].includes(facing) ? facing : 'down';
    // Check if in party dungeon instance
    const dungInst = this.rpgDungeonInstances[rp.zone];
    if (dungInst) {
      // Tile collision from instance tileMap
      if (!rp.fly && dungInst.tileMap) {
        const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && !TILE_PROPS[dungInst.tileMap[ty][tx]].walkable) return;
      }
      rp.x = x; rp.y = y; rp.facing = dir;
      this.rpgDungeonMove(username, x, y);
      return;
    }
    // Tile collision — reject moves onto blocked tiles (skip if fly mode)
    if (!rp.fly) {
      const w = this.rpgWorld[rp.zone];
      if (w && w.tileMap) {
        const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && !TILE_PROPS[w.tileMap[ty][tx]].walkable) return;
      }
    }
    rp.x = x;
    rp.y = y;
    rp.facing = dir;
    this.rpgBroadcastZone(rp.zone, { type: 'rpg_player_move', data: { username, x: rp.x, y: rp.y, facing: dir } }, username);
  }

  rpgSit(username, benchX, benchY) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    rp.sitting = { x: benchX, y: benchY };
    rp.x = benchX;
    rp.y = benchY;
    if (rp.zone === 'hub') {
      this.rpgBroadcastZone('hub', { type: 'rpg_player_sit', data: { username, x: benchX, y: benchY } }, username);
    }
  }

  rpgGetAchievements(username) {
    const p = this.rpgGetPlayerData(username);
    const all = Object.entries(ACHIEVEMENTS).map(([id, a]) => ({
      id,
      name: a.name,
      desc: a.desc,
      earned: (p.achievements || []).includes(id),
    }));
    return { achievements: all, earned: (p.achievements || []).length, total: Object.keys(ACHIEVEMENTS).length };
  }

  // ═══════════════════════════════════════════
  // RPG Admin Tools (mikeydamike only)
  // ═══════════════════════════════════════════
  isRPGAdmin(username) {
    return username === 'mikeydamike';
  }

  rpgAdminGodMode(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    rp.godMode = !rp.godMode;
    return { success: true, godMode: rp.godMode };
  }

  rpgAdminInstantKill(username, targetId, targetType) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const w = this.rpgWorld[rp.zone];
    if (!w) return { error: 'invalid_zone' };

    if (targetType === 'boss') {
      const pb = w.playerBosses && w.playerBosses[username];
      if (!pb || !pb.boss || pb.boss.dead) return { error: 'no_boss' };
      const boss = pb.boss;
      const dmg = boss.hp;
      boss.hp = 0;
      boss.dead = true;
      const bossRespawnMult2 = this.rpgGetWorldEventMultiplier('bossRespawn');
      boss.respawnAt = Date.now() + Math.floor((RPG_ZONES[rp.zone].boss.respawnTime || 120000) * (bossRespawnMult2 < 1 ? bossRespawnMult2 : 1));
      this.communityMilestoneData.bossKills = (this.communityMilestoneData.bossKills || 0) + 1;
      if (pb.saplings) pb.saplings.forEach(s => { s.dead = true; });
      const p = this.rpgGetPlayerData(username);
      const zone = RPG_ZONES[rp.zone];
      const gold = zone.boss.goldReward || 150;
      const xpR = zone.boss.xpReward || 200;
      this.addGold(p, gold);
      this.addXP(p, xpR);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      const bossKey = zone.boss.name.toLowerCase().replace(/\s+/g, '_');
      const lootDrops = this.rollLootTable(bossKey);
      const droppedItems = [], droppedWearables = [];
      for (const drop of lootDrops) {
        if (drop.wearable) {
          const ww = WEARABLES[drop.itemId];
          if (ww && !p.wearables.includes(drop.itemId)) { p.wearables.push(drop.itemId); droppedWearables.push({ id: drop.itemId, name: ww.name, icon: ww.icon, rarity: ww.rarity, slot: ww.slot }); }
        } else {
          const added = this.addItemToInventory(p, drop.itemId, drop.qty);
          if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
        }
      }
      this.saveData();
      return { success: true, type: 'boss', name: boss.name, dmg, gold, xp: xpR, drops: droppedItems, wearableDrops: droppedWearables };
    }

    if (targetType === 'mob') {
      const playerMobs = (w.playerMobs && w.playerMobs[username]) || [];
      const mob = playerMobs.find(m => m.id === targetId && !m.dead);
      if (!mob) return { error: 'mob_gone' };
      const dmg = mob.hp;
      mob.hp = 0;
      mob.dead = true;
      const eliteTier2 = mob.eliteTier || 'normal';
      mob.respawnAt = Date.now() + (eliteTier2 === 'champion' ? 12000 : eliteTier2 === 'elite' ? 8000 : 3000);
      const p = this.rpgGetPlayerData(username);
      const goldBase = mob.goldMin + Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1));
      this.addGold(p, goldBase);
      this.addXP(p, mob.xpReward);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      // Use templateName for loot key (mob.name has elite prefix)
      const mobKey = (mob.templateName || mob.name).toLowerCase().replace(/\s+/g, '_');
      let lootDrops2 = this.rollLootTable(mobKey);
      if (eliteTier2 === 'elite') { lootDrops2 = lootDrops2.concat(this.rollLootTable(mobKey)); }
      else if (eliteTier2 === 'champion') { lootDrops2 = lootDrops2.concat(this.rollLootTable(mobKey), this.rollLootTable(mobKey)); }
      const droppedItems = [], droppedWearables = [];
      for (const drop of lootDrops2) {
        if (drop.wearable) {
          const ww = WEARABLES[drop.itemId];
          if (ww && !p.wearables.includes(drop.itemId)) { p.wearables.push(drop.itemId); droppedWearables.push({ id: drop.itemId, name: ww.name, icon: ww.icon, rarity: ww.rarity, slot: ww.slot }); }
        } else {
          const added = this.addItemToInventory(p, drop.itemId, drop.qty);
          if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
        }
      }
      this.saveData();
      this.rpgSendTo(username, { type: 'rpg_mob_died', data: { mobId: targetId, killer: username, eliteTier: eliteTier2 } });
      return { success: true, type: 'mob', name: mob.name, dmg, gold: goldBase, xp: mob.xpReward, drops: droppedItems, wearableDrops: droppedWearables };
    }

    return { error: 'invalid_target' };
  }

  rpgAdminFly(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    rp.fly = !rp.fly;
    return { success: true, fly: rp.fly };
  }

  rpgAdminTeleport(username, zoneId) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const zone = RPG_ZONES[zoneId];
    if (!zone) return { error: 'invalid_zone' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const oldZone = rp.zone;
    // Clean up old zone per-player data
    if (oldZone && oldZone !== zoneId) {
      const oldW = this.rpgWorld[oldZone];
      if (oldW && oldW.playerBosses) delete oldW.playerBosses[username];
      if (oldW && oldW.playerMobs) delete oldW.playerMobs[username];
    }
    this.rpgBroadcastZone(oldZone, { type: 'rpg_player_left', data: { username } }, username);
    rp.zone = zoneId;
    rp.x = 1200; rp.y = 700;
    const zw = this.rpgWorld[zoneId];
    if (zw && zw.tileMap) { const sp = this.rpgFindWalkable(zw.tileMap, 1200, 700); rp.x = sp.x; rp.y = sp.y; }
    const p = this.rpgGetPlayerData(username);
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    rp.hp = maxHP; rp.maxHP = maxHP;
    this.rpgBroadcastZone(zoneId, { type: 'rpg_player_joined', data: { username, x: rp.x, y: rp.y, appearance: p.appearance, equipped: p.equipped, activeWearables: p.activeWearables, activeCosmetics: p.activeCosmetics || null } });
    return { success: true, zone: this.rpgGetZoneState(zoneId, username) };
  }

  rpgAdminGiveGold(username, amount) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    amount = Math.max(0, Math.min(1000000, parseInt(amount) || 0));
    this.addGold(p, amount);
    this.saveData();
    return { success: true, amount, gold: p.gold };
  }

  // ═══ Stripe Gold Shop — credit purchased gold ═══
  creditPurchasedGold(username, goldAmount, transactionId) {
    if (!username || !goldAmount || goldAmount <= 0) return { error: 'invalid' };
    // Prevent duplicate transactions
    if (!this.purchaseLog) this.purchaseLog = [];
    if (this.purchaseLog.find(t => t.txId === transactionId)) {
      console.log(`⚠️ Duplicate purchase blocked: ${transactionId}`);
      return { error: 'duplicate', gold: 0 };
    }
    const p = this.rpgGetPlayerData(username);
    // Direct gold add (no goldFindMult — purchased gold is exact)
    p.gold += Math.floor(goldAmount);
    this.purchaseLog.push({
      txId: transactionId,
      username,
      gold: goldAmount,
      time: Date.now()
    });
    // Keep purchase log trimmed to last 1000 entries
    if (this.purchaseLog.length > 1000) this.purchaseLog = this.purchaseLog.slice(-1000);
    this.logAction(username, 'purchase', `+${goldAmount}g (Stripe: ${transactionId.slice(0, 20)})`);
    this.saveData();
    return { success: true, gold: p.gold, added: goldAmount };
  }

  rpgAdminGiveItem(username, itemId, qty) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    qty = Math.max(1, Math.min(99, parseInt(qty) || 1));
    const item = ITEMS[itemId];
    if (!item) return { error: 'invalid_item' };
    const added = this.addItemToInventory(p, itemId, qty);
    if (!added) return { error: 'inventory_full' };
    this.saveData();
    return { success: true, itemId, name: item.name, qty, icon: item.icon };
  }

  rpgAdminGiveWearable(username, key) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    const w = WEARABLES[key];
    if (!w) return { error: 'invalid_wearable' };
    if (p.wearables.includes(key)) return { error: 'already_owned' };
    p.wearables.push(key);
    this.saveData();
    return { success: true, key, name: w.name, icon: w.icon, rarity: w.rarity };
  }

  rpgAdminSetLevel(username, level) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    level = Math.max(1, Math.min(100, parseInt(level) || 1));
    p.level = level;
    p.xp = 0;
    const rp = this.rpgPlayers[username];
    if (rp) {
      const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
      rp.hp = maxHP; rp.maxHP = maxHP;
    }
    this.saveData();
    return { success: true, level, gold: p.gold };
  }

  rpgAdminSetMiningLevel(username, level) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    level = Math.max(1, Math.min(100, parseInt(level) || 1));
    p.rpg.miningLevel = level;
    p.rpg.miningXP = 0;
    this.saveData();
    return { success: true, miningLevel: level };
  }

  rpgAdminSetTrust(username, trust) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    trust = Math.max(0, Math.min(200, parseInt(trust) || 0));
    p.rpg.trust = trust;
    this.saveData();
    return { success: true, trust };
  }

  rpgAdminCompleteGrizzleQuests(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    // Server-side just returns success — quests are tracked client-side
    return { success: true };
  }

  rpgAdminHeal(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const p = this.rpgGetPlayerData(username);
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    rp.hp = maxHP;
    rp.maxHP = maxHP;
    return { success: true, hp: maxHP };
  }

  rpgAdminSpeed(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    rp.speedBoost = rp.speedBoost ? false : true;
    return { success: true, speedBoost: rp.speedBoost };
  }

  rpgAdminSpawnBoss(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const zone = RPG_ZONES[rp.zone];
    if (!zone || !zone.boss) return { error: 'no_boss_zone' };
    const w = this.rpgWorld[rp.zone];
    const pb = w && w.playerBosses && w.playerBosses[username];
    if (pb && pb.boss && !pb.boss.dead) return { error: 'boss_alive' };
    // Force spawn for this player
    if (!w.playerBosses) w.playerBosses = {};
    if (!pb) {
      this.rpgEnsurePlayerBoss(rp.zone, username);
    } else {
      pb.boss = this.rpgMakeBoss(rp.zone);
      pb.saplings = [];
    }
    const freshPb = w.playerBosses[username];
    this.rpgSendTo(username, { type: 'rpg_boss_spawn', data: this.rpgGetBossData(freshPb.boss) });
    return { success: true, zone: rp.zone, bossName: zone.boss.name };
  }

  rpgAdminKillAllMobs(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const w = this.rpgWorld[rp.zone];
    if (!w) return { error: 'invalid_zone' };
    let count = 0;
    const pmobs = (w.playerMobs && w.playerMobs[username]) || [];
    pmobs.forEach(m => { if (!m.dead) { m.dead = true; m.respawnAt = Date.now() + 20000; count++; } });
    return { success: true, killed: count };
  }

  rpgAdminGiveAllWearables(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    let added = 0;
    for (const key of Object.keys(WEARABLES)) {
      if (!p.wearables.includes(key)) { p.wearables.push(key); added++; }
    }
    this.saveData();
    return { success: true, added, total: p.wearables.length };
  }

  rpgAdminGiveAllItems(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    let added = 0;
    for (const [id, item] of Object.entries(ITEMS)) {
      if (item.stackable) {
        const existing = (p.inventory || []).find(i => i.id === id);
        if (existing) { existing.qty = (existing.qty || 0) + 10; } else { this.addItemToInventory(p, id, 10); }
        added++;
      } else {
        this.addItemToInventory(p, id, 1);
        added++;
      }
    }
    this.saveData();
    return { success: true, added };
  }

  rpgAdminGetGameData() {
    return {
      items: ITEMS,
      wearables: WEARABLES,
      cosmetics: COSMETICS,
      lootTables: LOOT_TABLES,
      recipes: RECIPES,
      npcShop: NPC_SHOP,
      bossLoot: BOSS_LOOT,
      zones: RPG_ZONES,
      pickaxes: RPG_PICKAXES,
      rarityColors: RARITY_COLOR,
      vendorPrices: VENDOR_PRICE,
      achievements: Object.entries(ACHIEVEMENTS).map(([k, v]) => ({ id: k, name: v.name, desc: v.desc })),
    };
  }

  // ── Admin Event Controls ──
  rpgAdminForceCaravan(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    if (this.activeCaravan) this.rpgEndCaravan();
    const c = this.rpgStartCaravan();
    return { success: true, ore: c.oreName, price: c.caravanPrice, duration: CARAVAN_CONFIG.duration };
  }

  rpgAdminStopCaravan(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    if (!this.activeCaravan) return { error: 'no_caravan' };
    this.rpgEndCaravan();
    return { success: true };
  }

  rpgAdminOpenGoldVein(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    // Temporarily enable the gold vein landmark
    const hub = RPG_ZONES.hub;
    if (!hub || !hub.landmarks) return { error: 'no_hub' };
    const lm = hub.landmarks.find(l => l.id === 'lm_gold_vein');
    if (!lm) return { error: 'no_landmark' };
    lm.zone = 'gold_vein';
    // Broadcast announcement to all RPG players
    this.rpgBroadcastAll({ type: 'rpg_announcement', data: { message: '💰 GOLD VEIN OPENED! Rush to the Mining Quarter!' } });
    return { success: true };
  }

  rpgAdminCloseGoldVein(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const hub = RPG_ZONES.hub;
    if (!hub || !hub.landmarks) return { error: 'no_hub' };
    const lm = hub.landmarks.find(l => l.id === 'lm_gold_vein');
    if (!lm) return { error: 'no_landmark' };
    lm.zone = null;
    this.rpgBroadcastAll({ type: 'rpg_announcement', data: { message: '💰 Gold Vein has closed.' } });
    return { success: true };
  }

  rpgAdminDoubleXP(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const dur = 600000; // 10 minutes
    this.doubleXPUntil = Date.now() + dur;
    this.rpgBroadcastAll({ type: 'rpg_announcement', data: { message: '⚡ DOUBLE XP for 10 minutes!' } });
    return { success: true, duration: dur };
  }

  rpgAdminGiveAllCosmetics(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    if (!p.cosmetics) p.cosmetics = [];
    let added = 0;
    for (const key of Object.keys(COSMETICS)) {
      if (!p.cosmetics.includes(key)) { p.cosmetics.push(key); added++; }
    }
    this.saveData();
    return { success: true, added, total: p.cosmetics.length };
  }

  rpgAdminGiveCosmetic(username, cosmeticId) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const p = this.rpgGetPlayerData(username);
    const c = COSMETICS[cosmeticId];
    if (!c) return { error: 'invalid_cosmetic' };
    if (!p.cosmetics) p.cosmetics = [];
    if (p.cosmetics.includes(cosmeticId)) return { error: 'already_owned' };
    p.cosmetics.push(cosmeticId);
    this.saveData();
    return { success: true, key: cosmeticId, name: c.name };
  }

  rpgAdminRespawnAllMobs(username) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const w = this.rpgWorld[rp.zone];
    if (!w) return { error: 'invalid_zone' };
    let count = 0;
    const pmobs = (w.playerMobs && w.playerMobs[username]) || [];
    pmobs.forEach(m => { if (m.dead) { m.dead = false; m.hp = m.maxHP; m.respawnAt = 0; count++; } });
    return { success: true, respawned: count };
  }

  rpgAdminSetDmgMult(username, mult) {
    if (!this.isRPGAdmin(username)) return { error: 'not_admin' };
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    mult = Math.max(1, Math.min(50, parseFloat(mult) || 1));
    rp.adminDmgMult = mult;
    return { success: true, dmgMult: mult };
  }

  // ═══════════════════════════════════════════
  // Party System
  // ═══════════════════════════════════════════
  rpgPartyInvite(fromUser, toUser) {
    if (fromUser === toUser) return { error: 'cannot_invite_self' };
    if (!this.rpgPlayers[toUser]) return { error: 'player_not_online' };
    // Check if target already in a party
    if (this.rpgPlayerParty[toUser]) return { error: 'player_in_party' };
    let partyId = this.rpgPlayerParty[fromUser];
    let party;
    if (partyId != null) {
      party = this.rpgParties[partyId];
      if (party.leader !== fromUser) return { error: 'not_leader' };
      if (party.members.length >= 4) return { error: 'party_full' };
    } else {
      // Create a new party with the inviter as leader
      partyId = ++this.rpgPartyId;
      party = { leader: fromUser, members: [fromUser], invites: {} };
      this.rpgParties[partyId] = party;
      this.rpgPlayerParty[fromUser] = partyId;
    }
    party.invites[toUser] = Date.now();
    // Notify the invited player
    this.rpgSendTo(toUser, { type: 'rpg_party_invite', data: { partyId, from: fromUser } });
    return { success: true, partyId };
  }

  rpgPartyAccept(username, partyId) {
    const party = this.rpgParties[partyId];
    if (!party) return { error: 'party_not_found' };
    if (!party.invites[username]) return { error: 'no_invite' };
    if (party.members.length >= 4) return { error: 'party_full' };
    if (this.rpgPlayerParty[username]) return { error: 'already_in_party' };
    delete party.invites[username];
    party.members.push(username);
    this.rpgPlayerParty[username] = partyId;
    // Notify all party members
    for (const m of party.members) {
      this.rpgSendTo(m, { type: 'rpg_party_update', data: this.rpgGetPartyData(partyId) });
    }
    return { success: true };
  }

  rpgPartyDecline(username, partyId) {
    const party = this.rpgParties[partyId];
    if (!party) return { error: 'party_not_found' };
    delete party.invites[username];
    this.rpgSendTo(party.leader, { type: 'rpg_party_declined', data: { username } });
    // If the party was just created for this invite and has only the leader, dissolve
    if (party.members.length === 1 && Object.keys(party.invites).length === 0) {
      delete this.rpgPlayerParty[party.leader];
      delete this.rpgParties[partyId];
    }
    return { success: true };
  }

  rpgPartyLeave(username) {
    const partyId = this.rpgPlayerParty[username];
    if (partyId == null) return { error: 'not_in_party' };
    const party = this.rpgParties[partyId];
    if (!party) return { error: 'party_not_found' };
    // If in a dungeon instance, leave it first
    if (party.dungeonInstanceId && this.rpgDungeonInstances[party.dungeonInstanceId]) {
      const rp = this.rpgPlayers[username];
      if (rp && rp.zone === party.dungeonInstanceId) {
        this.rpgDungeonLeave(username);
      }
    }
    party.dungeonReady = {};
    party.members = party.members.filter(m => m !== username);
    delete this.rpgPlayerParty[username];
    if (party.members.length === 0) {
      delete this.rpgParties[partyId];
      return { success: true, dissolved: true };
    }
    // If leader left, promote next member
    if (party.leader === username) {
      party.leader = party.members[0];
    }
    // Notify remaining members
    for (const m of party.members) {
      this.rpgSendTo(m, { type: 'rpg_party_update', data: this.rpgGetPartyData(partyId) });
    }
    // If only 1 member left, dissolve the party
    if (party.members.length === 1) {
      const lastMember = party.members[0];
      delete this.rpgPlayerParty[lastMember];
      delete this.rpgParties[partyId];
      this.rpgSendTo(lastMember, { type: 'rpg_party_dissolved', data: {} });
    }
    return { success: true };
  }

  rpgPartyKick(leader, target) {
    const partyId = this.rpgPlayerParty[leader];
    if (partyId == null) return { error: 'not_in_party' };
    const party = this.rpgParties[partyId];
    if (party.leader !== leader) return { error: 'not_leader' };
    if (!party.members.includes(target)) return { error: 'not_in_party' };
    // If target is in dungeon instance, remove them
    if (party.dungeonInstanceId && this.rpgDungeonInstances[party.dungeonInstanceId]) {
      const rp = this.rpgPlayers[target];
      if (rp && rp.zone === party.dungeonInstanceId) {
        this.rpgDungeonLeave(target);
      }
    }
    party.dungeonReady = {};
    party.members = party.members.filter(m => m !== target);
    delete this.rpgPlayerParty[target];
    this.rpgSendTo(target, { type: 'rpg_party_kicked', data: {} });
    // Notify remaining
    for (const m of party.members) {
      this.rpgSendTo(m, { type: 'rpg_party_update', data: this.rpgGetPartyData(partyId) });
    }
    if (party.members.length <= 1) {
      const lastMember = party.members[0];
      if (lastMember) {
        delete this.rpgPlayerParty[lastMember];
        this.rpgSendTo(lastMember, { type: 'rpg_party_dissolved', data: {} });
      }
      delete this.rpgParties[partyId];
    }
    return { success: true };
  }

  rpgGetPartyData(partyId) {
    const party = this.rpgParties[partyId];
    if (!party) return null;
    return {
      partyId,
      leader: party.leader,
      members: party.members.map(m => {
        const rp = this.rpgPlayers[m];
        const p = this.players[m];
        return {
          username: m,
          level: p ? p.level : 1,
          hp: rp ? rp.hp : 0,
          maxHP: rp ? rp.maxHP : 0,
          zone: rp ? rp.zone : 'hub',
        };
      }),
    };
  }

  rpgGetPartyMembers(username) {
    const partyId = this.rpgPlayerParty[username];
    if (partyId == null) return [];
    const party = this.rpgParties[partyId];
    if (!party) return [];
    return party.members.filter(m => m !== username);
  }

  // ── Community Milestones ──
  rpgCheckMilestones() {
    for (const ms of COMMUNITY_MILESTONES) {
      if (this.communityMilestonesCompleted.includes(ms.id)) continue;
      try {
        if (ms.check(this)) {
          this.communityMilestonesCompleted.push(ms.id);
          // Broadcast to all online RPG players
          this.rpgBroadcastAll({
            type: 'rpg_milestone',
            data: { id: ms.id, title: ms.title, desc: ms.desc, reward: ms.reward }
          });
          // Apply rewards
          if (ms.id === 'ms_10_players') {
            for (const u of Object.keys(this.players)) {
              if (this.players[u].rpg) this.players[u].gold = (this.players[u].gold || 0) + 100;
            }
          }
          this.saveData();
        }
      } catch (e) { console.error('[Milestone check error]', ms.id, e.message); }
    }
  }

  rpgBroadcastZone(zoneId, msg, exclude) {
    const str = JSON.stringify(msg);
    for (const [u, rp] of Object.entries(this.rpgPlayers)) {
      if (rp.zone === zoneId && u !== exclude && rp.ws) {
        try { rp.ws.send(str); } catch (e) { console.error(`[WS send error] user=${u}`, e.message); }
      }
    }
  }

  rpgBroadcastAll(msg) {
    const str = JSON.stringify(msg);
    for (const [u, rp] of Object.entries(this.rpgPlayers)) {
      if (rp.ws) {
        try { rp.ws.send(str); } catch (e) { console.error(`[WS send error] user=${u}`, e.message); }
      }
    }
  }

  rpgBroadcastToPlayer(username, msg) {
    const rp = this.rpgPlayers[username];
    if (rp && rp.ws) {
      try { rp.ws.send(JSON.stringify(msg)); } catch (e) { console.error(`[WS send error] user=${username}`, e.message); }
    }
  }

  rpgSendTo(username, msg) {
    const rp = this.rpgPlayers[username];
    if (rp && rp.ws) {
      try { rp.ws.send(JSON.stringify(msg)); } catch (e) { console.error(`[WS send error] user=${username}`, e.message); }
    }
  }

  rpgGetOnlineCount() {
    return Object.values(this.rpgPlayers).filter(rp => !rp.disconnected).length;
  }

  // ═══════════════════════════════════════════
  // RPG Player-to-Player Trading
  // ═══════════════════════════════════════════
  rpgTradeRequest(from, to) {
    if (from === to) return { error: 'cannot_trade_self' };
    const rpFrom = this.rpgPlayers[from];
    const rpTo = this.rpgPlayers[to];
    if (!rpFrom || !rpTo) return { error: 'player_offline' };
    // Check proximity (must be in same zone and within 150px)
    if (rpFrom.zone !== rpTo.zone) return { error: 'different_zone' };
    const dx = rpFrom.x - rpTo.x, dy = rpFrom.y - rpTo.y;
    if (Math.sqrt(dx * dx + dy * dy) > 150) return { error: 'too_far' };
    // Check if either player is already in a trade
    for (const t of Object.values(this.pendingTrades)) {
      if (t.p1 === from || t.p2 === from || t.p1 === to || t.p2 === to) return { error: 'already_trading' };
    }
    const tradeId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this.pendingTrades[tradeId] = {
      p1: from, p2: to,
      offer1: { items: [], gold: 0 }, offer2: { items: [], gold: 0 },
      locked1: false, locked2: false,
      confirmed1: false, confirmed2: false,
    };
    this.rpgSendTo(to, { type: 'rpg_trade_request', data: { tradeId, from } });
    return { success: true, tradeId };
  }

  rpgTradeAcceptRequest(username, tradeId) {
    const t = this.pendingTrades[tradeId];
    if (!t || t.p2 !== username) return { error: 'invalid_trade' };
    // Notify both players trade is open
    this.rpgSendTo(t.p1, { type: 'rpg_trade_open', data: { tradeId, partner: t.p2 } });
    this.rpgSendTo(t.p2, { type: 'rpg_trade_open', data: { tradeId, partner: t.p1 } });
    return { success: true };
  }

  rpgTradeDecline(username, tradeId) {
    const t = this.pendingTrades[tradeId];
    if (!t || (t.p1 !== username && t.p2 !== username)) return { error: 'invalid_trade' };
    const other = t.p1 === username ? t.p2 : t.p1;
    this.rpgSendTo(other, { type: 'rpg_trade_cancelled', data: { reason: 'declined' } });
    delete this.pendingTrades[tradeId];
    return { success: true };
  }

  rpgTradeOffer(username, tradeId, itemUids, goldAmount) {
    const t = this.pendingTrades[tradeId];
    if (!t || (t.p1 !== username && t.p2 !== username)) return { error: 'invalid_trade' };
    const isP1 = t.p1 === username;
    if ((isP1 && t.locked1) || (!isP1 && t.locked2)) return { error: 'already_locked' };
    // Reset confirmations when offer changes
    t.confirmed1 = false; t.confirmed2 = false;
    t.locked1 = false; t.locked2 = false;
    const p = this.player(username);
    goldAmount = Math.max(0, Math.min(Math.floor(goldAmount || 0), p.gold));
    // Validate items exist in inventory
    const validItems = [];
    for (const uid of (itemUids || [])) {
      const item = p.inventory.find(i => i.uid === uid);
      if (item) validItems.push({ uid: item.uid, id: item.id, name: item.name, icon: item.icon, qty: item.qty || 1, rarity: item.rarity });
    }
    const offer = { items: validItems, gold: goldAmount };
    if (isP1) t.offer1 = offer; else t.offer2 = offer;
    // Send updated offers to both
    const tradeState = { tradeId, offer1: t.offer1, offer2: t.offer2, locked1: t.locked1, locked2: t.locked2, confirmed1: t.confirmed1, confirmed2: t.confirmed2 };
    this.rpgSendTo(t.p1, { type: 'rpg_trade_update', data: tradeState });
    this.rpgSendTo(t.p2, { type: 'rpg_trade_update', data: tradeState });
    return { success: true };
  }

  rpgTradeLock(username, tradeId) {
    const t = this.pendingTrades[tradeId];
    if (!t || (t.p1 !== username && t.p2 !== username)) return { error: 'invalid_trade' };
    if (t.p1 === username) t.locked1 = true; else t.locked2 = true;
    const tradeState = { tradeId, offer1: t.offer1, offer2: t.offer2, locked1: t.locked1, locked2: t.locked2, confirmed1: t.confirmed1, confirmed2: t.confirmed2 };
    this.rpgSendTo(t.p1, { type: 'rpg_trade_update', data: tradeState });
    this.rpgSendTo(t.p2, { type: 'rpg_trade_update', data: tradeState });
    return { success: true };
  }

  rpgTradeConfirm(username, tradeId) {
    const t = this.pendingTrades[tradeId];
    if (!t || (t.p1 !== username && t.p2 !== username)) return { error: 'invalid_trade' };
    // Both must be locked before confirming
    if (!t.locked1 || !t.locked2) return { error: 'not_locked' };
    if (t.p1 === username) t.confirmed1 = true; else t.confirmed2 = true;
    // Broadcast updated confirm state to both
    const confirmState = { tradeId, offer1: t.offer1, offer2: t.offer2, locked1: t.locked1, locked2: t.locked2, confirmed1: t.confirmed1, confirmed2: t.confirmed2 };
    this.rpgSendTo(t.p1, { type: 'rpg_trade_update', data: confirmState });
    this.rpgSendTo(t.p2, { type: 'rpg_trade_update', data: confirmState });
    if (t.confirmed1 && t.confirmed2) {
      // Execute the trade
      const result = this._executeTrade(t);
      if (result.error) {
        this.rpgSendTo(t.p1, { type: 'rpg_trade_cancelled', data: { reason: result.error } });
        this.rpgSendTo(t.p2, { type: 'rpg_trade_cancelled', data: { reason: result.error } });
        delete this.pendingTrades[tradeId];
        return result;
      }
      this.rpgSendTo(t.p1, { type: 'rpg_trade_complete', data: { partner: t.p2 } });
      this.rpgSendTo(t.p2, { type: 'rpg_trade_complete', data: { partner: t.p1 } });
      delete this.pendingTrades[tradeId];
      return { success: true, completed: true };
    }
    // Notify partner of confirmation
    const other = t.p1 === username ? t.p2 : t.p1;
    this.rpgSendTo(other, { type: 'rpg_trade_partner_confirmed', data: { tradeId } });
    return { success: true, waiting: true };
  }

  _executeTrade(t) {
    const p1 = this.player(t.p1);
    const p2 = this.player(t.p2);
    if (!p1 || !p2) return { error: 'player_not_found' };
    // Verify gold
    if (p1.gold < t.offer1.gold || p2.gold < t.offer2.gold) return { error: 'insufficient_gold' };
    // Verify items still exist
    for (const item of t.offer1.items) {
      if (!p1.inventory.find(i => i.uid === item.uid)) return { error: 'item_missing' };
    }
    for (const item of t.offer2.items) {
      if (!p2.inventory.find(i => i.uid === item.uid)) return { error: 'item_missing' };
    }
    // Transfer gold
    p1.gold -= t.offer1.gold; p2.gold += t.offer1.gold;
    p2.gold -= t.offer2.gold; p1.gold += t.offer2.gold;
    // Transfer items from p1 to p2
    for (const item of t.offer1.items) {
      const idx = p1.inventory.findIndex(i => i.uid === item.uid);
      if (idx !== -1) { const [moved] = p1.inventory.splice(idx, 1); p2.inventory.push(moved); }
    }
    // Transfer items from p2 to p1
    for (const item of t.offer2.items) {
      const idx = p2.inventory.findIndex(i => i.uid === item.uid);
      if (idx !== -1) { const [moved] = p2.inventory.splice(idx, 1); p1.inventory.push(moved); }
    }
    p1.tradeCount = (p1.tradeCount || 0) + 1;
    p2.tradeCount = (p2.tradeCount || 0) + 1;
    this.logAction(t.p1, 'trade', 'Traded with ' + t.p2 + ' (gave ' + t.offer1.items.length + ' items + ' + t.offer1.gold + 'g)');
    this.logAction(t.p2, 'trade', 'Traded with ' + t.p1 + ' (gave ' + t.offer2.items.length + ' items + ' + t.offer2.gold + 'g)');
    this.saveData();
    return { success: true };
  }

  rpgTradeCancel(username) {
    for (const [id, t] of Object.entries(this.pendingTrades)) {
      if (t.p1 === username || t.p2 === username) {
        const other = t.p1 === username ? t.p2 : t.p1;
        this.rpgSendTo(other, { type: 'rpg_trade_cancelled', data: { reason: 'cancelled' } });
        delete this.pendingTrades[id];
        return { success: true };
      }
    }
    return { error: 'no_trade' };
  }

  // ═══════════════════════════════════════════
  // RPG Duel System — Turn-based PvP
  // ═══════════════════════════════════════════
  getPlayerBracket(level) {
    for (const b of ARENA_CONFIG.brackets) {
      if (level >= b.minLv && level <= b.maxLv) return b.id;
    }
    return ARENA_CONFIG.brackets[ARENA_CONFIG.brackets.length - 1].id;
  }

  getArenaRank(rating) {
    let rank = ARENA_CONFIG.ranks[0];
    for (const r of ARENA_CONFIG.ranks) {
      if (rating >= r.minRating) rank = r;
    }
    return rank;
  }

  rpgDuelJoinQueue(username) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.inDuel) return { error: 'already_in_duel' };
    if (this.rpgDuelQueue.includes(username)) return { error: 'already_queued' };
    const p = this.rpgGetPlayerData(username);
    const bracket = this.getPlayerBracket(p.level);
    this.rpgDuelQueue.push(username);
    rp._duelQueuedAt = Date.now();
    // Try to match within same bracket first
    const match = this.rpgDuelQueue.find(u => {
      if (u === username) return false;
      const op = this.rpgGetPlayerData(u);
      return op && this.getPlayerBracket(op.level) === bracket;
    });
    if (match) {
      this.rpgDuelQueue.splice(this.rpgDuelQueue.indexOf(username), 1);
      this.rpgDuelQueue.splice(this.rpgDuelQueue.indexOf(match), 1);
      this.rpgDuelStart(username, match);
      return { matched: true, bracket };
    }
    // No same-bracket match — also try anyone who's been waiting 5+ seconds
    const fallback = this.rpgDuelQueue.find(u => {
      if (u === username) return false;
      const urp = this.rpgPlayers[u];
      return urp && urp._duelQueuedAt && Date.now() - urp._duelQueuedAt > 5000;
    });
    if (fallback) {
      this.rpgDuelQueue.splice(this.rpgDuelQueue.indexOf(username), 1);
      this.rpgDuelQueue.splice(this.rpgDuelQueue.indexOf(fallback), 1);
      this.rpgDuelStart(username, fallback);
      return { matched: true, bracket: 'cross' };
    }
    this.rpgBroadcastAll({ type: 'rpg_duel_queue_update', data: { count: this.rpgDuelQueue.length } });
    return { queued: true, position: this.rpgDuelQueue.length, bracket };
  }

  rpgDuelLeaveQueue(username) {
    const idx = this.rpgDuelQueue.indexOf(username);
    if (idx >= 0) {
      this.rpgDuelQueue.splice(idx, 1);
      this.rpgBroadcastAll({ type: 'rpg_duel_queue_update', data: { count: this.rpgDuelQueue.length } });
      return { left: true };
    }
    return { error: 'not_queued' };
  }

  rpgDuelStart(u1, u2) {
    const id = ++this.rpgDuelId;
    const p1 = this.rpgGetPlayerData(u1);
    const p2 = this.rpgGetPlayerData(u2);
    const sc = ARENA_CONFIG.pvpStatScale;
    const hp1 = 50 + p1.level * 5 + (p1.prestige || 0) * 10 + Math.floor(this.equipStat(p1, 'maxHP') * sc.maxHP);
    const hp2 = 50 + p2.level * 5 + (p2.prestige || 0) * 10 + Math.floor(this.equipStat(p2, 'maxHP') * sc.maxHP);
    const baseDmg1 = Math.floor((CONFIG.baseMinDmg + CONFIG.baseMaxDmg) / 2 + (p1.level - 1) * CONFIG.dmgPerLevel);
    const gearDmg1 = Math.floor((this.minDmg(p1) + this.maxDmg(p1)) / 2) - baseDmg1;
    const dmg1 = Math.max(5, baseDmg1 + Math.floor(gearDmg1 * sc.dmgMult));
    const baseDmg2 = Math.floor((CONFIG.baseMinDmg + CONFIG.baseMaxDmg) / 2 + (p2.level - 1) * CONFIG.dmgPerLevel);
    const gearDmg2 = Math.floor((this.minDmg(p2) + this.maxDmg(p2)) / 2) - baseDmg2;
    const dmg2 = Math.max(5, baseDmg2 + Math.floor(gearDmg2 * sc.dmgMult));
    const bracket = this.getPlayerBracket(Math.max(p1.level, p2.level));
    const duel = {
      id, p1: u1, p2: u2,
      p1HP: hp1, p2HP: hp2, p1MaxHP: hp1, p2MaxHP: hp2,
      p1MinDmg: Math.max(3, Math.floor(dmg1 * 0.7)),
      p1MaxDmg: Math.max(5, Math.floor(dmg1 * 1.3)),
      p2MinDmg: Math.max(3, Math.floor(dmg2 * 0.7)),
      p2MaxDmg: Math.max(5, Math.floor(dmg2 * 1.3)),
      p1CritChance: Math.min(0.5, this.critChance(p1) * sc.crit),
      p2CritChance: Math.min(0.5, this.critChance(p2) * sc.crit),
      p1Level: p1.level, p2Level: p2.level,
      p1Rating: p1.arenaRating || 1000, p2Rating: p2.arenaRating || 1000,
      bracket, state: 'active',
      p1LastAtk: 0, p2LastAtk: 0,
      atkCooldown: 800,
      p1OldZone: null, p2OldZone: null,
      timer: setTimeout(() => this.rpgDuelTimeout(id), 120000),
    };
    this.rpgDuels[id] = duel;
    const rp1 = this.rpgPlayers[u1];
    const rp2 = this.rpgPlayers[u2];
    if (rp1) { duel.p1OldZone = rp1.zone; rp1.inDuel = id; rp1.zone = 'colosseum'; rp1.x = 350; rp1.y = 600; }
    if (rp2) { duel.p2OldZone = rp2.zone; rp2.inDuel = id; rp2.zone = 'colosseum'; rp2.x = 850; rp2.y = 600; }
    this.rpgSendTo(u1, { type: 'rpg_duel_start', data: {
      duelId: id, opponent: u2, opponentLevel: p2.level,
      yourHP: hp1, yourMaxHP: hp1, theirHP: hp2, theirMaxHP: hp2,
      opponentAppearance: p2.appearance, opponentEquipped: p2.equipped || {},
      opponentWearables: p2.activeWearables || {}, opponentCosmetics: p2.activeCosmetics || null,
    }});
    this.rpgSendTo(u2, { type: 'rpg_duel_start', data: {
      duelId: id, opponent: u1, opponentLevel: p1.level,
      yourHP: hp2, yourMaxHP: hp2, theirHP: hp1, theirMaxHP: hp1,
      opponentAppearance: p1.appearance, opponentEquipped: p1.equipped || {},
      opponentWearables: p1.activeWearables || {}, opponentCosmetics: p1.activeCosmetics || null,
    }});
    this.rpgBroadcastAll({ type: 'rpg_duel_queue_update', data: { count: this.rpgDuelQueue.length } });
  }

  rpgSetBlock(username, active) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    rp.blocking = !!active;
    rp.blockStart = active ? Date.now() : 0;
  }

  rpgDuelAttack(username) {
    const rp = this.rpgPlayers[username];
    if (!rp || !rp.inDuel) return { error: 'not_in_duel' };
    const duel = this.rpgDuels[rp.inDuel];
    if (!duel || duel.state !== 'active') return { error: 'duel_over' };
    const now = Date.now();
    const isP1 = duel.p1 === username;
    // Cooldown check
    if (isP1 && now - duel.p1LastAtk < duel.atkCooldown) return { error: 'cooldown' };
    if (!isP1 && now - duel.p2LastAtk < duel.atkCooldown) return { error: 'cooldown' };
    // Proximity check
    const attacker = rp;
    const defenderName = isP1 ? duel.p2 : duel.p1;
    const defender = this.rpgPlayers[defenderName];
    if (!defender) return { error: 'opponent_gone' };
    const dx = attacker.x - defender.x, dy = attacker.y - defender.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) return { error: 'too_far' };
    // Calculate damage
    const minD = isP1 ? duel.p1MinDmg : duel.p2MinDmg;
    const maxD = isP1 ? duel.p1MaxDmg : duel.p2MaxDmg;
    let dmg = Math.floor(Math.random() * (maxD - minD + 1)) + minD;
    let crit = false;
    const critChance = isP1 ? duel.p1CritChance : duel.p2CritChance;
    if (Math.random() < critChance) { dmg = Math.floor(dmg * 1.5); crit = true; }
    // Block / Parry check for PvP
    let blocked = false, parried = false;
    if (defender.blocking) {
      if (now - defender.blockStart < 250) {
        parried = true; dmg = 0; crit = false;
        // Penalize attacker: extra cooldown
        if (isP1) duel.p1LastAtk = now + 600;
        else duel.p2LastAtk = now + 600;
      } else {
        blocked = true; dmg = Math.max(1, Math.floor(dmg * 0.5)); crit = false;
      }
    }
    // Apply damage
    if (isP1) { duel.p2HP = Math.max(0, duel.p2HP - dmg); if (!parried) duel.p1LastAtk = now; }
    else { duel.p1HP = Math.max(0, duel.p1HP - dmg); if (!parried) duel.p2LastAtk = now; }
    const defHP = isP1 ? duel.p2HP : duel.p1HP;
    // Broadcast hit to both players
    const hitData = { attacker: username, defender: defenderName, dmg, crit, blocked, parried, defenderHP: defHP, dx: defender.x, dy: defender.y - 40 };
    this.rpgSendTo(duel.p1, { type: 'rpg_duel_hit', data: hitData });
    this.rpgSendTo(duel.p2, { type: 'rpg_duel_hit', data: hitData });
    // Check for death
    if (duel.p1HP <= 0 || duel.p2HP <= 0) {
      let winner = null, loser = null;
      if (duel.p1HP <= 0 && duel.p2HP <= 0) { /* draw */ }
      else if (duel.p2HP <= 0) { winner = duel.p1; loser = duel.p2; }
      else { winner = duel.p2; loser = duel.p1; }
      this.rpgDuelEnd(duel.id, winner, loser);
    }
    return { hit: true };
  }

  rpgDuelEnd(duelId, winner, loser) {
    const duel = this.rpgDuels[duelId];
    if (!duel) return;
    clearTimeout(duel.timer);
    duel.state = 'finished';

    const p1Data = this.player(duel.p1);
    const p2Data = this.player(duel.p2);
    const avgLevel = Math.floor((duel.p1Level + duel.p2Level) / 2);

    if (winner && loser) {
      const wP = this.player(winner);
      const lP = this.player(loser);
      const goldReward = 5 + Math.floor(avgLevel * 2);
      const xpReward = 10 + avgLevel * 3;
      wP.gold += goldReward;
      this.addXP(wP, xpReward);

      // ELO rating update
      const wRating = wP.arenaRating || 1000;
      const lRating = lP.arenaRating || 1000;
      const expectedW = 1 / (1 + Math.pow(10, (lRating - wRating) / 400));
      const expectedL = 1 - expectedW;
      const K = 32;
      const wRatingChange = Math.round(K * (1 - expectedW));
      const lRatingChange = Math.round(K * (0 - expectedL));
      wP.arenaRating = Math.max(0, wRating + wRatingChange);
      lP.arenaRating = Math.max(0, lRating + lRatingChange);

      // Win/loss stats
      wP.duelsWon = (wP.duelsWon || 0) + 1;
      wP.duelWinStreak = (wP.duelWinStreak || 0) + 1;
      if (wP.duelWinStreak > (wP.bestDuelStreak || 0)) wP.bestDuelStreak = wP.duelWinStreak;
      lP.duelsLost = (lP.duelsLost || 0) + 1;
      lP.duelWinStreak = 0;

      // Arena tokens
      const streakTokens = Math.min(wP.duelWinStreak, ARENA_CONFIG.maxStreakBonus) * ARENA_CONFIG.streakBonus;
      const winTokens = ARENA_CONFIG.winTokens + streakTokens;
      const loseTokens = ARENA_CONFIG.loseTokens;
      wP.arenaTokens = (wP.arenaTokens || 0) + winTokens;
      lP.arenaTokens = (lP.arenaTokens || 0) + loseTokens;

      const wRank = this.getArenaRank(wP.arenaRating);
      const lRank = this.getArenaRank(lP.arenaRating);

      this.saveData();
      this.rpgSendTo(winner, { type: 'rpg_duel_end', data: {
        result: 'win', gold: goldReward, xp: xpReward, totalGold: wP.gold,
        ratingChange: wRatingChange, newRating: wP.arenaRating, rank: wRank,
        tokensEarned: winTokens, totalTokens: wP.arenaTokens,
        streak: wP.duelWinStreak, duelsWon: wP.duelsWon, duelsLost: wP.duelsLost,
      }});
      this.rpgSendTo(loser, { type: 'rpg_duel_end', data: {
        result: 'loss', gold: 0, xp: 0, totalGold: lP.gold,
        ratingChange: lRatingChange, newRating: lP.arenaRating, rank: lRank,
        tokensEarned: loseTokens, totalTokens: lP.arenaTokens,
        streak: 0, duelsWon: lP.duelsWon, duelsLost: lP.duelsLost,
      }});
    } else {
      // Draw
      const drawTokens = ARENA_CONFIG.drawTokens;
      p1Data.arenaTokens = (p1Data.arenaTokens || 0) + drawTokens;
      p2Data.arenaTokens = (p2Data.arenaTokens || 0) + drawTokens;
      p1Data.duelWinStreak = 0;
      p2Data.duelWinStreak = 0;
      const r1 = this.getArenaRank(p1Data.arenaRating || 1000);
      const r2 = this.getArenaRank(p2Data.arenaRating || 1000);
      this.saveData();
      this.rpgSendTo(duel.p1, { type: 'rpg_duel_end', data: {
        result: 'draw', gold: 0, xp: 0, totalGold: p1Data.gold,
        ratingChange: 0, newRating: p1Data.arenaRating || 1000, rank: r1,
        tokensEarned: drawTokens, totalTokens: p1Data.arenaTokens,
        streak: 0, duelsWon: p1Data.duelsWon || 0, duelsLost: p1Data.duelsLost || 0,
      }});
      this.rpgSendTo(duel.p2, { type: 'rpg_duel_end', data: {
        result: 'draw', gold: 0, xp: 0, totalGold: p2Data.gold,
        ratingChange: 0, newRating: p2Data.arenaRating || 1000, rank: r2,
        tokensEarned: drawTokens, totalTokens: p2Data.arenaTokens,
        streak: 0, duelsWon: p2Data.duelsWon || 0, duelsLost: p2Data.duelsLost || 0,
      }});
    }
    // Clean up — return players to hub
    const rp1 = this.rpgPlayers[duel.p1];
    const rp2 = this.rpgPlayers[duel.p2];
    if (rp1) {
      rp1.inDuel = null; rp1.zone = duel.p1OldZone || 'hub'; rp1.x = 1200; rp1.y = 1200;
      const p1d = this.players[duel.p1];
      if (p1d) this.rpgBroadcastZone(rp1.zone, { type: 'rpg_player_joined', data: { username: duel.p1, x: rp1.x, y: rp1.y, appearance: p1d.appearance, equipped: p1d.equipped, activeWearables: p1d.activeWearables, activeCosmetics: p1d.activeCosmetics || null } });
    }
    if (rp2) {
      rp2.inDuel = null; rp2.zone = duel.p2OldZone || 'hub'; rp2.x = 1200; rp2.y = 1200;
      const p2d = this.players[duel.p2];
      if (p2d) this.rpgBroadcastZone(rp2.zone, { type: 'rpg_player_joined', data: { username: duel.p2, x: rp2.x, y: rp2.y, appearance: p2d.appearance, equipped: p2d.equipped, activeWearables: p2d.activeWearables, activeCosmetics: p2d.activeCosmetics || null } });
    }
    delete this.rpgDuels[duelId];
  }

  rpgDuelTimeout(duelId) {
    const duel = this.rpgDuels[duelId];
    if (!duel || duel.state !== 'active') return;
    duel.state = 'finished';
    // Time ran out — draw
    this.rpgDuelEnd(duelId, null, null);
  }

  // ═══════════════════════════════════════════
  // Direct Duel Challenges (player-to-player)
  // ═══════════════════════════════════════════
  rpgDuelChallenge(challenger, targetUsername) {
    const rp = this.rpgPlayers[challenger];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.inDuel) return { error: 'already_in_duel' };
    if (challenger === targetUsername) return { error: 'cannot_challenge_self' };
    const rpTarget = this.rpgPlayers[targetUsername];
    if (!rpTarget) return { error: 'target_not_found' };
    if (rpTarget.inDuel) return { error: 'target_in_duel' };
    // Check if already has pending challenge to this target
    for (const ch of Object.values(this.rpgDuelChallenges)) {
      if (ch.challenger === challenger && ch.defender === targetUsername) return { error: 'already_challenged' };
    }
    const id = 'dc_' + (++this.rpgDuelId);
    this.rpgDuelChallenges[id] = { challenger, defender: targetUsername, timestamp: Date.now() };
    // Notify the target
    const p = this.rpgGetPlayerData(challenger);
    this.rpgSendTo(targetUsername, { type: 'rpg_duel_challenge_received', data: {
      challengeId: id, challenger, challengerLevel: p ? p.level : 1,
    }});
    return { sent: true, challengeId: id };
  }

  rpgDuelAcceptChallenge(username, challengeId) {
    const ch = this.rpgDuelChallenges[challengeId];
    if (!ch) return { error: 'not_found' };
    if (ch.defender !== username) return { error: 'not_yours' };
    const rp1 = this.rpgPlayers[ch.challenger];
    const rp2 = this.rpgPlayers[ch.defender];
    if (!rp1) return { error: 'challenger_offline' };
    if (!rp2) return { error: 'not_in_rpg' };
    if (rp1.inDuel || rp2.inDuel) return { error: 'already_in_duel' };
    delete this.rpgDuelChallenges[challengeId];
    // Remove both from queue if they're in it
    const qi1 = this.rpgDuelQueue.indexOf(ch.challenger);
    if (qi1 >= 0) this.rpgDuelQueue.splice(qi1, 1);
    const qi2 = this.rpgDuelQueue.indexOf(ch.defender);
    if (qi2 >= 0) this.rpgDuelQueue.splice(qi2, 1);
    this.rpgDuelStart(ch.challenger, ch.defender);
    return { started: true };
  }

  rpgDuelDeclineChallenge(username, challengeId) {
    const ch = this.rpgDuelChallenges[challengeId];
    if (!ch) return { error: 'not_found' };
    if (ch.defender !== username) return { error: 'not_yours' };
    this.rpgSendTo(ch.challenger, { type: 'rpg_duel_challenge_declined', data: { target: ch.defender } });
    delete this.rpgDuelChallenges[challengeId];
    return { declined: true };
  }

  // ═══════════════════════════════════════════
  // World Events — automated rotating events
  // ═══════════════════════════════════════════
  rpgStartRandomWorldEvent() {
    const eventTypes = Object.keys(WORLD_EVENTS);
    const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    return this.rpgStartWorldEvent(type);
  }

  rpgStartWorldEvent(eventType) {
    if (this.activeWorldEvent) this.rpgEndWorldEvent();
    const cfg = WORLD_EVENTS[eventType];
    if (!cfg) return { error: 'invalid_event' };
    const now = Date.now();
    const event = {
      id: ++this.worldEventId,
      eventType,
      config: cfg,
      startedAt: now,
      expiresAt: now + cfg.duration,
      participants: {},  // username -> { kills, gold, xp, dmgDealt }
      bountyTarget: null,
      bountyClaimed: false,
      hordeGoldPool: cfg.hordeGoldPool || 0, // admin can override
      hordeMobs: [],     // shared horde mobs (mob_invasion only)
      hordeMobsAlive: 0,
    };

    // Special setup per event type
    if (eventType === 'mob_invasion') {
      // Spawn shared horde mobs in hub zone visible to ALL players
      const count = cfg.hordeMobCount || 15;
      const templates = cfg.hordeMobs || [];
      const hubZone = RPG_ZONES.hub;
      // Spawn mobs in the combat region of hub (right side) 
      const combatRegion = hubZone.regions ? hubZone.regions.combat : null;
      const spawnMinX = combatRegion ? combatRegion.x1 * 40 : 1700;
      const spawnMaxX = combatRegion ? combatRegion.x2 * 40 : 2200;
      const spawnMinY = combatRegion ? combatRegion.y1 * 40 : 200;
      const spawnMaxY = combatRegion ? combatRegion.y2 * 40 : 1200;
      for (let i = 0; i < count; i++) {
        const tmpl = templates[Math.floor(Math.random() * templates.length)];
        const mob = {
          id: 'horde_' + event.id + '_' + i,
          name: tmpl.name,
          templateName: tmpl.name,
          hp: tmpl.maxHP,
          maxHP: tmpl.maxHP,
          atk: tmpl.atk,
          color: tmpl.color,
          x: spawnMinX + Math.random() * (spawnMaxX - spawnMinX),
          y: spawnMinY + Math.random() * (spawnMaxY - spawnMinY),
          homeX: 0, homeY: 0,
          moveSpeed: tmpl.moveSpeed || 0.5,
          chaseSpeed: (tmpl.moveSpeed || 0.5) * 2,
          aggroRange: 150,
          leashRange: 9999, // don't leash — they're invaders
          atkCD: tmpl.atkCD || 2000,
          lastAtk: 0,
          dead: false,
          isHorde: true,
          eliteTier: 'normal',
          facing: -1,
          behavior: 'aggressive',
          goldMin: 0, goldMax: 0, // no individual gold — gold comes from pool
          xpReward: Math.floor(tmpl.maxHP / 10),
        };
        mob.homeX = mob.x; mob.homeY = mob.y;
        event.hordeMobs.push(mob);
      }
      event.hordeMobsAlive = count;
      // Send horde mobs to all players currently in hub
      for (const [username, rp] of Object.entries(this.rpgPlayers)) {
        if (rp.disconnected) continue;
        if (rp.zone === 'hub') {
          for (const mob of event.hordeMobs) {
            this.rpgSendTo(username, { type: 'rpg_mob_spawn', data: mob });
          }
        }
      }
    }
    if (eventType === 'bounty_hunt') {
      // Spawn the Gilded Hoarder — a shared bounty boss visible to ALL players in the zone
      const zone = cfg._adminZone || event.bountyZone || cfg.zones[0] || 'forest';
      // Spawn coords based on zone — center of combat area
      const spawnCoords = {
        hub: { x: 2000, y: 600 },
        forest: { x: 1200, y: 600 },
        quarry: { x: 1200, y: 600 },
        underground_mine: { x: 1200, y: 600 },
        deep_mine: { x: 1200, y: 600 },
        dungeon: { x: 1200, y: 600 },
      };
      const sp = spawnCoords[zone] || { x: 1200, y: 600 };
      event.bountyBoss = {
        id: 'bounty_boss_' + event.id,
        name: 'Gilded Hoarder',
        hp: cfg.bountyBossHP || 15000,
        maxHP: cfg.bountyBossHP || 15000,
        atk: cfg.bountyBossAtk || 25,
        x: sp.x, y: sp.y,
        homeX: sp.x, homeY: sp.y,
        zone: zone,
        dead: false,
        isBountyBoss: true,
        facing: -1,
        state: 'idle',
        moveSpeed: 0.6,
        chaseSpeed: 1.5,
        aggroRange: 250,
        atkCD: 3000,
        lastAtk: 0,
        lastAbility: {},       // ability name → last use timestamp
        damageDealers: {},     // username → total damage dealt
        currentAttack: null,   // { name, type, targetX, targetY, radius, startedAt, telegraphEnd }
        phase: 'normal',       // normal, enraged (below 50%), desperate (below 20%)
        phaseChanged: 0,
        color: '#ffd700',
        eliteTier: 'champion',
      };
      event.bountyTarget = { zone, name: 'Gilded Hoarder', spawned: true };
      // Send boss to all players in the zone
      for (const [u, rp] of Object.entries(this.rpgPlayers)) {
        if (rp.disconnected || rp.zone !== zone) continue;
        this.rpgSendTo(u, { type: 'rpg_bounty_boss_spawn', data: this._getBountyBossClientData(event.bountyBoss) });
      }
    }
    if (eventType === 'boss_rush') {
      // Instantly respawn all dead bosses for all players
      for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
        if (w.playerBosses) {
          for (const [u, pb] of Object.entries(w.playerBosses)) {
            if (pb.boss && pb.boss.dead) {
              pb.boss = this.rpgMakeBoss(zoneId);
              pb.saplings = [];
              this.rpgSendTo(u, { type: 'rpg_boss_spawn', data: this.rpgGetBossData(pb.boss) });
            }
          }
        }
      }
    }

    this.activeWorldEvent = event;
    // Broadcast to all players
    const multipliers = {};
    if (cfg.goldMult && cfg.goldMult > 1) multipliers.gold = cfg.goldMult;
    if (cfg.xpMult && cfg.xpMult > 1) multipliers.xp = cfg.xpMult;
    if (cfg.mobDmgMult && cfg.mobDmgMult > 1) multipliers.mobDmg = cfg.mobDmgMult;
    if (cfg.miningGoldMult && cfg.miningGoldMult > 1) multipliers.miningGold = cfg.miningGoldMult;
    this.rpgBroadcastAll({ type: 'rpg_world_event_start', data: {
      id: event.id, type: eventType, name: cfg.name, icon: cfg.icon,
      desc: cfg.desc, duration: cfg.duration, endsAt: event.expiresAt,
      multipliers, bountyTarget: event.bountyTarget,
      bountyBoss: event.bountyBoss ? this._getBountyBossClientData(event.bountyBoss) : null,
      hordeGoldPool: event.hordeGoldPool || 0,
      hordeMobsAlive: event.hordeMobsAlive || 0,
    }});
    return { started: true, event: eventType, name: cfg.name };
  }

  _spawnInvasionMobs(username, zoneId, count) {
    const w = this.rpgWorld[zoneId];
    if (!w || !w.playerMobs) return;
    if (!w.playerMobs[username]) return;
    const zone = RPG_ZONES[zoneId];
    if (!zone || !zone.mobs) return;
    for (let i = 0; i < count; i++) {
      const mob = this.rpgMakeMob(zoneId, w.playerMobs[username].length + i, null, null);
      mob.isInvasion = true; // tag so we can give bonus rewards
      mob.hp = Math.floor(mob.hp * 1.5); // tougher invasion mobs
      mob.maxHP = mob.hp;
      w.playerMobs[username].push(mob);
      this.rpgSendTo(username, { type: 'rpg_mob_spawn', data: mob });
    }
  }

  rpgEndWorldEvent() {
    if (!this.activeWorldEvent) return;
    const event = this.activeWorldEvent;
    const cfg = event.config;

    // Distribute participation rewards
    const participants = Object.entries(event.participants);

    // Horde event: distribute shared gold pool among all participants who got kills
    if (event.eventType === 'mob_invasion' && event.hordeGoldPool > 0 && participants.length > 0) {
      const totalKills = participants.reduce((sum, [, p]) => sum + (p.kills || 0), 0);
      if (totalKills > 0) {
        for (const [username, pData] of participants) {
          const share = Math.floor(event.hordeGoldPool * (pData.kills / totalKills));
          if (share > 0) {
            const pp = this.player(username);
            if (pp) {
              pp.gold += share;
              pData.gold += share;
              this.rpgSendTo(username, { type: 'rpg_horde_reward', data: { gold: share, kills: pData.kills, totalKills } });
            }
          }
        }
      }
    }

    if (participants.length > 0) {
      // Sort by kills for MVP
      participants.sort((a, b) => (b[1].kills || 0) - (a[1].kills || 0));
      const mvp = participants[0][0];
      const mvpBonus = 500; // bonus gold for top participant
      const mvpP = this.player(mvp);
      if (mvpP) {
        mvpP.gold += mvpBonus;
        this.rpgSendTo(mvp, { type: 'rpg_world_event_mvp', data: { gold: mvpBonus } });
      }
    }

    // Clean up horde mobs from client
    if (event.eventType === 'mob_invasion') {
      for (const [u, urp] of Object.entries(this.rpgPlayers)) {
        if (urp.disconnected) continue;
        if (urp.zone === 'hub') {
          this.rpgSendTo(u, { type: 'rpg_horde_end', data: {} });
        }
      }
    }

    this.rpgBroadcastAll({ type: 'rpg_world_event_end', data: {
      id: event.id, type: event.eventType, name: cfg.name, icon: cfg.icon,
      participants: participants.length,
      mvp: participants.length > 0 ? participants[0][0] : null,
      totalKills: participants.reduce((s, [, p]) => s + (p.kills || 0), 0),
      totalGold: event.hordeGoldPool || 0,
    }});
    this.activeWorldEvent = null;
    this.saveData();
    this.nextWorldEventAt = Date.now() + WORLD_EVENT_CONFIG.intervalMin + Math.random() * (WORLD_EVENT_CONFIG.intervalMax - WORLD_EVENT_CONFIG.intervalMin);
  }

  rpgGetWorldEventClientData() {
    if (!this.activeWorldEvent) return null;
    const evt = this.activeWorldEvent;
    const cfg = evt.config;
    const multipliers = {};
    if (cfg.goldMult && cfg.goldMult > 1) multipliers.gold = cfg.goldMult;
    if (cfg.xpMult && cfg.xpMult > 1) multipliers.xp = cfg.xpMult;
    if (cfg.mobDmgMult && cfg.mobDmgMult > 1) multipliers.mobDmg = cfg.mobDmgMult;
    if (cfg.miningGoldMult && cfg.miningGoldMult > 1) multipliers.miningGold = cfg.miningGoldMult;
    return {
      active: true, type: evt.eventType, name: cfg.name, desc: cfg.desc,
      endsAt: evt.expiresAt, multipliers,
      hordeGoldPool: evt.hordeGoldPool || 0,
      hordeMobsAlive: evt.hordeMobsAlive || 0,
      hordeMobsTotal: evt.hordeMobs ? evt.hordeMobs.length : 0,
      bountyBoss: evt.bountyBoss ? this._getBountyBossClientData(evt.bountyBoss) : null,
      bountyTarget: evt.bountyTarget || null,
    };
  }

  rpgGetWorldEventMultiplier(type) {
    // Returns multiplier for gold/xp/mining during active events
    if (!this.activeWorldEvent) return 1.0;
    const cfg = this.activeWorldEvent.config;
    if (type === 'gold') return cfg.goldMult || 1.0;
    if (type === 'xp') return cfg.xpMult || 1.0;
    if (type === 'miningGold') return cfg.miningGoldMult || 1.0;
    if (type === 'miningXP') return cfg.miningXPMult || 1.0;
    if (type === 'mobDmg') return cfg.mobDmgMult || 1.0;
    if (type === 'bossRespawn') return cfg.bossRespawnMult || 1.0;
    return 1.0;
  }

  rpgRecordWorldEventParticipation(username, kills, gold, xp) {
    if (!this.activeWorldEvent) return;
    if (!this.activeWorldEvent.participants[username]) {
      this.activeWorldEvent.participants[username] = { kills: 0, gold: 0, xp: 0 };
    }
    const p = this.activeWorldEvent.participants[username];
    p.kills += kills || 0;
    p.gold += gold || 0;
    p.xp += xp || 0;
  }

  // ═══ BOUNTY BOSS — Gilded Hoarder ═══
  _getBountyBossClientData(bb) {
    return {
      id: bb.id, name: bb.name, hp: bb.hp, maxHP: bb.maxHP,
      x: Math.round(bb.x), y: Math.round(bb.y), zone: bb.zone,
      facing: bb.facing, state: bb.state, phase: bb.phase,
      isBountyBoss: true, color: bb.color, eliteTier: bb.eliteTier,
      currentAttack: bb.currentAttack,
    };
  }

  rpgAttackBountyBoss(username) {
    const rp = this.rpgPlayers[username];
    if (!rp || rp.hp <= 0) return { error: 'dead' };
    const evt = this.activeWorldEvent;
    if (!evt || evt.eventType !== 'bounty_hunt' || !evt.bountyBoss || evt.bountyBoss.dead) return { error: 'boss_gone' };
    const bb = evt.bountyBoss;
    if (rp.zone !== bb.zone) return { error: 'wrong_zone' };
    const dx = (rp.x || 400) - bb.x, dy = (rp.y || 400) - bb.y;
    if (Math.sqrt(dx * dx + dy * dy) > 200) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);

    bb.hp -= dmg;
    // Track damage dealers for shared VG reward
    bb.damageDealers[username] = (bb.damageDealers[username] || 0) + dmg;

    // Enchantment effects
    let burn = false, poison = false, holy = false;
    const wepItem = (p.rpg.equipped && p.rpg.equipped.weapon) || {};
    const weaponId = wepItem.id || '';
    const wepDef = ITEMS[weaponId] || {};
    let activeEnchant = '';
    if (wepDef.enchant) activeEnchant = wepDef.enchant;
    else if (wepItem.enchantments) {
      for (const ench of wepItem.enchantments) {
        const def = typeof ENCHANTMENTS !== 'undefined' && ENCHANTMENTS[ench.id];
        if (def && Math.random() < (ench.chance || 0.2)) { activeEnchant = def.type; break; }
      }
    }
    if (activeEnchant === 'fire') { bb.burnDmg = 8; bb.burnEnd = Date.now() + 3000; burn = true; }
    if (activeEnchant === 'poison') { bb.poisonDmg = 5; bb.poisonEnd = Date.now() + 4000; poison = true; }
    let holyDmg = 0;
    if (activeEnchant === 'holy') { holyDmg = Math.max(3, Math.floor(dmg * 0.15)); bb.hp -= holyDmg; holy = true; bb.damageDealers[username] += holyDmg; }

    // Weapon durability
    const wepResult = this.degradeEquipped(p, 'weapon', 3);
    const lifesteal = this.equipStat(p, 'lifesteal');
    let lifestealAmt = 0;
    if (lifesteal > 0) { lifestealAmt = Math.floor(dmg * lifesteal); rp.hp = Math.min(rp.maxHP, rp.hp + lifestealAmt); }

    // Phase transitions
    const hpPct = bb.hp / bb.maxHP;
    if (hpPct <= 0.2 && bb.phase !== 'desperate') { bb.phase = 'desperate'; bb.phaseChanged = Date.now(); }
    else if (hpPct <= 0.5 && bb.phase === 'normal') { bb.phase = 'enraged'; bb.phaseChanged = Date.now(); }

    // Broadcast hit to all players in zone
    const hitData = { bossId: bb.id, attacker: username, dmg, crit, bossHP: bb.hp, bossMaxHP: bb.maxHP, phase: bb.phase, burn, poison, holy: holyDmg || false };
    for (const [u, urp] of Object.entries(this.rpgPlayers)) {
      if (urp.disconnected || urp.zone !== bb.zone) continue;
      this.rpgSendTo(u, { type: 'rpg_bounty_boss_hit', data: hitData });
    }

    // Boss killed
    if (bb.hp <= 0) {
      bb.dead = true;
      const cfg = evt.config;
      // Killer gets last-hit VG + gold + XP
      const killVG = evt.bountyKillVG || cfg.bountyKillVG || 50;
      const shareVG = evt.bountyShareVG || cfg.bountyShareVG || 100;
      const goldReward = cfg.bountyGold || 5000;
      const xpReward = cfg.bountyXP || 2000;
      this.awardVaultGold(username, killVG, 'Bounty Boss last hit');
      const killerP = this.player(username);
      if (killerP) killerP.gold += goldReward;
      this.addXP(p, xpReward);

      // Distribute shared VG among all damage dealers proportional to damage
      const totalDmg = Object.values(bb.damageDealers).reduce((s, d) => s + d, 0);
      const participantRewards = [];
      for (const [u, dmgDealt] of Object.entries(bb.damageDealers)) {
        const share = Math.max(1, Math.floor(shareVG * (dmgDealt / totalDmg)));
        this.awardVaultGold(u, share, 'Bounty Boss participation');
        participantRewards.push({ username: u, vg: share, dmg: dmgDealt });
        this.rpgRecordWorldEventParticipation(u, 0, 0, 0);
      }

      // Broadcast kill to all players
      const killData = {
        bossId: bb.id, killer: username, killVG, shareVG, goldReward, xpReward,
        participants: participantRewards,
        totalParticipants: Object.keys(bb.damageDealers).length,
      };
      this.rpgBroadcastAll({ type: 'rpg_bounty_boss_killed', data: killData });

      // End the event shortly after boss dies
      setTimeout(() => { if (this.activeWorldEvent && this.activeWorldEvent.id === evt.id) this.rpgEndWorldEvent(); }, 5000);
      this.saveData();
    }

    return {
      hit: true, dmg, crit, bossHP: Math.max(0, bb.hp), bossMaxHP: bb.maxHP, phase: bb.phase,
      burn, poison, holy: holyDmg || false, lifesteal: lifestealAmt,
      hp: rp.hp, weaponBroke: wepResult && wepResult.broke ? wepResult.name : null,
      killed: bb.dead,
    };
  }

  rpgClaimBounty(username) {
    if (!this.activeWorldEvent || this.activeWorldEvent.eventType !== 'bounty_hunt') return { error: 'no_bounty' };
    if (this.activeWorldEvent.bountyClaimed) return { error: 'already_claimed' };
    this.activeWorldEvent.bountyClaimed = true;
    const cfg = this.activeWorldEvent.config;
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    p.gold += cfg.bountyGold;
    this.addXP(p, cfg.bountyXP);
    if (cfg.bountyVG) this.awardVaultGold(username, cfg.bountyVG, 'Bounty Hunt reward');
    this.saveData();
    this.rpgBroadcastAll({ type: 'rpg_bounty_claimed', data: {
      hunter: username, gold: cfg.bountyGold, xp: cfg.bountyXP, vg: cfg.bountyVG || 0,
      targetName: this.activeWorldEvent.bountyTarget ? this.activeWorldEvent.bountyTarget.name : 'Bounty',
    }});
    return { success: true, gold: cfg.bountyGold, xp: cfg.bountyXP, vg: cfg.bountyVG || 0 };
  }

  rpgAdminStartWorldEvent(username, eventType) {
    const result = this.rpgStartWorldEvent(eventType);
    this.logAction(username, 'admin_world_event', 'Started ' + eventType);
    return result;
  }

  rpgAdminStopWorldEvent(username) {
    if (!this.activeWorldEvent) return { error: 'no_active_event' };
    this.logAction(username, 'admin_world_event', 'Stopped ' + this.activeWorldEvent.eventType);
    this.rpgEndWorldEvent();
    return { stopped: true };
  }

  // ═══════════════════════════════════════════
  // PvP Shop
  // ═══════════════════════════════════════════
  rpgPvpShopBuy(username, itemId) {
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    const shopItem = PVP_SHOP.find(i => i.id === itemId);
    if (!shopItem) return { error: 'invalid_item' };
    if ((p.arenaTokens || 0) < shopItem.cost) return { error: 'not_enough_tokens', need: shopItem.cost, have: p.arenaTokens || 0 };
    // Check if already owned (wearables is an array)
    if (!p.wearables) p.wearables = [];
    if (Array.isArray(p.wearables) && p.wearables.includes(itemId)) return { error: 'already_owned' };
    p.arenaTokens -= shopItem.cost;
    p.wearables.push(itemId);
    this.saveData();
    return { success: true, item: shopItem, remainingTokens: p.arenaTokens };
  }

  rpgGetArenaStats(username) {
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    const rank = this.getArenaRank(p.arenaRating || 1000);
    const bracket = this.getPlayerBracket(p.level);
    return {
      rating: p.arenaRating || 1000,
      rank: rank,
      bracket: bracket,
      tokens: p.arenaTokens || 0,
      duelsWon: p.duelsWon || 0,
      duelsLost: p.duelsLost || 0,
      winStreak: p.duelWinStreak || 0,
      bestStreak: p.bestDuelStreak || 0,
      winRate: (p.duelsWon || 0) + (p.duelsLost || 0) > 0
        ? Math.round(((p.duelsWon || 0) / ((p.duelsWon || 0) + (p.duelsLost || 0))) * 100) : 0,
    };
  }

  rpgGetArenaLeaderboard() {
    const entries = Object.entries(this.players).filter(([, p]) => (p.duelsWon || 0) + (p.duelsLost || 0) > 0);
    entries.sort((a, b) => (b[1].arenaRating || 1000) - (a[1].arenaRating || 1000));
    return entries.slice(0, 20).map(([name, p], i) => {
      const rank = this.getArenaRank(p.arenaRating || 1000);
      return {
        position: i + 1,
        name,
        rating: p.arenaRating || 1000,
        rank: rank,
        wins: p.duelsWon || 0,
        losses: p.duelsLost || 0,
        streak: p.duelWinStreak || 0,
        level: p.level,
      };
    });
  }

  rpgGetPvpShop(username) {
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    return {
      tokens: p.arenaTokens || 0,
      items: PVP_SHOP.map(item => ({
        ...item,
        owned: !!(p.wearables && p.wearables[item.id]),
        canAfford: (p.arenaTokens || 0) >= item.cost,
        wearable: WEARABLES[item.id] || null,
      })),
    };
  }

  // ═══════════════════════════════════════════
  // Housing System
  // ═══════════════════════════════════════════

  rpgGetHousingStreets() {
    if (!this.housingStreets) this.housingStreets = [];
    return this.housingStreets;
  }

  rpgBuyHouse(username) {
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    if (!p.rpg) return { error: 'no_rpg' };
    if (p.rpg.house) return { error: 'already_own', msg: 'You already own a house!' };
    const tier = HOUSING.TIERS[0];
    if (p.gold < tier.cost) return { error: 'broke', gold: p.gold, cost: tier.cost };
    // Find a street with available plots BEFORE deducting gold
    const streets = this.rpgGetHousingStreets();
    let streetIdx = -1, plotIdx = -1;
    for (let s = 0; s < streets.length; s++) {
      const emptySlot = streets[s].findIndex(slot => slot === null);
      if (emptySlot !== -1) { streetIdx = s; plotIdx = emptySlot; break; }
    }
    if (streetIdx === -1) {
      // Create new street
      streetIdx = streets.length;
      streets.push(new Array(HOUSING.PLOTS_PER_STREET).fill(null));
      plotIdx = 0;
    }
    // Deduct gold only after allocation succeeds
    p.gold -= tier.cost;
    streets[streetIdx][plotIdx] = username;
    p.rpg.house = {
      streetIndex: streetIdx,
      plotIndex: plotIdx,
      tier: 1,
      wallStyle: 0,
      floorStyle: 0,
      furniture: (DEFAULT_FURNITURE[1] || []).map(f => ({ id: f.id, fx: f.fx, fy: f.fy })),
    };
    this.logAction(username, 'house_buy', 'Bought a Cottage on Street ' + (streetIdx + 1) + ', Plot ' + (plotIdx + 1) + ' for ' + tier.cost + 'g');
    this.saveData();
    return { success: true, house: p.rpg.house, gold: p.gold, streetIndex: streetIdx, plotIndex: plotIdx };
  }

  rpgUpgradeHouse(username) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    if (h.tier >= HOUSING.TIERS.length) return { error: 'max_tier', msg: 'Your house is already max tier!' };
    const nextTier = HOUSING.TIERS[h.tier]; // tier is 1-indexed, array is 0-indexed so [tier] = next tier
    if (p.gold < nextTier.upgradeCost) return { error: 'broke', gold: p.gold, cost: nextTier.upgradeCost };
    p.gold -= nextTier.upgradeCost;
    h.tier = nextTier.id;
    // Add default furniture for the new tier (skip any that overlap existing)
    const defs = DEFAULT_FURNITURE[h.tier] || [];
    for (const df of defs) {
      const tmpl = ITEMS[df.id];
      const dfw = (tmpl && tmpl.w) || 1, dfh = (tmpl && tmpl.h) || 1;
      const dfFloor = df.floor || 1;
      let overlaps = false;
      for (const placed of h.furniture) {
        if ((placed.floor || 1) !== dfFloor) continue;
        const pt = ITEMS[placed.id];
        const pw = (pt && pt.w) || 1, ph = (pt && pt.h) || 1;
        if (df.fx < placed.fx + pw && df.fx + dfw > placed.fx && df.fy < placed.fy + ph && df.fy + dfh > placed.fy) { overlaps = true; break; }
      }
      if (!overlaps && h.furniture.length < nextTier.maxFurniture) {
        h.furniture.push({ id: df.id, fx: df.fx, fy: df.fy, floor: dfFloor });
      }
    }
    this.logAction(username, 'house_upgrade', 'Upgraded house to ' + nextTier.name + ' for ' + nextTier.upgradeCost + 'g');
    this.saveData();
    return { success: true, house: h, gold: p.gold, tierName: nextTier.name };
  }

  rpgBuyWallStyle(username, styleId) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const style = HOUSING.WALL_STYLES.find(s => s.id === styleId);
    if (!style) return { error: 'invalid_style' };
    if (p.rpg.house.wallStyle === styleId) return { error: 'already_set' };
    if (p.gold < style.cost) return { error: 'broke', gold: p.gold, cost: style.cost };
    if (style.cost > 0) p.gold -= style.cost;
    p.rpg.house.wallStyle = styleId;
    this.saveData();
    return { success: true, house: p.rpg.house, gold: p.gold };
  }

  rpgBuyFloorStyle(username, styleId) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const style = HOUSING.FLOOR_STYLES.find(s => s.id === styleId);
    if (!style) return { error: 'invalid_style' };
    if (p.rpg.house.floorStyle === styleId) return { error: 'already_set' };
    if (p.gold < style.cost) return { error: 'broke', gold: p.gold, cost: style.cost };
    if (style.cost > 0) p.gold -= style.cost;
    p.rpg.house.floorStyle = styleId;
    this.saveData();
    return { success: true, house: p.rpg.house, gold: p.gold };
  }

  rpgBuyFurniture(username, itemId) {
    const template = ITEMS[itemId];
    if (!template || template.type !== 'furniture') return { error: 'not_furniture' };
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    if (p.gold < template.shopPrice) return { error: 'broke', gold: p.gold, cost: template.shopPrice };
    p.gold -= template.shopPrice;
    const item = this.addItemToInventory(p, itemId);
    this.logAction(username, 'furniture_buy', template.icon + ' ' + template.name + ' for ' + template.shopPrice + 'g');
    this.saveData();
    return { success: true, item, gold: p.gold };
  }

  rpgPlaceFurniture(username, invIndex, fx, fy, floor) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    const tierCfg = HOUSING.TIERS[h.tier - 1];
    if (h.furniture.length >= tierCfg.maxFurniture) return { error: 'full', max: tierCfg.maxFurniture };
    const invItem = p.inventory[invIndex];
    if (!invItem) return { error: 'invalid_item' };
    const template = ITEMS[invItem.id];
    if (!template || template.type !== 'furniture') return { error: 'not_furniture' };
    const placeFloor = (tierCfg.floors && tierCfg.floors >= 2) ? (floor || 1) : 1;
    // Bounds check (keep 1-tile wall margin, consistent with rpgMoveFurniture)
    const fw = template.w || 1, fh = template.h || 1;
    if (fx < 1 || fy < 1 || fx + fw > tierCfg.gridW - 1 || fy + fh > tierCfg.gridH - 1) return { error: 'out_of_bounds' };
    // Overlap check (same floor only)
    for (const placed of h.furniture) {
      if ((placed.floor || 1) !== placeFloor) continue;
      const pt = ITEMS[placed.id];
      const pw = (pt && pt.w) || 1, ph = (pt && pt.h) || 1;
      if (fx < placed.fx + pw && fx + fw > placed.fx && fy < placed.fy + ph && fy + fh > placed.fy) {
        return { error: 'overlap' };
      }
    }
    // Remove from inventory
    if (invItem.stackable && invItem.qty > 1) { invItem.qty--; } else { p.inventory.splice(invIndex, 1); }
    h.furniture.push({ id: invItem.id, fx, fy, floor: placeFloor });
    this.saveData();
    return { success: true, house: h, inventory: p.inventory };
  }

  rpgPickupFurniture(username, furnitureIdx) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    if (furnitureIdx < 0 || furnitureIdx >= h.furniture.length) return { error: 'invalid_index' };
    const tmpl = ITEMS[h.furniture[furnitureIdx].id];
    if (tmpl && tmpl.noPickup) return { error: 'Cannot pick up this item' };
    const removed = h.furniture.splice(furnitureIdx, 1)[0];
    this.addItemToInventory(p, removed.id);
    this.saveData();
    return { success: true, house: h, inventory: p.inventory };
  }

  rpgMoveFurniture(username, furnitureIdx, fx, fy, floor) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    if (furnitureIdx < 0 || furnitureIdx >= h.furniture.length) return { error: 'invalid_index' };
    const tierCfg = HOUSING.TIERS[h.tier - 1];
    const furn = h.furniture[furnitureIdx];
    const template = ITEMS[furn.id];
    if (template && template.noPickup) return { error: 'Cannot move this item' };
    const fw = (template && template.w) || 1, fh = (template && template.h) || 1;
    const moveFloor = (tierCfg.floors && tierCfg.floors >= 2) ? (floor || furn.floor || 1) : 1;
    // Bounds check (keep 1-tile wall margin)
    if (fx < 1 || fy < 1 || fx + fw > tierCfg.gridW - 1 || fy + fh > tierCfg.gridH - 1) return { error: 'out_of_bounds' };
    // Overlap check against all OTHER furniture on same floor
    for (let i = 0; i < h.furniture.length; i++) {
      if (i === furnitureIdx) continue;
      const placed = h.furniture[i];
      if ((placed.floor || 1) !== moveFloor) continue;
      const pt = ITEMS[placed.id];
      const pw = (pt && pt.w) || 1, ph = (pt && pt.h) || 1;
      if (fx < placed.fx + pw && fx + fw > placed.fx && fy < placed.fy + ph && fy + fh > placed.fy) {
        return { error: 'overlap' };
      }
    }
    furn.fx = fx;
    furn.fy = fy;
    furn.floor = moveFloor;
    this.saveData();
    return { success: true, house: h };
  }

  rpgSetPlaque(username, furnitureIdx, achievementId) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    if (furnitureIdx < 0 || furnitureIdx >= h.furniture.length) return { error: 'invalid_index' };
    const furn = h.furniture[furnitureIdx];
    if (furn.id !== 'achievement_plaque') return { error: 'not_plaque' };
    // Verify player has earned this achievement
    const earned = p.achievements || [];
    if (!earned.includes(achievementId)) return { error: 'not_earned' };
    furn.achievementId = achievementId;
    this.saveData();
    return { success: true, house: h };
  }

  rpgGetHouseData(username) {
    const p = this.player(username);
    if (!p || !p.rpg || !p.rpg.house) return { error: 'no_house' };
    const h = p.rpg.house;
    const tierCfg = HOUSING.TIERS[h.tier - 1];
    // Backfill default furniture for existing houses that have none
    if (h.furniture.length === 0 && DEFAULT_FURNITURE[h.tier]) {
      h.furniture = DEFAULT_FURNITURE[h.tier].map(f => ({ id: f.id, fx: f.fx, fy: f.fy, floor: f.floor || 1 }));
      this.saveData();
    }
    return {
      house: h,
      tierName: tierCfg.name,
      gridW: tierCfg.gridW,
      gridH: tierCfg.gridH,
      maxFurniture: tierCfg.maxFurniture,
      floors: tierCfg.floors || 1,
      wallStyles: HOUSING.WALL_STYLES,
      floorStyles: HOUSING.FLOOR_STYLES,
      furnitureShop: FURNITURE_SHOP.map(id => ({ ...ITEMS[id], itemId: id })),
    };
  }

  rpgVisitHouse(username, targetName) {
    const target = targetName.toLowerCase();
    const tp = this.player(target);
    if (!tp || !tp.rpg || !tp.rpg.house) return { error: 'no_house', msg: target + ' does not own a house.' };
    const h = tp.rpg.house;
    const tierCfg = HOUSING.TIERS[h.tier - 1];
    return {
      success: true,
      owner: target,
      house: { tier: h.tier, wallStyle: h.wallStyle, floorStyle: h.floorStyle, furniture: h.furniture },
      tierName: tierCfg.name,
      gridW: tierCfg.gridW,
      gridH: tierCfg.gridH,
      floors: tierCfg.floors || 1,
    };
  }

  rpgKnockHouse(username, streetIndex, plotIndex) {
    const streets = this.rpgGetHousingStreets();
    const sIdx = Math.floor(Number(streetIndex));
    const pIdx = Math.floor(Number(plotIndex));
    if (!Number.isFinite(sIdx) || !Number.isFinite(pIdx)) return { error: 'invalid_plot' };
    if (sIdx < 0 || sIdx >= streets.length) return { error: 'invalid_street' };
    if (pIdx < 0 || pIdx >= HOUSING.PLOTS_PER_STREET) return { error: 'invalid_plot' };

    const owner = streets[sIdx][pIdx];
    if (!owner) return { error: 'empty_plot', msg: 'Nobody owns this plot yet.' };
    if (owner === username) return { error: 'own_house', msg: 'This is your house. Enter it directly.' };

    const now = Date.now();
    const cdKey = username + '->' + owner + ':' + sIdx + ':' + pIdx;
    const last = this.houseKnockCooldowns[cdKey] || 0;
    if (now - last < 5000) return { error: 'cooldown', msg: 'You just knocked. Wait a few seconds.' };
    this.houseKnockCooldowns[cdKey] = now;

    const ownerOnline = !!(this.rpgPlayers[owner] && this.rpgPlayers[owner].ws);
    if (ownerOnline) {
      this.rpgSendTo(owner, {
        type: 'rpg_house_knock',
        data: { from: username, streetIndex: sIdx, plotIndex: pIdx, ts: now },
      });
    }

    return { success: true, owner, notified: ownerOnline };
  }

  rpgGetStreetData(streetIndex) {
    const streets = this.rpgGetHousingStreets();
    if (streetIndex < 0 || streetIndex >= streets.length) return { error: 'invalid_street' };
    const plots = streets[streetIndex].map((owner, idx) => {
      if (!owner) return { plotIndex: idx, owner: null, tier: 0 };
      const p = this.player(owner);
      const tier = (p && p.rpg && p.rpg.house) ? p.rpg.house.tier : 1;
      return { plotIndex: idx, owner, tier };
    });
    return { success: true, streetIndex, plots, totalStreets: streets.length };
  }

  rpgGetHousingDirectory(page) {
    const streets = this.rpgGetHousingStreets();
    const perPage = 8;
    const start = (page || 0) * perPage;
    const totalStreets = streets.length;
    const results = [];
    for (let s = start; s < Math.min(start + perPage, totalStreets); s++) {
      const occupied = streets[s].filter(o => o !== null).length;
      results.push({ streetIndex: s, occupied, total: HOUSING.PLOTS_PER_STREET });
    }
    return { streets: results, totalStreets, page: page || 0, totalPages: Math.ceil(totalStreets / perPage) };
  }

  rpgSearchHouse(targetName) {
    const target = targetName.toLowerCase();
    const tp = this.player(target);
    if (!tp || !tp.rpg || !tp.rpg.house) return { error: 'not_found', msg: target + ' does not own a house.' };
    return { success: true, owner: target, streetIndex: tp.rpg.house.streetIndex, plotIndex: tp.rpg.house.plotIndex };
  }

  rpgGetFurnitureShop() {
    return { items: FURNITURE_SHOP.map(id => ({ ...ITEMS[id], itemId: id })) };
  }

  rpgPlayDice(username, bet) {
    const p = this.player(username);
    if (!p) return { error: 'not_found' };
    bet = Math.max(1, Math.min(Math.floor(Number(bet) || 10), 1000));
    if (p.gold < bet) return { error: 'broke', gold: p.gold };
    p.gold -= bet;
    const playerRoll = Math.floor(Math.random() * 6) + 1;
    const npcRoll = Math.floor(Math.random() * 6) + 1;
    let result, winnings = 0;
    if (playerRoll > npcRoll) { result = 'win'; winnings = bet * 2; p.gold += winnings; }
    else if (playerRoll < npcRoll) { result = 'lose'; }
    else { result = 'tie'; p.gold += bet; }
    this.saveData();
    return { success: true, playerRoll, npcRoll, result, winnings, bet, gold: p.gold };
  }

  // ═══════════════════════════════════════════
  // Party Dungeon System
  // ═══════════════════════════════════════════

  rpgBroadcastInstance(instanceId, msg, exclude) {
    const inst = this.rpgDungeonInstances[instanceId];
    if (!inst) return;
    for (const u of inst.members) {
      if (u !== exclude) this.rpgSendTo(u, msg);
    }
  }

  rpgDungeonReady(username, ready) {
    const partyId = this.rpgPlayerParty[username];
    if (partyId == null) return { error: 'not_in_party' };
    const party = this.rpgParties[partyId];
    if (!party) return { error: 'party_not_found' };
    if (party.members.length < PARTY_DUNGEON_CONFIG.minPartySize) return { error: 'party_too_small', required: PARTY_DUNGEON_CONFIG.minPartySize };
    // Check trust requirement
    const p = this.rpgGetPlayerData(username);
    if ((p.rpg.trust || 0) < PARTY_DUNGEON_CONFIG.trustReq) return { error: 'trust_low', required: PARTY_DUNGEON_CONFIG.trustReq, current: p.rpg.trust || 0 };
    // Can't ready if already in a dungeon instance
    if (party.dungeonInstanceId) return { error: 'already_in_dungeon' };
    // Check all members are in hub
    const rp = this.rpgPlayers[username];
    if (!rp || rp.zone !== 'hub') return { error: 'must_be_in_hub' };

    if (!party.dungeonReady) party.dungeonReady = {};
    party.dungeonReady[username] = !!ready;
    // Broadcast ready state to party
    const readyState = {};
    for (const m of party.members) readyState[m] = !!party.dungeonReady[m];
    for (const m of party.members) {
      this.rpgSendTo(m, { type: 'rpg_dungeon_ready_update', data: { readyState, members: party.members, leader: party.leader } });
    }
    return { success: true, readyState };
  }

  rpgDungeonLaunch(username) {
    const partyId = this.rpgPlayerParty[username];
    if (partyId == null) return { error: 'not_in_party' };
    const party = this.rpgParties[partyId];
    if (!party) return { error: 'party_not_found' };
    if (party.leader !== username) return { error: 'not_leader' };
    if (party.dungeonInstanceId) return { error: 'already_in_dungeon' };
    if (party.members.length < PARTY_DUNGEON_CONFIG.minPartySize) return { error: 'party_too_small' };
    // Verify all members are ready and in hub
    for (const m of party.members) {
      if (!party.dungeonReady || !party.dungeonReady[m]) return { error: 'not_all_ready', who: m };
      const rp = this.rpgPlayers[m];
      if (!rp || rp.zone !== 'hub') return { error: 'member_not_in_hub', who: m };
      const mp = this.rpgGetPlayerData(m);
      if ((mp.rpg.trust || 0) < PARTY_DUNGEON_CONFIG.trustReq) return { error: 'member_trust_low', who: m };
    }
    // Create the instance
    const inst = this.rpgDungeonCreateInstance(partyId);
    party.dungeonInstanceId = inst.id;
    party.dungeonReady = {};
    // Move all members into the instance zone
    for (let mi = 0; mi < party.members.length; mi++) {
      const m = party.members[mi];
      const rp = this.rpgPlayers[m];
      if (!rp) continue;
      // Leave hub
      this.rpgBroadcastZone('hub', { type: 'rpg_player_left', data: { username: m } }, m);
      rp.zone = inst.id;
      rp.sitting = null;
      // Spread players evenly around spawn area (wider spread)
      const angle = (mi / party.members.length) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 50 + mi * 40;
      let sx = 1200 + Math.cos(angle) * dist;
      let sy = 1200 + Math.sin(angle) * dist;
      // Snap to walkable tile
      if (inst.tileMap) { const sp = this.rpgFindWalkable(inst.tileMap, sx, sy); sx = sp.x; sy = sp.y; }
      rp.x = sx;
      rp.y = sy;
      // Recalculate HP
      const mp = this.rpgGetPlayerData(m);
      const maxHP = 50 + mp.level * 5 + (mp.prestige || 0) * 10 + this.equipStat(mp, 'maxHP');
      rp.maxHP = maxHP;
      rp.hp = Math.min(rp.hp || maxHP, maxHP);
    }
    // Send instance state to all members
    for (const m of party.members) {
      this.rpgSendTo(m, { type: 'rpg_dungeon_start', data: this.rpgGetDungeonState(inst.id, m) });
    }
    return { success: true, instanceId: inst.id };
  }

  rpgDungeonCreateInstance(partyId) {
    const party = this.rpgParties[partyId];
    const id = `pdung_${partyId}_${++this.rpgDungeonInstanceId}`;
    const cfg = PARTY_DUNGEON_CONFIG;
    const partySize = party.members.length;
    const scale = 1 + (partySize - 1) * cfg.scaleFactor;

    // Generate tilemap (reuse dungeon tilemap generator)
    const tileMap = this.rpgGenerateTileMap('dungeon');

    // Create scaled mobs
    const mobs = [];
    for (let i = 0; i < cfg.mobCount; i++) {
      const t = cfg.mobs[Math.floor(Math.random() * cfg.mobs.length)];
      let x = 600 + Math.random() * 1200, y = 600 + Math.random() * 1200;
      if (tileMap) { const pos = this.rpgFindWalkable(tileMap, x, y); x = pos.x; y = pos.y; }
      // Keep out of boss arena
      const dx = x - cfg.boss.arenaX, dy = y - cfg.boss.arenaY;
      if (Math.sqrt(dx * dx + dy * dy) < cfg.boss.arenaRadius + 40) {
        x = cfg.boss.arenaX + (cfg.boss.arenaRadius + 80) * (Math.random() > 0.5 ? 1 : -1);
        y = cfg.boss.arenaY + Math.random() * 100 - 50;
      }
      const now = Date.now();
      mobs.push({
        id: `${id}_m${i}`, ...t,
        maxHP: Math.floor(t.maxHP * scale), hp: Math.floor(t.maxHP * scale),
        atk: Math.floor(t.atk * (1 + (partySize - 1) * 0.3)),
        x, y, dead: false, respawnAt: 0, templateName: t.name,
        spawnX: x, spawnY: y, state: 'idle', targetUser: null, facing: 1,
        wanderX: x, wanderY: y, nextWander: now + 2000 + Math.random() * 3000,
        nextAttack: now + (t.atkCD || 2000), retreatUntil: 0,
        telegraphEnd: 0, telegraphTarget: null,
        nextAbility: now + 5000 + Math.random() * 3000, abilityActive: null, abilityEnd: 0, hasSplit: false,
        eliteTier: 'normal',
      });
    }

    // Create shared boss (scaled for party)
    const b = cfg.boss;
    const boss = {
      id: `${id}_boss`,
      cfgId: b.cfgId,
      name: b.name,
      maxHP: Math.floor(b.maxHP * scale),
      hp: Math.floor(b.maxHP * scale),
      color: b.color,
      x: b.arenaX, y: b.arenaY,
      homeX: b.arenaX, homeY: b.arenaY,
      arenaRadius: b.arenaRadius,
      dead: false, phase: 'idle',
      phaseName: b.sleeping ? 'Sleeping' : '',
      sleeping: b.sleeping || false,
      wakeRadius: b.wakeRadius || 200,
      targetPlayer: null,
      attackCooldowns: {},
      currentAttack: null,
      attackTimer: 0,
      globalCD: 0,
      dmgMult: 1,
    };

    const inst = {
      id,
      partyId,
      members: [...party.members],
      boss,
      mobs,
      tileMap,
      startTime: Date.now(),
      timeLimit: cfg.timeLimit,
      phase: 'active', // active | boss | complete | failed
      deadMembers: [],  // spectating after death
      bossConfig: b,    // reference to PARTY_DUNGEON_CONFIG.boss
    };
    this.rpgDungeonInstances[id] = inst;
    console.log(`[PDUNG] Created instance ${id} for party ${partyId} (${partySize} members, scale ${scale.toFixed(2)})`);
    return inst;
  }

  rpgGetDungeonState(instanceId, username) {
    const inst = this.rpgDungeonInstances[instanceId];
    if (!inst) return null;
    const cfg = PARTY_DUNGEON_CONFIG;
    const elapsed = Date.now() - inst.startTime;
    const players = inst.members.map(m => {
      const rp = this.rpgPlayers[m];
      const pd = this.players[m];
      return {
        username: m,
        x: rp ? rp.x : 0, y: rp ? rp.y : 0,
        hp: rp ? rp.hp : 0, maxHP: rp ? rp.maxHP : 0,
        appearance: pd ? pd.appearance : null,
        equipped: pd ? pd.equipped : null,
        activeWearables: pd ? pd.activeWearables : null,
        activeCosmetics: pd ? (pd.activeCosmetics || null) : null,
        dead: inst.deadMembers.includes(m),
      };
    });
    const bossData = inst.boss && !inst.boss.dead ? {
      id: inst.boss.id, name: inst.boss.name, hp: inst.boss.hp, maxHP: inst.boss.maxHP,
      x: inst.boss.x, y: inst.boss.y, color: inst.boss.color, phase: inst.boss.phase,
      phaseName: inst.boss.phaseName || '', cfgId: inst.boss.cfgId,
      sleeping: inst.boss.sleeping || false,
      currentAttack: inst.boss.currentAttack, attackTimer: inst.boss.attackTimer,
      arenaRadius: inst.boss.arenaRadius, homeX: inst.boss.homeX, homeY: inst.boss.homeY,
    } : null;
    return {
      instanceId: inst.id,
      name: cfg.name,
      icon: cfg.icon,
      bg: cfg.bg,
      tileMap: inst.tileMap,
      phase: inst.phase,
      timeLeft: Math.max(0, inst.timeLimit - elapsed),
      timeLimit: inst.timeLimit,
      mobs: inst.mobs.filter(m => !m.dead).map(m => ({
        id: m.id, name: m.name, hp: m.hp, maxHP: m.maxHP, atk: m.atk,
        x: m.x, y: m.y, color: m.color, state: m.state || 'idle', facing: m.facing || 1,
        goldMin: m.goldMin, goldMax: m.goldMax, xpReward: m.xpReward, templateName: m.templateName,
      })),
      players,
      boss: bossData,
      partyId: inst.partyId,
      deadMembers: inst.deadMembers,
    };
  }

  rpgDungeonTick() {
    const now = Date.now();
    for (const [instId, inst] of Object.entries(this.rpgDungeonInstances)) {
      if (inst.phase !== 'active' && inst.phase !== 'boss') continue;

      // ── Time limit check ──
      const elapsed = now - inst.startTime;
      if (elapsed >= inst.timeLimit) {
        inst.phase = 'failed';
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_timeout', data: { instanceId: instId } });
        this.rpgDungeonEnd(instId, false);
        continue;
      }

      // ── Broadcast time remaining every ~5s ──
      if (!inst._lastTimeBC || now - inst._lastTimeBC > 5000) {
        inst._lastTimeBC = now;
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_time', data: { timeLeft: Math.max(0, inst.timeLimit - elapsed) } });
      }

      // ── Shared boss AI (only when all mobs dead → boss phase) ──
      const aliveMobs = inst.mobs.filter(m => !m.dead);
      if (aliveMobs.length === 0 && inst.phase === 'active') {
        inst.phase = 'boss';
        // Wake the boss
        if (inst.boss && inst.boss.sleeping) {
          inst.boss.sleeping = false;
          inst.boss.phaseName = 'Awakening';
          inst.boss.globalCD = 3000;
        }
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_boss_phase', data: {
          instanceId: instId,
          boss: { id: inst.boss.id, name: inst.boss.name, hp: inst.boss.hp, maxHP: inst.boss.maxHP, x: inst.boss.x, y: inst.boss.y, cfgId: inst.boss.cfgId },
        }});
      }

      // ── Boss tick (shared — targets nearest alive player) ──
      if (inst.phase === 'boss' && inst.boss && !inst.boss.dead) {
        const boss = inst.boss;
        const bCfg = inst.bossConfig;

        // Find target player — randomly switch targets every few seconds so both players get attacked
        let nearest = null, nearDist = Infinity;
        const alivePlayers = [];
        for (const m of inst.members) {
          if (inst.deadMembers.includes(m)) continue;
          const rp = this.rpgPlayers[m];
          if (!rp || rp.hp <= 0) continue;
          const dx = (rp.x || 400) - boss.x, dy = (rp.y || 200) - boss.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          alivePlayers.push({ username: m, rp, dist: d });
          if (d < nearDist) { nearest = { username: m, rp, dist: d }; nearDist = d; }
        }
        // Switch aggro target every 4-8 seconds if multiple players alive
        if (alivePlayers.length > 1) {
          if (!boss._aggroSwitch) boss._aggroSwitch = now;
          if (now - boss._aggroSwitch > 4000 + Math.random() * 4000) {
            boss._aggroSwitch = now;
            const other = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            nearest = other;
            nearDist = other.dist;
          }
        }

        if (!nearest) continue; // all dead = wipe will be handled below

        if (boss.sleeping) continue; // shouldn't happen in boss phase but safety

        // Leash — return home if too far from arena
        if (nearDist > bCfg.arenaRadius + 100) {
          boss.phase = 'idle';
          boss.targetPlayer = null;
          const dx = boss.homeX - boss.x, dy = boss.homeY - boss.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 5) {
            boss.x += (dx / d) * bCfg.chaseSpeed * 2;
            boss.y += (dy / d) * bCfg.chaseSpeed * 2;
            this.rpgBroadcastInstance(instId, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
          }
          continue;
        }

        boss.targetPlayer = nearest.username;
        boss.phase = 'combat';
        if (boss.globalCD > 0) boss.globalCD -= 200;

        // Phase system
        let speedMult = 1, dmgMult = 1, currentPhaseName = '';
        if (bCfg.phases) {
          const hpPct = boss.hp / boss.maxHP;
          for (const ph of bCfg.phases) {
            if (hpPct <= ph.hpPercent) { speedMult = ph.speedMult || 1; dmgMult = ph.dmgMult || 1; currentPhaseName = ph.name; }
          }
          if (currentPhaseName && boss.phaseName !== currentPhaseName) {
            boss.phaseName = currentPhaseName;
            this.rpgBroadcastInstance(instId, { type: 'rpg_boss_phase', data: { bossId: boss.id, phase: currentPhaseName, hp: boss.hp, maxHP: boss.maxHP } });
          }
          boss.dmgMult = dmgMult;
        }

        // Attack in progress
        if (boss.currentAttack) {
          boss.attackTimer -= 200;
          if (boss.attackTimer <= 0) {
            const landingAtk = boss.currentAttack;
            boss.attackCooldowns[landingAtk.name] = now + landingAtk.cooldown;
            boss.currentAttack = null;
            boss.globalCD = 2500;
            // Hit check against ALL alive players
            try { this.rpgDungeonBossAttackLand(instId, boss, landingAtk); } catch(e) { console.error('[PDUNG BOSS ATTACK ERROR]', boss.id, landingAtk.name, e.message); }
          } else {
            this.rpgBroadcastInstance(instId, { type: 'rpg_boss_telegraph', data: {
              attack: boss.currentAttack.name, type: boss.currentAttack.type,
              timer: boss.attackTimer, maxTimer: boss.currentAttack.telegraphTime || 800,
              bossX: boss.x, bossY: boss.y,
              targetX: nearest.rp.x, targetY: nearest.rp.y,
              radius: boss.currentAttack.radius || 0,
              range: boss.currentAttack.range || 0, width: boss.currentAttack.width || 0,
            }});
          }
        } else {
          // Chase nearest player
          if (nearDist > 120) {
            const dx = nearest.rp.x - boss.x, dy = nearest.rp.y - boss.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const spd = bCfg.chaseSpeed * speedMult;
            boss.x += (dx / d) * spd;
            boss.y += (dy / d) * spd;
            // Stay within arena
            const adx = boss.x - boss.homeX, ady = boss.y - boss.homeY;
            const adist = Math.sqrt(adx * adx + ady * ady);
            if (adist > bCfg.arenaRadius) {
              boss.x = boss.homeX + (adx / adist) * bCfg.arenaRadius;
              boss.y = boss.homeY + (ady / adist) * bCfg.arenaRadius;
            }
            this.rpgBroadcastInstance(instId, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
          }

          // Pick an attack
          if (boss.globalCD <= 0) {
            const avail = bCfg.attacks.filter(a => {
              if (now < (boss.attackCooldowns[a.name] || 0)) return false;
              if (a.maxHpPct && (boss.hp / boss.maxHP) > a.maxHpPct) return false;
              return true;
            });
            if (avail.length > 0) {
              const atk = avail[Math.floor(Math.random() * avail.length)];
              if (atk.type === 'summon') {
                // Summon mobs back into the instance
                this.rpgDungeonBossSummon(instId, boss, atk);
                boss.attackCooldowns[atk.name] = now + atk.cooldown;
                boss.globalCD = 1500;
              } else {
                boss.currentAttack = { ...atk, snapX: nearest.rp.x, snapY: nearest.rp.y };
                boss.attackTimer = atk.telegraphTime || 800;
                this.rpgBroadcastInstance(instId, { type: 'rpg_boss_attack_start', data: {
                  attack: atk.name, type: atk.type,
                  telegraphTime: atk.telegraphTime || 800,
                  bossX: boss.x, bossY: boss.y,
                  targetX: nearest.rp.x, targetY: nearest.rp.y,
                  radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
                }});
              }
            }
          }
        }

        // ── Boss Burn/Poison DOT ──
        if (boss.burnEnd && now < boss.burnEnd && now >= boss.burnTickAt && !boss.dead) {
          boss.hp -= boss.burnDamage;
          boss.burnTickAt = now + 500;
          this.rpgBroadcastInstance(instId, { type: 'rpg_boss_burn', data: { bossId: boss.id, dmg: boss.burnDamage, hp: boss.hp, maxHP: boss.maxHP } });
          if (boss.hp <= 0 && !boss.dead) { boss.dead = true; boss.hp = 0; }
        }
        if (boss.poisonEnd && now < boss.poisonEnd && now >= boss.poisonTickAt && !boss.dead) {
          boss.hp -= boss.poisonDamage;
          boss.poisonTickAt = now + 500;
          this.rpgBroadcastInstance(instId, { type: 'rpg_boss_poison', data: { bossId: boss.id, dmg: boss.poisonDamage, hp: boss.hp, maxHP: boss.maxHP } });
          if (boss.hp <= 0 && !boss.dead) { boss.dead = true; boss.hp = 0; }
        }
      }

      // ── Mob AI for instance mobs (shared, target nearest player) ──
      for (const mob of inst.mobs) {
        if (mob.dead) continue;
        // Find nearest alive player
        let target = null, tDist = Infinity;
        for (const m of inst.members) {
          if (inst.deadMembers.includes(m)) continue;
          const rp = this.rpgPlayers[m];
          if (!rp || rp.hp <= 0) continue;
          const dx = (rp.x || 400) - mob.x, dy = (rp.y || 200) - mob.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < tDist) { target = { username: m, rp, dist: d }; tDist = d; }
        }
        if (!target) continue;

        // Simple chase + attack AI
        if (tDist < (mob.aggroRange || 130)) {
          mob.state = 'chase';
          mob.targetUser = target.username;
          if (tDist > 40) {
            const dx = target.rp.x - mob.x, dy = target.rp.y - mob.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const spd = mob.chaseSpeed || 1.0;
            mob.x += (dx / d) * spd;
            mob.y += (dy / d) * spd;
            mob.facing = dx > 0 ? 1 : -1;
          }
          // Attack if close enough and cooldown ready
          if (tDist < 50 && now >= (mob.nextAttack || 0)) {
            mob.nextAttack = now + (mob.atkCD || 2000);
            const rp = target.rp;
            if (!rp.godMode) {
              const p = this.player(target.username);
              const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
              const dmg = Math.max(1, mob.atk - def);
              rp.hp = Math.max(0, rp.hp - dmg);
              this.rpgSendTo(target.username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg, hp: rp.hp, maxHP: rp.maxHP } });
              // Broadcast HP update to party
              this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_player_hp', data: { username: target.username, hp: rp.hp, maxHP: rp.maxHP } }, target.username);
              if (rp.hp <= 0) {
                this.rpgDungeonPlayerDied(instId, target.username);
              }
            }
          }
        } else if (mob.state === 'chase' && tDist > (mob.leashRange || 250)) {
          // Leash back
          mob.state = 'idle';
          mob.targetUser = null;
          const dx = mob.spawnX - mob.x, dy = mob.spawnY - mob.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 5) {
            mob.x += (dx / d) * (mob.moveSpeed || 0.5);
            mob.y += (dy / d) * (mob.moveSpeed || 0.5);
          }
        } else if (mob.state !== 'chase') {
          // Wander
          if (now >= (mob.nextWander || 0)) {
            mob.wanderX = mob.spawnX + (Math.random() - 0.5) * 160;
            mob.wanderY = mob.spawnY + (Math.random() - 0.5) * 160;
            mob.nextWander = now + 3000 + Math.random() * 4000;
          }
          const dx = mob.wanderX - mob.x, dy = mob.wanderY - mob.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 5) {
            mob.x += (dx / d) * (mob.moveSpeed || 0.5);
            mob.y += (dy / d) * (mob.moveSpeed || 0.5);
            mob.facing = dx > 0 ? 1 : -1;
          }
        }
      }

      // ── Broadcast mob positions every ~1s ──
      if (!inst._lastMobBC || now - inst._lastMobBC > 1000) {
        inst._lastMobBC = now;
        const mobData = inst.mobs.filter(m => !m.dead).map(m => ({ id: m.id, x: m.x, y: m.y, hp: m.hp, maxHP: m.maxHP, state: m.state, facing: m.facing }));
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_mobs', data: { mobs: mobData } });
      }

      // ── Wipe check: all members dead ──
      const aliveMembers = inst.members.filter(m => !inst.deadMembers.includes(m));
      if (aliveMembers.length === 0) {
        inst.phase = 'failed';
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_wipe', data: { instanceId: instId } });
        this.rpgDungeonEnd(instId, false);
      }
    }
  }

  rpgDungeonBossAttackLand(instId, boss, atk) {
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return;
    for (const m of inst.members) {
      if (inst.deadMembers.includes(m)) continue;
      const rp = this.rpgPlayers[m];
      if (!rp || rp.hp <= 0) continue;
      const px = rp.x || 400, py = rp.y || 200;
      let hit = false;
      if (atk.type === 'aoe' || atk.type === 'wing_buffet') {
        const dx = px - boss.x, dy = py - boss.y;
        hit = Math.sqrt(dx * dx + dy * dy) < (atk.radius || 100);
      } else if (atk.type === 'line') {
        const sx = atk.snapX || px, sy = atk.snapY || py;
        const dx = sx - boss.x, dy = sy - boss.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len, ny = dy / len;
        const ppx = px - boss.x, ppy = py - boss.y;
        const proj = ppx * nx + ppy * ny;
        if (proj > 0 && proj < (atk.range || 180)) {
          const perpDist = Math.sqrt((ppx - proj * nx) ** 2 + (ppy - proj * ny) ** 2);
          hit = perpDist < (atk.width || 40) / 2;
        }
      } else if (atk.type === 'breath_sweep') {
        // Cone sweep — player hit if within range AND within the sweep angle arc
        const dx = px - boss.x, dy = py - boss.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < (atk.range || 250)) {
          // Sweep direction based on snapped target position
          const sx = atk.snapX || px, sy = atk.snapY || py;
          const centerAngle = Math.atan2(sy - boss.y, sx - boss.x);
          const playerAngle = Math.atan2(dy, dx);
          let angleDiff = playerAngle - centerAngle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          hit = Math.abs(angleDiff) < (atk.sweepAngle || 2.4) / 2;
        }
      } else if (atk.type === 'head_lunge') {
        // Narrow fast lunge — tighter than line, longer range
        const sx = atk.snapX || px, sy = atk.snapY || py;
        const dx = sx - boss.x, dy = sy - boss.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len, ny = dy / len;
        const ppx = px - boss.x, ppy = py - boss.y;
        const proj = ppx * nx + ppy * ny;
        if (proj > -20 && proj < (atk.range || 200)) {
          const perpDist = Math.sqrt((ppx - proj * nx) ** 2 + (ppy - proj * ny) ** 2);
          hit = perpDist < (atk.width || 90) / 2;
        }
      }
      if (hit && !rp.godMode) {
        const p = this.player(m);
        const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
        const dmg = Math.max(1, Math.floor(atk.dmg * (boss.dmgMult || 1)) - def);
        rp.hp = Math.max(0, rp.hp - dmg);
        this.degradeEquipped(p, 'armor', 3);
        this.rpgSendTo(m, { type: 'rpg_boss_hit', data: { dmg, hp: rp.hp, maxHP: rp.maxHP, attack: atk.name, armorBroke: null } });
        this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_player_hp', data: { username: m, hp: rp.hp, maxHP: rp.maxHP } }, m);
        if (rp.hp <= 0) {
          this.rpgDungeonPlayerDied(instId, m);
        }
      }
    }
    this.rpgBroadcastInstance(instId, { type: 'rpg_boss_attack_land', data: { attack: atk.name, type: atk.type, bossX: boss.x, bossY: boss.y, radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0 } });
  }

  rpgDungeonBossSummon(instId, boss, atk) {
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return;
    const cfg = PARTY_DUNGEON_CONFIG;
    const count = atk.count || 2;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const t = cfg.mobs[0]; // Summon skeletons (weakest mob)
      const angle = (Math.PI * 2 / count) * i;
      const dist = 60 + Math.random() * 40;
      const x = boss.x + Math.cos(angle) * dist;
      const y = boss.y + Math.sin(angle) * dist;
      const mobId = `${instId}_sum${Date.now()}_${i}`;
      inst.mobs.push({
        id: mobId, ...t,
        maxHP: Math.floor(t.maxHP * 0.6), hp: Math.floor(t.maxHP * 0.6),
        atk: Math.floor(t.atk * 0.8),
        x, y, dead: false, respawnAt: 0, templateName: t.name,
        spawnX: x, spawnY: y, state: 'chase', targetUser: null, facing: 1,
        wanderX: x, wanderY: y, nextWander: now + 5000,
        nextAttack: now + 1000, retreatUntil: 0,
        telegraphEnd: 0, telegraphTarget: null,
        nextAbility: now + 8000, abilityActive: null, abilityEnd: 0, hasSplit: false,
        eliteTier: 'normal', summoned: true,
      });
    }
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_summon', data: {
      mobs: inst.mobs.filter(m => !m.dead && m.summoned).map(m => ({
        id: m.id, name: m.name, hp: m.hp, maxHP: m.maxHP, x: m.x, y: m.y, color: m.color,
      })),
    }});
  }

  rpgDungeonAttackMob(username, mobId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const instId = rp.zone;
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return { error: 'not_in_dungeon' };
    if (inst.deadMembers.includes(username)) return { error: 'dead' };
    const mob = inst.mobs.find(m => m.id === mobId && !m.dead);
    if (!mob) return { error: 'mob_gone' };
    const dx = (rp.x || 400) - mob.x, dy = (rp.y || 200) - mob.y;
    if (Math.sqrt(dx * dx + dy * dy) > 80) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);
    mob.hp -= dmg;

    // Weapon degrade
    const wepResult = this.degradeEquipped(p, 'weapon', 1);

    if (mob.hp <= 0) {
      mob.dead = true;
      const gold = Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1)) + mob.goldMin;
      this.addGold(p, gold);
      const leveled = this.addXP(p, mob.xpReward);
      p.rpg.stats = p.rpg.stats || {};
      p.rpg.stats.kills = (p.rpg.stats.kills || 0) + 1;
      this.saveData();
      // Broadcast mob death to party
      this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_mob_died', data: { mobId: mob.id, killedBy: username } });
      return { killed: true, dmg, crit, gold, xp: mob.xpReward, leveled, level: p.level, totalGold: p.gold, mobName: mob.templateName, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
    }
    // Broadcast mob HP to party
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_mob_hp', data: { mobId: mob.id, hp: mob.hp, maxHP: mob.maxHP } }, username);
    return { hit: true, dmg, crit, mobHP: mob.hp, mobMaxHP: mob.maxHP, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
  }

  rpgDungeonAttackBoss(username) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const instId = rp.zone;
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return { error: 'not_in_dungeon' };
    if (inst.deadMembers.includes(username)) return { error: 'dead' };
    if (!inst.boss || inst.boss.dead) return { error: 'boss_gone' };
    if (inst.boss.sleeping) return { error: 'boss_sleeping' };
    const boss = inst.boss;
    const dx = (rp.x || 400) - boss.x, dy = (rp.y || 200) - boss.y;
    if (Math.sqrt(dx * dx + dy * dy) > 120) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    if (rp.adminDmgMult > 1) dmg = Math.floor(dmg * rp.adminDmgMult);
    boss.hp -= dmg;

    // Enchant effects
    let burn = false, poison = false, holy = false;
    const wepItem = (p.rpg.equipped && p.rpg.equipped.weapon) || {};
    const weaponId = wepItem.id || '';
    const wepDef = ITEMS[weaponId] || {};
    let activeEnchant = '';
    if (wepDef.enchant) { activeEnchant = wepDef.enchant; }
    else if (wepItem.enchantments) {
      for (const ench of wepItem.enchantments) {
        const edef = ENCHANTMENTS[ench.id];
        if (edef && edef.stat === 'elemental' && Math.random() < (edef.proc || 0.10)) { activeEnchant = edef.value; break; }
      }
    }
    if (activeEnchant === 'fire') { boss.burnDamage = 8; boss.burnEnd = Date.now() + 3000; boss.burnTickAt = Date.now() + 500; burn = true; }
    if (activeEnchant === 'poison') { boss.poisonDamage = 5; boss.poisonEnd = Date.now() + 4000; boss.poisonTickAt = Date.now() + 500; poison = true; }
    if (activeEnchant === 'holy') { const holyDmg = Math.max(3, Math.floor(dmg * 0.15)); boss.hp -= holyDmg; holy = holyDmg; }

    // Lifesteal
    let lifestealHeal = 0;
    const lsVal = this.equipStat(p, 'lifesteal');
    if (lsVal > 0) {
      lifestealHeal = Math.max(1, Math.floor(dmg * lsVal));
      rp.hp = Math.min(rp.hp + lifestealHeal, rp.maxHP);
    }

    const wepResult = this.degradeEquipped(p, 'weapon', 3);

    // Broadcast boss HP to party
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_boss_hp', data: { hp: boss.hp, maxHP: boss.maxHP, attacker: username, dmg, crit } }, username);

    if (boss.hp <= 0) {
      boss.dead = true;
      inst.phase = 'complete';
      this.communityMilestoneData.bossKills = (this.communityMilestoneData.bossKills || 0) + 1;
      // Distribute loot to ALL alive members
      const lootResults = {};
      const cfg = PARTY_DUNGEON_CONFIG;
      for (const m of inst.members) {
        const mp = this.rpgGetPlayerData(m);
        const gold = this.addGold(mp, cfg.boss.goldReward || 800);
        const xpR = cfg.boss.xpReward || 600;
        const leveled = this.addXP(mp, xpR);
        mp.rpg.stats = mp.rpg.stats || {};
        mp.rpg.stats.kills = (mp.rpg.stats.kills || 0) + 1;
        this.addTrust(mp, 12);
        // Roll boss loot for each player
        const bossKey = boss.name.toLowerCase().replace(/\s+/g, '_');
        const lootDrops = this.rollLootTable(bossKey);
        const droppedItems = [], droppedWearables = [];
        for (const drop of lootDrops) {
          if (drop.wearable) {
            const w = WEARABLES[drop.itemId];
            if (w && !mp.wearables.includes(drop.itemId)) {
              mp.wearables.push(drop.itemId);
              droppedWearables.push({ id: drop.itemId, name: w.name, icon: w.icon, rarity: w.rarity, slot: w.slot });
            }
          } else {
            const added = this.addItemToInventory(mp, drop.itemId, drop.qty);
            if (added) droppedItems.push({ id: drop.itemId, name: (ITEMS[drop.itemId] || {}).name, qty: drop.qty, icon: (ITEMS[drop.itemId] || {}).icon });
          }
        }
        lootResults[m] = { gold, xp: xpR, leveled, level: mp.level, totalGold: mp.gold, drops: droppedItems, wearableDrops: droppedWearables, trust: mp.rpg.trust };
      }
      this.saveData();
      // Send victory to all
      for (const m of inst.members) {
        this.rpgSendTo(m, { type: 'rpg_dungeon_victory', data: { instanceId: instId, bossName: boss.name, loot: lootResults[m], allLoot: lootResults } });
      }
      this.logAction(inst.members[0], 'rpg_pdung_clear', `Party dungeon cleared by ${inst.members.join(', ')}`);
      // Schedule cleanup
      setTimeout(() => this.rpgDungeonEnd(instId, true), 10000);
      return { killed: true, dmg, crit, bossName: boss.name, cfgId: boss.cfgId, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
    }
    return { hit: true, dmg, crit, bossHP: boss.hp, bossMaxHP: boss.maxHP, burn, poison, holy, lifesteal: lifestealHeal, hp: rp.hp, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
  }

  rpgDungeonPlayerDied(instId, username) {
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return;
    if (inst.deadMembers.includes(username)) return;
    inst.deadMembers.push(username);
    const p = this.player(username);
    // Reduced gold loss in party dungeon (1.5% vs 3% solo)
    const lost = Math.floor((p.gold || 0) * 0.015);
    p.gold = Math.max(0, (p.gold || 0) - lost);
    this.saveData();
    this.rpgSendTo(username, { type: 'rpg_dungeon_you_died', data: { goldLost: lost, gold: p.gold } });
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_member_died', data: { username, deadMembers: inst.deadMembers } }, username);
  }

  rpgDungeonLeave(username) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const instId = rp.zone;
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return { error: 'not_in_dungeon' };
    // Remove from instance
    inst.members = inst.members.filter(m => m !== username);
    inst.deadMembers = inst.deadMembers.filter(m => m !== username);
    // Clean up any disconnect state
    delete rp.disconnected;
    delete rp._savedHP;
    delete rp._savedX;
    delete rp._savedY;
    delete rp._savedZone;
    // Send player back to hub
    rp.zone = 'hub';
    rp.x = 1200; rp.y = 700;
    const p = this.rpgGetPlayerData(username);
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    rp.maxHP = maxHP;
    rp.hp = maxHP;
    this.rpgSendTo(username, { type: 'rpg_dungeon_left', data: { zone: this.rpgGetZoneState('hub', username) } });
    this.rpgBroadcastZone('hub', { type: 'rpg_player_joined', data: { username, x: rp.x, y: rp.y, appearance: p.appearance, equipped: p.equipped, activeWearables: p.activeWearables, activeCosmetics: p.activeCosmetics || null } });
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_member_left', data: { username, members: inst.members } });
    // If all members left, cleanup
    if (inst.members.length === 0) {
      this.rpgDungeonEnd(instId, false);
    }
    return { success: true };
  }

  rpgDungeonEnd(instId, victory) {
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return;
    console.log(`[PDUNG] Instance ${instId} ended (${victory ? 'victory' : 'failed'})`);
    // Return all remaining members to hub
    for (const m of [...inst.members]) {
      const rp = this.rpgPlayers[m];
      if (!rp) continue;
      // Clean up disconnected players: remove their rp entry so they rejoin fresh
      if (rp.disconnected) {
        delete rp._savedHP;
        delete rp._savedX;
        delete rp._savedY;
        delete rp._savedZone;
        delete rp.disconnected;
        delete this.rpgPlayers[m];
        continue;
      }
      rp.zone = 'hub';
      rp.x = 1200; rp.y = 700;
      const p = this.rpgGetPlayerData(m);
      const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
      rp.maxHP = maxHP;
      rp.hp = maxHP;
      this.rpgSendTo(m, { type: 'rpg_dungeon_ended', data: { victory, zone: this.rpgGetZoneState('hub', m) } });
      this.rpgBroadcastZone('hub', { type: 'rpg_player_joined', data: { username: m, x: rp.x, y: rp.y, appearance: p.appearance, equipped: p.equipped, activeWearables: p.activeWearables, activeCosmetics: p.activeCosmetics || null } });
    }
    // Clear party dungeon state
    const party = this.rpgParties[inst.partyId];
    if (party) {
      party.dungeonInstanceId = null;
      party.dungeonReady = {};
    }
    // Delete instance
    delete this.rpgDungeonInstances[instId];
  }

  rpgDungeonMove(username, x, y) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    const instId = rp.zone;
    const inst = this.rpgDungeonInstances[instId];
    if (!inst) return;
    if (inst.deadMembers.includes(username)) return;
    rp.x = x;
    rp.y = y;
    // Broadcast movement to other party members
    const p = this.players[username];
    this.rpgBroadcastInstance(instId, { type: 'rpg_dungeon_player_move', data: {
      username, x, y,
      appearance: p ? p.appearance : null,
      equipped: p ? p.equipped : null,
      activeWearables: p ? p.activeWearables : null,
      activeCosmetics: p ? (p.activeCosmetics || null) : null,
    }}, username);
  }
}

// ═══════════════════════════════════════════
// RPG Constants
// ═══════════════════════════════════════════
const TAVERN_QUESTS = [
  // ── Early Forest (Stranger / Newcomer trust tier) ──
  { id: 'q_slimes',       title: 'First Blood',         type: 'kill', target: 'slime',  goal: 4,  goldReward: 60,  xpReward: 25, trustReq: 0,  trustReward: 3,  desc: 'Every blade needs testin\'. Forest\'s crawling with slimes — overgrown things, more of \'em every day since the quake. Put four down and I\'ll know you can handle yourself.' },
  { id: 'q_stones',       title: 'Earn Your Keep',      type: 'mine',                   goal: 8,  goldReward: 75,  xpReward: 30, trustReq: 0,  trustReward: 3,  desc: 'This tavern doesn\'t run on good intentions. The quarry\'s got stone we need for repairs — eight blocks should do it. Consider it rent for sleeping under my roof.' },
  { id: 'q_goblins',      title: 'Goblin Creep',        type: 'kill', target: 'goblin', goal: 5,  goldReward: 100, xpReward: 40, trustReq: 5,  trustReward: 4,  desc: 'Goblins are pushing closer to Tavernvale every night. Never used to come this far. Something\'s driving them out of the deep woods. Put five down before they get bold enough to raid the market.' },
  { id: 'q_wolves',       title: 'Thinning the Pack',   type: 'kill', target: 'wolf',   goal: 4,  goldReward: 100, xpReward: 40, trustReq: 10, trustReward: 4,  desc: 'The wolves in the Shadow Forest are changing — bigger, meaner, eyes too bright. Like something\'s feeding them from below. Thin the pack before they organize. Four should send a message.' },
  // ── Mid Forest (Newcomer / Familiar trust tier) ──
  { id: 'q_forest_patrol',title: 'Forest Patrol',       type: 'kill_any_forest',         goal: 10, goldReward: 150, xpReward: 60, trustReq: 15, trustReward: 5,  desc: 'Road\'s not safe. Traders can\'t get through without escort and I\'m tired of hearing about ambushes. Patrol the forest — kill ten of whatever snarls at you. Make the roads passable again.' },
  { id: 'q_goblin_camp',  title: 'Goblin Camp',         type: 'kill', target: 'goblin', goal: 8,  goldReward: 175, xpReward: 60, trustReq: 20, trustReward: 5,  desc: '*leans forward* The goblins have set up a camp deeper in the forest. Bold little bastards. They\'re organizing — raiding parties, scouts, the works. Hit \'em hard. Eight should scatter the camp.' },
  { id: 'q_goblin_king',  title: 'Dethrone the King',   type: 'kill_boss', target: 'goblin_king', goal: 1, goldReward: 300, xpReward: 100, trustReq: 22, trustReward: 8, desc: '*slams fist on table* Those goblin raids? They ain\'t random. There\'s a King — a big ugly brute holed up in a warehouse on the east side of the forest. Crown on his head, club in his hand, and a mountain of stolen gold at his feet. Kick his door in and put him down. Word is he keeps an ornate key on him — unlocks a treasure chest hidden in the back of his hut. Whatever\'s in there... it\'s yours if you can pry the key from his cold, dead hands.' },
  { id: 'q_wolf_alpha',   title: 'Alpha Hunt',          type: 'kill', target: 'wolf',   goal: 6,  goldReward: 175, xpReward: 65, trustReq: 25, trustReward: 6,  desc: '*leans forward* There\'s an alpha leading the pack. Big. Smart. It\'s been watching the town from the tree line. Take out six wolves and the alpha loses its army. Then maybe it\'ll be foolish enough to come looking for you itself.' },
  { id: 'q_deep_woods',   title: 'Deep Woods',          type: 'kill_any_forest',         goal: 15, goldReward: 250, xpReward: 75, trustReq: 30, trustReward: 6,  desc: 'You\'ve proven you can handle what lurks at the forest edge. Time to push deeper. The things in the heart of the Shadow Forest are older, meaner. Fifteen kills. Don\'t come back until the deep woods know your name.' },
  { id: 'q_quarry_supply',title: 'Quarry Supply Run',   type: 'mine',                   goal: 15, goldReward: 200, xpReward: 65, trustReq: 35, trustReward: 5,  desc: 'We\'re running low on building stone. The walls need reinforcing — something tells me we\'ll need \'em strong soon. Mine fifteen blocks from the quarry. Solid work for solid pay.' },
  // ── Late Forest (Familiar / Trusted trust tier) ──
  { id: 'q_forest_clear', title: 'Prepare for Battle',  type: 'kill_any_forest',         goal: 20, goldReward: 350, xpReward: 90, trustReq: 40, trustReward: 7,  desc: '*dead serious* The Ancient Treant isn\'t just some overgrown tree. It\'s a corrupted Warden guardian — twisted by whatever\'s feeding on the Flame below. Twenty forest kills to sharpen your edge. When you face that thing, you\'ll need every ounce of skill you\'ve earned.' },
  { id: 'q_treant_kill',   title: 'Fell the Ancient',    type: 'kill_boss', target: 'ancient_treant', goal: 1, goldReward: 500, xpReward: 150, trustReq: 45, trustReward: 12, desc: '*stands up slowly* It\'s time. The Ancient Treant — the corrupted Warden — must fall. It\'s been poisoning the forest from its roots, twisting every creature that comes near. March into its arena and put that abomination DOWN. This is what you\'ve been training for.' },
];

// ═══════════════════════════════════════════
// Grizzle's Mining Quests — quarry NPC side-quests
// ═══════════════════════════════════════════
const GRIZZLE_QUESTS = [
  // ── Starter tier (mining level 1+) ──
  { id: 'gq_first_haul',    title: 'First Haul',         type: 'mine',           goal: 5,  goldReward: 50,  xpReward: 20,  miningReq: 1,  desc: '*spits on ground* You look green. Prove you can swing a pick before I waste my breath. Break five rocks — any kind. Come back when your arms hurt.' },
  { id: 'gq_stone_order',   title: 'Stone Requisition',  type: 'mine_type', target: 'stone',  goal: 10, goldReward: 75,  xpReward: 30,  miningReq: 1,  desc: '*checks clipboard* Got an order for stone blocks from Tavernvale. Ten chunks of plain stone. Boring work, but it pays. The walls ain\'t gonna rebuild themselves.' },
  { id: 'gq_copper_hunt',   title: 'Copper Prospecting', type: 'mine_type', target: 'copper', goal: 5,  goldReward: 100, xpReward: 40,  miningReq: 3,  desc: '*taps a vein* See that greenish streak? Copper. Good stuff for tools and trading. Five copper veins — pick carefully, they\'re not everywhere.' },
  // ── Mid tier (mining level 5+) ──
  { id: 'gq_iron_rush',     title: 'Iron Rush',          type: 'mine_type', target: 'iron',   goal: 4,  goldReward: 150, xpReward: 55,  miningReq: 5,  desc: '*eyes narrow* Iron\'s getting scarce. The blacksmith in town is screaming for it. Four iron veins — hit \'em clean, don\'t waste the ore. I\'ll pay above market rate.' },
  { id: 'gq_deep_survey',   title: 'Deep Survey',        type: 'mine',           goal: 20, goldReward: 250, xpReward: 80,  miningReq: 5,  desc: '*unfolds dusty map* Need someone to survey the deeper shafts. Mine twenty nodes of any ore — map out what\'s down there. Mark the veins. Used to be a whole network of tunnels before the quake...' },
  { id: 'gq_gold_strike',   title: 'Gold Strike',        type: 'mine_type', target: 'gold',   goal: 3,  goldReward: 250, xpReward: 85,  miningReq: 8,  desc: '*lowers voice* Between you and me... I\'ve been tracking a gold vein. Mother lode, kid. Find three gold deposits in this quarry. That\'s right — GOLD in a stone quarry. The quake shook things loose that shouldn\'t be here.' },
  // ── Expert tier (mining level 12+) ──
  { id: 'gq_gem_collector',  title: 'Gem Collector',     type: 'mine_type', target: 'gem',    goal: 2,  goldReward: 350, xpReward: 100, miningReq: 12, desc: '*pulls out magnifying glass* There are raw gems buried in these walls. Rare as hen\'s teeth, but worth a fortune. Find two gem deposits. They glow faint blue if you know what to look for...' },
  { id: 'gq_marathon_miner', title: 'Marathon Miner',    type: 'mine',           goal: 50, goldReward: 500, xpReward: 150, miningReq: 12, desc: '*crosses arms* You think you\'re a real miner? Prove it. Fifty rocks. In this quarry. No breaks, no complaints. That\'s what separates the tourists from the workers. I\'ll make it worth your while.' },
  { id: 'gq_rare_earth',     title: 'Rare Earth',        type: 'mine_rare',      goal: 5,  goldReward: 600, xpReward: 180, miningReq: 15, desc: '*pulls you aside* Listen close. The rare ores — copper, iron, gold, gems — they\'re not random. The quake exposed old Warden deposits. Mine five rare ores of ANY kind. I need samples to study. This could change everything for Tavernvale.' },
  { id: 'gq_master_delve',   title: 'Master Delve',      type: 'mine',           goal: 100,goldReward: 1000,xpReward: 300, miningReq: 20, desc: '*dead serious* One hundred nodes. This whole quarry, top to bottom. No miner in Tavernvale has ever done it in a single push. You do this... *pauses* ...I\'ll give you something special. A real miner\'s reward.' },
];

// ═══════════════════════════════════════════
// Enchantment System — apply books to equipment
// ═══════════════════════════════════════════
const ENCHANTMENTS = {
  sharpness:  { name: 'Sharpness',  slot: 'weapon', stat: 'dmgBonus',     value: 4,    desc: '+4 damage',          color: '#ff4444' },
  protection: { name: 'Protection', slot: 'armor',  stat: 'defBonus',     value: 3,    desc: '+3 defense',         color: '#4488ff' },
  fortune:    { name: 'Fortune',    slot: 'weapon', stat: 'goldFind',     value: 0.15, desc: '+15% gold from mining', color: '#fbbf24' },
  lifesteal:  { name: 'Lifesteal',  slot: 'weapon', stat: 'lifesteal',    value: 0.08, desc: 'Heal 8% of dmg dealt', color: '#44ff44' },
  critical:   { name: 'Critical',   slot: 'weapon', stat: 'critChance',   value: 0.05, desc: '+5% crit chance',    color: '#c084fc' },
  unbreaking: { name: 'Unbreaking', slot: 'any',    stat: 'durability',   value: 0.5,  desc: '+50% durability',    color: '#60a5fa' },
  // Elemental enchants (from books — 10% proc chance on non-mythic weapons)
  fire_enchant:   { name: 'Inferno',   slot: 'weapon', stat: 'elemental', value: 'fire',   proc: 0.10, desc: '10% chance to burn',   color: '#ff6600' },
  poison_enchant: { name: 'Venom',     slot: 'weapon', stat: 'elemental', value: 'poison', proc: 0.10, desc: '10% chance to poison', color: '#44ff44' },
  holy_enchant:   { name: 'Radiance',  slot: 'weapon', stat: 'elemental', value: 'holy',   proc: 0.10, desc: '10% chance holy burst', color: '#ffd700' },
};

const RPG_PICKAXES = [
  { tier: 1, name: 'Stone Pickaxe',   cost: 0,     power: 1, speed: 1.0,  icon: '🪨' },
  { tier: 2, name: 'Iron Pickaxe',    cost: 1000,  power: 2, speed: 1.3,  icon: '⛏️' },
  { tier: 3, name: 'Gold Pickaxe',    cost: 3000,  power: 3, speed: 1.6,  icon: '🥇' },
  { tier: 4, name: 'Diamond Pickaxe', cost: 8000,  power: 4, speed: 2.0,  icon: '💎' },
  { tier: 5, name: 'Crystal Pickaxe', cost: 20000, power: 5, speed: 2.5,  icon: '🔮' },
];

// Minimum pickaxe tier required to mine each ore type
const ORE_TIER_REQ = {
  stone: 1, copper: 1, iron: 1, silver: 2, gold: 3, gem: 2,
  ruby: 3, diamond: 4, crystal: 4, mythril: 5, void: 5,
};

// ═══════════════════════════════════════════
// Tile Map System — grid-based world for each zone
// ═══════════════════════════════════════════
const TILE_SIZE = 40;  // pixels per tile
const MAP_W = 60;      // 60 * 40 = 2400px (matches world width)
const MAP_H = 60;      // 60 * 40 = 2400px (matches world height)
const TILE = { FLOOR: 0, WALL: 1, GRASS: 2, STONE: 3, SAND: 4, WATER: 5, WOOD: 6 };
// Tile properties array indexed by tile ID
const TILE_PROPS = [
  /* FLOOR */ { walkable: true },
  /* WALL  */ { walkable: false },
  /* GRASS */ { walkable: true },
  /* STONE */ { walkable: true },
  /* SAND  */ { walkable: true },
  /* WATER */ { walkable: false },
  /* WOOD  */ { walkable: true },
];

const RPG_ZONES = {
  hub: {
    name: 'Hub Town', icon: '🏠', type: 'hub',
    bg: '#1a1a2e',
    minMiningLevel: 0,
    // Zone regions — named sub-areas of the hub used for minimap labels,
    // spawn validation, and future gameplay hooks. Coords in tile units.
    regions: {
      spawn:  { x1: 24, y1: 13, x2: 36, y2: 21, label: 'Spawn' },
      mining: { x1: 3,  y1: 3,  x2: 18, y2: 31, label: 'Mine' },
      combat: { x1: 42, y1: 3,  x2: 57, y2: 31, label: 'Combat' },
      market: { x1: 22, y1: 25, x2: 38, y2: 31, label: 'Market' },
      tavern: { x1: 24, y1: 4,  x2: 36, y2: 11, label: 'Tavern' },
      basement: { x1: 48, y1: 19, x2: 56, y2: 33, label: 'Dungeon Basement' },
    },
    // In-world interactive landmarks — walk up and press E to travel / interact.
    // tx,ty = tile coords; zone = target zone or null; type = visual type; label = prompt text
    landmarks: [
      { id: 'lm_quarry',    tx: 10, ty: 17, zone: 'quarry',    type: 'mine_entrance', label: 'Mining Lodge',     icon: '⛏️' },
      { id: 'lm_deep_mine', tx: 10, ty: 10, zone: null,         type: 'mine_entrance', label: 'Iron Depths (Event)', icon: '🕳️' },
      { id: 'lm_gold_vein', tx: 10, ty: 24, zone: null,         type: 'mine_entrance', label: 'Gold Vein (Event)',   icon: '💰' },
      { id: 'lm_forest',    tx: 50, ty: 17, zone: 'forest',    type: 'forest_gate',   label: 'Shadow Forest',    icon: '🌲' },
      { id: 'lm_dungeon',   tx: 49, ty: 54, zone: 'dungeon',   type: 'dungeon_portal',label: 'Dark Dungeon',     icon: '🏰' },
      { id: 'lm_market',    tx: 30, ty: 28, zone: 'market',    type: 'market_gate',   label: 'Marketplace — NOW OPEN!!', icon: '🏪' },
      { id: 'lm_duel',      tx: 50, ty: 10, zone: null,         type: 'arena_gate',    label: 'Duel Arena',       icon: '⚔️' },
      { id: 'lm_housing',   tx: 30, ty: 35, zone: 'housing',    type: 'housing_gate',  label: 'Housing District', icon: '🏘️' },
    ],
  },
  quarry: {
    name: 'Mining Lodge', icon: '⛏️', type: 'mine',
    bg: '#2a2018',
    minMiningLevel: 0,
    npc: { id: 'grizzle', name: 'Grizzle', x: 30, y: 29 },
    nodes: 18,
    respawnTime: 15000,
    drops: [
      { type: 'stone',  weight: 45, gold: 1,  xp: 1,  hp: 3,  color: '#888888', size: 1.0 },
      { type: 'copper', weight: 30, gold: 2,  xp: 3,  hp: 5,  color: '#CD7F32', size: 0.9 },
      { type: 'iron',   weight: 18, gold: 4,  xp: 5,  hp: 8,  color: '#B0B0B0', size: 0.85 },
      { type: 'gold',   weight: 5,  gold: 8,  xp: 10, hp: 12, color: '#FFD700', size: 0.75 },
      { type: 'gem',    weight: 2,  gold: 15, xp: 14, hp: 16, color: '#00BFFF', size: 0.65 },
    ],
    landmarks: [
      { id: 'lm_undermine', tx: 30, ty: 54, zone: 'underground_mine', type: 'mine_entrance', label: 'Abandoned Mine', icon: '⛏️' },
      { id: 'lm_deepmine', tx: 37, ty: 28, zone: 'deep_mine', type: 'dungeon_portal', label: 'Deep Caves', icon: '🕳️', minMiningLevel: 15 },
      { id: 'lm_quarry_return', tx: 30, ty: 34, zone: 'hub', type: 'return_portal', label: 'Return to Hub', icon: '🏠' },
    ],
  },
  underground_mine: {
    name: 'Underground Mine', icon: '⛏️', type: 'mine',
    bg: '#0d0d12',
    minMiningLevel: 1,
    nodes: 28,
    respawnTime: 45000,
    drops: [
      { type: 'stone',  weight: 40, gold: 1,  xp: 1,  hp: 5,  color: '#888888', size: 1.0 },
      { type: 'copper', weight: 20, gold: 2,  xp: 3,  hp: 7,  color: '#CD7F32', size: 0.9 },
      { type: 'iron',   weight: 18, gold: 4,  xp: 5,  hp: 10, color: '#B0B0B0', size: 0.85 },
      { type: 'silver', weight: 10, gold: 6,  xp: 7,  hp: 12, color: '#C0C0C0', size: 0.8 },
      { type: 'gold',   weight: 7,  gold: 8,  xp: 10, hp: 16, color: '#FFD700', size: 0.75 },
      { type: 'gem',    weight: 3,  gold: 15, xp: 14, hp: 20, color: '#00BFFF', size: 0.65 },
      { type: 'ruby',   weight: 1.5,gold: 22, xp: 20, hp: 24, color: '#FF0044', size: 0.55 },
      { type: 'diamond',weight: 0.5,gold: 35, xp: 30, hp: 30, color: '#E0F0FF', size: 0.50 },
    ],
    mobCount: 5,
    mobs: [
      { name: 'Cave Spider',  maxHP: 80,  atk: 4,  goldMin: 1, goldMax: 3,  xpReward: 5,  color: '#4a3728', behavior:'swarm',    moveSpeed:1.8, chaseSpeed:2.4, aggroRange:140, leashRange:220, atkCD:1800, ability:{name:'web_spit',cd:7000,trigger:'ranged',range:150,slowDuration:2000,slowMult:0.4} },
      { name: 'Stone Golem',  maxHP: 200, atk: 8,  goldMin: 3, goldMax: 7,  xpReward: 12, color: '#888888', behavior:'slow_tank', moveSpeed:0.4, chaseSpeed:0.6, aggroRange:100, leashRange:180, atkCD:3500, ability:{name:'ground_slam',cd:8000,trigger:'melee',radius:100,dmgMult:0.8,stunDuration:1000} },
      { name: 'Mimic Ore',    maxHP: 120, atk: 6,  goldMin: 4, goldMax: 10, xpReward: 15, color: '#FFD700', behavior:'ambusher',  moveSpeed:0.0, chaseSpeed:2.0, aggroRange:70,  leashRange:200, atkCD:2000, ability:{name:'gold_scatter',cd:6000,trigger:'combat',count:4,dmgEach:2} },
    ],
    landmarks: [
      { id: 'lm_deep_descent', tx: 30, ty: 54, zone: 'deep_mine', type: 'dungeon_portal', label: 'Deep Caves', icon: '🕳️', minMiningLevel: 15 },
      { id: 'lm_umine_return', tx: 56, ty: 30, zone: 'quarry', type: 'return_portal', label: 'Return to Mining Lodge', icon: '⛏️' },
    ],
    boss: {
      cfgId: 'crystal_burrower',
      name: 'Crystal Burrower',
      maxHP: 2000,
      goldReward: 800,
      xpReward: 450,
      vgReward: 10,
      color: '#8844aa',
      arenaX: 2080, arenaY: 1200,
      arenaRadius: 320,
      chaseSpeed: 1.2,
      respawnTime: 200000,
      sleeping: true,
      wakeRadius: 120,
      phases: [
        { hpPercent: 1.0,  name: 'Surfacing',    speedMult: 0.9, dmgMult: 1.0 },
        { hpPercent: 0.7,  name: 'Feeding Frenzy', speedMult: 1.2, dmgMult: 1.3 },
        { hpPercent: 0.35, name: 'Desperate',     speedMult: 1.6, dmgMult: 1.8 },
      ],
      attacks: [
        { name: 'Tunnel Charge',     type: 'line', dmg: 18, range: 280, width: 60,  telegraphTime: 1800, cooldown: 4000 },
        { name: 'Acid Pools',        type: 'acid_pools', dmg: 5, poolCount: 4, poolRadius: 50, poolDuration: 8000, tickRate: 1000, telegraphTime: 1600, cooldown: 9000 },
        { name: 'Burrow',            type: 'burrow', dmg: 30, radius: 100, burrowDuration: 2200, speed: 2.5, telegraphTime: 1200, cooldown: 10000 },
        { name: 'Tail Whip',         type: 'aoe',  dmg: 16, radius: 120, telegraphTime: 1200, cooldown: 3500 },
        { name: 'Cave-In',           type: 'aoe',  dmg: 28, radius: 180, telegraphTime: 2400, cooldown: 7000, maxHpPct: 0.7 },
        { name: 'Constrict',         type: 'constrict', dmg: 35, radius: 160, shrinkDuration: 3000, gapAngle: 0.8, telegraphTime: 800, cooldown: 14000, maxHpPct: 0.7 },
        { name: 'Eruption',          type: 'aoe',  dmg: 35, radius: 200, telegraphTime: 2800, cooldown: 10000, maxHpPct: 0.35 },
        { name: 'Crystal Barrage',   type: 'line', dmg: 40, range: 300, width: 70,  telegraphTime: 2600, cooldown: 12000, maxHpPct: 0.35 },
      ],
    },
  },
  deep_mine: {
    name: 'Deep Mine', icon: '🕳️', type: 'mine',
    bg: '#08060f',
    minMiningLevel: 15,
    nodes: 16,
    respawnTime: 90000,
    drops: [
      { type: 'gold',    weight: 35, gold: 8,  xp: 8,  hp: 18, color: '#FFD700', size: 0.8 },
      { type: 'crystal', weight: 22, gold: 12, xp: 12, hp: 24, color: '#c084fc', size: 0.7 },
      { type: 'diamond', weight: 15, gold: 22, xp: 20, hp: 30, color: '#00BFFF', size: 0.6 },
      { type: 'ruby',    weight: 12, gold: 30, xp: 25, hp: 36, color: '#FF0044', size: 0.55 },
      { type: 'mythril', weight: 10, gold: 45, xp: 35, hp: 44, color: '#88ffcc', size: 0.5 },
      { type: 'void',    weight: 6,  gold: 60, xp: 45, hp: 55, color: '#9900ff', size: 0.45 },
    ],
    mobCount: 4,
    mobs: [
      { name: 'Stone Golem',  maxHP: 300, atk: 12, goldMin: 5,  goldMax: 10, xpReward: 18, color: '#888888', behavior:'slow_tank', moveSpeed:0.5, chaseSpeed:0.7, aggroRange:110, leashRange:200, atkCD:3200, ability:{name:'ground_slam',cd:7000,trigger:'melee',radius:120,dmgMult:1.0,stunDuration:1200} },
      { name: 'Cave Spider',  maxHP: 150, atk: 8,  goldMin: 3,  goldMax: 6,  xpReward: 10, color: '#4a3728', behavior:'swarm',     moveSpeed:2.0, chaseSpeed:2.8, aggroRange:150, leashRange:240, atkCD:1600, ability:{name:'web_spit',cd:6000,trigger:'ranged',range:160,slowDuration:2500,slowMult:0.35} },
      { name: 'Mimic Ore',    maxHP: 220, atk: 10, goldMin: 6,  goldMax: 14, xpReward: 20, color: '#FFD700', behavior:'ambusher',  moveSpeed:0.0, chaseSpeed:2.2, aggroRange:75,  leashRange:220, atkCD:1800, ability:{name:'gold_scatter',cd:5000,trigger:'combat',count:5,dmgEach:3} },
    ],
    boss: {
      cfgId: 'stone_guardian',
      name: 'Stone Guardian',
      maxHP: 4000,
      goldReward: 1500,
      xpReward: 800,
      vgReward: 25,
      color: '#555555',
      arenaX: 1200, arenaY: 360,
      arenaRadius: 300,
      chaseSpeed: 1.0,
      respawnTime: 300000,
      sleeping: true,
      wakeRadius: 140,
      phases: [
        { hpPercent: 1.0,  name: 'Dormant',      speedMult: 0.8, dmgMult: 1.0 },
        { hpPercent: 0.75, name: 'Awakened',      speedMult: 1.0, dmgMult: 1.2 },
        { hpPercent: 0.5,  name: 'Crumbling',     speedMult: 1.3, dmgMult: 1.6 },
        { hpPercent: 0.25, name: 'Crystal Core',  speedMult: 1.6, dmgMult: 2.0 },
        { hpPercent: 0.1,  name: 'Shattered Fury', speedMult: 2.0, dmgMult: 2.5 },
      ],
      attacks: [
        { name: 'Rock Slam',       type: 'aoe',  dmg: 30, radius: 150, telegraphTime: 1800, cooldown: 3500 },
        { name: 'Boulder Throw',   type: 'line', dmg: 25, range: 280, width: 70, telegraphTime: 1600, cooldown: 3000 },
        { name: 'Earthquake',      type: 'aoe',  dmg: 40, radius: 220, telegraphTime: 2200, cooldown: 7000, maxHpPct: 0.75 },
        { name: 'Crystal Barrage', type: 'aoe',  dmg: 35, radius: 180, telegraphTime: 2000, cooldown: 5000, maxHpPct: 0.5 },
        { name: 'Collapse',        type: 'aoe',  dmg: 55, radius: 300, telegraphTime: 2800, cooldown: 12000, maxHpPct: 0.25 },
        { name: 'Boulder Throw',   type: 'line', dmg: 35, range: 300, width: 80, telegraphTime: 1400, cooldown: 4000, maxHpPct: 0.5 },
        { name: 'Rock Slam',       type: 'aoe',  dmg: 45, radius: 180, telegraphTime: 1500, cooldown: 3000, maxHpPct: 0.1 },
      ],
    },
    landmarks: [
      { id: 'lm_deep_return', tx: 56, ty: 30, zone: 'underground_mine', type: 'return_portal', label: 'Return to Underground', icon: '⛏️' },
    ],
  },
  gold_vein: {
    name: 'Gold Vein', icon: '💰', type: 'mine',
    bg: '#2a2510',
    minMiningLevel: 25,
    nodes: 10,
    respawnTime: 240000,
    drops: [
      { type: 'gold',    weight: 50, gold: 8,  xp: 6,  hp: 20, color: '#FFD700' },
      { type: 'crystal', weight: 24, gold: 12, xp: 12, hp: 26, color: '#c084fc' },
      { type: 'diamond', weight: 15, gold: 22, xp: 20, hp: 34, color: '#00BFFF' },
      { type: 'ruby',    weight: 8,  gold: 35, xp: 30, hp: 44, color: '#FF0044' },
      { type: 'void',    weight: 3,  gold: 60, xp: 45, hp: 55, color: '#9900ff' },
    ],
    landmarks: [
      { id: 'lm_gold_return', tx: 56, ty: 17, zone: 'deep_mine', type: 'return_portal', label: 'Return to Deep Mine', icon: '🕳️' },
    ],
  },
  forest: {
    name: 'Shadow Forest', icon: '🌲', type: 'combat',
    bg: '#0a1a0a',
    minMiningLevel: 0,
    mobCount: 12,
    mobs: [
      { name: 'Slime',    maxHP: 35,  atk: 2,  goldMin: 1,  goldMax: 3,  xpReward: 4,  color: '#44ff44', behavior:'slow_chase', moveSpeed:0.4, chaseSpeed:0.7, aggroRange:90, leashRange:180, atkCD:3000, ability:{name:'split',cd:0,trigger:'hp30'} },
      { name: 'Goblin',   maxHP: 55,  atk: 3,  goldMin: 2,  goldMax: 5,  xpReward: 6,  color: '#ff8800', behavior:'skirmisher', moveSpeed:0.7, chaseSpeed:1.3, aggroRange:110, leashRange:220, atkCD:2200, ability:{name:'throw_dagger',cd:8000,trigger:'ranged',range:180,dmgMult:0.4} },
      { name: 'Wolf',     maxHP: 80,  atk: 5,  goldMin: 3,  goldMax: 7,  xpReward: 10, color: '#aaaaaa', behavior:'pack_hunter',moveSpeed:0.9, chaseSpeed:1.6, aggroRange:130, leashRange:250, atkCD:1800, ability:{name:'lunge',cd:6000,trigger:'chase',dashDist:60,dmgMult:1.5} },
    ],
    landmarks: [
      { id: 'lm_forest_return', tx: 4, ty: 30, zone: 'hub', type: 'return_portal', label: 'Return to Hub', icon: '🏠' },
    ],
    boss: {
      cfgId: 'ancient_treant',
      name: 'Ancient Treant',
      maxHP: 2500,
      goldReward: 750,
      xpReward: 500,
      vgReward: 15,
      color: '#2d5a1e',
      arenaX: 360, arenaY: 360,
      arenaRadius: 350,
      chaseSpeed: 1.4,
      respawnTime: 180000,
      sleeping: true,
      wakeRadius: 120,
      phases: [
        { hpPercent: 1.0,  name: 'Guardian',   speedMult: 1.0, dmgMult: 1.0 },
        { hpPercent: 0.75, name: 'Awakened',    speedMult: 1.2, dmgMult: 1.15 },
        { hpPercent: 0.5,  name: 'Enraged',     speedMult: 1.5, dmgMult: 1.4 },
        { hpPercent: 0.25, name: 'Desperate',   speedMult: 1.8, dmgMult: 1.7 },
      ],
      attacks: [
        { name: 'Root Slam',         type: 'aoe',    dmg: 22, radius: 130, telegraphTime: 2000,  cooldown: 4000  },
        { name: 'Vine Whip',         type: 'line',   dmg: 15, range: 220,  width: 50,  telegraphTime: 1500,  cooldown: 3000  },
        { name: 'Thorn Barrage',     type: 'line',   dmg: 10, range: 200,  width: 60,  telegraphTime: 1200,  cooldown: 2000  },
        { name: 'Ground Pound',      type: 'aoe',    dmg: 30, radius: 200, telegraphTime: 2500, cooldown: 8000, maxHpPct: 0.75 },
        { name: 'Spore Cloud',       type: 'aoe',    dmg: 14, radius: 160, telegraphTime: 1800,  cooldown: 5000, maxHpPct: 0.5 },
        { name: 'Entangling Roots',  type: 'aoe',    dmg: 18, radius: 180, telegraphTime: 2200, cooldown: 10000, maxHpPct: 0.6 },
        { name: 'Death Blossom',     type: 'aoe',    dmg: 40, radius: 250, telegraphTime: 3000, cooldown: 20000, maxHpPct: 0.25 },
        { name: 'Trunk Hurl',        type: 'line',   dmg: 45, range: 300, width: 70, telegraphTime: 2800, cooldown: 12000, maxHpPct: 0.25 },
      ],
    },
    secondaryBosses: [
      {
        id: 'goblin_king',
        name: 'Goblin King',
        maxHP: 1200,
        goldReward: 500,
        xpReward: 350,
        color: '#ff8800',
        arenaX: 2100, arenaY: 1000,
        arenaRadius: 240,
        chaseSpeed: 1.0,
        respawnTime: 120000,
        sleeping: true,
        wakeRadius: 80,
        moveSpeed: 0.5,
        phases: [
          { hpPercent: 1.0,  name: 'Throne Guard', speedMult: 0.8, dmgMult: 1.0 },
          { hpPercent: 0.6,  name: 'Furious',      speedMult: 1.2, dmgMult: 1.3 },
          { hpPercent: 0.3,  name: 'ENRAGED',      speedMult: 1.2, dmgMult: 1.3, enraged: true },
        ],
        attacks: [
          { name: 'Dash Strike',       type: 'dash',   dmg: 28, range: 280, width: 50, telegraphTime: 1400, cooldown: 5000 },
          { name: 'Triple Knife Throw',type: 'spread', dmg: 16, range: 260, spreadAngle: 0.5, knifeCount: 3, width: 30, telegraphTime: 1600, cooldown: 4500 },
          { name: 'Goblin Bomb',       type: 'bomb',   dmg: 32, radius: 120, telegraphTime: 2200, cooldown: 7000 },
          { name: 'Club Slam',         type: 'aoe',    dmg: 22, radius: 100, telegraphTime: 1200, cooldown: 3500 },
          { name: 'Fury Dash',         type: 'dash',   dmg: 38, range: 320, width: 60, telegraphTime: 1000, cooldown: 6000, maxHpPct: 0.3 },
          { name: 'Crown Smash',       type: 'aoe',    dmg: 42, radius: 150, telegraphTime: 1800, cooldown: 9000, maxHpPct: 0.3 },
        ],
      },
    ],
  },
  dungeon: {
    name: 'Dark Dungeon', icon: '🏰', type: 'combat',
    bg: '#0a0a15',
    minMiningLevel: 0,
    mobCount: 5,
    mobs: [
      { name: 'Skeleton', maxHP: 200, atk: 10, goldMin: 3,  goldMax: 7,  xpReward: 12, color: '#ffffff', behavior:'guardian',   moveSpeed:0.7, chaseSpeed:1.2, aggroRange:130, leashRange:180, atkCD:2200, ability:{name:'bone_shield',cd:10000,trigger:'combat',duration:3000,reduction:0.5} },
      { name: 'Zombie',   maxHP: 300, atk: 14, goldMin: 5,  goldMax: 10, xpReward: 18, color: '#6b8e23', behavior:'relentless', moveSpeed:0.5, chaseSpeed:0.8, aggroRange:140, leashRange:9999, atkCD:2800, ability:{name:'grab',cd:8000,trigger:'melee',rootDuration:1500} },
      { name: 'Wraith',   maxHP: 430, atk: 18, goldMin: 6,  goldMax: 12, xpReward: 28, color: '#8844cc', behavior:'ambusher',   moveSpeed:0.0, chaseSpeed:1.6, aggroRange:80,  leashRange:220, atkCD:2000, ability:{name:'life_drain',cd:9000,trigger:'combat',duration:4000,healPct:0.5} },
      { name: 'Demon',    maxHP: 600, atk: 24, goldMin: 8,  goldMax: 18, xpReward: 45, color: '#ff2222', behavior:'aggressive', moveSpeed:1.0, chaseSpeed:2.0, aggroRange:200, leashRange:300, atkCD:1500, ability:{name:'fire_breath',cd:7000,trigger:'combat',dmgMult:1.5,range:120} },
    ],
    boss: {
      cfgId: 'hollow_sentinel',
      name: 'Hollow Sentinel',
      maxHP: 900,
      goldReward: 600,
      xpReward: 450,
      vgReward: 5,
      color: '#2a0a3a',
      arenaX: 420, arenaY: 420,
      arenaRadius: 300,
      chaseSpeed: 1.6,
      respawnTime: 180000,
      sleeping: true,
      wakeRadius: 120,
      phases: [
        { hpPercent: 1.0,  name: 'Dormant',    speedMult: 1.0, dmgMult: 1.0 },
        { hpPercent: 0.5,  name: 'Unleashed',   speedMult: 1.4, dmgMult: 1.5 },
        { hpPercent: 0.2,  name: 'Void Fury',   speedMult: 1.8, dmgMult: 2.0 },
      ],
      attacks: [
        { name: 'Void Slam',         type: 'aoe',    dmg: 24, radius: 120, telegraphTime: 700, cooldown: 4000 },
        { name: 'Shadow Beam',       type: 'line',   dmg: 18, range: 220,  width: 50, telegraphTime: 500, cooldown: 3000 },
        { name: 'Hollow Rift',       type: 'aoe',    dmg: 30, radius: 80,  telegraphTime: 600, cooldown: 8000 },
        { name: 'Summon Shades',     type: 'summon', count: 2, cooldown: 15000 },
      ],
    },
    landmarks: [
      { id: 'lm_dungeon_return', tx: 4, ty: 30, zone: 'hub', type: 'return_portal', label: 'Return to Hub', icon: '🏠' },
    ],
  },
  housing: {
    name: 'Housing District', icon: '🏘️', type: 'housing',
    bg: '#1a1e2a',
    minMiningLevel: 0,
    landmarks: [
      { id: 'lm_housing_return', tx: 4, ty: 8, zone: 'hub', type: 'return_portal', label: 'Return to Hub', icon: '🏠' },
    ],
  },
  market: {
    name: 'Marketplace', icon: '🏪', type: 'market',
    bg: '#2a1e14',
    minMiningLevel: 0,
    landmarks: [
      { id: 'lm_market_return', tx: 30, ty: 56, zone: 'hub', type: 'return_portal', label: 'Return to Hub', icon: '🏠' },
    ],
    stallSlots: {
      small:  [
        { id: 'sm1', tx: 10, ty: 18, w: 5, h: 4 },
        { id: 'sm2', tx: 18, ty: 18, w: 5, h: 4 },
        { id: 'sm3', tx: 42, ty: 18, w: 5, h: 4 },
        { id: 'sm4', tx: 50, ty: 18, w: 5, h: 4 },
        { id: 'sm5', tx: 10, ty: 40, w: 5, h: 4 },
        { id: 'sm6', tx: 50, ty: 40, w: 5, h: 4 },
      ],
      medium: [
        { id: 'md1', tx: 10, ty: 28, w: 7, h: 5 },
        { id: 'md2', tx: 43, ty: 28, w: 7, h: 5 },
        { id: 'md3', tx: 18, ty: 40, w: 7, h: 5 },
        { id: 'md4', tx: 35, ty: 40, w: 7, h: 5 },
      ],
      large:  [
        { id: 'lg1', tx: 14, ty: 8, w: 10, h: 6 },
        { id: 'lg2', tx: 36, ty: 8, w: 10, h: 6 },
      ],
    },
  },
};

// ═══════════════════════════════════════════
// Party Dungeon Configuration
// ═══════════════════════════════════════════
const PARTY_DUNGEON_CONFIG = {
  name: 'Abyssal Sanctum',
  icon: '⚔️',
  bg: '#0a0a15',
  timeLimit: 300000, // 5 minutes
  mobCount: 4,
  mobs: [
    { name: 'Skeleton', maxHP: 200, atk: 10, goldMin: 3,  goldMax: 7,  xpReward: 12, color: '#ffffff', behavior:'guardian',   moveSpeed:0.7, chaseSpeed:1.2, aggroRange:130, leashRange:250, atkCD:2200, ability:{name:'bone_shield',cd:10000,trigger:'combat',duration:3000,reduction:0.5} },
    { name: 'Zombie',   maxHP: 300, atk: 14, goldMin: 5,  goldMax: 10, xpReward: 18, color: '#6b8e23', behavior:'relentless', moveSpeed:0.5, chaseSpeed:0.8, aggroRange:140, leashRange:9999, atkCD:2800, ability:{name:'grab',cd:8000,trigger:'melee',rootDuration:1500} },
    { name: 'Wraith',   maxHP: 430, atk: 18, goldMin: 6,  goldMax: 12, xpReward: 28, color: '#8844cc', behavior:'ambusher',   moveSpeed:0.0, chaseSpeed:1.6, aggroRange:100, leashRange:300, atkCD:2000, ability:{name:'life_drain',cd:9000,trigger:'combat',duration:4000,healPct:0.5} },
    { name: 'Demon',    maxHP: 600, atk: 24, goldMin: 8,  goldMax: 18, xpReward: 45, color: '#ff2222', behavior:'aggressive', moveSpeed:1.0, chaseSpeed:2.0, aggroRange:200, leashRange:350, atkCD:1500, ability:{name:'fire_breath',cd:7000,trigger:'combat',dmgMult:1.5,range:120} },
  ],
  boss: {
    cfgId: 'pdung_abyssal_dragon',
    name: 'Abyssal Dragon',
    maxHP: 2500,
    goldReward: 1000,
    xpReward: 800,
    vgReward: 20,
    color: '#6a1aaa',
    arenaX: 1200, arenaY: 1200,
    arenaRadius: 350,
    chaseSpeed: 1.8,
    sleeping: true,
    wakeRadius: 160,
    phases: [
      { hpPercent: 1.0,  name: 'Draconic Wrath',     speedMult: 1.0, dmgMult: 1.0 },
      { hpPercent: 0.7,  name: 'Shadow Fury',         speedMult: 1.1, dmgMult: 1.1 },
      { hpPercent: 0.45, name: 'Infernal Ascension',  speedMult: 1.2, dmgMult: 1.2 },
      { hpPercent: 0.2,  name: 'Apocalypse',          speedMult: 1.4, dmgMult: 1.4 },
    ],
    attacks: [
      { name: 'Dragon Claw',         type: 'aoe',          dmg: 14, radius: 100, telegraphTime: 1200, cooldown: 5000 },
      { name: 'Shadow Breath',       type: 'line',         dmg: 12, range: 260,  width: 60, telegraphTime: 1400, cooldown: 6000 },
      { name: 'Tail Sweep',          type: 'aoe',          dmg: 18, radius: 150, telegraphTime: 1500, cooldown: 8000 },
      { name: 'Abyssal Flames',      type: 'aoe',          dmg: 22, radius: 200, telegraphTime: 2500, cooldown: 14000, maxHpPct: 0.7 },
      { name: 'Summon Dragonkin',    type: 'summon',        count: 1, cooldown: 30000 },
      { name: 'Inferno Nova',        type: 'aoe',          dmg: 28, radius: 250, telegraphTime: 3000, cooldown: 22000, maxHpPct: 0.45 },
      { name: 'Meteor Storm',        type: 'aoe',          dmg: 35, radius: 300, telegraphTime: 3500, cooldown: 28000, maxHpPct: 0.2 },
      { name: 'Fire Breath Sweep',   type: 'breath_sweep', dmg: 20, range: 280, sweepAngle: 2.8, telegraphTime: 2800, cooldown: 12000 },
      { name: 'Devouring Maw',       type: 'head_lunge',   dmg: 30, range: 200, width: 90, telegraphTime: 2200, cooldown: 10000 },
      { name: 'Wing Tempest',        type: 'wing_buffet',  dmg: 15, radius: 220, telegraphTime: 2000, cooldown: 15000, maxHpPct: 0.7 },
    ],
  },
  scaleFactor: 0.6, // HP *= 1 + (partySize - 1) * scaleFactor
  minPartySize: 2,
  trustReq: 50,
};

// ═══════════════════════════════════════════
// Community Milestones
// ═══════════════════════════════════════════
const COMMUNITY_MILESTONES = [
  { id: 'ms_10_players',   title: 'First Gathering',     desc: '10 unique adventurers have entered Tavernvale.', check: g => Object.keys(g.players).filter(u => g.players[u].rpg).length >= 10, reward: 'Everyone gets 100 bonus gold' },
  { id: 'ms_100_kills',    title: 'Blood Tithe',         desc: '100 total monsters slain across all adventurers.', check: g => { let t = 0; for (const u of Object.keys(g.players)) { const r = g.players[u].rpg; if (r) t += (r.stats?.kills || 0); } return t >= 100; }, reward: 'Forest boss spawns permanently faster' },
  { id: 'ms_50_quests',    title: 'The Ledger Fills',    desc: '50 total quests completed by the community.', check: g => { let t = 0; for (const u of Object.keys(g.players)) { const r = g.players[u].rpg; if (r) t += (r.stats?.questsDone || 0); } return t >= 50; }, reward: 'Quest gold rewards +20%' },
  { id: 'ms_5_lvl10',      title: 'Seasoned Blades',     desc: '5 players have reached level 10 or above.', check: g => Object.keys(g.players).filter(u => { const r = g.players[u].rpg; return r && r.level >= 10; }).length >= 5, reward: 'Dungeon doors open permanently' },
  { id: 'ms_first_boss',   title: 'Felled Giant',        desc: 'A zone boss has been defeated for the first time.', check: g => g.communityMilestoneData.bossKills > 0, reward: 'New cosmetic title unlocked: Giantslayer' },
  { id: 'ms_1000_stones',  title: 'Stone by Stone',      desc: '1000 total stones mined by the community.', check: g => { let t = 0; for (const u of Object.keys(g.players)) { const r = g.players[u].rpg; if (r) t += (r.stats?.mined || 0); } return t >= 1000; }, reward: 'Crystal pickaxe available in shop' },
];

module.exports = { Game, CONFIG, COSMETICS, WEARABLES, BOSS_LOOT, ITEMS, LOOT_TABLES, RECIPES, NPC_SHOP, ACHIEVEMENTS, RARITY_COLOR, VENDOR_PRICE, RANK_BADGES, getRankBadge, RPG_ZONES, RPG_PICKAXES, ORE_TIER_REQ, TAVERN_QUESTS, COMMUNITY_MILESTONES, TILE, TILE_PROPS, TILE_SIZE, MAP_W, MAP_H, GRIZZLE_QUESTS, ENCHANTMENTS, REFINE_RECIPES, ORE_QUALITY, ARENA_CONFIG, PVP_SHOP, PARTY_DUNGEON_CONFIG, WORLD_EVENTS, WORLD_EVENT_CONFIG };
