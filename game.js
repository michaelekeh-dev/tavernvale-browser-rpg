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

  // Gold economy — 200g = $1 USD
  goldPerHit: 2,           // 2 gold per attack
  baseXP: 25,
  baseGold: 50,            // kill participation reward
  mvpXP: 100,
  mvpGold: 200,            // MVP bonus
  top3Gold: 100,
  top5Gold: 50,
  dailyXP: 20,
  dailyGold: 100,          // daily claim ($0.50)
  top5XP: 50,
  dodgePenalty: 10,        // gold lost if you don't dodge

  xpPerLevel: 100,
  breakDuration: 180000,
  activeWindow: 600000,
  saveInterval: 60000,

  // Cash prize exchange rate (admin sets this)
  goldPerDollar: 200,       // 200 gold = $1 IRL
};

// ═══════════════════════════════════════════
// Loot Tables
// ═══════════════════════════════════════════
const RARITY_COLOR = { common: '#aaa', uncommon: '#4ade80', rare: '#60a5fa', epic: '#c084fc', legendary: '#fbbf24', mythic: '#ff4500' };
const VENDOR_PRICE = { common: 10, uncommon: 25, rare: 60, epic: 120, legendary: 250, mythic: 500 };

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
  iron_sword:     { id: 'iron_sword',     name: 'Iron Sword',     type: 'weapon', rarity: 'uncommon', dmgBonus: 5,  maxDurability: 120, desc: '+5 damage', icon: '⚔️', shopPrice: 1200 },
  steel_blade:    { id: 'steel_blade',    name: 'Steel Blade',    type: 'weapon', rarity: 'rare',     dmgBonus: 10, maxDurability: 180, desc: '+10 damage', icon: '🔪', shopPrice: 4000 },
  war_axe:        { id: 'war_axe',        name: 'War Axe',        type: 'weapon', rarity: 'rare',     dmgBonus: 12, maxDurability: 160, desc: '+12 damage', icon: '🪓', shopPrice: 6500 },
  shadow_dagger:  { id: 'shadow_dagger',  name: 'Shadow Dagger',  type: 'weapon', rarity: 'epic',     dmgBonus: 18, maxDurability: 220, desc: '+18 damage', icon: '🗡️', shopPrice: 15000 },
  // ── NPC Armor (buyable from shop) ──
  cloth_armor:    { id: 'cloth_armor',    name: 'Cloth Armor',    type: 'armor',  rarity: 'common',   defBonus: 1,  maxDurability: 80,  desc: '-1 damage taken', icon: '👕', shopPrice: 0 },
  leather_vest:   { id: 'leather_vest',   name: 'Leather Vest',   type: 'armor',  rarity: 'uncommon', defBonus: 3,  maxDurability: 120, desc: '-3 damage taken', icon: '🦺', shopPrice: 800 },
  chain_armor:    { id: 'chain_armor',    name: 'Chain Armor',    type: 'armor',  rarity: 'rare',     defBonus: 6,  maxDurability: 180, desc: '-6 damage taken', icon: '🛡️', shopPrice: 3500 },
  knight_plate:   { id: 'knight_plate',   name: 'Knight Plate',   type: 'armor',  rarity: 'rare',     defBonus: 8,  maxDurability: 200, desc: '-8 damage taken', icon: '🛡️', shopPrice: 6000 },
  dark_plate:     { id: 'dark_plate',     name: 'Dark Plate',     type: 'armor',  rarity: 'epic',     defBonus: 12, maxDurability: 250, desc: '-12 damage taken', icon: '🛡️', shopPrice: 12000 },
  // ── Consumables (NPC shop + drops) ──
  health_potion:  { id: 'health_potion',  name: 'Health Potion',  type: 'consumable', subtype: 'heal',       value: 30,   desc: 'Restore 30 HP', icon: '❤️', shopPrice: 25, stackable: true },
  power_elixir:   { id: 'power_elixir',   name: 'Power Elixir',   type: 'consumable', subtype: 'buff_dmg',   value: 1.25, duration: 300000, desc: '+25% dmg 5min', icon: '💪', shopPrice: 80, stackable: true },
  shield_scroll:  { id: 'shield_scroll',  name: 'Shield Scroll',  type: 'consumable', subtype: 'buff_def',   value: 5,    duration: 300000, desc: '+5 def 5min', icon: '📜', shopPrice: 60, stackable: true },
  speed_tonic:    { id: 'speed_tonic',    name: 'Speed Tonic',    type: 'consumable', subtype: 'buff_speed', value: 1.5,  duration: 180000, desc: '+50% speed 3min', icon: '⚡', shopPrice: 40, stackable: true },
  repair_kit:     { id: 'repair_kit',     name: 'Repair Kit',     type: 'consumable', subtype: 'repair',     value: 50,   desc: 'Restore 50 durability', icon: '🔧', shopPrice: 150, stackable: true },
  // ── Materials (drops only — used for crafting) ──
  slime_gel:      { id: 'slime_gel',      name: 'Slime Gel',      type: 'material', rarity: 'common',   desc: 'Sticky gel from slimes', icon: '🟢', stackable: true },
  goblin_ear:     { id: 'goblin_ear',     name: 'Goblin Ear',     type: 'material', rarity: 'common',   desc: 'Pointy goblin ear', icon: '👂', stackable: true },
  wolf_fang:      { id: 'wolf_fang',      name: 'Wolf Fang',      type: 'material', rarity: 'uncommon', desc: 'Sharp wolf fang', icon: '🦷', stackable: true },
  treant_bark:    { id: 'treant_bark',    name: 'Treant Bark',    type: 'material', rarity: 'rare',     desc: 'Ancient living bark', icon: '🪵', stackable: true },
  bone_fragment:  { id: 'bone_fragment',  name: 'Bone Fragment',  type: 'material', rarity: 'common',   desc: 'Bleached skeleton bone', icon: '🦴', stackable: true },
  zombie_flesh:   { id: 'zombie_flesh',   name: 'Zombie Flesh',   type: 'material', rarity: 'common',   desc: 'Rotting zombie flesh', icon: '🧟', stackable: true },
  wraith_essence: { id: 'wraith_essence', name: 'Wraith Essence', type: 'material', rarity: 'uncommon', desc: 'Ethereal wraith energy', icon: '👻', stackable: true },
  demon_core:     { id: 'demon_core',     name: 'Demon Core',     type: 'material', rarity: 'rare',     desc: 'Burning demon heart', icon: '🔴', stackable: true },
  iron_ore:       { id: 'iron_ore',       name: 'Iron Ore',       type: 'material', rarity: 'common',   desc: 'Raw iron ore', icon: '⬜', stackable: true },
  gold_nugget:    { id: 'gold_nugget',    name: 'Gold Nugget',    type: 'material', rarity: 'uncommon', desc: 'Shiny gold nugget', icon: '🟡', stackable: true },
  crystal_shard:  { id: 'crystal_shard',  name: 'Crystal Shard',  type: 'material', rarity: 'rare',     desc: 'Glowing crystal shard', icon: '🔮', stackable: true },
  void_fragment:  { id: 'void_fragment',  name: 'Void Fragment',  type: 'material', rarity: 'epic',     desc: 'Fragment of the void', icon: '🌀', stackable: true },
  // ── Crafted Weapons (better than NPC shop) ──
  venom_blade:    { id: 'venom_blade',    name: 'Venom Blade',    type: 'weapon', rarity: 'rare',      dmgBonus: 14, maxDurability: 200, desc: '+14 damage (crafted)', icon: '🗡️', crafted: true },
  bone_cleaver:   { id: 'bone_cleaver',   name: 'Bone Cleaver',   type: 'weapon', rarity: 'epic',      dmgBonus: 22, maxDurability: 260, desc: '+22 damage (crafted)', icon: '🪓', crafted: true },
  void_edge:      { id: 'void_edge',      name: 'Void Edge',      type: 'weapon', rarity: 'legendary', dmgBonus: 30, maxDurability: 300, desc: '+30 damage (crafted)', icon: '⚔️', crafted: true },
  demon_scythe:   { id: 'demon_scythe',   name: 'Demon Scythe',   type: 'weapon', rarity: 'legendary', dmgBonus: 35, maxDurability: 280, desc: '+35 damage (crafted)', icon: '⚔️', crafted: true },
  mythic_blade:   { id: 'mythic_blade',   name: 'Mythic Blade',   type: 'weapon', rarity: 'mythic',    dmgBonus: 50, maxDurability: 400, desc: '+50 damage (crafted)', icon: '⚔️', crafted: true },
  // ── Crafted Armor (better than NPC shop) ──
  wolf_hide:      { id: 'wolf_hide',      name: 'Wolf Hide Armor', type: 'armor', rarity: 'rare',      defBonus: 8,  maxDurability: 200, desc: '-8 damage taken (crafted)', icon: '🐺', crafted: true },
  wraith_cloak:   { id: 'wraith_cloak',   name: 'Wraith Cloak',    type: 'armor', rarity: 'epic',      defBonus: 14, maxDurability: 260, desc: '-14 damage taken (crafted)', icon: '👻', crafted: true },
  void_armor:     { id: 'void_armor',     name: 'Void Armor',      type: 'armor', rarity: 'legendary', defBonus: 20, maxDurability: 300, desc: '-20 damage taken (crafted)', icon: '🌀', crafted: true },
  demon_plate:    { id: 'demon_plate',    name: 'Demon Plate',     type: 'armor', rarity: 'legendary', defBonus: 24, maxDurability: 280, desc: '-24 damage taken (crafted)', icon: '😈', crafted: true },
  mythic_armor:   { id: 'mythic_armor',   name: 'Mythic Armor',    type: 'armor', rarity: 'mythic',    defBonus: 35, maxDurability: 400, desc: '-35 damage taken (crafted)', icon: '🛡️', crafted: true },
};

