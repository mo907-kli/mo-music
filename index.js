// index.js

// ====== تحميل التوكن من المتغيرات البيئية (Railway) ======
require("dotenv").config();
const TOKEN = process.env.DISCORD_TOKEN;
// ==========================================================

const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const play = require("play-dl");

// إنشاء الكلاينت
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// نظام الكيو لكل سيرفر
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    const queue = {
      guildId,
      songs: [],
      player,
      connection: null,
      textChannel: null,
      currentSong: null,
      volume: 1.0,
    };

    // لما تخلص الأغنية
    player.on(AudioPlayerStatus.Idle, () => {
      if (queue.songs.length > 0) queue.songs.shift();
      if (queue.songs.length > 0) {
        playSong(guildId);
      } else {
        queue.currentSong = null;
        if (queue.textChannel) {
          queue.textChannel.send("🎶 **انتهت قائمة الانتظار.**");
        }
      }
    });

    player.on("error", (err) => {
      console.error("Player error:", err);
      if (queue.textChannel) {
        queue.textChannel.send("⚠️ صار خطأ في مشغل الصوت، تم تخطي الأغنية.");
      }
      if (queue.songs.length > 0) queue.songs.shift();
      if (queue.songs.length > 0) playSong(guildId);
    });

    queues.set(guildId, queue);
  }
  return queues.get(guildId);
}

// تشغيل أغنية من الكيو
async function playSong(guildId) {
  const queue = getQueue(guildId);

  if (!queue.songs.length) {
    queue.currentSong = null;
    return;
  }

  const song = queue.songs[0];
  queue.currentSong = song;

  try {
    console.log(`[${guildId}] تشغيل: ${song.title} (${song.url})`);

    const stream = await play.stream(song.url, {
      quality: 2,
      discordPlayerCompatibility: true,
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });

    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);

    if (queue.textChannel) {
      queue.textChannel.send(`🎧 **جاري تشغيل:** ${song.title}`);
    }
  } catch (err) {
    console.error("Error while playing:", err);
    if (queue.textChannel) {
      queue.textChannel.send("⚠️ ما قدرت أشغل هالأغنية، بجرب اللي بعدها.");
    }
    queue.songs.shift();
    playSong(guildId);
  }
}

// أوامر البوت (بدون / )
client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const queue = getQueue(message.guild.id);
  queue.textChannel = message.channel;

  // p = تشغيل (اسم + رابط يوتيوب)
  if (cmd === "p") {
    const query = args.join(" ");
    if (!query) return message.reply("⚠️ اكتب اسم الأغنية أو رابط يوتيوب بعد `p`.");

    const vc = message.member.voice.channel;
    if (!vc) return message.reply("⚠️ لازم تكون في روم صوتي.");

    if (!queue.connection) {
      try {
        queue.connection = joinVoiceChannel({
          channelId: vc.id,
          guildId: vc.guild.id,
          adapterCreator: vc.guild.voiceAdapterCreator,
          selfDeaf: true,
        });
        queue.connection.subscribe(queue.player);
      } catch (err) {
        console.error("Error joining voice channel:", err);
        return message.reply("⚠️ ما قدرت أدخل الروم الصوتي، تأكد من صلاحياتي.");
      }
    }

    try {
      let songInfo;

      if (query.startsWith("http://") || query.startsWith("https://")) {
        // رابط يوتيوب مباشر
        const type = play.yt_validate(query);
        if (type !== "video" && type !== "shorts") {
          return message.reply("❌ الرابط هذا مو فيديو يوتيوب صالح.");
        }
        const info = await play.video_info(query);
        songInfo = {
          title: info.video_details.title,
          url: info.video_details.url,
        };
      } else {
        // بحث بالاسم
        const results = await play.search(query, { limit: 1 });
        if (!results.length) {
          return message.reply("❌ ما حصلت أي أغنية بهالاسم.");
        }
        songInfo = {
          title: results[0].title,
          url: results[0].url,
        };
      }

      queue.songs.push(songInfo);
      await message.reply(`🎵 تم إضافة: **${songInfo.title}**`);

      if (!queue.currentSong) {
        playSong(message.guild.id);
      }
    } catch (err) {
      console.error("Error in p command:", err);
      message.reply("⚠️ صار خطأ أثناء البحث عن الأغنية.");
    }
  }

  // sk = تخطي
  if (cmd === "sk") {
    if (!queue.currentSong) return message.reply("❌ ما في أغنية شغالة.");
    queue.songs.shift();
    queue.player.stop();
    message.reply("⏭️ تم تخطي الأغنية.");
  }

  // s = إيقاف
  if (cmd === "s") {
    queue.songs = [];
    queue.player.stop();
    queue.currentSong = null;
    if (queue.connection) {
      queue.connection.destroy();
      queue.connection = null;
    }
    message.reply("⛔ تم إيقاف الأغاني.");
  }

  // pa = إيقاف مؤقت
  if (cmd === "pa") {
    queue.player.pause();
    message.reply("⏸️ تم إيقاف الأغنية مؤقتاً.");
  }

  // r = استئناف
  if (cmd === "r") {
    queue.player.unpause();
    message.reply("▶️ تم استكمال الأغنية.");
  }

  // q = قائمة الانتظار
  if (cmd === "q") {
    if (!queue.songs.length) return message.reply("📭 قائمة الانتظار فاضية.");
    const list = queue.songs
      .map((s, i) => `${i === 0 ? "**🎧 يشغّل الآن:**" : `**${i + 1}.**`} ${s.title}`)
      .join("\n");
    message.reply(list);
  }

  // n = الآن يُشغّل
  if (cmd === "n") {
    if (!queue.currentSong) return message.reply("❌ لا يوجد شيء مشغّل الآن.");
    message.reply(`🎧 يشغّل الآن: **${queue.currentSong.title}**`);
  }

  // v = الصوت
  if (cmd === "v") {
    const value = parseInt(args[0]);
    if (!value || value < 1 || value > 200) {
      return message.reply("⚠️ اكتب رقم بين 1 و 200 مثل: `v 100`.");
    }

    queue.volume = value / 100;
    const state = queue.player.state;
    if (state.resource && state.resource.volume) {
      state.resource.volume.setVolume(queue.volume);
    }

    message.reply(`🔊 تم ضبط الصوت إلى **${value}%**`);
  }
});

client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
