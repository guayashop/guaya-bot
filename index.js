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

// Endpoint pour échanger le code OAuth Discord contre le profil utilisateur
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
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Erreur échange token');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();

    // Redirige vers le site Netlify avec les infos en paramètres d'URL
    res.redirect(`https://guayashop.netlify.app/?discord_id=${userData.id}&discord_name=${encodeURIComponent(userData.username)}`);
  } catch (err) {
    console.error('Erreur OAuth Discord :', err);
    res.status(500).send('Échec de la connexion Discord');
  }
});

// Route d'achat / ticket
app.post('/api/order', async (req, res) => {
  try {
    const { email, item, price, paymentMethod, orderId, discordId } = req.body;
    const guild = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      return res.status(500).json({ error: 'Serveur Discord introuvable' });
    }

    const channelName = `commande-${orderId || Date.now().toString().slice(-4)}`;
    
    // Permissions : visible par le bot, les admins, et le client Discord s'il est connecté
    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      }
    ];

    if (discordId) {
      permissionOverwrites.push({
        id: discordId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      });
    }

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: CATEGORY_TICKETS_ID,
      permissionOverwrites
    });

    const embed = new EmbedBuilder()
      .setTitle(`🛒 Nouvelle commande : ${item}`)
      .setColor('#5865F2')
      .addFields(
        { name: 'Client', value: email || 'Non spécifié', inline: true },
        { name: 'Discord ID', value: discordId ? `<@${discordId}>` : 'Non relié', inline: true },
        { name: 'Montant', value: `${price} €`, inline: true },
        { name: 'Moyen de paiement', value: paymentMethod || 'Inconnu', inline: true }
      )
      .setTimestamp();

    await ticketChannel.send({ embeds: [embed] });

    if (email) {
      await resend.emails.send({
        from: 'Guaya Shop <onboarding@resend.dev>',
        to: email,
        subject: `Confirmation de commande - ${item}`,
        html: `<p>Bonjour,</p><p>Votre commande pour <strong>${item}</strong> (${price} €) a bien été prise en compte !</p><p>Rejoignez notre Discord pour récupérer votre produit via votre ticket.</p>`
      });
    }

    res.json({ success: true, channelId: ticketChannel.id });
  } catch (err) {
    console.error('Erreur commande :', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Bot en ligne sur le port ${PORT}`);
});

client.login(TOKEN);
