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

// Route d'achat / ticket
app.post('/api/order', async (req, res) => {
  try {
    const { email, item, price, paymentMethod, orderId } = req.body;
    const guild = client.guilds.cache.get(GUILD_ID);

    if (!guild) {
      return res.status(500).json({ error: 'Serveur Discord introuvable' });
    }

    // Création du salon ticket
    const channelName = `commande-${orderId || Date.now().toString().slice(-4)}`;
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: CATEGORY_TICKETS_ID,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        }
      ]
    });

    const embed = new EmbedBuilder()
      .setTitle(`🛒 Nouvelle commande : ${item}`)
      .setColor('#5865F2')
      .addFields(
        { name: 'Client', value: email || 'Non spécifié', inline: true },
        { name: 'Montant', value: `${price} €`, inline: true },
        { name: 'Moyen de paiement', value: paymentMethod || 'Inconnu', inline: true }
      )
      .setTimestamp();

    await ticketChannel.send({ embeds: [embed] });

    // Envoi de l'e-mail via Resend
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

// Connexion du bot avec la variable d'environnement
client.login(TOKEN);
