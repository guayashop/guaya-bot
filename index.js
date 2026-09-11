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

// --- SYSTÈME DE LIMITE DE TEMPS (COOLDOWN) ---
const TICKET_COOLDOWN_MS = 60 * 1000;
const lastTicketCreation = new Map();

// Helper pour lire techs.json
function getTechsData() {
  try {
    if (fs.existsSync(TECHS_FILE)) {
      const raw = fs.readFileSync(TECHS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Erreur lecture techs.json :', err);
  }
  return {};
}

// Helper pour extraire les données du ticket
async function getTicketInfo(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  const orderMessage = messages.reverse().find(msg => msg.embeds.length > 0);

  let item = 'Produit';
  let orderId = channel.name.replace('cmd-', '');
  let clientMention = 'Non relié';
  let clientDiscordId = null;
  let price = '0 €';
  let paymentMethod = 'Inconnu';

  if (orderMessage && orderMessage.embeds[0]) {
    const embed = orderMessage.embeds[0];
    if (embed.title) item = embed.title.replace('🛒 Nouvelle commande : ', '');
    embed.fields.forEach(field => {
      if (field.name === 'Commande') orderId = field.value;
      if (field.name === 'Client Discord') {
        clientMention = field.value;
        const match = clientMention.match(/<@(\d+)>/);
        if (match) clientDiscordId = match[1];
      }
      if (field.name === 'Montant') price = field.value;
      if (field.name === 'Paiement') paymentMethod = field.value;
    });
  }

  return { item, orderId, clientMention, clientDiscordId, price, paymentMethod };
}

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

client.once('ready', async () => {
  console.log(`Bot Guaya Shop connecté : ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Ferme la vente manuellement sans formulaire et supprime le ticket')
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

// --- GESTION DES INTERACTIONS ---
client.on('interactionCreate', async (interaction) => {
  // 1. Bouton de validation & livraison
  if (interaction.isButton() && interaction.customId === 'validate_and_deliver') {
    const channel = interaction.channel;
    const ticketInfo = await getTicketInfo(channel);
    const techs = getTechsData();

    const cleanItemName = ticketInfo.item.toLowerCase().replace(/[^a-z0-9]/g, '');
const matchedKey = Object.keys(techs).find(k => {
  const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanItemName.includes(cleanKey) || cleanKey.includes(cleanItemName);
});

    // CAS A : Méthode présente dans techs.json
    if (matchedKey) {
      await interaction.deferReply({ ephemeral: true });
      const techContent = techs[matchedKey];

      const techEmbed = new EmbedBuilder()
        .setTitle(`📖 Ta méthode : ${ticketInfo.item}`)
        .setColor('#10b981')
        .setDescription(typeof techContent === 'string' ? techContent : JSON.stringify(techContent, null, 2))
        .setFooter({ text: 'Merci pour ton achat chez Guaya Shop !' })
        .setTimestamp();

      let dmSent = false;
      if (ticketInfo.clientDiscordId) {
        try {
          const member = await interaction.guild.members.fetch(ticketInfo.clientDiscordId);
          if (member) {
            await member.send({
              content: `Ta commande **#${ticketInfo.orderId}** est validée ! Voici ta tech :`,
              embeds: [techEmbed]
            });
            dmSent = true;
          }
        } catch (e) {
          console.warn('MP fermé ou impossible :', e.message);
        }
      }

      await channel.send({
        content: ticketInfo.clientMention !== 'Non relié' ? `${ticketInfo.clientMention} Ta tech est prête !` : undefined,
        embeds: [techEmbed]
      });

      const salonAnnonces = client.channels.cache.get(SALON_ANNONCES_ID);
      if (salonAnnonces && salonAnnonces.isTextBased()) {
        const recapEmbed = new EmbedBuilder()
          .setTitle(`✅ Vente finalisée : ${ticketInfo.item}`)
          .setColor('#10b981')
          .addFields(
            { name: 'Commande', value: `${ticketInfo.orderId}`, inline: true },
            { name: 'Client', value: `${ticketInfo.clientMention}`, inline: true },
            { name: 'Montant', value: `${ticketInfo.price}`, inline: true },
            { name: 'Méthode', value: `${ticketInfo.paymentMethod}`, inline: true },
            { name: 'Validé par', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        await salonAnnonces.send({ embeds: [recapEmbed] });
      }

      await interaction.editReply({
        content: `Tech envoyée automatiquement depuis techs.json ! (MP : ${dmSent ? 'envoyé' : 'fermé/échoué'}). Suppression du ticket dans 5 secondes...`
      });

      setTimeout(async () => {
        await channel.delete().catch(err => console.error('Erreur suppression salon :', err));
      }, 5000);

      return;
    }

    // CAS B : Compte à remplir manuellement
    const modal = new ModalBuilder()
      .setCustomId('deliver_modal')
      .setTitle('Livraison des accès');

    const usernameInput = new TextInputBuilder()
      .setCustomId('account_user')
      .setLabel('Identifiant / E-mail du compte')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ex: client@gmail.com')
      .setRequired(true);

    const passwordInput = new TextInputBuilder()
      .setCustomId('account_pass')
      .setLabel('Mot de passe / Clé d’accès')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ex: MotDePasse123')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(usernameInput),
      new ActionRowBuilder().addComponents(passwordInput)
    );

    return await interaction.showModal(modal);
  }

  // 2. Soumission du modal pour identifiants manuels
  if (interaction.isModalSubmit() && interaction.customId === 'deliver_modal') {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const accountUser = interaction.fields.getTextInputValue('account_user');
    const accountPass = interaction.fields.getTextInputValue('account_pass');

    try {
      const ticketInfo = await getTicketInfo(channel);

      const credsEmbed = new EmbedBuilder()
        .setTitle(`🔑 Tes identifiants pour : ${ticketInfo.item}`)
        .setColor('#10b981')
        .addFields(
          { name: 'Identifiant / E-mail', value: `\`\`\`${accountUser}\`\`\``, inline: false },
          { name: 'Mot de passe / Clé', value: `\`\`\`${accountPass}\`\`\``, inline: false }
        )
        .setFooter({ text: 'Merci pour ton achat chez Guaya Shop !' })
        .setTimestamp();

      let dmSent = false;
      if (ticketInfo.clientDiscordId) {
        try {
          const targetMember = await interaction.guild.members.fetch(ticketInfo.clientDiscordId);
          if (targetMember) {
            await targetMember.send({
              content: `Ta commande **#${ticketInfo.orderId}** a été validée ! Voici tes accès :`,
              embeds: [credsEmbed]
            });
            dmSent = true;
          }
        } catch (dmErr) {
          console.warn('Impossible d’envoyer le MP :', dmErr.message);
        }
      }

      await channel.send({
        content: ticketInfo.clientMention !== 'Non relié' ? `${ticketInfo.clientMention} Votre commande a été validée !` : undefined,
        embeds: [credsEmbed]
      });

      const salonAnnonces = client.channels.cache.get(SALON_ANNONCES_ID);
      if (salonAnnonces && salonAnnonces.isTextBased()) {
        const recapEmbed = new EmbedBuilder()
          .setTitle(`✅ Vente finalisée : ${ticketInfo.item}`)
          .setColor('#10b981')
          .addFields(
            { name: 'Commande', value: `${ticketInfo.orderId}`, inline: true },
            { name: 'Client', value: `${ticketInfo.clientMention}`, inline: true },
            { name: 'Montant', value: `${ticketInfo.price}`, inline: true },
            { name: 'Méthode', value: `${ticketInfo.paymentMethod}`, inline: true },
            { name: 'Validé par', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        await salonAnnonces.send({ embeds: [recapEmbed] });
      }

      await interaction.editReply({
        content: `Commande livrée avec succès ! (MP : ${dmSent ? 'envoyé' : 'fermé/échoué'}). Suppression du ticket dans 5 secondes...`
      });

      setTimeout(async () => {
        await channel.delete().catch(err => console.error('Erreur suppression salon :', err));
      }, 5000);

    } catch (err) {
      console.error('Erreur livraison modal :', err);
      await interaction.editReply({ content: `Erreur : ${err.message}` });
    }
  }

  // 3. Commande /close
  if (interaction.isChatInputCommand() && interaction.commandName === 'close') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;

    if (!channel.name.startsWith('cmd-')) {
      return interaction.editReply({
        content: 'Cette commande ne peut être utilisée que dans un salon ticket (`cmd-xxxx`).'
      });
    }

    try {
      const ticketInfo = await getTicketInfo(channel);

      const salonAnnonces = client.channels.cache.get(SALON_ANNONCES_ID);
      if (salonAnnonces && salonAnnonces.isTextBased()) {
        const recapEmbed = new EmbedBuilder()
          .setTitle(`✅ Vente clôturée : ${ticketInfo.item}`)
          .setColor('#10b981')
          .addFields(
            { name: 'Commande', value: `${ticketInfo.orderId}`, inline: true },
            { name: 'Client', value: `${ticketInfo.clientMention}`, inline: true },
            { name: 'Montant', value: `${ticketInfo.price}`, inline: true },
            { name: 'Méthode', value: `${ticketInfo.paymentMethod}`, inline: true },
            { name: 'Validé par', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();

        await salonAnnonces.send({ embeds: [recapEmbed] });
      }

      await interaction.editReply({
        content: 'Ticket clôturé manuellement. Suppression dans 3 secondes...'
      });

      setTimeout(async () => {
        await channel.delete().catch(err => console.error('Erreur suppression salon :', err));
      }, 3000);

    } catch (err) {
      console.error('Erreur /close :', err);
      await interaction.editReply({ content: `Erreur : ${err.message}` });
    }
  }
});

// --- ROUTES EXPRESS API ---
app.get('/', (req, res) => {
  res.send('API Guaya Bot active !');
});

// OAuth Callback Discord
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

    res.redirect(`https://guaya-shop.vercel.app/?discord_id=${userData.id}&discord_name=${encodeURIComponent(userData.username)}`);
  } catch (err) {
    console.error('Erreur OAuth Discord :', err);
    res.status(500).send('Échec connexion Discord');
  }
});

