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
const TOKEN = '5535a220a06c46915b6c22fb932d5734e6ae7a164eb40b4cf54aaac13a15a07d';
const GUILD_ID = '1546527956959105126';
const SALON_ANNONCES_ID = '1546527958695411758';
const CATEGORY_TICKETS_ID = '1547371253588037694';

// Configuration Resend
const resend = new Resend('re_BxDtdXmG_D2mrdLZmcE66JAH2GfmQJhuY');
const ADMIN_EMAIL = 'lemonsellings@gmail.com'; 
const BOT_API_URL = 'http://localhost:3000'; // À remplacer par ton URL Render une fois en ligne

const STOCK_FILE = path.join(__dirname, 'stock.json');
const TECHS_FILE = path.join(__dirname, 'techs.json');

function getStock() {
  if (!fs.existsSync(STOCK_FILE)) fs.writeFileSync(STOCK_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(STOCK_FILE, 'utf-8'));
}

function saveStock(data) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(data, null, 2));
}

function getTechs() {
  if (!fs.existsSync(TECHS_FILE)) fs.writeFileSync(TECHS_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(TECHS_FILE, 'utf-8'));
}

function isManualDelivery(itemName) {
  const name = itemName.toLowerCase();
  return name.includes('basic') || name.includes('on air') || name.includes('fitness park') || name.includes('salles');
}

function getProductKey(itemName) {
  const name = itemName.toLowerCase();
  if (name.includes('mcdo')) return 'tech_mcdo';
  if (name.includes('red bull')) return 'tech_redbull';
  if (name.includes('paypal')) return 'tech_paypal';
  if (name.includes('revolut')) return 'revolut';
  if (name.includes('crunchyroll')) return 'crunchyroll';
  if (name.includes('netflix')) return 'netflix';
  if (name.includes('spotify')) return 'spotify';
  if (name.includes('deezer')) return 'deezer';
  if (name.includes('nordvpn')) return 'nordvpn';
  if (name.includes('apple')) return 'apple_music';
  return 'autres';
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
});