// ═══════════════════════════════════════════
// Loot Tables — what mobs/bosses/mines drop
// ═══════════════════════════════════════════
const LOOT_TABLES = {
  // Forest mobs
  slime:    { drops: [{ itemId: 'slime_gel',   chance: 0.40 }, { itemId: 'health_potion', chance: 0.05 }, { itemId: 'party_hat', chance: 0.02, wearable: true }] },
  goblin:   { drops: [{ itemId: 'goblin_ear',  chance: 0.35 }, { itemId: 'iron_ore',      chance: 0.10 }, { itemId: 'health_potion', chance: 0.05 }, { itemId: 'straw_hat', chance: 0.02, wearable: true }, { itemId: 'leather_band', chance: 0.02, wearable: true }] },
  wolf:     { drops: [{ itemId: 'wolf_fang',   chance: 0.30 }, { itemId: 'leather_vest',  chance: 0.02 }, { itemId: 'health_potion', chance: 0.08 }, { itemId: 'woodland_cloak', chance: 0.015, wearable: true }, { itemId: 'bandana', chance: 0.02, wearable: true }] },
  // Dungeon mobs
  skeleton: { drops: [{ itemId: 'bone_fragment', chance: 0.40 }, { itemId: 'iron_ore',      chance: 0.10 }, { itemId: 'health_potion', chance: 0.08 }, { itemId: 'tattered_cape', chance: 0.02, wearable: true }, { itemId: 'eye_patch', chance: 0.015, wearable: true }] },
  zombie:   { drops: [{ itemId: 'zombie_flesh',  chance: 0.35 }, { itemId: 'bone_fragment',  chance: 0.15 }, { itemId: 'shield_scroll', chance: 0.05 }, { itemId: 'chain_bracelet', chance: 0.01, wearable: true }] },
  wraith:   { drops: [{ itemId: 'wraith_essence',chance: 0.25 }, { itemId: 'crystal_shard',  chance: 0.05 }, { itemId: 'power_elixir',  chance: 0.05 }, { itemId: 'wizard_hat', chance: 0.015, wearable: true }, { itemId: 'shadow_cape', chance: 0.008, wearable: true }] },
  demon:    { drops: [{ itemId: 'demon_core',    chance: 0.20 }, { itemId: 'wraith_essence', chance: 0.10 }, { itemId: 'repair_kit',    chance: 0.05 }, { itemId: 'void_fragment', chance: 0.02 }, { itemId: 'top_hat', chance: 0.01, wearable: true }, { itemId: 'devil_horns', chance: 0.005, wearable: true }, { itemId: 'skull_mask', chance: 0.005, wearable: true }] },
  // RPG Bosses — guaranteed drop + bonus
  ancient_treant: { guaranteed: 'treant_bark', drops: [{ itemId: 'crystal_shard', chance: 0.15 }, { itemId: 'iron_sword', chance: 0.08 }, { itemId: 'chain_armor', chance: 0.06 }, { itemId: 'venom_blade', chance: 0.03 }, { itemId: 'crown_thorns', chance: 0.03, wearable: true }, { itemId: 'santa_hat', chance: 0.01, wearable: true }, { itemId: 'fire_cape', chance: 0.008, wearable: true }] },
  // Mining bonus drops (chance per node break)
  mine_quarry:    { drops: [{ itemId: 'iron_ore',      chance: 0.25 }, { itemId: 'gold_nugget',    chance: 0.05 }] },
  mine_deep:      { drops: [{ itemId: 'iron_ore',      chance: 0.20 }, { itemId: 'gold_nugget',    chance: 0.12 }, { itemId: 'crystal_shard', chance: 0.04 }, { itemId: 'monocle', chance: 0.005, wearable: true }] },
  mine_gold_vein: { drops: [{ itemId: 'gold_nugget',   chance: 0.25 }, { itemId: 'crystal_shard',  chance: 0.10 }, { itemId: 'void_fragment',  chance: 0.02 }, { itemId: 'gold_watch', chance: 0.01, wearable: true }, { itemId: 'crystal_cuff', chance: 0.003, wearable: true }, { itemId: 'pirate_hat', chance: 0.005, wearable: true }] },
};

// ═══════════════════════════════════════════
// Crafting Recipes
// ═══════════════════════════════════════════
const RECIPES = {
  venom_blade:  { result: 'venom_blade',  materials: { wolf_fang: 5, slime_gel: 8, iron_ore: 3 },               goldCost: 500,   desc: 'Poison-tipped blade' },
  bone_cleaver: { result: 'bone_cleaver', materials: { bone_fragment: 10, wraith_essence: 3, crystal_shard: 2 }, goldCost: 2000,  desc: 'Heavy undead cleaver' },
  void_edge:    { result: 'void_edge',    materials: { void_fragment: 5, crystal_shard: 8, demon_core: 3 },      goldCost: 8000,  desc: 'Edge of nothingness' },
  demon_scythe: { result: 'demon_scythe', materials: { demon_core: 8, void_fragment: 3, wraith_essence: 5 },     goldCost: 12000, desc: 'Demonic reaper blade' },
  mythic_blade: { result: 'mythic_blade', materials: { void_fragment: 10, demon_core: 8, crystal_shard: 15, treant_bark: 5 }, goldCost: 50000, desc: 'The ultimate weapon' },
  wolf_hide:    { result: 'wolf_hide',    materials: { wolf_fang: 8, goblin_ear: 5, slime_gel: 5 },              goldCost: 800,   desc: 'Primal wolf armor' },
  wraith_cloak: { result: 'wraith_cloak', materials: { wraith_essence: 6, bone_fragment: 8, zombie_flesh: 5 },   goldCost: 3000,  desc: 'Ghostly protection' },
  void_armor:   { result: 'void_armor',   materials: { void_fragment: 5, crystal_shard: 6, wraith_essence: 4 },  goldCost: 10000, desc: 'Armor from the void' },
  demon_plate:  { result: 'demon_plate',  materials: { demon_core: 6, void_fragment: 4, bone_fragment: 10 },     goldCost: 15000, desc: 'Infernal plate armor' },
  mythic_armor: { result: 'mythic_armor', materials: { void_fragment: 12, demon_core: 10, crystal_shard: 15, treant_bark: 8 }, goldCost: 60000, desc: 'The ultimate armor' },
  // Consumable crafting (cheaper than NPC)
  health_potion_x5: { result: 'health_potion', resultQty: 5, materials: { slime_gel: 3 },          goldCost: 50,  desc: 'Brew 5 potions' },
  repair_kit_x3:    { result: 'repair_kit',    resultQty: 3, materials: { iron_ore: 5, gold_nugget: 2 }, goldCost: 200, desc: 'Forge 3 repair kits' },
};

// ═══════════════════════════════════════════
// NPC Shop (items you can buy with gold)
// ═══════════════════════════════════════════
const NPC_SHOP = {
  weapons: ['wooden_sword', 'iron_sword', 'steel_blade', 'war_axe', 'shadow_dagger'],
  armor:   ['cloth_armor', 'leather_vest', 'chain_armor', 'knight_plate', 'dark_plate'],
  consumables: ['health_potion', 'power_elixir', 'shield_scroll', 'speed_tonic', 'repair_kit'],
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
  crown_thorns:   { name: 'Crown of Thorns',  rarity: 'rare',      slot: 'hat',   icon: '🌿', desc: 'Pain is power',               source: 'Treant Boss' },
  devil_horns:    { name: 'Devil Horns',      rarity: 'epic',      slot: 'hat',   icon: '😈', desc: 'Embrace the darkness',         source: 'Demon drops' },
  santa_hat:      { name: 'Santa Hat',        rarity: 'epic',      slot: 'hat',   icon: '🎅', desc: 'Ho ho ho!',                    source: 'Boss reward' },
  halo:           { name: 'Halo',             rarity: 'legendary',  slot: 'hat',   icon: '😇', desc: 'Angelic presence',            source: 'Boss MVP' },
  void_crown:     { name: 'Void Crown',       rarity: 'mythic',    slot: 'hat',   icon: '👑', desc: 'Crown of the abyss',          source: 'Boss MVP' },
  // ── Capes ──
  tattered_cape:  { name: 'Tattered Cape',    rarity: 'common',    slot: 'cape',  icon: '🧥', desc: 'Seen better days',            source: 'Skeleton drops' },
  woodland_cloak: { name: 'Woodland Cloak',   rarity: 'uncommon',  slot: 'cape',  icon: '🍃', desc: 'Blends with nature',          source: 'Wolf drops' },
  shadow_cape:    { name: 'Shadow Cape',      rarity: 'rare',      slot: 'cape',  icon: '🌑', desc: 'Made of pure shadow',         source: 'Wraith drops' },
  fire_cape:      { name: 'Fire Cape',        rarity: 'epic',      slot: 'cape',  icon: '🔥', desc: 'Burns with fury',             source: 'Boss reward' },
  royal_mantle:   { name: 'Royal Mantle',     rarity: 'legendary',  slot: 'cape',  icon: '👑', desc: 'Fit for royalty',             source: 'Boss MVP' },
  // ── Wrist ──
  leather_band:   { name: 'Leather Band',     rarity: 'common',    slot: 'wrist', icon: '🤎', desc: 'Simple leather wrap',         source: 'Goblin drops' },
  gold_watch:     { name: 'Gold Watch',       rarity: 'uncommon',  slot: 'wrist', icon: '⌚', desc: 'Tick tock',                    source: 'Mining gold vein' },
  chain_bracelet: { name: 'Chain Bracelet',   rarity: 'rare',      slot: 'wrist', icon: '⛓️', desc: 'Heavy chain links',           source: 'Zombie drops' },
  crystal_cuff:   { name: 'Crystal Cuff',     rarity: 'epic',      slot: 'wrist', icon: '💎', desc: 'Glowing crystal band',        source: 'Mining rare find' },
  dragon_bangle:  { name: 'Dragon Bangle',    rarity: 'legendary',  slot: 'wrist', icon: '🐲', desc: 'Scales of a dragon',         source: 'Boss MVP' },
  // ── Face ──
  bandana:        { name: 'Bandana',          rarity: 'common',    slot: 'face',  icon: '🟥', desc: 'Outlaw vibes',                source: 'Wolf drops' },
  eye_patch:      { name: 'Eye Patch',        rarity: 'uncommon',  slot: 'face',  icon: '🏴‍☠️', desc: 'Lost it in battle',           source: 'Skeleton drops' },
  monocle:        { name: 'Monocle',          rarity: 'rare',      slot: 'face',  icon: '🧐', desc: 'Quite distinguished',         source: 'Mining rare find' },
  skull_mask:     { name: 'Skull Mask',       rarity: 'epic',      slot: 'face',  icon: '💀', desc: 'Face of death',               source: 'Demon drops' },
  phantom_mask:   { name: 'Phantom Mask',     rarity: 'legendary',  slot: 'face',  icon: '🎭', desc: 'Who hides behind it?',       source: 'Boss MVP' },
};