// Création de ticket avec limite de temps et rejet des tests factices
async function handleTicketCreation(req, res) {
  try {
    const data = req.body || {};
    const discordId = data.discordId || data.discord_id || null;
    const orderId = data.orderId || data.id || Date.now().toString().slice(-4);

    // 1. Rejet automatique des fausses données de test
    if (orderId === '9999' || orderId === 'G-9999' || discordId === '123456789012345678') {
      console.warn('Requête de test factice bloquée.');
      return res.status(400).json({ error: 'Fausse commande rejetée.' });
    }

    // 2. Cooldown de 60 secondes
    const clientIdentifier = discordId || req.ip || req.headers['x-forwarded-for'] || 'default';
    const now = Date.now();
    const lastTime = lastTicketCreation.get(clientIdentifier) || 0;

    if (now - lastTime < TICKET_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((TICKET_COOLDOWN_MS - (now - lastTime)) / 1000);
      console.warn(`Cooldown actif pour ${clientIdentifier}. Reste ${remainingSeconds}s.`);
      return res.status(429).json({ 
        error: `Merci de patienter ${remainingSeconds}s avant d'ouvrir un autre ticket.` 
      });
    }

    lastTicketCreation.set(clientIdentifier, now);

    const email = data.email || data.user_email || 'Non spécifié';
    const item = data.item || data.product || data.name || 'Produit';
    const price = data.price || data.amount || '0';
    const paymentMethod = data.paymentMethod || data.method || 'Inconnu';

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error('Serveur introuvable ID:', GUILD_ID);
      return res.status(500).json({ error: 'Serveur Discord introuvable' });
    }

    const channelName = `cmd-${orderId}`;
    
    const channelOptions = {
      name: channelName,
      type: ChannelType.GuildText
    };

    if (CATEGORY_TICKETS_ID) {
      channelOptions.parent = CATEGORY_TICKETS_ID;
    }

    const ticketChannel = await guild.channels.create(channelOptions);

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
      console.warn('Avertissement perms :', permErr.message);
    }

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('validate_and_deliver')
        .setLabel('✅ Valider le paiement & Livrer')
        .setStyle(ButtonStyle.Success)
    );

    await ticketChannel.send({ 
      content: discordId ? `<@${discordId}> Bienvenue sur votre ticket de commande !` : undefined, 
      embeds: [embed],
      components: [row]
    });

    if (email && email.includes('@') && email !== 'Non spécifié') {
      try {
        await resend.emails.send({
          from: 'Guaya Shop <onboarding@resend.dev>',
          to: email,
          subject: `Confirmation de commande #${orderId} - ${item}`,
          html: `<p>Votre commande pour <strong>${item}</strong> (${price} €) est validée. Un salon ticket a été créé sur notre Discord !</p>`
        });
      } catch (mailErr) {
        console.warn('Erreur Resend :', mailErr.message);
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