// ROUTE 1 : Création du ticket + Alerte e-mail
app.post('/api/create-ticket', async (req, res) => {
  const { orderId, discordUserId, total, items, method } = req.body;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const primaryItem = items && items.length > 0 ? items[0] : 'Inconnu';
    const isManual = isManualDelivery(primaryItem);

    const channelOptions = {
      name: `ticket-${orderId.toLowerCase().replace('#', '')}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }
      ]
    };

    if (CATEGORY_TICKETS_ID && CATEGORY_TICKETS_ID !== 'METS_ICI_ID_DE_LA_CATEGORIE_TICKETS') {
      channelOptions.parent = CATEGORY_TICKETS_ID;
    }

    if (discordUserId && /^\d+$/.test(discordUserId)) {
      channelOptions.permissionOverwrites.push({
        id: discordUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    const channel = await guild.channels.create(channelOptions);

    const embedTicket = new EmbedBuilder()
      .setTitle(`📦 Commande ${orderId}`)
      .setColor(0xd97706)
      .setDescription(
        discordUserId && /^\d+$/.test(discordUserId)
          ? `Bienvenue <@${discordUserId}> sur ton espace de commande !`
          : 'Bienvenue sur ton espace de commande !'
      )
      .addFields(
        { name: '💰 Montant', value: `\`${total}\``, inline: true },
        { name: '💳 Paiement', value: `\`${method}\``, inline: true },
        { name: '📝 Articles', value: items.map(i => `• ${i}`).join('\n') },
        { name: '📌 Important', value: `Indique bien **\`${orderId}\`** en référence de paiement. Le staff valide ta commande dès réception.` }
      )
      .setFooter({ text: 'Guaya Shop' })
      .setTimestamp();

    await channel.send({
      content: discordUserId && /^\d+$/.test(discordUserId) ? `<@${discordUserId}>` : undefined,
      embeds: [embedTicket]
    });

    const rowStaff = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_confirm_${discordUserId || 'null'}_${orderId}_${encodeURIComponent(primaryItem)}_${encodeURIComponent(total)}_${isManual ? '1' : '0'}`)
        .setLabel('✅ Confirmer réception')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`btn_deny_${discordUserId || 'null'}_${orderId}`)
        .setLabel('❌ Paiement non reçu')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      embeds: [new EmbedBuilder().setColor(0x2b2d31).setTitle('🛡️ Panel Staff').setDescription(`Commande : **${total}** via **${method}**`)],
      components: [rowStaff]
    });

    // Envoi de l'e-mail Resend avec bouton 1-clic
    const validateLink = `${BOT_API_URL}/api/email-validate?orderId=${orderId}&discordId=${discordUserId || 'null'}&item=${encodeURIComponent(primaryItem)}&total=${encodeURIComponent(total)}&channelId=${channel.id}`;

    try {
      await resend.emails.send({
        from: 'Guaya Shop <onboarding@resend.dev>',
        to: ADMIN_EMAIL,
        subject: `🚨 Commande ${orderId} (${total})`,
        html: `
          <h2>Nouvelle commande passée !</h2>
          <p><b>Numéro :</b> ${orderId}</p>
          <p><b>Montant :</b> ${total}</p>
          <p><b>Méthode :</b> ${method}</p>
          <p><b>Produit :</b> ${items.join(', ')}</p>
          <p><b>Discord :</b> &lt;@${discordUserId}&gt;</p>
          <br/>
          <p>Une fois les fonds vérifiés sur ton compte :</p>
          <a href="${validateLink}" style="background-color:#10b981; color:#fff; padding:12px 20px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">
            ✅ VALIDER ET LIVRER EN MP
          </a>
        `
      });
    } catch (mailErr) {
      console.error("Erreur envoi mail Resend :", mailErr);
    }

    res.json({ success: true, channelId: channel.id });
  } catch (err) {
    console.error('Erreur commande :', err);
    res.status(500).json({ error: 'Erreur traitement commande' });
  }
});

// ROUTE 2 : Clic depuis le mail
app.get('/api/email-validate', async (req, res) => {
  const { orderId, discordId, item, total, channelId } = req.query;
  const decodedItem = decodeURIComponent(item);
  const decodedTotal = decodeURIComponent(total);

  try {
    const productKey = getProductKey(decodedItem);
    const techs = getTechs();
    const stock = getStock();

    let deliveredText = "";

    if (techs[productKey]) {
      deliveredText = techs[productKey];
    } else if (stock[productKey] && stock[productKey].length > 0) {
      deliveredText = stock[productKey].shift();
      saveStock(stock);
    } else if (isManualDelivery(decodedItem)) {
      return res.send(`<h2>⚠️ Ce produit (${decodedItem}) est manuel. Va directement dans le ticket Discord remplir les accès !</h2>`);
    } else {
      return res.send(`<h2>⚠️ Stock vide pour : ${productKey}. Aucun compte dispo.</h2>`);
    }

    await executeDelivery(discordId, orderId, decodedItem, decodedTotal, deliveredText, channelId);

    res.send(`
      <body style="font-family:sans-serif; text-align:center; padding:40px; background:#0e0a08; color:#fff;">
        <h1 style="color:#10b981;">✅ Commande ${orderId} validée !</h1>
        <p>Le client a bien reçu ses accès par MP et dans son salon.</p>
      </body>
    `);
  } catch (err) {
    res.status(500).send("Erreur validation : " + err.message);
  }
});

// BOUTONS DISCORD
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith('btn_deny_')) {
      const [, , clientId, orderId] = customId.split('_');
      await interaction.reply({
        content: `⚠️ <@${clientId}> : Paiement non reçu pour la commande \`${orderId}\`. Vérifie l'envoi des fonds.`
      });
      return;
    }

    if (customId.startsWith('btn_confirm_')) {
      const parts = customId.split('_');
      const clientId = parts[2];
      const orderId = parts[3];
      const itemName = decodeURIComponent(parts[4]);
      const total = decodeURIComponent(parts[5]);
      const isManual = parts[6] === '1';

      if (isManual) {
        const modal = new ModalBuilder()
          .setCustomId(`modal_deliver_${clientId}_${orderId}_${encodeURIComponent(itemName)}_${encodeURIComponent(total)}`)
          .setTitle(`Livraison : ${itemName.slice(0, 30)}`);

        const input = new TextInputBuilder()
          .setCustomId('credentials')
          .setLabel("Identifiants (Email / Mot de passe)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      await interaction.deferReply();
      const productKey = getProductKey(itemName);
      const techs = getTechs();
      const stock = getStock();
      let dataToDeliver = techs[productKey] || (stock[productKey] ? stock[productKey].shift() : null);

      if (stock[productKey]) saveStock(stock);

      if (!dataToDeliver) {
        return interaction.editReply({ content: `⚠️ Stock vide pour \`${productKey}\`.` });
      }

      await executeDelivery(clientId, orderId, itemName, total, dataToDeliver, interaction.channel.id);
      await interaction.editReply({ content: `✅ Commande livrée en MP ! Clôture du ticket...` });
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_deliver_')) {
    await interaction.deferReply();
    const parts = interaction.customId.split('_');
    const credentials = interaction.fields.getTextInputValue('credentials');
    await executeDelivery(parts[2], parts[3], decodeURIComponent(parts[4]), decodeURIComponent(parts[5]), credentials, interaction.channel.id);
    await interaction.editReply({ content: `✅ Accès livrés en MP ! Clôture du ticket...` });
  }
});