const COSMETICS = {
  // ── Borders (leaderboard/name frame) ──
  border_gold:    { name: '🟡 Gold Border', cost: 600, desc: 'Gold border on leaderboard', type: 'border', cssVal: '#ffd700' },
  border_red:     { name: '🔴 Red Border', cost: 500, desc: 'Red border on leaderboard', type: 'border', cssVal: '#ff4444' },
  border_blue:    { name: '🔵 Blue Border', cost: 500, desc: 'Blue border on leaderboard', type: 'border', cssVal: '#4488ff' },
  border_purple:  { name: '🟣 Purple Border', cost: 700, desc: 'Purple border on leaderboard', type: 'border', cssVal: '#c084fc' },
  border_rainbow: { name: '🌈 Rainbow Border', cost: 1800, desc: 'Animated rainbow border', type: 'border', cssVal: 'rainbow' },
  border_green:   { name: '💚 Emerald Border', cost: 600, desc: 'Green border on leaderboard', type: 'border', cssVal: '#4ade80' },
  border_fire:    { name: '🔥 Inferno Border', cost: 3000, desc: 'Animated fire border', type: 'border', cssVal: 'fire' },
  border_ice:     { name: '❄️ Frost Border', cost: 2500, desc: 'Animated ice border', type: 'border', cssVal: 'ice' },
  // ── Titles (shown before name) ──
  title_champion: { name: '⭐ Champion', cost: 3000, desc: 'Permanent ⭐ title', type: 'title', titleText: '⭐' },
  title_legend:   { name: '🔥 Legend', cost: 5000, desc: 'Permanent 🔥 title', type: 'title', titleText: '🔥' },
  title_king:     { name: '👑 King', cost: 7500, desc: 'Permanent 👑 title', type: 'title', titleText: '👑' },
  title_skull:    { name: '💀 Reaper', cost: 3500, desc: 'Permanent 💀 title', type: 'title', titleText: '💀' },
  title_diamond:  { name: '💎 Diamond', cost: 9000, desc: 'Permanent 💎 title', type: 'title', titleText: '💎' },
  title_clown:    { name: '🤡 Class Clown', cost: 1200, desc: 'Permanent 🤡 title', type: 'title', titleText: '🤡' },
  title_rat:      { name: '🐀 Chat Rat', cost: 900, desc: 'Embrace the grind 🐀', type: 'title', titleText: '🐀' },
  title_goat:     { name: '🐐 GOAT', cost: 12000, desc: 'The greatest of all time', type: 'title', titleText: '🐐' },
  // ── Hit Effects (visual on boss/pvp hits) ──
  effect_fire:    { name: '🔥 Flame Hits', cost: 1200, desc: 'Hits show as fire', type: 'hitEffect', effectId: 'fire' },
  effect_ice:     { name: '❄️ Ice Hits', cost: 1200, desc: 'Hits show as ice', type: 'hitEffect', effectId: 'ice' },
  effect_lightning:{ name: '⚡ Lightning Hits', cost: 1500, desc: 'Hits show as lightning', type: 'hitEffect', effectId: 'lightning' },
  effect_shadow:  { name: '🌑 Shadow Hits', cost: 1500, desc: 'Hits show as shadow', type: 'hitEffect', effectId: 'shadow' },
  effect_blood:   { name: '🩸 Blood Hits', cost: 1800, desc: 'Hits show blood splatter', type: 'hitEffect', effectId: 'blood' },
  effect_holy:    { name: '✨ Holy Hits', cost: 2000, desc: 'Hits show divine light', type: 'hitEffect', effectId: 'holy' },
  // ── Badges (emoji beside name) ──
  badge_vip:      { name: '💠 VIP Badge', cost: 2500, desc: 'VIP badge next to name', type: 'badge', badgeEmoji: '💠' },
  badge_sword:    { name: '⚔️ Warrior Badge', cost: 1800, desc: 'Sword badge next to name', type: 'badge', badgeEmoji: '⚔️' },
  badge_shield:   { name: '🛡️ Guardian Badge', cost: 1800, desc: 'Shield badge next to name', type: 'badge', badgeEmoji: '🛡️' },
  badge_skull:    { name: '💀 Death Badge', cost: 3500, desc: 'Skull badge — fear me', type: 'badge', badgeEmoji: '💀' },
  badge_dragon:   { name: '🐲 Dragon Badge', cost: 5000, desc: 'Dragon badge — I own bosses', type: 'badge', badgeEmoji: '🐲' },
  // ── Kill Effects (animation on final blow) ──
  killeffect_explode: { name: '💥 Explosion', cost: 3000, desc: 'Target explodes on defeat', type: 'killEffect', effectId: 'explode' },
  killeffect_disintegrate: { name: '✨ Disintegrate', cost: 3500, desc: 'Target fades to dust', type: 'killEffect', effectId: 'disintegrate' },
  killeffect_lightning: { name: '⚡ Smited', cost: 4500, desc: 'Lightning strikes the loser', type: 'killEffect', effectId: 'smite' },
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
  gold_100:       { name: '🪙 Moneybags', desc: 'Hold 500 gold at once', check: (p) => p.gold >= 500 },
  gold_500:       { name: '💰 Wealthy', desc: 'Hold 2,500 gold at once', check: (p) => p.gold >= 2500 },
  gold_2k:        { name: '🏦 Tycoon', desc: 'Hold 10,000 gold at once', check: (p) => p.gold >= 10000 },
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
      whetstone: { name: '🗡️ Whetstone', cost: 300, desc: '+3 bonus dmg this boss', type: 'dmg_boost', value: 3 },
      charm:     { name: '🍀 Lucky Charm', cost: 450, desc: '+15% crit this boss', type: 'crit_boost', value: 0.15 },
      boots:     { name: '👟 Swift Boots', cost: 600, desc: 'Half cooldown this boss', type: 'speed_boost' },
      potion:    { name: '💪 Mega Potion', cost: 1000, desc: '2x damage this boss', type: 'mega_dmg' },
    };
    this.playerBuffs = {};

    // Boss attack state
    this.bossAttackActive = false;
    this.bossAttackDodgers = new Set();
    this.bossAttackTimer = null;

    // Market
    this.market = [];
    this.marketIdCounter = 1;

    // Pending direct trades
    this.pendingTrades = {};

    // Link tokens for player portal auth
    this.linkTokens = {};  // { username: { token, created } }
    this.pendingLinkCodes = {};  // { username: { code, created } }
    this.authAccounts = {};  // { username: { hash, salt } }

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
    this.saveTimer = setInterval(() => this.saveData(), CONFIG.saveInterval);
    this.initRPG();
  }

  // ── Persistence ──────────────────────────
  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        this.players = d.players || {};
        this.market = d.market || [];
        this.marketIdCounter = d.marketIdCounter || 1;
        this.payoutQueue = d.payoutQueue || [];
        this.payoutIdCounter = d.payoutIdCounter || 1;
        this.discordWebhook = d.discordWebhook || null;
        this.discordBotConfig = d.discordBotConfig || null;
        if (d.rpgEnabled !== undefined) this.rpgEnabled = d.rpgEnabled;
        if (d.gamblingEnabled !== undefined) this.gamblingEnabled = d.gamblingEnabled;
        this.authAccounts = d.authAccounts || {};
        this.linkTokens = d.linkTokens || {};
      }
    } catch { this.players = {}; this.market = []; }
  }

  saveData() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        players: this.players, market: this.market, marketIdCounter: this.marketIdCounter,
        payoutQueue: this.payoutQueue, payoutIdCounter: this.payoutIdCounter,
        discordWebhook: this.discordWebhook, discordBotConfig: this.discordBotConfig,
        authAccounts: this.authAccounts, linkTokens: this.linkTokens,
        rpgEnabled: this.rpgEnabled,
        gamblingEnabled: this.gamblingEnabled,
      }, null, 2));
    } catch (e) { console.error('Save failed:', e.message); }
  }

  // ── Player helpers ───────────────────────
  player(name) {
    if (!this.players[name]) {
      this.players[name] = {
        xp: 0, gold: 0, level: 1, totalDamage: 0, lastDaily: 0,
        streak: 0, bestStreak: 0, mvpCount: 0, gamblesWon: 0,
        bossKills: 0, dodgeCount: 0, tradeCount: 0,
        prestige: 0, prestigeBonus: 0,
        duelsWon: 0, duelsLost: 0, duelWinStreak: 0, bestDuelStreak: 0, arenaRating: 1000,
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
    return p;
  }

  randomAppearance() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return {
      skinColor: pick(['#f5d0a9','#c68642','#8d5524','#ffdbac','#e0ac69','#6b4226','#f1c27d','#d4a574']),
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
    const allowed = ['skinColor','hairStyle','hairColor','eyeStyle','eyeColor','mouthStyle','outfit','outfitColor'];
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
    return { success: true, slot, item };
  }

  unequipItem(username, slot) {
    const p = this.player(username);
    if (!p.equipped[slot]) return { error: 'nothing_equipped' };
    p.inventory.push(p.equipped[slot]);
    const item = p.equipped[slot];
    delete p.equipped[slot];
    this.saveData();
    return { success: true, slot, item };
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
    if (!this.removeStackable(p, itemId, 1)) return { error: 'none_owned' };
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
  addItemToInventory(p, itemId, qty = 1) {
    const template = ITEMS[itemId];
    if (!template) return null;
    if (template.stackable) {
      // Stackable: find existing stack or create new
      const existing = p.inventory.find(i => i.id === itemId && i.stackable);
      if (existing) {
        existing.qty += qty;
        return existing;
      }
      const stack = { id: itemId, name: template.name, type: template.type, rarity: template.rarity, icon: template.icon, desc: template.desc, stackable: true, qty };
      if (template.subtype) stack.subtype = template.subtype;
      if (template.value !== undefined) stack.value = template.value;
      if (template.duration) stack.duration = template.duration;
      p.inventory.push(stack);
      return stack;
    }
    // Non-stackable: create unique instance with durability
    const item = {
      id: itemId, uid: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
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
    if (!table) return { items: [], guaranteed: null };
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
    }

    // MVP: prize gold + XP + legendary loot
    if (mvp) {
      const p = this.player(mvp);
      this.addXP(p, CONFIG.mvpXP);
      this.addGold(p, prizeGold);
      p.mvpCount = (p.mvpCount || 0) + 1;
      const loot = pick(BOSS_LOOT.mvp);
      const item = { ...loot, uid: Date.now() + '_mvp' };
      p.inventory.push(item);
      lootResults.push({ username: mvp, item, rank: 1 });
    }

    // Top 2-3: prize gold + XP + loot
    for (let i = 1; i < Math.min(3, sorted.length); i++) {
      const u = sorted[i][0], p = this.player(u);
      this.addXP(p, CONFIG.top5XP);
      this.addGold(p, prizeGold);
      const loot = pick(BOSS_LOOT.top3);
      const item = { ...loot, uid: Date.now() + '_t' + (i + 1) };
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
      const item = { ...loot, uid: Date.now() + '_r' + i };
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
    if (!item.slot) return { error: 'not_equippable' };
    const old = p.equipped[item.slot];
    if (old) p.inventory.push(old);
    p.equipped[item.slot] = item;
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
    // Max 5 listings per player
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 5) return { error: 'max_listings', message: 'Max 5 active listings' };
    const idx = p.inventory.findIndex(i => i.uid === itemUid);
    if (idx === -1) return { error: 'not_found' };
    // 2% listing fee
    const listFee = Math.max(1, Math.floor(priceNum * 0.02));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    const item = p.inventory.splice(idx, 1)[0];
    const listing = { id: this.marketIdCounter++, seller: username, type: 'equipment', itemData: item, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
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
    if (myListings.length >= 5) return { error: 'max_listings', message: 'Max 5 active listings' };
    if (this.getStackCount(p, itemId) < qtyNum) return { error: 'not_enough', have: this.getStackCount(p, itemId) };
    const template = ITEMS[itemId];
    if (!template) return { error: 'invalid_item' };
    const listFee = Math.max(1, Math.floor(priceNum * 0.02));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    this.removeStackable(p, itemId, qtyNum);
    const listing = {
      id: this.marketIdCounter++, seller: username, type: 'material',
      itemData: { id: itemId, name: template.name, icon: template.icon, rarity: template.rarity, qty: qtyNum },
      price: priceNum, listFee, listedAt: Date.now(),
    };
    this.market.push(listing);
    this.saveData();
    return { username, listing, fee: listFee, gold: p.gold };
  }

  handleSellCosmetic(username, cosmeticKey, price) {
    const p = this.player(username);
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1) return { error: 'invalid_price' };
    const myListings = this.market.filter(l => l.seller === username);
    if (myListings.length >= 5) return { error: 'max_listings', message: 'Max 5 active listings' };
    const key = (cosmeticKey || '').toLowerCase();
    if (!p.cosmetics.includes(key)) return { error: 'not_owned' };
    for (const v of Object.values(p.activeCosmetics)) { if (v === key) return { error: 'unequip_first' }; }
    const listFee = Math.max(1, Math.floor(priceNum * 0.02));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    p.cosmetics = p.cosmetics.filter(c => c !== key);
    const listing = { id: this.marketIdCounter++, seller: username, type: 'cosmetic', itemData: { key, ...COSMETICS[key] }, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
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
    if (myListings.length >= 5) return { error: 'max_listings', message: 'Max 5 active listings' };
    const key = (wearableKey || '').toLowerCase();
    if (!p.wearables.includes(key)) return { error: 'not_owned' };
    for (const v of Object.values(p.activeWearables)) { if (v === key) return { error: 'unequip_first' }; }
    const listFee = Math.max(1, Math.floor(priceNum * 0.02));
    if (p.gold < listFee) return { error: 'cant_afford_fee', fee: listFee, gold: p.gold };
    p.gold -= listFee;
    p.wearables = p.wearables.filter(w => w !== key);
    const wData = WEARABLES[key];
    const listing = { id: this.marketIdCounter++, seller: username, type: 'wearable', itemData: { key, name: wData.name, icon: wData.icon, rarity: wData.rarity, slot: wData.slot }, price: priceNum, listFee, listedAt: Date.now() };
    this.market.push(listing);
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
      listings: this.market.slice(-50).map(l => ({
        id: l.id, seller: l.seller, type: l.type,
        name: l.itemData.name, rarity: l.itemData.rarity || null, price: l.price,
        icon: l.itemData.icon || null, qty: l.itemData.qty || null,
      })),
    };
  }

  getMarketListings() {
    return this.market.map(l => ({
      id: l.id, seller: l.seller, type: l.type,
      name: l.itemData.name, rarity: l.itemData.rarity || null, price: l.price,
      icon: l.itemData.icon || null, qty: l.itemData.qty || null,
    }));
  }

  handleBuyMarket(username, listingId) {
    const lid = parseInt(listingId);
    const idx = this.market.findIndex(l => l.id === lid);
    if (idx === -1) return { error: 'not_found' };
    const listing = this.market[idx];
    if (listing.seller === username) return { error: 'own_listing' };
    const buyer = this.player(username);
    if (buyer.gold < listing.price) return { error: 'broke', gold: buyer.gold, cost: listing.price };
    buyer.gold -= listing.price;
    const seller = this.player(listing.seller);
    // 5% sale tax taken from seller's proceeds
    const tax = Math.max(1, Math.floor(listing.price * 0.05));
    seller.gold += listing.price - tax;
    if (listing.type === 'equipment') buyer.inventory.push(listing.itemData);
    else if (listing.type === 'material') this.addItemToInventory(buyer, listing.itemData.id, listing.itemData.qty || 1);
    else if (listing.type === 'cosmetic') buyer.cosmetics.push(listing.itemData.key);
    else if (listing.type === 'wearable') { if (!buyer.wearables.includes(listing.itemData.key)) buyer.wearables.push(listing.itemData.key); }
    this.market.splice(idx, 1);
    buyer.tradeCount = (buyer.tradeCount || 0) + 1;
    seller.tradeCount = (seller.tradeCount || 0) + 1;
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

  // ── Cash Balance ─────────────────────────
  handleCashBalance(username) {
    const p = this.player(username);
    return { username, gold: p.gold, cashValue: (p.gold / CONFIG.goldPerDollar).toFixed(2), rate: CONFIG.goldPerDollar };
  }

  // ── Stats / Info ─────────────────────────
  handleStats(username) {
    const cd = this.checkCD(username, 'stats');
    if (cd > 0) return { error: 'cooldown', remaining: cd };
    const p = this.player(username);
    return {
      username, level: p.level, xp: p.xp, xpNeeded: this.xpNeeded(p),
      gold: p.gold, totalDamage: p.totalDamage,
      minDmg: this.minDmg(p), maxDmg: this.maxDmg(p),
      critChance: Math.round(this.critChance(p) * 100),
      streak: p.streak || 0, bestStreak: p.bestStreak || 0,
      equipped: p.equipped, achievements: p.achievements.length,
      cashValue: (p.gold / CONFIG.goldPerDollar).toFixed(2),
      inventoryCount: p.inventory.length, cosmeticCount: p.cosmetics.length,
    };
  }

  handleDaily(username) {
    const p = this.player(username);
    const since = Date.now() - (p.lastDaily || 0);
    if (since < CONFIG.dailyCooldown) return { error: 'cooldown', remaining: CONFIG.dailyCooldown - since };
    p.lastDaily = Date.now();
    const leveled = this.addXP(p, CONFIG.dailyXP);
    this.addGold(p, CONFIG.dailyGold);
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
      return { username, won: true, bet, payout, gold: p.gold, game: 'coinflip' };
    } else {
      p.gold -= bet;
      p.gamblesLost = (p.gamblesLost || 0) + 1;
      p.totalGambleProfit = (p.totalGambleProfit || 0) - bet;
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
    return { username, reels, mult, bet, payout, won: mult > 0, gold: p.gold, game: 'slots' };
  }

  handleBlackjack(username, amount) {
    if (!this.gamblingEnabled) return { error: 'gambling_disabled' };
    const p = this.player(username);
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    if (bet > p.gold) return { error: 'broke', gold: p.gold };
    // Simplified instant blackjack — deal 2 cards each, highest wins
    const deck = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const val = c => c === 'A' ? 11 : ['J','Q','K'].includes(c) ? 10 : parseInt(c);
    const suits = ['♠','♥','♦','♣'];
    const draw = () => { const c = deck[Math.floor(Math.random() * deck.length)]; const s = suits[Math.floor(Math.random() * suits.length)]; return { card: c + s, value: val(c) }; };
    const pc = [draw(), draw()];
    const dc = [draw(), draw()];
    let pTotal = pc[0].value + pc[1].value;
    let dTotal = dc[0].value + dc[1].value;
    // Bust check (>21)
    if (pTotal > 21) pTotal -= 10;
    if (dTotal > 21) dTotal -= 10;
    // Dealer advantage: dealer wins ties, and if both have same total dealer wins
    const playerBJ = pTotal === 21;
    const dealerBJ = dTotal === 21;
    let won = false, payout = 0, result = 'lose';
    if (playerBJ && !dealerBJ) { won = true; payout = Math.floor(bet * 2.5); result = 'blackjack'; }
    else if (pTotal > dTotal && !dealerBJ) { won = true; payout = bet * 2; result = 'win'; }
    else { result = dealerBJ ? 'dealer_bj' : pTotal === dTotal ? 'push_lose' : 'lose'; }
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
    return { username, spin: num, color: isGreen ? 'green' : isRed ? 'red' : 'black', choice: pick, won, mult, bet, payout, gold: p.gold, game: 'roulette' };
  }

  handleGift(from, to, amount) {
    const bet = parseInt(amount);
    if (isNaN(bet) || bet < 1) return { error: 'invalid' };
    const pFrom = this.player(from);
    if (bet > pFrom.gold) return { error: 'broke', gold: pFrom.gold };
    const pTo = this.player(to);
    pFrom.gold -= bet;
    pTo.gold += bet;
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
        this.addGold(this.player(u), perPlayer);
        goldWinners.push({ username: u, gold: perPlayer });
      }
    } else if (reward.includes('Jackpot')) {
      const totalGold = 5000 * m;
      const winner = all.length > 0 ? pick(all) : null;
      if (winner) {
        this.addGold(this.player(winner), totalGold);
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
    this.resetForNewStream();
    this.saveData();
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
      totalDamage: p.totalDamage,
      minDmg: this.minDmg(p),
      maxDmg: this.maxDmg(p),
      critChance: this.critChance(p),
      critMultiplier: CONFIG.critMultiplier + this.equipStat(p, 'critMult'),
      cashValue: (p.gold / CONFIG.goldPerDollar).toFixed(2),
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

  getMarketListings() { return this.market; }

  // ── Vendor Sell (NPC sell for fixed gold) ──
  handleVendorSell(username, itemUid) {
    const p = this.player(username);
    const idx = p.inventory.findIndex(i => i.uid === itemUid);
    if (idx === -1) return { error: 'not_found' };
    const item = p.inventory[idx];
    const price = VENDOR_PRICE[item.rarity] || 5;
    p.inventory.splice(idx, 1);
    p.gold += price;
    this.saveData();
    this.emitAchievements(username);
    return { username, item: item.name, rarity: item.rarity, gold: price, newGold: p.gold };
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
    const minRedeem = 5000;  // $25 minimum
    if (isNaN(amt) || amt < minRedeem) return { error: 'min_redeem', minimum: minRedeem };
    if (p.gold < amt) return { error: 'broke', gold: p.gold, message: 'You\'re down bad rn... go farm some bosses 💀' };
    if (this.payoutQueue.find(r => r.username === username && r.status === 'pending')) return { error: 'already_pending', message: 'Chill, you already got one cooking 🍳' };
    const dollarValue = parseFloat((amt / CONFIG.goldPerDollar).toFixed(2));
    p.gold -= amt;
    const request = {
      id: this.payoutIdCounter++, username, method, address,
      goldAmount: amt, dollarValue, status: 'pending', date: Date.now(),
    };
    this.payoutQueue.push(request);
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
      p.gold += req.goldAmount;
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

    // Transfer gold
    if (duel.bet > 0) {
      this.player(winner).gold += duel.bet;
      this.player(loser).gold -= duel.bet;
    }

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
    { rank: 1, name: 'Certified Grinder',  minLevel: 30, goldReward: 50000,   dmgBonus: 0.05, icon: '⚒️' },
    { rank: 2, name: 'Touch Grass? Never',  minLevel: 35, goldReward: 100000,  dmgBonus: 0.12, icon: '🌿' },
    { rank: 3, name: 'Built Different',     minLevel: 40, goldReward: 250000,  dmgBonus: 0.20, icon: '💪' },
    { rank: 4, name: 'No Life Speedrun',    minLevel: 45, goldReward: 500000,  dmgBonus: 0.30, icon: '💀' },
    { rank: 5, name: 'Actual Legend',        minLevel: 50, goldReward: 1000000, dmgBonus: 0.45, icon: '☀️' },
    { rank: 6, name: 'Mikey X',              minLevel: 50, goldReward: 1500000, dmgBonus: 0.60, icon: '🔥' },
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
    this.saveData();
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.breakTimer) clearTimeout(this.breakTimer);
    if (this.bossAttackTimer) clearTimeout(this.bossAttackTimer);
  }

  // ═══════════════════════════════════════════
  // RPG — Offline 2D Dungeon / Mining System
  // ═══════════════════════════════════════════
  initRPG() {
    if (!this.rpgWorld) {
      this.rpgWorld = {};
      for (const zoneId of Object.keys(RPG_ZONES)) {
        this.rpgWorld[zoneId] = { nodes: [], mobs: [], lastTick: Date.now(), tileMap: this.rpgGenerateTileMap(zoneId) };
      }
    }
    this.rpgPlayers = {}; // username -> { zone, ws, x, y, hp, maxHP }
    this.rpgDuelQueue = []; // [username, ...]
    this.rpgDuels = {}; // duelId -> duel state
    this.rpgDuelId = 0;
    this.rpgSpawnAll();
    this.rpgTickTimer = setInterval(() => this.rpgTick(), 3000);
    this.rpgBossTickTimer = setInterval(() => this.rpgBossTick(), 200);
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
      // Spawn mobs
      if (zone.mobs) {
        w.mobs = [];
        for (let i = 0; i < zone.mobCount; i++) {
          w.mobs.push(this.rpgMakeMob(zoneId, i));
        }
      }
      // Spawn boss
      if (zone.boss) {
        w.boss = this.rpgMakeBoss(zoneId);
        w.saplings = [];
      }
    }
  }

  rpgMakeBoss(zoneId) {
    const zone = RPG_ZONES[zoneId];
    const b = zone.boss;
    return {
      id: `${zoneId}_boss`,
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
      maxHP: 40,
      hp: 40,
      atk: 4,
      color: '#5a8a2e',
      x: bossX + Math.cos(angle) * dist,
      y: bossY + Math.sin(angle) * dist,
      dead: false,
      respawnAt: 0,
      goldMin: 0, goldMax: 0, xpReward: 2,
    };
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
    let x = 150 + (idx % cols) * 270 + Math.floor(Math.random() * 80);
    let y = 120 + Math.floor(idx / cols) * 260 + Math.floor(Math.random() * 60);
    const w = this.rpgWorld[zoneId];
    if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
    return {
      id: `${zoneId}_n${idx}`,
      type: drop.type, color: drop.color, gold: drop.gold, xp: drop.xp,
      hp: drop.hp || 3, maxHP: drop.hp || 3,
      x, y, mined: false, respawnAt: 0,
    };
  }

  rpgMakeMob(zoneId, idx) {
    const zone = RPG_ZONES[zoneId];
    const templates = zone.mobs;
    const t = templates[Math.floor(Math.random() * templates.length)];
    let x = 200 + Math.random() * 2000, y = 150 + Math.random() * 1100;
    const w = this.rpgWorld[zoneId];
    if (w && w.tileMap) { const pos = this.rpgFindWalkable(w.tileMap, x, y); x = pos.x; y = pos.y; }
    return {
      id: `${zoneId}_m${idx}`, ...t, hp: t.maxHP, x, y, dead: false, respawnAt: 0,
    };
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
      // Respawn dead mobs
      if (w.mobs) {
        for (let i = 0; i < w.mobs.length; i++) {
          if (w.mobs[i].dead && now >= w.mobs[i].respawnAt) {
            w.mobs[i] = this.rpgMakeMob(zoneId, i);
            this.rpgBroadcastZone(zoneId, { type: 'rpg_mob_spawn', data: w.mobs[i] });
          }
        }
      }
      // Mob auto-attack nearby players
      if (w.mobs) {
        for (const mob of w.mobs) {
          if (mob.dead) continue;
          for (const [username, rp] of Object.entries(this.rpgPlayers)) {
            if (rp.zone !== zoneId) continue;
            if (!rp.hp || rp.hp <= 0) continue;
            const dx = (rp.x || 400) - mob.x, dy = (rp.y || 200) - mob.y;
            if (Math.sqrt(dx * dx + dy * dy) < 120) {
              const p = this.player(username);
              const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
              const dmg = Math.max(1, mob.atk - Math.floor(Math.random() * 3) - def);
              rp.hp = Math.max(0, rp.hp - dmg);
              // Degrade armor durability (mob hit = -1)
              const armorResult = this.degradeEquipped(p, 'armor', 1);
              this.rpgSendTo(username, { type: 'rpg_mob_attack', data: { mobId: mob.id, dmg, hp: rp.hp, maxHP: rp.maxHP, armorBroke: armorResult && armorResult.broken ? armorResult.name : null } });
              if (rp.hp <= 0) {
                const lost = Math.floor(p.gold * 0.02);
                p.gold = Math.max(0, p.gold - lost);
                this.saveData();
                this.rpgSendTo(username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
                rp.zone = 'hub';
                rp.hp = rp.maxHP;
              }
            }
          }
        }
      }
      // Sapling auto-attack nearby players
      if (w.saplings) {
        for (const sap of w.saplings) {
          if (sap.dead) continue;
          for (const [username, rp] of Object.entries(this.rpgPlayers)) {
            if (rp.zone !== zoneId || !rp.hp || rp.hp <= 0) continue;
            const dx = (rp.x || 400) - sap.x, dy = (rp.y || 200) - sap.y;
            if (Math.sqrt(dx * dx + dy * dy) < 80) {
              const p = this.player(username);
              const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
              const dmg = Math.max(1, sap.atk - Math.floor(Math.random() * 2) - def);
              rp.hp = Math.max(0, rp.hp - dmg);
              const armorResult = this.degradeEquipped(p, 'armor', 1);
              this.rpgSendTo(username, { type: 'rpg_mob_attack', data: { mobId: sap.id, dmg, hp: rp.hp, maxHP: rp.maxHP, armorBroke: armorResult && armorResult.broken ? armorResult.name : null } });
              if (rp.hp <= 0) {
                const lost = Math.floor(p.gold * 0.02);
                p.gold = Math.max(0, p.gold - lost);
                this.saveData();
                this.rpgSendTo(username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
                rp.zone = 'hub'; rp.hp = rp.maxHP;
              }
            }
          }
        }
        w.saplings = w.saplings.filter(s => !s.dead || Date.now() < s.respawnAt);
      }
      // Boss respawn
      if (w.boss && w.boss.dead && now >= w.boss.respawnAt) {
        w.boss = this.rpgMakeBoss(zoneId);
        w.saplings = [];
        this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_spawn', data: this.rpgGetBossData(w.boss) });
      }
    }
  }

  rpgGetBossData(boss) {
    if (!boss || boss.dead) return null;
    return {
      id: boss.id, name: boss.name, hp: boss.hp, maxHP: boss.maxHP,
      x: boss.x, y: boss.y, color: boss.color, phase: boss.phase,
      currentAttack: boss.currentAttack, attackTimer: boss.attackTimer,
      arenaRadius: boss.arenaRadius, homeX: boss.homeX, homeY: boss.homeY,
    };
  }

  rpgBossTick() {
    const now = Date.now();
    for (const [zoneId, w] of Object.entries(this.rpgWorld)) {
      const zone = RPG_ZONES[zoneId];
      if (!zone.boss || !w.boss || w.boss.dead) continue;
      const boss = w.boss;
      const bCfg = zone.boss;

      // Find nearest player in zone
      let nearP = null, nearD = Infinity;
      for (const [username, rp] of Object.entries(this.rpgPlayers)) {
        if (rp.zone !== zoneId || !rp.hp || rp.hp <= 0) continue;
        const dx = (rp.x || 400) - boss.x, dy = (rp.y || 200) - boss.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearD) { nearD = dist; nearP = { username, rp, dist }; }
      }

      // No player nearby or player out of arena — return to home
      if (!nearP || nearD > bCfg.arenaRadius) {
        boss.phase = 'idle';
        boss.targetPlayer = null;
        const dx = boss.homeX - boss.x, dy = boss.homeY - boss.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 5) {
          boss.x += (dx / d) * bCfg.chaseSpeed * 2;
          boss.y += (dy / d) * bCfg.chaseSpeed * 2;
          this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
        }
        continue;
      }

      boss.targetPlayer = nearP.username;
      boss.phase = 'combat';
      if (boss.globalCD > 0) boss.globalCD -= 200;

      // Currently executing an attack — count down telegraph
      if (boss.currentAttack) {
        boss.attackTimer -= 200;
        if (boss.attackTimer <= 0) {
          this.rpgBossAttackLand(zoneId, boss, boss.currentAttack, nearP);
          boss.attackCooldowns[boss.currentAttack.name] = now + boss.currentAttack.cooldown;
          boss.currentAttack = null;
          boss.globalCD = 1000;
        } else {
          this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_telegraph', data: {
            attack: boss.currentAttack.name, type: boss.currentAttack.type,
            timer: boss.attackTimer, maxTimer: boss.currentAttack.telegraphTime || 800,
            bossX: boss.x, bossY: boss.y,
            targetX: nearP.rp.x, targetY: nearP.rp.y,
            radius: boss.currentAttack.radius || 0,
            range: boss.currentAttack.range || 0, width: boss.currentAttack.width || 0,
          }});
        }
        continue;
      }

      // Chase player
      if (nearD > 120) {
        const dx = nearP.rp.x - boss.x, dy = nearP.rp.y - boss.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        boss.x += (dx / d) * bCfg.chaseSpeed;
        boss.y += (dy / d) * bCfg.chaseSpeed;
        const adx = boss.x - boss.homeX, ady = boss.y - boss.homeY;
        const adist = Math.sqrt(adx * adx + ady * ady);
        if (adist > bCfg.arenaRadius) {
          boss.x = boss.homeX + (adx / adist) * bCfg.arenaRadius;
          boss.y = boss.homeY + (ady / adist) * bCfg.arenaRadius;
        }
        this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_move', data: { x: boss.x, y: boss.y, phase: boss.phase } });
      }

      // Pick an attack
      if (boss.globalCD <= 0) {
        const avail = bCfg.attacks.filter(a => now >= (boss.attackCooldowns[a.name] || 0));
        if (avail.length > 0) {
          const atk = avail[Math.floor(Math.random() * avail.length)];
          if (atk.type === 'summon') {
            this.rpgBossSummon(zoneId, boss, atk);
            boss.attackCooldowns[atk.name] = now + atk.cooldown;
            boss.globalCD = 1500;
          } else {
            boss.currentAttack = { ...atk, snapX: nearP.rp.x, snapY: nearP.rp.y };
            boss.attackTimer = atk.telegraphTime || 800;
            this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_attack_start', data: {
              attack: atk.name, type: atk.type,
              telegraphTime: atk.telegraphTime || 800,
              bossX: boss.x, bossY: boss.y,
              targetX: nearP.rp.x, targetY: nearP.rp.y,
              radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
            }});
          }
        }
      }
    }
  }

  rpgBossAttackLand(zoneId, boss, atk, target) {
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
    }
    if (hit) {
      const p = this.player(target.username);
      const def = this.armorDefBonus(p) + ((p.rpg && p.rpg.buffDef && Date.now() < p.rpg.buffDef.expires) ? p.rpg.buffDef.value : 0);
      const dmg = Math.max(1, atk.dmg + Math.floor(Math.random() * 4) - def);
      target.rp.hp = Math.max(0, target.rp.hp - dmg);
      // Boss hit degrades armor by 3
      const armorResult = this.degradeEquipped(p, 'armor', 3);
      this.rpgSendTo(target.username, { type: 'rpg_boss_hit', data: {
        dmg, hp: target.rp.hp, maxHP: target.rp.maxHP, attack: atk.name,
        armorBroke: armorResult && armorResult.broken ? armorResult.name : null,
      }});
      if (target.rp.hp <= 0) {
        const lost = Math.floor(p.gold * 0.03);
        p.gold = Math.max(0, p.gold - lost);
        this.saveData();
        this.rpgSendTo(target.username, { type: 'rpg_death', data: { goldLost: lost, gold: p.gold } });
        target.rp.zone = 'hub'; target.rp.hp = target.rp.maxHP;
      }
    }
    this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_attack_land', data: {
      attack: atk.name, type: atk.type, hit,
      bossX: boss.x, bossY: boss.y,
      targetX: atk.snapX || px, targetY: atk.snapY || py,
      radius: atk.radius || 0, range: atk.range || 0, width: atk.width || 0,
    }});
  }

  rpgBossSummon(zoneId, boss, atk) {
    const w = this.rpgWorld[zoneId];
    if (!w.saplings) w.saplings = [];
    const alive = w.saplings.filter(s => !s.dead).length;
    const toSpawn = Math.min(atk.count || 3, 6 - alive);
    const newSaps = [];
    for (let i = 0; i < toSpawn; i++) {
      const sap = this.rpgMakeSapling(zoneId, boss.x, boss.y, i);
      w.saplings.push(sap);
      newSaps.push(sap);
    }
    this.rpgBroadcastZone(zoneId, { type: 'rpg_boss_summon', data: { saplings: newSaps, bossX: boss.x, bossY: boss.y } });
  }

  rpgAttackBoss(username, bossId) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.hp <= 0) return { error: 'dead' };
    const w = this.rpgWorld[rp.zone];
    if (!w || !w.boss || w.boss.dead || w.boss.id !== bossId) return { error: 'boss_gone' };
    const boss = w.boss;
    const dx = (rp.x || 400) - boss.x, dy = (rp.y || 200) - boss.y;
    if (Math.sqrt(dx * dx + dy * dy) > 120) return { error: 'too_far' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    boss.hp -= dmg;
    // Degrade weapon durability (boss hit = -3)
    const wepResult = this.degradeEquipped(p, 'weapon', 3);

    if (boss.hp <= 0) {
      boss.dead = true;
      boss.respawnAt = Date.now() + (RPG_ZONES[rp.zone].boss.respawnTime || 120000);
      if (w.saplings) w.saplings.forEach(s => { s.dead = true; });
      const zone = RPG_ZONES[rp.zone];
      const goldMult = 1 + this.equipStat(p, 'goldFind');
      const gold = Math.round((zone.boss.goldReward || 150) * goldMult);
      const xpR = zone.boss.xpReward || 200;
      this.addGold(p, gold);
      const leveled = this.addXP(p, xpR);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
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
      this.saveData();
      this.emitAchievements(username);
      this.rpgBroadcastZone(rp.zone, { type: 'rpg_boss_died', data: { bossId: boss.id, killer: username } });
      return { killed: true, dmg, crit, gold, xp: xpR, leveled, level: p.level, totalGold: p.gold, mobName: boss.name, drops: droppedItems, wearableDrops: droppedWearables, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
    }
    return { hit: true, dmg, crit, bossHP: boss.hp, bossMaxHP: boss.maxHP, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
  }

  rpgGetPlayerData(username) {
    const p = this.player(username);
    if (!p.rpg) p.rpg = { miningLevel: 1, miningXP: 0, totalMined: 0, mobKills: 0, pickaxeTier: 1 };
    return p;
  }

  rpgJoin(username) {
    const p = this.rpgGetPlayerData(username);
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    let spawnX = 1200, spawnY = 700;
    const hubW = this.rpgWorld['hub'];
    if (hubW && hubW.tileMap) { const sp = this.rpgFindWalkable(hubW.tileMap, spawnX, spawnY); spawnX = sp.x; spawnY = sp.y; }
    this.rpgPlayers[username] = { zone: 'hub', x: spawnX, y: spawnY, hp: maxHP, maxHP, username, inDuel: null, sitting: null };
    return {
      rpg: p.rpg,
      level: p.level,
      gold: p.gold,
      maxHP,
      baseDmg: Math.floor((this.minDmg(p) + this.maxDmg(p)) / 2) || 5,
      appearance: p.appearance,
      equipped: p.equipped,
      activeWearables: p.activeWearables,
      zones: Object.entries(RPG_ZONES).map(([id, z]) => ({ id, name: z.name, icon: z.icon, minMiningLevel: z.minMiningLevel || 0, type: z.type })),
      pickaxes: RPG_PICKAXES,
      duelQueueCount: this.rpgDuelQueue.length,
      ghostDefeated: !!p.ghostDefeated,
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
    delete this.rpgPlayers[username];
    this.rpgBroadcastAll({ type: 'rpg_player_left', data: { username } });
  }

  rpgChangeZone(username, zoneId) {
    const zone = RPG_ZONES[zoneId];
    if (!zone) return { error: 'invalid_zone' };
    const p = this.rpgGetPlayerData(username);
    if (zone.minMiningLevel && p.rpg.miningLevel < zone.minMiningLevel) {
      return { error: 'mining_level_low', required: zone.minMiningLevel, current: p.rpg.miningLevel };
    }
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    const oldZone = rp.zone;
    if (oldZone && oldZone !== zoneId && oldZone === 'hub') {
      this.rpgBroadcastZone(oldZone, { type: 'rpg_player_left', data: { username } }, username);
    }
    rp.sitting = null;
    rp.zone = zoneId;
    rp.x = 1200; rp.y = 700;
    const zw = this.rpgWorld[zoneId];
    if (zw && zw.tileMap) { const sp = this.rpgFindWalkable(zw.tileMap, 1200, 700); rp.x = sp.x; rp.y = sp.y; }
    const maxHP = 50 + p.level * 5 + (p.prestige || 0) * 10 + this.equipStat(p, 'maxHP');
    rp.hp = maxHP;
    rp.maxHP = maxHP;
    // Only broadcast join in hub (multiplayer zone)
    if (zoneId === 'hub') {
      this.rpgBroadcastZone(zoneId, { type: 'rpg_player_joined', data: { username, x: rp.x, y: rp.y, appearance: p.appearance, equipped: p.equipped, activeWearables: p.activeWearables } });
    }
    return { success: true, zone: this.rpgGetZoneState(zoneId, username) };
  }

  rpgGetZoneState(zoneId, username) {
    const w = this.rpgWorld[zoneId] || { nodes: [], mobs: [] };
    const zone = RPG_ZONES[zoneId] || {};
    // Only hub is multiplayer — other zones are single-player instances
    const isMultiplayer = zoneId === 'hub';
    const players = isMultiplayer ? Object.entries(this.rpgPlayers)
      .filter(([u, rp]) => rp.zone === zoneId && u !== username)
      .map(([u, rp]) => {
        const pd = this.players[u];
        return { username: u, x: rp.x, y: rp.y, appearance: pd ? pd.appearance : null, equipped: pd ? pd.equipped : null, activeWearables: pd ? pd.activeWearables : null, sitting: rp.sitting || null };
      }) : [];
    const bossData = w.boss && !w.boss.dead ? {
      id: w.boss.id, name: w.boss.name, hp: w.boss.hp, maxHP: w.boss.maxHP,
      x: w.boss.x, y: w.boss.y, color: w.boss.color, phase: w.boss.phase,
      currentAttack: w.boss.currentAttack, attackTimer: w.boss.attackTimer,
      arenaRadius: w.boss.arenaRadius, homeX: w.boss.homeX, homeY: w.boss.homeY,
    } : null;
    return {
      id: zoneId,
      name: zone.name,
      type: zone.type,
      bg: zone.bg,
      tileMap: w.tileMap || null,
      regions: zone.regions || null,
      landmarks: zone.landmarks || null,
      nodes: (w.nodes || []).filter(n => !n.mined),
      mobs: (w.mobs || []).filter(m => !m.dead).concat((w.saplings || []).filter(s => !s.dead)),
      players,
      boss: bossData,
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

    // Hit the node
    node.hp -= pickaxe.power;
    if (node.hp > 0) {
      return { hit: true, hpLeft: node.hp, maxHP: node.maxHP };
    }

    // Node broken!
    node.mined = true;
    const zone = RPG_ZONES[rp.zone];
    node.respawnAt = Date.now() + (zone.respawnTime || 15000);

    // Rewards
    const goldMult = 1 + this.equipStat(p, 'goldFind');
    const gold = Math.round(node.gold * goldMult * 100) / 100;
    const goldInt = Math.max(0, Math.round(gold));
    if (goldInt > 0) this.addGold(p, goldInt);
    p.rpg.miningXP += node.xp;
    p.rpg.totalMined++;

    // Mining level up
    let leveledUp = false;
    let needed = p.rpg.miningLevel * 30;
    while (p.rpg.miningXP >= needed) {
      p.rpg.miningXP -= needed;
      p.rpg.miningLevel++;
      leveledUp = true;
      needed = p.rpg.miningLevel * 30;
    }

    this.saveData();
    this.rpgBroadcastZone(rp.zone, { type: 'rpg_node_mined', data: { nodeId, username } });

    // Roll mining loot table
    const mineTableMap = { quarry: 'mine_quarry', deep_mine: 'mine_deep', gold_vein: 'mine_gold_vein' };
    const mineTableId = mineTableMap[rp.zone];
    const mineDrops = mineTableId ? this.rollLootTable(mineTableId) : [];
    const droppedItems = [];
    const droppedWearables = [];
    for (const drop of mineDrops) {
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
    if (droppedItems.length > 0 || droppedWearables.length > 0) this.saveData();

    return {
      success: true,
      oreType: node.type,
      gold: goldInt,
      miningXP: node.xp,
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
    const mob = (w.mobs || []).find(m => m.id === mobId && !m.dead);
    if (!mob) return { error: 'mob_gone' };

    const p = this.rpgGetPlayerData(username);
    let dmg = Math.floor(Math.random() * (this.maxDmg(p) - this.minDmg(p) + 1)) + this.minDmg(p);
    let crit = false;
    if (Math.random() < this.critChance(p)) {
      dmg = Math.floor(dmg * (CONFIG.critMultiplier + this.equipStat(p, 'critMult')));
      crit = true;
    }
    mob.hp -= dmg;
    // Degrade weapon durability (mob hit = -1)
    const wepResult = this.degradeEquipped(p, 'weapon', 1);

    if (mob.hp <= 0) {
      mob.dead = true;
      mob.respawnAt = Date.now() + 20000;
      const goldMult = 1 + this.equipStat(p, 'goldFind');
      const goldBase = mob.goldMin + Math.floor(Math.random() * (mob.goldMax - mob.goldMin + 1));
      const gold = Math.round(goldBase * goldMult);
      this.addGold(p, gold);
      const leveled = this.addXP(p, mob.xpReward);
      p.rpg.mobKills = (p.rpg.mobKills || 0) + 1;
      // Roll loot table for this mob
      const mobKey = mob.name.toLowerCase().replace(/\s+/g, '_');
      const lootDrops = this.rollLootTable(mobKey);
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
      this.rpgBroadcastZone(rp.zone, { type: 'rpg_mob_died', data: { mobId, killer: username } });
      return { killed: true, dmg, crit, gold, xp: mob.xpReward, leveled, level: p.level, totalGold: p.gold, mobName: mob.name, drops: droppedItems, wearableDrops: droppedWearables, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
    }

    return { hit: true, dmg, crit, mobHP: mob.hp, mobMaxHP: mob.maxHP, weaponBroke: wepResult && wepResult.broken ? wepResult.name : null };
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

  rpgMove(username, x, y) {
    const rp = this.rpgPlayers[username];
    if (!rp) return;
    if (rp.sitting) { rp.sitting = null; } // Stand up on move
    x = Math.max(0, Math.min(2400, x));
    y = Math.max(0, Math.min(2400, y));
    // Tile collision — reject moves onto blocked tiles
    const w = this.rpgWorld[rp.zone];
    if (w && w.tileMap) {
      const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
      if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && !TILE_PROPS[w.tileMap[ty][tx]].walkable) return;
    }
    rp.x = x;
    rp.y = y;
    this.rpgBroadcastZone(rp.zone, { type: 'rpg_player_move', data: { username, x: rp.x, y: rp.y } }, username);
  }

  rpgSit(username, benchX, benchY) {
    const rp = this.rpgPlayers[username];
    if (!rp || rp.zone !== 'hub') return;
    rp.sitting = { x: benchX, y: benchY };
    rp.x = benchX;
    rp.y = benchY;
    this.rpgBroadcastZone('hub', { type: 'rpg_player_sit', data: { username, x: benchX, y: benchY } }, username);
  }

  rpgBroadcastZone(zoneId, msg, exclude) {
    for (const [u, rp] of Object.entries(this.rpgPlayers)) {
      if (rp.zone === zoneId && u !== exclude && rp.ws) {
        try { rp.ws.send(JSON.stringify(msg)); } catch {}
      }
    }
  }

  rpgBroadcastAll(msg) {
    for (const [, rp] of Object.entries(this.rpgPlayers)) {
      if (rp.ws) {
        try { rp.ws.send(JSON.stringify(msg)); } catch {}
      }
    }
  }

  rpgSendTo(username, msg) {
    const rp = this.rpgPlayers[username];
    if (rp && rp.ws) {
      try { rp.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  rpgGetOnlineCount() {
    return Object.keys(this.rpgPlayers).length;
  }

  // ═══════════════════════════════════════════
  // RPG Duel System — Turn-based PvP
  // ═══════════════════════════════════════════
  rpgDuelJoinQueue(username) {
    const rp = this.rpgPlayers[username];
    if (!rp) return { error: 'not_in_rpg' };
    if (rp.inDuel) return { error: 'already_in_duel' };
    if (this.rpgDuelQueue.includes(username)) return { error: 'already_queued' };
    this.rpgDuelQueue.push(username);
    // Try to match
    if (this.rpgDuelQueue.length >= 2) {
      const p1 = this.rpgDuelQueue.shift();
      const p2 = this.rpgDuelQueue.shift();
      this.rpgDuelStart(p1, p2);
      return { matched: true };
    }
    this.rpgBroadcastAll({ type: 'rpg_duel_queue_update', data: { count: this.rpgDuelQueue.length } });
    return { queued: true, position: this.rpgDuelQueue.length };
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
    const hp1 = 50 + p1.level * 5 + (p1.prestige || 0) * 10 + this.equipStat(p1, 'maxHP');
    const hp2 = 50 + p2.level * 5 + (p2.prestige || 0) * 10 + this.equipStat(p2, 'maxHP');
    const dmg1 = Math.floor((this.minDmg(p1) + this.maxDmg(p1)) / 2) || 5;
    const dmg2 = Math.floor((this.minDmg(p2) + this.maxDmg(p2)) / 2) || 5;
    const duel = {
      id, p1: u1, p2: u2,
      p1HP: hp1, p2HP: hp2, p1MaxHP: hp1, p2MaxHP: hp2,
      p1BaseDmg: dmg1, p2BaseDmg: dmg2,
      p1Action: null, p2Action: null,
      p1Heals: 3, p2Heals: 3,
      p1Level: p1.level, p2Level: p2.level,
      turn: 1, state: 'active',
      timer: setTimeout(() => this.rpgDuelTimeout(id), 20000),
    };
    this.rpgDuels[id] = duel;
    const rp1 = this.rpgPlayers[u1];
    const rp2 = this.rpgPlayers[u2];
    if (rp1) rp1.inDuel = id;
    if (rp2) rp2.inDuel = id;
    this.rpgSendTo(u1, { type: 'rpg_duel_start', data: {
      duelId: id, opponent: u2, opponentLevel: p2.level,
      yourHP: hp1, yourMaxHP: hp1, theirHP: hp2, theirMaxHP: hp2,
      yourDmg: dmg1, theirDmg: dmg2, turn: 1,
      opponentAppearance: p2.appearance, opponentEquipped: p2.equipped || {},
    }});
    this.rpgSendTo(u2, { type: 'rpg_duel_start', data: {
      duelId: id, opponent: u1, opponentLevel: p1.level,
      yourHP: hp2, yourMaxHP: hp2, theirHP: hp1, theirMaxHP: hp1,
      yourDmg: dmg2, theirDmg: dmg1, turn: 1,
      opponentAppearance: p1.appearance, opponentEquipped: p1.equipped || {},
    }});
    this.rpgBroadcastAll({ type: 'rpg_duel_queue_update', data: { count: this.rpgDuelQueue.length } });
  }

  rpgDuelAction(username, action) {
    const rp = this.rpgPlayers[username];
    if (!rp || !rp.inDuel) return { error: 'not_in_duel' };
    const duel = this.rpgDuels[rp.inDuel];
    if (!duel || duel.state !== 'active') return { error: 'duel_over' };
    const validActions = ['slash', 'heavy', 'block', 'fireball', 'heal', 'dodge'];
    if (!validActions.includes(action)) return { error: 'invalid_action' };
    if (action === 'heal') {
      if (duel.p1 === username && duel.p1Heals <= 0) return { error: 'no_heals' };
      if (duel.p2 === username && duel.p2Heals <= 0) return { error: 'no_heals' };
    }
    if (duel.p1 === username) duel.p1Action = action;
    else if (duel.p2 === username) duel.p2Action = action;
    else return { error: 'not_in_duel' };
    // If both have chosen, resolve
    if (duel.p1Action && duel.p2Action) {
      this.rpgDuelResolve(duel.id);
    }
    return { submitted: true };
  }

  rpgDuelResolve(duelId) {
    const duel = this.rpgDuels[duelId];
    if (!duel) return;
    clearTimeout(duel.timer);
    const a1 = duel.p1Action, a2 = duel.p2Action;
    const attackMult = { slash: 1.0, heavy: 1.5, fireball: 1.3, block: 0, heal: 0, dodge: 0 };
    let d1 = Math.round(duel.p1BaseDmg * (attackMult[a1] || 0));
    let d2 = Math.round(duel.p2BaseDmg * (attackMult[a2] || 0));
    let h1 = 0, h2 = 0;
    let p1Dodged = false, p2Dodged = false;
    // Healing
    if (a1 === 'heal') { h1 = Math.round(duel.p1MaxHP * 0.2); duel.p1Heals--; }
    if (a2 === 'heal') { h2 = Math.round(duel.p2MaxHP * 0.2); duel.p2Heals--; }
    // Dodge: chance to avoid incoming damage
    if (a1 === 'dodge') {
      const dodgeChance = a2 === 'heavy' ? 0.85 : a2 === 'fireball' ? 0.40 : 0.65;
      if (Math.random() < dodgeChance) { p1Dodged = true; d2 = 0; }
    }
    if (a2 === 'dodge') {
      const dodgeChance = a1 === 'heavy' ? 0.85 : a1 === 'fireball' ? 0.40 : 0.65;
      if (Math.random() < dodgeChance) { p2Dodged = true; d1 = 0; }
    }
    // Counter: Block reduces Slash to 30%
    if (a2 === 'block' && a1 === 'slash') d1 = Math.round(d1 * 0.3);
    if (a1 === 'block' && a2 === 'slash') d2 = Math.round(d2 * 0.3);
    // Counter: Heavy breaks through Block (full damage)
    // Counter: Slash interrupts Fireball (fireball does 50%)
    if (a1 === 'slash' && a2 === 'fireball') d2 = Math.round(d2 * 0.5);
    if (a2 === 'slash' && a1 === 'fireball') d1 = Math.round(d1 * 0.5);
    // Counter: Fireball beats Heavy (heavy misses)
    if (a1 === 'heavy' && a2 === 'fireball') d1 = 0;
    if (a2 === 'heavy' && a1 === 'fireball') d2 = 0;
    // Fireball ignores block
    // Apply
    duel.p1HP = Math.max(0, Math.min(duel.p1MaxHP, duel.p1HP + h1 - d2));
    duel.p2HP = Math.max(0, Math.min(duel.p2MaxHP, duel.p2HP + h2 - d1));
    // Build result
    const result = { turn: duel.turn, p1Action: a1, p2Action: a2, d1, d2, h1, h2, p1HP: duel.p1HP, p2HP: duel.p2HP, p1MaxHP: duel.p1MaxHP, p2MaxHP: duel.p2MaxHP, p1Dodged, p2Dodged };
    // Check winner
    let winner = null;
    if (duel.p1HP <= 0 && duel.p2HP <= 0) winner = 'draw';
    else if (duel.p2HP <= 0) winner = duel.p1;
    else if (duel.p1HP <= 0) winner = duel.p2;
    if (winner) {
      duel.state = 'finished';
      this.rpgDuelEnd(duel.id, winner === 'draw' ? null : winner, winner === 'draw' ? null : (winner === duel.p1 ? duel.p2 : duel.p1));
      result.winner = winner;
    } else {
      duel.turn++;
      duel.p1Action = null;
      duel.p2Action = null;
      duel.timer = setTimeout(() => this.rpgDuelTimeout(duel.id), 20000);
    }
    // Send to both players (flipped perspective)
    this.rpgSendTo(duel.p1, { type: 'rpg_duel_turn', data: {
      ...result, yourAction: a1, theirAction: a2,
      yourDmgDealt: d1, theirDmgDealt: d2, yourHeal: h1, theirHeal: h2,
      yourHP: duel.p1HP, theirHP: duel.p2HP,
      yourMaxHP: duel.p1MaxHP, theirMaxHP: duel.p2MaxHP,
      healsLeft: duel.p1Heals, winner: result.winner,
      youDodged: p1Dodged, theyDodged: p2Dodged,
    }});
    this.rpgSendTo(duel.p2, { type: 'rpg_duel_turn', data: {
      ...result, yourAction: a2, theirAction: a1,
      yourDmgDealt: d2, theirDmgDealt: d1, yourHeal: h2, theirHeal: h1,
      yourHP: duel.p2HP, theirHP: duel.p1HP,
      yourMaxHP: duel.p2MaxHP, theirMaxHP: duel.p1MaxHP,
      healsLeft: duel.p2Heals, winner: result.winner,
      youDodged: p2Dodged, theyDodged: p1Dodged,
    }});
  }

  rpgDuelEnd(duelId, winner, loser) {
    const duel = this.rpgDuels[duelId];
    if (!duel) return;
    clearTimeout(duel.timer);
    duel.state = 'finished';
    // Rewards
    let goldReward = 0, xpReward = 0;
    if (winner && loser) {
      const wP = this.player(winner);
      const avgLevel = Math.floor((duel.p1Level + duel.p2Level) / 2);
      goldReward = 5 + Math.floor(avgLevel * 2);
      xpReward = 10 + avgLevel * 3;
      this.addGold(wP, goldReward);
      this.addXP(wP, xpReward);
      this.saveData();
      this.rpgSendTo(winner, { type: 'rpg_duel_end', data: { result: 'win', gold: goldReward, xp: xpReward, totalGold: wP.gold } });
      this.rpgSendTo(loser, { type: 'rpg_duel_end', data: { result: 'loss', gold: 0, xp: 0, totalGold: this.player(loser).gold } });
    } else {
      // Draw
      this.rpgSendTo(duel.p1, { type: 'rpg_duel_end', data: { result: 'draw', gold: 0, xp: 0, totalGold: this.player(duel.p1).gold } });
      this.rpgSendTo(duel.p2, { type: 'rpg_duel_end', data: { result: 'draw', gold: 0, xp: 0, totalGold: this.player(duel.p2).gold } });
    }
    // Clean up
    const rp1 = this.rpgPlayers[duel.p1];
    const rp2 = this.rpgPlayers[duel.p2];
    if (rp1) rp1.inDuel = null;
    if (rp2) rp2.inDuel = null;
    delete this.rpgDuels[duelId];
  }

  rpgDuelTimeout(duelId) {
    const duel = this.rpgDuels[duelId];
    if (!duel || duel.state !== 'active') return;
    // Auto-block for players who haven't acted
    if (!duel.p1Action) duel.p1Action = 'block';
    if (!duel.p2Action) duel.p2Action = 'block';
    this.rpgDuelResolve(duelId);
  }
}

// ═══════════════════════════════════════════
// RPG Constants
// ═══════════════════════════════════════════
const RPG_PICKAXES = [
  { tier: 1, name: 'Stone Pickaxe',   cost: 0,    power: 1, speed: 1.0,  icon: '🪨' },
  { tier: 2, name: 'Iron Pickaxe',    cost: 300,  power: 2, speed: 1.3,  icon: '⛏️' },
  { tier: 3, name: 'Gold Pickaxe',    cost: 800,  power: 3, speed: 1.6,  icon: '🥇' },
  { tier: 4, name: 'Diamond Pickaxe', cost: 2000, power: 4, speed: 2.0,  icon: '💎' },
  { tier: 5, name: 'Crystal Pickaxe', cost: 5000, power: 5, speed: 2.5,  icon: '🔮' },
];

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
      { id: 'lm_quarry',    tx: 10, ty: 17, zone: 'quarry',    type: 'mine_entrance', label: 'Stone Quarry',     icon: '⛏️' },
      { id: 'lm_deep_mine', tx: 10, ty: 10, zone: 'deep_mine', type: 'mine_entrance', label: 'Iron Depths',      icon: '🕳️' },
      { id: 'lm_gold_vein', tx: 10, ty: 24, zone: 'gold_vein', type: 'mine_entrance', label: 'Gold Vein',        icon: '💰' },
      { id: 'lm_forest',    tx: 50, ty: 17, zone: 'forest',    type: 'forest_gate',   label: 'Shadow Forest',    icon: '🌲' },
      { id: 'lm_dungeon',   tx: 49, ty: 54, zone: 'dungeon',   type: 'dungeon_portal',label: 'Dark Dungeon',     icon: '🏰' },
      { id: 'lm_market',    tx: 30, ty: 28, zone: null,         type: 'market_stall',  label: 'Market (Coming Soon)', icon: '🛒' },
      { id: 'lm_duel',      tx: 50, ty: 10, zone: null,         type: 'arena_gate',    label: 'Duel Arena',       icon: '⚔️' },
    ],
  },
  quarry: {
    name: 'Stone Quarry', icon: '⛏️', type: 'mine',
    bg: '#2a2520',
    minMiningLevel: 1,
    nodes: 16,
    respawnTime: 60000,
    drops: [
      { type: 'stone',  weight: 85, gold: 1,  xp: 1,  hp: 8,  color: '#888888' },
      { type: 'copper', weight: 8,  gold: 2,  xp: 2,  hp: 10, color: '#CD7F32' },
      { type: 'iron',   weight: 4,  gold: 3,  xp: 4,  hp: 12, color: '#B0B0B0' },
      { type: 'gold',   weight: 2.5,gold: 5,  xp: 6,  hp: 15, color: '#FFD700' },
      { type: 'gem',    weight: 0.5,gold: 10, xp: 10, hp: 18, color: '#00BFFF' },
    ],
  },
  deep_mine: {
    name: 'Iron Depths', icon: '🕳️', type: 'mine',
    bg: '#1a1520',
    minMiningLevel: 10,
    nodes: 14,
    respawnTime: 120000,
    drops: [
      { type: 'iron',    weight: 60, gold: 3,  xp: 4,  hp: 15, color: '#B0B0B0' },
      { type: 'gold',    weight: 20, gold: 6,  xp: 6,  hp: 18, color: '#FFD700' },
      { type: 'crystal', weight: 11, gold: 10, xp: 10, hp: 22, color: '#c084fc' },
      { type: 'diamond', weight: 6,  gold: 15, xp: 16, hp: 28, color: '#00BFFF' },
      { type: 'ruby',    weight: 3,  gold: 25, xp: 24, hp: 35, color: '#FF0044' },
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
      { type: 'crystal', weight: 24, gold: 15, xp: 12, hp: 26, color: '#c084fc' },
      { type: 'diamond', weight: 15, gold: 25, xp: 20, hp: 34, color: '#00BFFF' },
      { type: 'ruby',    weight: 8,  gold: 40, xp: 30, hp: 44, color: '#FF0044' },
      { type: 'void',    weight: 3,  gold: 80, xp: 45, hp: 55, color: '#9900ff' },
    ],
  },
  forest: {
    name: 'Shadow Forest', icon: '🌲', type: 'combat',
    bg: '#0a1a0a',
    minMiningLevel: 0,
    mobCount: 18,
    mobs: [
      { name: 'Slime',    maxHP: 60,  atk: 3,  goldMin: 2,  goldMax: 4,  xpReward: 3,  color: '#44ff44' },
      { name: 'Goblin',   maxHP: 90,  atk: 5,  goldMin: 3,  goldMax: 7,  xpReward: 5,  color: '#ff8800' },
      { name: 'Wolf',     maxHP: 140, atk: 8,  goldMin: 5,  goldMax: 10, xpReward: 9,  color: '#aaaaaa' },
    ],
    boss: {
      name: 'Ancient Treant',
      maxHP: 600,
      goldReward: 300,
      xpReward: 200,
      color: '#2d5a1e',
      arenaX: 360, arenaY: 360,
      arenaRadius: 280,
      chaseSpeed: 1.2,
      respawnTime: 120000,
      attacks: [
        { name: 'Root Slam',       type: 'aoe',     dmg: 18, radius: 100, telegraphTime: 800,  cooldown: 4000  },
        { name: 'Vine Whip',       type: 'line',    dmg: 12, range: 180,  width: 40,   telegraphTime: 500,  cooldown: 3000  },
        { name: 'Summon Saplings', type: 'summon',  count: 3, cooldown: 12000 },
      ],
    },
  },
  dungeon: {
    name: 'Dark Dungeon', icon: '🏰', type: 'combat',
    bg: '#0a0a15',
    minMiningLevel: 0,
    mobCount: 8,
    mobs: [
      { name: 'Skeleton', maxHP: 200, atk: 10, goldMin: 5,  goldMax: 10, xpReward: 10, color: '#ffffff' },
      { name: 'Zombie',   maxHP: 300, atk: 14, goldMin: 7,  goldMax: 12, xpReward: 16, color: '#6b8e23' },
      { name: 'Wraith',   maxHP: 430, atk: 18, goldMin: 8,  goldMax: 15, xpReward: 24, color: '#8844cc' },
      { name: 'Demon',    maxHP: 600, atk: 24, goldMin: 10, goldMax: 20, xpReward: 40, color: '#ff2222' },
    ],
  },
};

module.exports = { Game, CONFIG, COSMETICS, WEARABLES, BOSS_LOOT, ITEMS, LOOT_TABLES, RECIPES, NPC_SHOP, ACHIEVEMENTS, RARITY_COLOR, VENDOR_PRICE, RANK_BADGES, getRankBadge, RPG_ZONES, RPG_PICKAXES, TILE, TILE_PROPS, TILE_SIZE, MAP_W, MAP_H };
