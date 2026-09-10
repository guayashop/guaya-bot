const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const { Resend } = require('resend');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://guaya-bot.onrender.com/api/auth/discord/callback';

const GUILD_ID = '1546527956959105126';
const SALON_ANNONCES_ID = '1546527958695411758';
const CATEGORY_TICKETS_ID = '1547371253588037694';

// Configuration Resend
const resend = new Resend('re_BxDtdXmG_D2mrdLZmcE66JAH2GfmQJhuY');
const ADMIN_EMAIL = 'lemonsellings@gmail.com';
const BOT_API_URL = 'https://guaya-bot.onrender.com';

const STOCK_FILE = path.join(__dirname, 'stock.json');
const TECHS_FILE = path.join(__dirname, 'techs.json');

// --- CLIENT DISCORD ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`Bot Guaya Shop connecté : ${client.user.tag}`);
});

// --- ROUTES EXPRESS API ---
app.get('/', (req, res) => {
  res.send('API Guaya Bot active !');
});

// Endpoint OAuth Discord
app.get('/api/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Code manquant');

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Erreur token');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();

    // Redirection directe vers le site Vercel avec l'ID et le pseudo
    res.redirect(`https://guaya-shop.vercel.app/?discord_id=${userData.id}&discord_name=${encodeURIComponent(userData.username)}`);
  } catch (err) {
    console.error('Erreur OAuth Discord :', err);
    res.status(500).send('Échec de la connexion Discord');
  }
});

// Fonction universelle pour créer le ticket
async function handleTicketCreation(req, res) {
  console.log("-> Requête de commande reçue :", req.body);
  try {
    const data = req.body;
    const email = data.email || data.user_email || 'Non spécifié';
    const item = data.item || data.product || data.name || 'Produit';
    const price = data.price || data.amount || '0';
    const paymentMethod = data.paymentMethod || data.method || 'Inconnu';
    const orderId = data.orderId || data.id || Date.now().toString().slice(-4);
    const discordId = data.discordId || data.discord_id || null;

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error("Serveur introuvable ID:", GUILD_ID);
      return res.status(500).json({ error: 'Serveur Discord introuvable' });
    }

    const channelName = `cmd-${orderId}`;
    
    // Permissions : salon privé (@everyone masqué, bot et client autorisés)
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles
        ]
      }
    ];

    if (discordId) {
      permissionOverwrites.push({
        id: discordId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites
    };

    if (CATEGORY_TICKETS_ID) {
      channelOptions.parent = CATEGORY_TICKETS_ID;
    }

    const ticketChannel = await guild.channels.create(channelOptions);

    const embed = new EmbedBuilder()
      .setTitle(`🛒 Nouvelle commande : ${item}`)
      .setColor('#d97706')
      .addFields(
        { name: 'Commande', value: `#${orderId}`, inline: true },
        { name: 'Client Discord', value: discordId ? `<@${discordId}>` : 'Non relié', inline: true },
        { name: 'E-mail', value: `${email}`, inline: true },
        { name: 'Montant total', value: `${price} €`, inline: true },
        { name: 'Moyen de paiement', value: `${paymentMethod}`, inline: true }
      )
      .setTimestamp();

    await ticketChannel.send({ 
      content: discordId ? `<@${discordId}> Bienvenue sur votre ticket de commande !` : undefined, 
      embeds: [embed] 
    });

    if (email && email.includes('@') && email !== 'Non spécifié') {
      try {
        await resend.emails.send({
          from: 'Guaya Shop <onboarding@resend.dev>',
          to: email,
          subject: `Confirmation de commande #${orderId} - ${item}`,
          html: `<p>Votre commande pour <strong>${item}</strong> (${price} €) est validée.</p><p>Votre salon ticket <strong>#${channelName}</strong> est ouvert sur notre serveur Discord pour finaliser la livraison.</p>`
        });
      } catch (mailErr) {
        console.warn("Erreur Resend :", mailErr.message);
      }
    }

    console.log(`Ticket créé avec succès : #${channelName}`);
    return res.json({ success: true, channelId: ticketChannel.id });
  } catch (err) {
    console.error('Erreur création ticket :', err);
    return res.status(500).json({ error: err.message });
  }
}

// Support des deux routes pour le frontend
app.post('/api/order', handleTicketCreation);
app.post('/api/create-ticket', handleTicketCreation);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Bot en ligne sur le port ${PORT}`);
});

client.login(TOKEN);
