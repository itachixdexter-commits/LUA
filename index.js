require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require('discord.js');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MESSAGE_LIMIT = 1900;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function loadRooms() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveRooms(rooms) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2));
}

const commands = [
  new SlashCommandBuilder()
    .setName('setroom')
    .setDescription('تحديد الروم الي يشتغل فيها البوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('صنع سكربت Roblox Luau')
    .setDMPermission(false)
    .addStringOption(o =>
      o.setName('prompt').setDescription('وصف السكربت المطلوب').setRequired(true)
    )
].map(c => c.toJSON());

const SYSTEM_PROMPT = `You are an expert Roblox Luau scripter.
Write complete, working, production-quality Luau scripts for Roblox Studio based on the user's request.
Strict rules:
1. The code must contain ZERO comments of any kind. No lines starting with --, no --[[ ]] blocks, no trailing comments.
2. Use modern Luau practices: task.wait, task.spawn, game:GetService, local variables.
3. Output format must be exactly:
<code>
the full script here
</code>
<explanation>
the explanation here
</explanation>
4. The explanation must ONLY describe what the script does, in one to three short sentences, in the same language the user wrote in. Do not mention where to place it, do not explain line by line, and do not add tips.
5. Do not output anything outside the two tags. Do not wrap the code in markdown fences.`;

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 16000, temperature: 0.4 }
  };

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || '').join('');
    }

    lastError = new Error(`Gemini ${res.status}: ${await res.text()}`);
    if (res.status !== 429 && res.status !== 503) break;
    await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw lastError;
}

function stripComments(code) {
  let out = code.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '');
  out = out
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function parseResponse(text) {
  const codeMatch = text.match(/<code>([\s\S]*?)<\/code>/);
  const explMatch = text.match(/<explanation>([\s\S]*?)<\/explanation>/);
  let code = codeMatch ? codeMatch[1] : text;
  code = code.replace(/^\s*```(?:lua|luau)?\s*/i, '').replace(/\s*```\s*$/, '');
  return {
    code: stripComments(code),
    explanation: explMatch ? explMatch[1].trim() : ''
  };
}

function splitText(text, size) {
  const parts = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) parts.push(rest);
  return parts;
}

client.once('ready', async () => {
  await client.application.commands.set(commands);
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setroom') {
    const rooms = loadRooms();
    rooms[interaction.guildId] = interaction.channelId;
    saveRooms(rooms);
    await interaction.reply(`تم تحديد هذي الروم <#${interaction.channelId}> للبوت.`);
    return;
  }

  if (interaction.commandName === 'ai') {
    const rooms = loadRooms();
    const roomId = rooms[interaction.guildId];

    if (!roomId) {
      await interaction.reply({
        content: 'ما تم تحديد روم للبوت. اطلب من الادارة تستخدم /setroom اولا.',
        ephemeral: true
      });
      return;
    }

    if (interaction.channelId !== roomId) {
      await interaction.reply({
        content: `هذا الامر يشتغل فقط في <#${roomId}>`,
        ephemeral: true
      });
      return;
    }

    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply();

    try {
      const raw = await askGemini(prompt);

      const { code, explanation } = parseResponse(raw);

      if (!code) {
        await interaction.editReply('ما قدرت اصنع السكربت، جرب تعيد صياغة الطلب.');
        return;
      }

      const block = '```lua\n' + code + '\n```';
      const explText = explanation ? `\n**وش يسوي:**\n${explanation}` : '';

      if ((block + explText).length <= MESSAGE_LIMIT) {
        await interaction.editReply(block + explText);
        return;
      }

      const file = new AttachmentBuilder(Buffer.from(code, 'utf8'), { name: 'script.lua' });
      const explParts = splitText(explText, MESSAGE_LIMIT);

      await interaction.editReply({
        content: explParts[0] || 'السكربت في الملف المرفق.',
        files: [file]
      });

      for (let i = 1; i < explParts.length; i++) {
        await interaction.followUp(explParts[i]);
      }
    } catch (err) {
      console.error(err);
      await interaction.editReply('صار خطأ اثناء صنع السكربت، حاول مرة ثانية.');
    }
  }
});

process.on('unhandledRejection', err => console.error(err));

if (!process.env.DISCORD_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error('Missing DISCORD_TOKEN or GEMINI_API_KEY');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