// FONCTION D'EXPÉDITION EN MESSAGE PRIVÉ (MP)
async function executeDelivery(clientId, orderId, item, total, textData, channelId) {
  let clientUser = null;
  let mpStatus = "✅ MP envoyé avec succès";

  if (clientId && clientId !== 'null') {
    try {
      clientUser = await client.users.fetch(clientId);
    } catch (e) {
      console.warn("Impossible de fetch le user :", e);
    }
  }

  const embedDelivery = new EmbedBuilder()
    .setTitle(`🎉 Ta commande ${orderId} est disponible !`)
    .setColor(0x10b981)
    .addFields(
      { name: '📦 Produit', value: `\`${item}\``, inline: true },
      { name: '💰 Montant', value: `\`${total}\``, inline: true },
      { name: '🔑 Accès / Instructions', value: textData }
    )
    .setFooter({ text: 'Merci pour ta confiance sur Guaya Shop !' })
    .setTimestamp();

  // Envoi direct en MP
  if (clientUser) {
    try {
      await clientUser.send({ embeds: [embedDelivery] });
    } catch (err) {
      console.warn("Échec envoi MP (MP fermés par le client) :", err);
      mpStatus = "⚠️ MP bloqués par le client (affiché dans le ticket)";
    }
  }

  // Annonce dans le salon des ventes
  try {
    const logChannel = await client.channels.fetch(SALON_ANNONCES_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚡ Nouvelle Vente Confirmée !')
            .setColor(0x00ff88)
            .addFields(
              { name: '👤 Client', value: clientUser ? `<@${clientUser.id}>` : 'Client Web', inline: true },
              { name: '📦 Article', value: `\`${item}\``, inline: true },
              { name: '💰 Montant', value: `\`${total}\``, inline: true }
            )
            .setFooter({ text: 'Guaya Shop' })
            .setTimestamp()
        ]
      });
    }
  } catch (e) {}

  // Affichage dans le ticket avant fermeture
  if (channelId) {
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch) {
        await ch.send({ 
          content: `${mpStatus} pour <@${clientId}>.\nFermeture du ticket dans 5 secondes...`, 
          embeds: [embedDelivery] 
        });
        setTimeout(() => ch.delete().catch(() => {}), 5000);
      }
    } catch (e) {}
  }
}

const PORT = 3000;
app.listen(PORT, () => console.log(`API Bot en ligne sur http://localhost:${PORT}`));
client.login(TOKEN);
