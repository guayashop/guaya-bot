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
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
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

// Enregistrement de la commande /close au démarrage
client.once('ready', async () => {
  console.log(`Bot Guaya Shop connecté : ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Ferme la vente en cours, poste le récapitulatif et supprime le ticket')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('Slash command /close enregistrée sur le serveur.');
  } catch (err) {
    console.error('Erreur enregistrement commande /close :', err);
  }
});

// --- GESTION DES COMMANDES (INTERACTIONS) ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'close') {
    // Évite l'erreur "L'application ne répond plus"
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;

    // Vérifie qu'on est bien dans un salon ticket
    if (!channel.name.startsWith('cmd-')) {
      return interaction.editReply({
        content: 'Cette commande ne peut être utilisée que dans un salon ticket (`cmd-xxxx`).'
      });
    }

    try {
      // Récupération du premier message contenant l'embed de commande
      const messages = await channel.messages.fetch({ limit: 50 });
      const orderMessage = messages.reverse().find(msg => msg.embeds.length > 0);

      let item = 'Non spécifié';
      let orderId = channel.name.replace('cmd-', '');
      let clientMention = 'Inconnu';
      let price = '0 €';
      let paymentMethod = 'Inconnu';

      if (orderMessage && orderMessage.embeds[0]) {
        const embed = orderMessage.embeds[0];
        if (embed.title) item = embed.title.replace('🛒 Nouvelle commande : ', '');
        embed.fields.forEach(field => {
          if (field.name === 'Commande') orderId = field.value;
          if (field.name === 'Client Discord') clientMention = field.value;
          if (field.name === 'Montant') price = field.value;
          if (field.name === 'Paiement') paymentMethod = field.value;
        });
      }

      // Envoi du récapitulatif dans le salon d'annonces
      const salonAnnonces = client.channels.cache.get(SALON_ANNONCES_ID);
      if (salonAnnonces && salonAnnonces.isTextBased()) {
        const recapEmbed = new EmbedBuilder()
          .setTitle(`✅ Vente finalisée : ${item}`)
          .setColor('#10b981')
          .addFields(
            { name: 'Commande', value: `${orderId}`, inline: true },
            { name: 'Client', value: `${clientMention}`, inline: true },
            { name: 'Montant', value: `${price}`, inline: true },
            { name: 'Méthode', value: `${paymentMethod}`, inline: true },
            { name: 'Validé par', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        await salonAnnonces.send({ embeds: [recapEmbed] });
      }

      await interaction.editReply({
        content: 'Vente clôturée et postée dans les annonces. Suppression du ticket dans 3 secondes...'
      });

      // Suppression du ticket
      setTimeout(async () => {
        await channel.delete().catch(err => console.error('Erreur suppression salon :', err));
      }, 3000);

    } catch (err) {
      console.error('Erreur /close :', err);
      await interaction.editReply({
        content: `Erreur lors de la fermeture : ${err.message}`
      });
    }
  }
});

// --- ROUTES EXPRESS API ---
app.get('/', (req, res) => {
  res.send('API Guaya Bot active !');
});

// Endpoint OAuth Discord avec ajout automatique au serveur
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

    // AJOUT DU MEMBRE SUR LE SERVEUR
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (guild) {
        await guild.members.add(userData.id, {
          accessToken: tokenData.access_token
        });
        console.log(`Utilisateur ${userData.username} (${userData.id}) ajouté ou déjà présent sur le serveur.`);
      }
    } catch (joinErr) {
      console.warn("Impossible d'ajouter automatiquement le membre au serveur :", joinErr.message);
    }

    // Redirection vers ton site Vercel
    res.redirect(`https://guaya-shop.vercel.app/?discord_id=${userData.id}&discord_name=${encodeURIComponent(userData.username)}`);
  } catch (err) {
    console.error('Erreur OAuth Discord :', err);
    res.status(500).send('Échec connexion Discord');
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
    
    // 1. Création simple du salon
    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText
    };

    if (CATEGORY_TICKETS_ID) {
      channelOptions.parent = CATEGORY_TICKETS_ID;
    }

    const ticketChannel = await guild.channels.create(channelOptions);

    // 2. Attribution des permissions après création
    try {
      await ticketChannel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false
      });

      await ticketChannel.permissionOverwrites.edit(client.user.id, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true
      });

      if (discordId) {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (member) {
          await ticketChannel.permissionOverwrites.edit(member, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        }
      }
    } catch (permErr) {
      console.warn("Avertissement perms :", permErr.message);
    }

    // 3. Message de récapitulatif
    const embed = new EmbedBuilder()
      .setTitle(`🛒 Nouvelle commande : ${item}`)
      .setColor('#d97706')
      .addFields(
        { name: 'Commande', value: `#${orderId}`, inline: true },
        { name: 'Client Discord', value: discordId ? `<@${discordId}>` : 'Non relié', inline: true },
        { name: 'E-mail', value: `${email}`, inline: true },
        { name: 'Montant', value: `${price} €`, inline: true },
        { name: 'Paiement', value: `${paymentMethod}`, inline: true }
      )
      .setTimestamp();

    await ticketChannel.send({ 
      content: discordId ? `<@${discordId}> Bienvenue sur votre ticket de commande !` : undefined, 
      embeds: [embed] 
    });

    // 4. Envoi de l'e-mail Resend
    if (email && email.includes('@') && email !== 'Non spécifié') {
      try {
        await resend.emails.send({
          from: 'Guaya Shop <onboarding@resend.dev>',
          to: email,
          subject: `Confirmation de commande #${orderId} - ${item}`,
          html: `<p>Votre commande pour <strong>${item}</strong> (${price} €) est validée. Un salon ticket a été créé sur notre Discord !</p>`
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

app.post('/api/order', handleTicketCreation);
app.post('/api/create-ticket', handleTicketCreation);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Bot en ligne sur le port ${PORT}`);
});

client.login(TOKEN);
