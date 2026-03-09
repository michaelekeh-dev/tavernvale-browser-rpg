const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Game, CONFIG, COSMETICS, WEARABLES, BOSS_LOOT, ITEMS, LOOT_TABLES, RECIPES, NPC_SHOP, ACHIEVEMENTS, RARITY_COLOR, VENDOR_PRICE, RANK_BADGES, getRankBadge, RPG_ZONES, RPG_PICKAXES, TAVERN_QUESTS } = require('./game');

// ═══════════════════════════════════════════
// CONFIGURATION — Edit these values
// ═══════════════════════════════════════════
const KICK_CHANNEL = 'mikeydamike';
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kickstream2026';

// If auto-detection fails, set your chatroom ID manually:
// 1. Open your browser and go to: https://kick.com/api/v2/channels/mikeydamike
// 2. Search for "chatroom" → "id" in the JSON
// 3. Put that number below:
const CHATROOM_ID = null; // e.g., 12345678

// ═══════════════════════════════════════════
// Express + HTTP
// ═══════════════════════════════════════════
const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use('/audio', express.static(path.join(__dirname, 'audio')));
app.use('/overlay', (req, res, next) => {
  if (req.query.pw !== ADMIN_PASSWORD) return res.status(403).send('Access denied.');
  next();
}, express.static(path.join(__dirname, 'Overlay')));
app.get('/', (req, res) => res.redirect('/play'));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));
app.get('/rpg', (req, res) => {
  if (!game.rpgEnabled) return res.send('<html><body style="background:#0a0a0f;color:#ffd700;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center"><div><h1>\u2694\ufe0f RPG Coming Soon</h1><p style="color:#888">The RPG is currently disabled. Check back later!</p><a href="/play" style="color:#4ecdc4">\u2190 Back to Player Portal</a></div></body></html>');
  res.sendFile(path.join(__dirname, 'rpg.html'));
});
app.get('/admin', (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(403).send('Access denied.');
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/api/admin/gamedata', (req, res) => {
  const pw = req.query.pw;
  if (pw !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Access denied' });
  res.json(game.rpgAdminGetGameData());
});

// ═══════════════════════════════════════════
// Player Portal REST API
// ═══════════════════════════════════════════
// Pending link requests — player visits site, clicks "Link", we store their username here
// When they type !link in chat, we match it and generate the token
const pendingLinks = new Map(); // username -> { resolve, timer }

app.get('/api/player/:username', (req, res) => {
  const profile = game.getPlayerProfile(req.params.username.toLowerCase());
  if (!profile) return res.status(404).json({ error: 'Player not found. Attack a boss first!' });
  res.json(profile);
});

app.get('/api/boss', (req, res) => res.json(game.getBossStatus()));
app.get('/api/market', (req, res) => res.json(game.getMarketListings()));
app.get('/api/cosmetics', (req, res) => res.json(COSMETICS));
app.get('/api/wearables', (req, res) => res.json(WEARABLES));
app.get('/api/achievements', (req, res) => res.json(ACHIEVEMENTS));
app.get('/api/loot', (req, res) => res.json(BOSS_LOOT));
app.get('/api/items', (req, res) => res.json(ITEMS));
app.get('/api/shop', (req, res) => res.json(NPC_SHOP));
app.get('/api/recipes', (req, res) => res.json(RECIPES));
app.get('/api/leaderboard', (req, res) => res.json(game.handleLeaderboard()));
app.get('/api/rarity-colors', (req, res) => res.json(RARITY_COLOR));
app.get('/api/rank-badges', (req, res) => res.json(RANK_BADGES));

// Auth middleware for portal actions
function requireAuth(req, res, next) {
  const { username, token } = req.body || {};
  if (!username || !token) return res.status(401).json({ error: 'Missing credentials' });
  if (!game.validateToken(username.toLowerCase(), token)) return res.status(401).json({ error: 'Invalid or expired token. Type !link in chat again.' });
  req.playerName = username.toLowerCase();
  next();
}

// Equip / Unequip
app.post('/api/equip', requireAuth, (req, res) => {
  const r = game.handleEquip(req.playerName, req.body.itemUid);
  if (r && !r.error) { broadcast('item_equipped', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/unequip', requireAuth, (req, res) => {
  const r = game.handleUnequip(req.playerName, req.body.slot);
  if (r && !r.error) { broadcast('item_unequipped', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Cosmetics
app.post('/api/buycosmetic', requireAuth, (req, res) => {
  const r = game.handleBuyCosmetic(req.playerName, req.body.key);
  if (r && !r.error) { broadcast('cosmetic_purchased', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/equipcosmetic', requireAuth, (req, res) => {
  const r = game.handleEquipCosmetic(req.playerName, req.body.key);
  if (r && !r.error) { broadcast('cosmetic_equipped', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
// Wearables
app.post('/api/equipwearable', requireAuth, (req, res) => {
  const r = game.handleEquipWearable(req.playerName, req.body.key);
  if (r && !r.error) { broadcast('wearable_equipped', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/unequipwearable', requireAuth, (req, res) => {
  const r = game.handleUnequipWearable(req.playerName, req.body.slot);
  if (r && !r.error) { broadcast('wearable_unequipped', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/sellwearable', requireAuth, (req, res) => {
  const r = game.handleSellWearable(req.playerName, req.body.key, req.body.price);
  if (r && !r.error) { broadcast('market_listed', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Character Appearance
app.post('/api/appearance', requireAuth, (req, res) => {
  const appearance = game.updateAppearance(req.playerName, req.body);
  res.json({ success: true, appearance });
});

// Market
app.post('/api/sell', requireAuth, (req, res) => {
  const r = game.handleSellItem(req.playerName, req.body.itemUid, req.body.price);
  if (r && !r.error) { broadcast('market_listed', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/sellcosmetic', requireAuth, (req, res) => {
  const r = game.handleSellCosmetic(req.playerName, req.body.key, req.body.price);
  if (r && !r.error) { broadcast('market_listed', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/buymarket', requireAuth, (req, res) => {
  const r = game.handleBuyMarket(req.playerName, req.body.listingId);
  if (r && !r.error) { broadcast('market_purchased', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/sellmaterial', requireAuth, (req, res) => {
  const r = game.handleSellMaterial(req.playerName, req.body.itemId, req.body.qty, req.body.price);
  if (r && !r.error) { broadcast('market_listed', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/cancel', requireAuth, (req, res) => {
  const r = game.handleCancelListing(req.playerName, req.body.listingId);
  if (r && !r.error) { broadcast('market_cancelled', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.get('/api/market', (req, res) => {
  res.json(game.getMarketListings());
});

// Gamble
app.post('/api/gamble', requireAuth, (req, res) => {
  const r = game.handleGamble(req.playerName, req.body.amount);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Dice Roll
app.post('/api/dice', requireAuth, (req, res) => {
  const r = game.handleDiceRoll(req.playerName, req.body.amount, req.body.target);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Slots
app.post('/api/slots', requireAuth, (req, res) => {
  const r = game.handleSlots(req.playerName, req.body.amount);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Blackjack
app.post('/api/blackjack', requireAuth, (req, res) => {
  const r = game.handleBlackjack(req.playerName, req.body.amount);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Crash
app.post('/api/crash', requireAuth, (req, res) => {
  const r = game.handleCrash(req.playerName, req.body.amount, req.body.cashout);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Roulette
app.post('/api/roulette', requireAuth, (req, res) => {
  const r = game.handleRoulette(req.playerName, req.body.amount, req.body.choice);
  if (r && !r.error) { broadcast('gamble_result', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Gift
app.post('/api/gift', requireAuth, (req, res) => {
  const r = game.handleGift(req.playerName, req.body.target, req.body.amount);
  if (r && !r.error) { broadcast('gift_sent', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Long-poll link endpoint: portal calls this, waits for user to type !link in chat
app.post('/api/link', (req, res) => {
  const username = (req.body.username || '').toLowerCase().trim();
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!game.getPlayerProfile(username)) return res.status(404).json({ error: 'Player not found. Attack a boss on stream first!' });
  // Generate a PIN code the user must type in Kick chat
  const code = game.generateLinkCode(username);
  // Cancel any existing pending link long-poll for this user
  const existing = pendingLinks.get(username);
  if (existing) { clearTimeout(existing.timer); existing.resolve(null); pendingLinks.delete(username); }
  // Long-poll: wait up to 90 seconds for !link CODE in chat
  const timeout = 90000;
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => { pendingLinks.delete(username); resolve(null); }, timeout);
    pendingLinks.set(username, { resolve, timer });
  });
  promise.then((token) => {
    if (token) res.json({ success: true, token });
    else res.status(408).json({ error: 'Timed out. Try again and type the code faster!' });
  });
  // Send the code back immediately as a header so the portal can show it
  // Actually we need to send it in a different way since long-poll blocks...
  // We'll use a separate endpoint to get the code
});

// Get pending link code for display
app.get('/api/link/code/:username', (req, res) => {
  const username = req.params.username.toLowerCase().trim();
  const pending = game.pendingLinkCodes[username];
  if (!pending || Date.now() - pending.created > 300000) return res.json({ code: null });
  res.json({ code: pending.code });
});

// Vendor sell disabled — player-driven economy only
app.post('/api/vendorsell', requireAuth, (req, res) => {
  res.status(400).json({ error: 'disabled', message: 'NPC selling is disabled. Trade with other players on the Market instead!' });
});
app.get('/api/vendorprices', (req, res) => res.json(VENDOR_PRICE));

// Payout queue
app.post('/api/redeem', requireAuth, (req, res) => {
  const { method, address, gold } = req.body;
  if (!method || !address) return res.status(400).json({ error: 'Method and address required' });
  const r = game.handleRedeemRequest(req.playerName, method, address.slice(0, 200), gold);
  if (r && r.success) {
    broadcastToPortal('payout_requested', r.request);
    discordEmbed({
      title: '💰 Payout Request',
      description: `**${req.playerName}** wants **$${r.request.dollarValue}** (${r.request.goldAmount}g)\n**Method:** ${method}`,
      color: 0xFFAA00,
    });
    return res.json(r);
  }
  res.status(400).json(r || { error: 'Failed' });
});

app.get('/api/redeem/status/:username', (req, res) => {
  const queue = game.getPayoutQueue().filter(r => r.username === req.params.username.toLowerCase());
  res.json(queue);
});

// Chat history
app.get('/api/chat', (req, res) => res.json(game.getChatHistory()));

// ═══ PvP Arena API ═══
app.post('/api/duel/challenge', requireAuth, (req, res) => {
  const r = game.challengeDuel(req.playerName, (req.body.defender || '').toLowerCase().trim(), req.body.bet);
  if (r && r.success) { broadcast('duel_challenge', r.duel); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/duel/accept', requireAuth, (req, res) => {
  const r = game.acceptDuel(req.playerName, parseInt(req.body.duelId));
  if (r && r.success) { broadcast('duel_result', r.result); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.post('/api/duel/decline', requireAuth, (req, res) => {
  const r = game.declineDuel(req.playerName, parseInt(req.body.duelId));
  if (r && r.success) { broadcast('duel_declined', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});
app.get('/api/duel/pending/:username', (req, res) => {
  res.json(game.getPendingDuels(req.params.username.toLowerCase()));
});
app.get('/api/arena/leaderboard', (req, res) => {
  res.json(game.getArenaLeaderboard());
});
app.get('/api/arena/stats/:username', (req, res) => {
  res.json(game.getArenaStats(req.params.username.toLowerCase()));
});

// ═══ Prestige API ═══
app.get('/api/prestige/:username', (req, res) => {
  res.json(game.getPrestigeInfo(req.params.username.toLowerCase()));
});
app.post('/api/prestige', requireAuth, (req, res) => {
  const r = game.doPrestige(req.playerName);
  if (r && r.success) { broadcast('prestige', r); return res.json(r); }
  res.status(400).json(r || { error: 'Failed' });
});

// Admin: payout queue management
app.get('/api/admin/payouts', (req, res) => res.json(game.getPayoutQueue()));
app.post('/api/admin/payout', (req, res) => {
  const { requestId, action } = req.body;
  const r = game.processPayoutRequest(requestId, action);
  if (r && r.success) {
    broadcastToPortal('payout_processed', r.request);
    discordEmbed({
      title: action === 'approve' ? '✅ Payout Approved' : '❌ Payout Denied',
      description: `**${r.request.username}** — $${r.request.dollarValue} (${r.request.goldAmount}g)`,
      color: action === 'approve' ? 0x44FF44 : 0xFF4444,
    });
    return res.json(r);
  }
  res.status(400).json(r || { error: 'Failed' });
});

// Admin: full reset (wipe all data)
app.post('/api/admin/fullreset', (req, res) => {
  game.fullReset();
  broadcast('full_reset', {});
  discordEmbed({
    title: '🔥 FULL RESET',
    description: 'All player data has been wiped! Fresh start! 🧹',
    color: 0xFF0000,
  });
  res.json({ success: true });
});

// Admin: set discord webhook (events channel)
app.post('/api/admin/discord-webhook', (req, res) => {
  const url = (req.body.url || '').trim();
  game.setDiscordWebhook(url || null);
  res.json({ success: true, set: !!url });
});
app.get('/api/admin/discord-webhook', (req, res) => {
  res.json({ url: game.getDiscordWebhook() || '' });
});

// Admin: Discord bot config (two-way chat)
app.post('/api/admin/discord-bot', (req, res) => {
  const { botToken, chatChannelId } = req.body;
  if (!botToken || !chatChannelId) return res.status(400).json({ error: 'Bot token and chat channel ID required' });
  // Store config (persist in gamedata)
  game.discordBotConfig = { botToken, chatChannelId };
  game.saveData();
  initDiscordBot(botToken, chatChannelId);
  res.json({ success: true });
});
app.get('/api/admin/discord-bot', (req, res) => {
  const cfg = game.discordBotConfig || {};
  res.json({ configured: !!cfg.botToken, chatChannelId: cfg.chatChannelId || '' });
});
app.post('/api/admin/discord-bot/disconnect', (req, res) => {
  if (discordBot) { discordBot.destroy(); discordBot = null; discordChatSend = null; }
  game.discordBotConfig = null;
  game.saveData();
  res.json({ success: true });
});

// RPG toggle
app.post('/api/admin/rpg-toggle', (req, res) => {
  game.rpgEnabled = !!req.body.enabled;
  game.saveData();
  res.json({ success: true, enabled: game.rpgEnabled });
});

app.post('/api/admin/gambling-toggle', (req, res) => {
  game.gamblingEnabled = !!req.body.enabled;
  game.saveData();
  res.json({ success: true, enabled: game.gamblingEnabled });
});

app.get('/api/gambling-status', (req, res) => {
  res.json({ enabled: game.gamblingEnabled });
});

// Announcement broadcast
app.post('/api/admin/announce', (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) return res.json({ error: 'No message provided' });
  broadcast('announcement', { message, timestamp: Date.now() });
  res.json({ success: true });
});

// ═══════════════════════════════════════════
// WebSocket Server (overlay communication)
// ═══════════════════════════════════════════
const wss = new WebSocket.Server({ server });
const portalClients = new Set(); // track portal WS connections

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

function broadcastToPortal(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const c of portalClients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

// ═══════════════════════════════════════════
// Discord Webhook (events) + Bot (two-way chat)
// ═══════════════════════════════════════════
let discordChatSend = null; // function to send to Discord chat channel (set when bot connects)
let discordBot = null;

async function discordNotify(content) {
  const url = game.getDiscordWebhook();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, username: '⚔️ KickStream MMO', avatar_url: '' }),
    });
  } catch (e) { console.error('Discord webhook error:', e.message); }
}

async function discordEmbed(embed) {
  const url = game.getDiscordWebhook();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '⚔️ KickStream MMO', avatar_url: '', embeds: [embed] }),
    });
  } catch (e) { console.error('Discord webhook error:', e.message); }
}

// Achievement batching — collect achievements for 3 seconds then send once
let achievementBatch = [];
let achievementTimer = null;
function queueAchievement(username, name) {
  achievementBatch.push({ username, name });
  if (achievementTimer) return;
  achievementTimer = setTimeout(() => {
    if (achievementBatch.length > 0) {
      const lines = achievementBatch.map(a => `🏆 **${a.username}** → ${a.name}`);
      discordEmbed({
        title: '🏆 Achievements Unlocked',
        description: lines.join('\n'),
        color: 0xFFD700,
      });
      achievementBatch = [];
    }
    achievementTimer = null;
  }, 3000);
}

// Initialize Discord bot for two-way chat
function initDiscordBot(token, chatChannelId) {
  try {
    const { Client, GatewayIntentBits } = require('discord.js');
    if (discordBot) { discordBot.destroy(); discordBot = null; discordChatSend = null; }
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

    client.once('ready', async () => {
      console.log(`🤖 Discord bot connected as ${client.user.tag}`);
      console.log(`🔍 Looking for chat channel ID: ${chatChannelId}`);
      console.log(`📋 Bot is in ${client.guilds.cache.size} server(s): ${client.guilds.cache.map(g => g.name).join(', ')}`);
      try {
        const channel = await client.channels.fetch(String(chatChannelId), { force: true });
        if (channel) {
          console.log(`✅ Found chat channel: #${channel.name} in ${channel.guild?.name}`);
          discordChatSend = (msg) => channel.send(msg).catch(e => console.error('Discord send error:', e.message));
          discordChatSend('🎮 **KickStream MMO** bot connected! Two-way chat is live 🔥');
        } else {
          console.error('❌ Discord chat channel not found for ID:', chatChannelId);
          console.error('   Right-click the channel in Discord (Developer Mode on) → Copy Channel ID');
        }
      } catch (e) {
        console.error('❌ Failed to fetch Discord chat channel:', e.message);
        console.error('   Channel ID used:', chatChannelId);
        console.error('   Make sure: 1) Bot is in the server  2) Channel ID is correct  3) Bot can view that channel');
      }
    });

    client.on('messageCreate', (msg) => {
      if (msg.author.bot) return;
      if (msg.channel.id !== chatChannelId) return;
      // Bridge Discord message to portal chat
      const displayName = msg.member?.displayName || msg.author.username;
      const chatMsg = game.addChatMessage(displayName, msg.content.slice(0, 300), 'discord');
      broadcastToPortal('chat_message', chatMsg);
    });

    client.login(token).catch(e => {
      console.error('❌ Discord bot login failed:', e.message);
      discordBot = null;
      discordChatSend = null;
    });

    discordBot = client;
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.log('ℹ️  discord.js not installed. Run: npm install discord.js');
      console.log('   Two-way Discord chat disabled. Webhook notifications still work.');
    } else {
      console.error('❌ Discord bot error:', e.message);
    }
  }
}

// ═══════════════════════════════════════════
// Game Engine
// ═══════════════════════════════════════════
const game = new Game((type, data) => {
  broadcast(type, data);
  if (type === 'boss_phase') console.log(`⚠️  ${data.bossName} at ${data.phase}% HP!`);
  if (type === 'wheel_ready') console.log('🎡 Raid Wheel READY — click SPIN on the overlay!');
  // Discord notifications for key events
  if (type === 'boss_spawn') {
    discordEmbed({
      title: `⚔️ ${data.name} has appeared!`,
      description: `**HP:** ${data.hp.toLocaleString()}\n**Type:** ${data.number === 1 ? 'Warm-Up Boss' : '👑 RAID BOSS'}`,
      color: data.number === 1 ? 0x44FF44 : 0xFF4444,
    });
  }
  if (type === 'boss_dead') {
    const top3 = (data.top5 || []).slice(0, 3).map((p, i) => `${['🥇','🥈','🥉'][i]} **${p.username}** — ${p.damage.toLocaleString()} dmg`).join('\n');
    discordEmbed({
      title: `💀 ${data.bossName} Defeated!`,
      description: `**MVP:** ${data.mvp}\n**Attackers:** ${data.totalAttackers}\n\n${top3}`,
      color: 0xFFD700,
      footer: { text: `Prize: $${data.prizeDollars || 0} per winner` },
    });
  }
  if (type === 'sub_kill') {
    discordEmbed({
      title: '🌟 SUBSCRIBER INSTANT KILL!',
      description: `**${data.subscriber}** subscribed and **INSTANTLY KILLED** ${data.bossName}!`,
      color: 0xFF00FF,
    });
  }
  if (type === 'achievement') queueAchievement(data.username, data.name);
  if (type === 'duel_result' && data) {
    discordEmbed({
      title: `⚔️ Arena Duel — ${data.arena?.name || 'Arena'}`,
      description: `**${data.winner}** defeated **${data.loser}**${data.bet > 0 ? ` for **${data.bet}g**` : ''}`,
      fields: [
        { name: 'Rating Change', value: `+${data.ratingChange} / -${data.ratingChange}`, inline: true },
        { name: 'Rounds', value: `${data.rounds?.length || '?'}`, inline: true },
      ],
      color: 0xFF6B6B,
    });
  }
  if (type === 'prestige' && data) {
    discordEmbed({
      title: `🏅 ${data.username} Prestiged!`,
      description: `**Rank:** ${data.prestigeIcon || '⭐'} ${data.prestigeName}\n**Bonus:** +${data.dmgBonus}% permanent damage\n**Reward:** +${data.goldReward}g`,
      color: 0x4ECDC4,
    });
  }
});

// Kick connection state tracker
let kickConnected = false;
let activeChatroomId = null;
let kickWs = null;

// Overlay connections
wss.on('connection', (ws) => {
  console.log('🖥️  Overlay connected');
  ws.send(JSON.stringify({ type: 'state_sync', data: game.getFullState() }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'wheel_spin') game.spinWheel();
      if (msg.type === 'reward_effect' && msg.effect) game.applyRewardEffect(msg.effect);
      if (msg.type === 'start_game') game.resetForNewStream();
      if (msg.type === 'test_command') handleChatMessage({ sender: { slug: msg.username }, content: msg.content });

      // Admin panel messages
      if (msg.type === 'admin_get_players') {
        ws.send(JSON.stringify({ type: 'admin_players', data: { players: game.getPlayers() } }));
      }
      if (msg.type === 'admin_get_config') {
        ws.send(JSON.stringify({ type: 'admin_config', data: { config: game.getConfig() } }));
      }
      if (msg.type === 'admin_get_kick_status') {
        ws.send(JSON.stringify({ type: 'admin_kick_status', data: {
          connected: kickConnected,
          channel: KICK_CHANNEL,
          chatroomId: activeChatroomId,
        }}));
      }
      if (msg.type === 'admin_set_player' && msg.username && msg.data) {
        const result = game.setPlayer(msg.username, msg.data);
        broadcast('admin_player_updated', { username: msg.username });
      }
      if (msg.type === 'admin_update_config' && msg.updates) {
        game.setConfig(msg.updates);
        broadcast('admin_config_updated', { success: true });
      }
      if (msg.type === 'admin_set_chatroom' && msg.id) {
        activeChatroomId = msg.id;
        broadcast('admin_chatroom_set', { id: msg.id });
        // Disconnect existing Kick connection and reconnect
        if (kickWs) { try { kickWs.close(); } catch {} }
        connectToKick(msg.id);
      }

      // Portal chat
      if (msg.type === 'portal_register') {
        ws.isPortal = true;
        ws.portalUser = msg.username || null;
        portalClients.add(ws);
        ws.send(JSON.stringify({ type: 'chat_history', data: game.getChatHistory() }));
      }
      if (msg.type === 'chat_send' && ws.isPortal && ws.portalUser && msg.message) {
        // Validate auth
        if (!msg.token || !game.validateToken(ws.portalUser, msg.token)) {
          ws.send(JSON.stringify({ type: 'chat_error', data: { error: 'Not linked. Click Link Account first.' } }));
          return;
        }
        const text = msg.message.trim().slice(0, 300);
        if (!text) return;
        const chatMsg = game.addChatMessage(ws.portalUser, text, 'portal');
        broadcastToPortal('chat_message', chatMsg);
        // Send to Discord chat channel if bot is connected
        if (discordChatSend) discordChatSend(`� **${ws.portalUser}**: ${text}`);
      }

      // ── RPG WebSocket messages ──
      // Rate limit: max 30 messages per second per client
      if (!ws._msgTimes) ws._msgTimes = [];
      const now_rl = Date.now();
      ws._msgTimes = ws._msgTimes.filter(t => now_rl - t < 1000);
      if (ws._msgTimes.length > 30) return;
      ws._msgTimes.push(now_rl);

      if (msg.type === 'rpg_join' && msg.username && msg.token) {
        const u = msg.username.toLowerCase();
        if (!game.rpgEnabled) {
          ws.send(JSON.stringify({ type: 'rpg_error', data: { error: 'RPG is currently disabled.' } }));
          return;
        }
        if (!game.validateToken(u, msg.token)) {
          ws.send(JSON.stringify({ type: 'rpg_error', data: { error: 'Invalid token. Link your account first.' } }));
          return;
        }
        ws.isRPG = true;
        ws.rpgUser = u;
        const joinData = game.rpgJoin(u);
        if (game.rpgPlayers[u]) game.rpgPlayers[u].ws = ws;
        ws.send(JSON.stringify({ type: 'rpg_joined', data: joinData }));
        game.rpgBroadcastAll({ type: 'rpg_online_count', data: { count: game.rpgGetOnlineCount() } });
      }
      if (msg.type === 'rpg_change_zone' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgChangeZone(ws.rpgUser, msg.zone);
        ws.send(JSON.stringify({ type: 'rpg_zone_changed', data: r }));
      }
      if (msg.type === 'rpg_mine' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgMineHit(ws.rpgUser, msg.nodeId);
        ws.send(JSON.stringify({ type: 'rpg_mine_result', data: r }));
      }
      if (msg.type === 'rpg_attack' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgAttackMob(ws.rpgUser, msg.mobId);
        ws.send(JSON.stringify({ type: 'rpg_attack_result', data: r }));
      }
      if (msg.type === 'rpg_attack_boss' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgAttackBoss(ws.rpgUser, msg.bossId);
        ws.send(JSON.stringify({ type: 'rpg_boss_attack_result', data: r }));
      }
      if (msg.type === 'rpg_buy_pickaxe' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgBuyPickaxe(ws.rpgUser, msg.tier);
        ws.send(JSON.stringify({ type: 'rpg_pickaxe_result', data: r }));
      }
      if (msg.type === 'rpg_move' && ws.isRPG && ws.rpgUser) {
        game.rpgMove(ws.rpgUser, msg.x, msg.y);
      }
      if (msg.type === 'rpg_sit' && ws.isRPG && ws.rpgUser) {
        game.rpgSit(ws.rpgUser, msg.x, msg.y);
      }
      if (msg.type === 'rpg_ghost_defeated' && ws.isRPG && ws.rpgUser) {
        // Server validates ghost is actually dead
        const rp = game.rpgPlayers[ws.rpgUser];
        const w = rp && game.rpgWorld[rp.zone];
        if (w && w.boss && w.boss.dead) {
          const p = game.player(ws.rpgUser);
          p.ghostDefeated = true;
          game.saveData();
          ws.send(JSON.stringify({ type: 'rpg_ghost_defeated_ack', data: { success: true } }));
        }
      }
      if (msg.type === 'rpg_quest_turnin' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgQuestTurnIn(ws.rpgUser, msg.questId);
        ws.send(JSON.stringify({ type: 'rpg_quest_turnin_result', data: r }));
      }
      if (msg.type === 'rpg_duel_queue' && ws.isRPG && ws.rpgUser) {
        let r;
        if (msg.action === 'join') r = game.rpgDuelJoinQueue(ws.rpgUser);
        else if (msg.action === 'leave') r = game.rpgDuelLeaveQueue(ws.rpgUser);
        else r = { error: 'invalid_action' };
        ws.send(JSON.stringify({ type: 'rpg_duel_queue_result', data: r }));
      }
      if (msg.type === 'rpg_duel_action' && ws.isRPG && ws.rpgUser) {
        const r = game.rpgDuelAction(ws.rpgUser, msg.action);
        ws.send(JSON.stringify({ type: 'rpg_duel_action_result', data: r }));
      }
      // ── Equipment & Items ──
      if (msg.type === 'rpg_equip' && ws.isRPG && ws.rpgUser) {
        const r = game.equipItem(ws.rpgUser, msg.uid);
        ws.send(JSON.stringify({ type: 'rpg_equip_result', data: r }));
      }
      if (msg.type === 'rpg_unequip' && ws.isRPG && ws.rpgUser) {
        const r = game.unequipItem(ws.rpgUser, msg.slot);
        ws.send(JSON.stringify({ type: 'rpg_unequip_result', data: r }));
      }
      if (msg.type === 'rpg_use_item' && ws.isRPG && ws.rpgUser) {
        const r = game.useConsumable(ws.rpgUser, msg.itemId);
        ws.send(JSON.stringify({ type: 'rpg_use_item_result', data: r }));
      }
      if (msg.type === 'rpg_repair' && ws.isRPG && ws.rpgUser) {
        const r = game.repairItem(ws.rpgUser, msg.uid);
        ws.send(JSON.stringify({ type: 'rpg_repair_result', data: r }));
      }
      if (msg.type === 'rpg_shop_buy' && ws.isRPG && ws.rpgUser) {
        const r = game.buyFromShop(ws.rpgUser, msg.itemId);
        ws.send(JSON.stringify({ type: 'rpg_shop_buy_result', data: r }));
      }
      if (msg.type === 'rpg_craft' && ws.isRPG && ws.rpgUser) {
        const r = game.craftItem(ws.rpgUser, msg.recipeId);
        ws.send(JSON.stringify({ type: 'rpg_craft_result', data: r }));
      }
      if (msg.type === 'rpg_inventory' && ws.isRPG && ws.rpgUser) {
        const r = game.getInventory(ws.rpgUser);
        ws.send(JSON.stringify({ type: 'rpg_inventory_result', data: r }));
      }
      if (msg.type === 'rpg_market_sell' && ws.isRPG && ws.rpgUser) {
        const r = game.handleSellItem(ws.rpgUser, msg.itemUid, msg.price);
        ws.send(JSON.stringify({ type: 'rpg_market_sell_result', data: r }));
        if (r && !r.error) broadcast('market_listed', r);
      }
      if (msg.type === 'rpg_market_sell_material' && ws.isRPG && ws.rpgUser) {
        const r = game.handleSellMaterial(ws.rpgUser, msg.itemId, msg.qty, msg.price);
        ws.send(JSON.stringify({ type: 'rpg_market_sell_result', data: r }));
        if (r && !r.error) broadcast('market_listed', r);
      }
      if (msg.type === 'rpg_market_buy' && ws.isRPG && ws.rpgUser) {
        const r = game.handleBuyMarket(ws.rpgUser, msg.listingId);
        ws.send(JSON.stringify({ type: 'rpg_market_buy_result', data: r }));
        if (r && !r.error) broadcast('market_purchased', r);
      }
      if (msg.type === 'rpg_market_cancel' && ws.isRPG && ws.rpgUser) {
        const r = game.handleCancelListing(ws.rpgUser, msg.listingId);
        ws.send(JSON.stringify({ type: 'rpg_market_cancel_result', data: r }));
        if (r && !r.error) broadcast('market_cancelled', r);
      }
      // Wearable handlers
      if (msg.type === 'rpg_wearables' && ws.isRPG && ws.rpgUser) {
        const r = game.getWearables(ws.rpgUser);
        ws.send(JSON.stringify({ type: 'rpg_wearables_result', data: r }));
      }
      if (msg.type === 'rpg_equip_wearable' && ws.isRPG && ws.rpgUser) {
        const r = game.handleEquipWearable(ws.rpgUser, msg.key);
        ws.send(JSON.stringify({ type: 'rpg_equip_wearable_result', data: r }));
        if (r && !r.error) {
          const p = game.player(ws.rpgUser);
          game.rpgBroadcastZone('hub', { type: 'rpg_player_wearable_update', data: { username: ws.rpgUser, activeWearables: p.activeWearables } }, ws.rpgUser);
        }
      }
      if (msg.type === 'rpg_unequip_wearable' && ws.isRPG && ws.rpgUser) {
        const r = game.handleUnequipWearable(ws.rpgUser, msg.slot);
        ws.send(JSON.stringify({ type: 'rpg_unequip_wearable_result', data: r }));
        if (r && !r.error) {
          const p = game.player(ws.rpgUser);
          game.rpgBroadcastZone('hub', { type: 'rpg_player_wearable_update', data: { username: ws.rpgUser, activeWearables: p.activeWearables } }, ws.rpgUser);
        }
      }
      if (msg.type === 'rpg_market_sell_wearable' && ws.isRPG && ws.rpgUser) {
        const r = game.handleSellWearable(ws.rpgUser, msg.key, msg.price);
        ws.send(JSON.stringify({ type: 'rpg_market_sell_result', data: r }));
        if (r && !r.error) broadcast('market_listed', r);
      }
      // ── RPG Admin Tools (mikeydamike only) ──
      if (msg.type === 'rpg_admin' && ws.isRPG && ws.rpgUser === 'mikeydamike') {
        let r;
        switch (msg.action) {
          case 'god_mode':       r = game.rpgAdminGodMode(ws.rpgUser); break;
          case 'instant_kill':   r = game.rpgAdminInstantKill(ws.rpgUser, msg.targetId, msg.targetType); break;
          case 'fly':            r = game.rpgAdminFly(ws.rpgUser); break;
          case 'teleport':       r = game.rpgAdminTeleport(ws.rpgUser, msg.zone); break;
          case 'give_gold':      r = game.rpgAdminGiveGold(ws.rpgUser, msg.amount); break;
          case 'give_item':      r = game.rpgAdminGiveItem(ws.rpgUser, msg.itemId, msg.qty); break;
          case 'give_wearable':  r = game.rpgAdminGiveWearable(ws.rpgUser, msg.key); break;
          case 'set_level':      r = game.rpgAdminSetLevel(ws.rpgUser, msg.level); break;
          case 'set_mining':     r = game.rpgAdminSetMiningLevel(ws.rpgUser, msg.level); break;
          case 'heal':           r = game.rpgAdminHeal(ws.rpgUser); break;
          case 'speed':          r = game.rpgAdminSpeed(ws.rpgUser); break;
          case 'spawn_boss':     r = game.rpgAdminSpawnBoss(ws.rpgUser); break;
          case 'kill_all_mobs':  r = game.rpgAdminKillAllMobs(ws.rpgUser); break;
          case 'give_all_wearables': r = game.rpgAdminGiveAllWearables(ws.rpgUser); break;
          case 'give_all_items': r = game.rpgAdminGiveAllItems(ws.rpgUser); break;
          case 'get_game_data':  r = game.rpgAdminGetGameData(); break;
          default: r = { error: 'unknown_action' };
        }
        ws.send(JSON.stringify({ type: 'rpg_admin_result', data: { action: msg.action, ...r } }));
      }
    } catch {}
  });

  ws.on('close', () => {
    portalClients.delete(ws);
    if (ws.isRPG && ws.rpgUser) {
      game.rpgLeave(ws.rpgUser);
      game.rpgBroadcastAll({ type: 'rpg_online_count', data: { count: game.rpgGetOnlineCount() } });
    }
  });
});

// ═══════════════════════════════════════════
// Kick Chat via Pusher WebSocket
// ═══════════════════════════════════════════
async function getChatroomId() {
  if (CHATROOM_ID) return CHATROOM_ID;
  try {
    const resp = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(KICK_CHANNEL)}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.chatroom?.id;
  } catch (e) {
    console.error(`Failed to fetch chatroom ID: ${e.message}`);
    return null;
  }
}

function connectToKick(chatroomId) {
  const url = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false';
  kickWs = new WebSocket(url);

  kickWs.on('open', () => { console.log('📡 Connected to Kick Pusher'); kickConnected = true; });

  kickWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'pusher:connection_established') {
        kickWs.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `chatrooms.${chatroomId}.v2` } }));
        kickWs.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `channel.${chatroomId}` } }));
        console.log(`📡 Subscribed to chatroom ${chatroomId} + channel events`);
      }
      if (msg.event === 'App\\Events\\ChatMessageEvent') {
        handleChatMessage(JSON.parse(msg.data));
      }
      // Sub = instant boss kill
      if (msg.event === 'App\\Events\\SubscriptionEvent' || msg.event === 'App\\Events\\ChannelSubscriptionEvent') {
        try {
          const subData = JSON.parse(msg.data);
          const subName = subData.username || subData.user?.username || 'Anonymous';
          console.log(`🌟 SUBSCRIPTION: ${subName}`);
          game.handleSubKill(subName);
        } catch {}
      }
    } catch {}
  });

  kickWs.on('close', () => { kickConnected = false; console.log('📡 Kick disconnected, reconnecting in 5s...'); setTimeout(() => connectToKick(chatroomId), 5000); });
  kickWs.on('error', (err) => { kickConnected = false; console.error('Kick WS error:', err.message); });

  // Pusher keepalive
  const ping = setInterval(() => { if (kickWs.readyState === WebSocket.OPEN) kickWs.send(JSON.stringify({ event: 'pusher:ping', data: {} })); }, 30000);
  kickWs.on('close', () => clearInterval(ping));
}

// ═══════════════════════════════════════════
// Anti-Bot / Rate Limiting
// ═══════════════════════════════════════════
const commandRateLimit = {};  // { username: [timestamp, timestamp, ...] }
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 6;        // max 6 commands per 10s

function isRateLimited(username) {
  const now = Date.now();
  if (!commandRateLimit[username]) commandRateLimit[username] = [];
  // Remove old timestamps
  commandRateLimit[username] = commandRateLimit[username].filter(t => now - t < RATE_LIMIT_WINDOW);
  if (commandRateLimit[username].length >= RATE_LIMIT_MAX) return true;
  commandRateLimit[username].push(now);
  return false;
}

// Clean up rate limit map every 60s to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const user of Object.keys(commandRateLimit)) {
    commandRateLimit[user] = commandRateLimit[user].filter(t => now - t < RATE_LIMIT_WINDOW);
    if (commandRateLimit[user].length === 0) delete commandRateLimit[user];
  }
}, 60000);

// ═══════════════════════════════════════════
// Chat Command Handler
// ═══════════════════════════════════════════
function handleChatMessage(data) {
  const username = data.sender?.slug || data.sender?.username;
  const content = (data.content || '').trim().toLowerCase();
  if (!username || !content.startsWith('!')) return;

  // Rate limit check (anti-bot)
  if (isRateLimited(username)) return;

  const cmd = content.split(' ')[0];

  switch (cmd) {
    case '!attack': game.handleAttack(username); break;
    case '!stats': {
      const r = game.handleStats(username);
      if (r && !r.error) broadcast('stats_response', r);
      break;
    }
    case '!daily': {
      const r = game.handleDaily(username);
      if (r && !r.error) broadcast('daily_claimed', r);
      break;
    }
    case '!boss': {
      const r = game.handleBossInfo(username);
      if (r && !r.error) broadcast('boss_info', r);
      break;
    }
    case '!lb': broadcast('leaderboard', game.handleLeaderboard()); break;
    case '!gamble': {
      const amt = content.split(' ')[1];
      const r = game.handleGamble(username, amt);
      if (r && !r.error) broadcast('gamble_result', r);
      else if (r && r.error === 'broke') broadcast('gamble_result', { username, error: 'broke', gold: r.gold });
      break;
    }
    case '!gift': {
      const parts2 = content.split(' ');
      if (parts2.length >= 3) {
        const r = game.handleGift(username, parts2[1], parts2[2]);
        if (r && !r.error) broadcast('gift_sent', r);
      }
      break;
    }
    case '!help':
    case '!thegame': {
      const r = game.handleTheGame(username);
      if (r && !r.error) broadcast('rules_display', r);
      break;
    }
    case '!shop': {
      const r = game.handleShop(username);
      if (r) broadcast('shop_list', r);
      break;
    }
    case '!buy': {
      const itemKey = content.split(' ')[1];
      const r = game.handleBuy(username, itemKey);
      if (r && !r.error) broadcast('shop_purchase', r);
      else if (r) broadcast('shop_error', { username, ...r });
      break;
    }
    // ── Boss dodge ──
    case '!dodge': {
      const r = game.handleDodge(username);
      if (r) broadcast('dodge_success', r);
      break;
    }
    // ── Inventory / Equipment ──
    case '!inv':
    case '!inventory': {
      const r = game.handleInventory(username);
      broadcast('inventory_list', r);
      break;
    }
    case '!equip': {
      const uid = content.split(' ').slice(1).join(' ');
      const r = game.handleEquip(username, uid);
      if (r && !r.error) broadcast('item_equipped', r);
      else if (r) broadcast('equip_error', { username, ...r });
      break;
    }
    case '!unequip': {
      const slot = content.split(' ')[1];
      const r = game.handleUnequip(username, slot);
      if (r && !r.error) broadcast('item_unequipped', r);
      else if (r) broadcast('unequip_error', { username, ...r });
      break;
    }
    // ── Cosmetics ──
    case '!cosmetics': {
      const r = game.handleCosmeticShop(username);
      broadcast('cosmetic_shop', r);
      break;
    }
    case '!buycosmetic': {
      const key = content.split(' ')[1];
      const r = game.handleBuyCosmetic(username, key);
      if (r && !r.error) broadcast('cosmetic_purchased', r);
      else if (r) broadcast('cosmetic_error', { username, ...r });
      break;
    }
    case '!equipcosmetic': {
      const key = content.split(' ')[1];
      const r = game.handleEquipCosmetic(username, key);
      if (r && !r.error) broadcast('cosmetic_equipped', r);
      break;
    }
    // ── Market / Trading ──
    case '!market': {
      const r = game.handleMarket(username);
      broadcast('market_list', r);
      break;
    }
    case '!sell': {
      const parts = content.split(' ');
      const uid = parts[1]; const price = parts[2];
      const r = game.handleSellItem(username, uid, price);
      if (r && !r.error) broadcast('market_listed', r);
      else if (r) broadcast('market_error', { username, ...r });
      break;
    }
    case '!sellcosmetic': {
      const parts = content.split(' ');
      const key = parts[1]; const price = parts[2];
      const r = game.handleSellCosmetic(username, key, price);
      if (r && !r.error) broadcast('market_listed', r);
      else if (r) broadcast('market_error', { username, ...r });
      break;
    }
    case '!sellmat': {
      const parts = content.split(' ');
      const itemId = parts[1]; const qty = parts[2]; const price = parts[3];
      const r = game.handleSellMaterial(username, itemId, qty, price);
      if (r && !r.error) broadcast('market_listed', r);
      else if (r) broadcast('market_error', { username, ...r });
      break;
    }
    case '!buymarket': {
      const lid = content.split(' ')[1];
      const r = game.handleBuyMarket(username, lid);
      if (r && !r.error) broadcast('market_purchased', r);
      else if (r) broadcast('market_error', { username, ...r });
      break;
    }
    case '!cancel': {
      const lid = content.split(' ')[1];
      const r = game.handleCancelListing(username, lid);
      if (r && !r.error) broadcast('market_cancelled', r);
      break;
    }
    // ── Achievements / Cash ──
    case '!achievements':
    case '!ach': {
      const r = game.handleAchievementList(username);
      broadcast('achievement_list', r);
      break;
    }
    case '!cash': {
      const r = game.handleCashBalance(username);
      broadcast('cash_balance', r);
      break;
    }
    case '!vendorsell': {
      broadcast('vendor_error', { username, error: 'disabled', message: 'NPC selling is disabled. Use the Market to trade with other players!' });
      break;
    }
    // ── Admin commands (streamer only) ──
    case '!kill': case '!spawn1': case '!spawn2': case '!wheel': case '!skip': case '!reset':
    case '!bossattack': {
      const r = game.handleAdmin(username, cmd);
      if (r && r.success) console.log(`🔧 Admin ${cmd} by ${username}`);
      break;
    }
    case '!sethp': {
      const val = content.split(' ')[1];
      if (val) game.handleSetHP(username, val);
      break;
    }
    // ── Player Portal Link ──
    case '!link': {
      const code = content.split(' ')[1] || '';
      const result = game.handleLink(username, code);
      if (result.error) {
        console.log(`\u274c ${username} link failed: ${result.message}`);
        break;
      }
      // If there's a pending link request from the portal, resolve it
      const pending = pendingLinks.get(username);
      if (pending) {
        pending.resolve(result.token);
        clearTimeout(pending.timer);
        pendingLinks.delete(username);
      }
      console.log(`🔗 ${username} linked their account`);
      break;
    }
  }
}

// ═══════════════════════════════════════════
// Start
// ═══════════════════════════════════════════
async function start() {
  server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  ⚔️  KICKSTREAM MMO SERVER  ⚔️');
    console.log('========================================');
    console.log(`  Overlay:  http://localhost:${PORT}`);
    console.log(`  Admin:    http://localhost:${PORT}/admin`);
    console.log(`  Portal:   http://localhost:${PORT}/play`);
    console.log(`  Channel:  ${KICK_CHANNEL}`);
    console.log('========================================');
    console.log('');
  });

  const id = await getChatroomId();
  if (id) {
    activeChatroomId = id;
    console.log(`Chatroom ID: ${id}`);
    connectToKick(id);
  } else {
    console.error('');
    console.error('⚠️  Could not auto-detect chatroom ID!');
    console.error('   Option 1: Open your browser → https://kick.com/api/v2/channels/' + KICK_CHANNEL);
    console.error('   Find chatroom.id in the JSON, then set CHATROOM_ID in server.js');
    console.error('   Option 2: Go to http://localhost:' + PORT + '/admin and enter the ID there');
    console.error('   Option 3: Use the test panel on the overlay to test without Kick chat');
    console.error('');
  }
  // Auto-connect Discord bot if configured
  if (game.discordBotConfig && game.discordBotConfig.botToken) {
    console.log('🤖 Connecting Discord bot...');
    initDiscordBot(game.discordBotConfig.botToken, game.discordBotConfig.chatChannelId);
  }
}

start();
process.on('SIGINT', () => { if (discordBot) discordBot.destroy(); game.shutdown(); process.exit(); });
