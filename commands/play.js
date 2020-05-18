const ytdl = require('ytdl-core');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const search = require('youtube-search');
const { PassThrough } = require('stream');
const { youtube_token } = require('../config.json');
const Discord = require('discord.js');
const { EventEmitter } = require('events');

ffmpeg.setFfmpegPath(ffmpegPath);


const opts = {
  maxResults: 10,
  key: youtube_token,
};

const obj = {
  name: 'play',
  description: 'Play a song',
  guilds: [],
  async execute(message, args) {
    let guild;
    if (message.guild)
      guild = message.guild.id;
    else
      guild = message;
    let controller = this.guilds.find(element => {
      return element.guild_name === guild;
    });
    if (controller === undefined) controller = new song_control(guild);
    if (args.length === 0) return;
    find_song(message, args, controller);
    controller.on('finish', () => {
      if (controller.cycling) {
        setImmediate(() => controller.play(message, controller.gen.next().value));
        return;
      }
      if (controller.stack.length !== 0) {
        const arg = controller.stack.shift();
        setImmediate(() => controller.play(message, arg));
      }
    })
  },
};

module.exports = obj;

class song_control extends EventEmitter {
  constructor(guild_name) {
    super();
    this.guild_name = guild_name;
    this.stack = [];
    this.playing = false;
    this.volume = 1;
    this.effect = null;
    this.reading = false;
    this.cycling = false;
    obj.guilds.push(this);
  }

  async play(message, args) {
    if (args.length === 0 || typeof args[0] !== 'string' || (!message.member.voice.channel && !this.connection) || this.reading) return;

    if (this.playing) {
      this.stack.push(args);
      this.gen = select_track(this.stack);
      message.channel.send('Queued');
      message.channel.send(args[1]);
      return;
    }

    const link = args[0];

    const stream = new PassThrough();
    const effect = new PassThrough();

    ffmpeg(ytdl(link)).outputFormat('mp3').on('error', () => {
      console.log('ffmpeg error');
      setImmediate(() => this.dispatcher.end());
    }).output(stream).run();

    if (this.effect) {
      ffmpeg(stream).outputFormat('mp3').audioFilter(this.effect).on('error', err => {
        message.reply('Wrong filter!');
        console.log(err);
        setImmediate(() => this.dispatcher.end());
        this.effect = null;
      }).output(effect).run();
    }

    this.connection = await message.member.voice.channel.join().catch(e => console.log(e));

    try {
      let str = this.effect ? effect : stream;
      this.dispatcher = this.connection.play(str.on('error', err => { throw err }), {volume: this.volume})
          .on('error', err => { throw err });
    } catch (e) {
      console.error(e);
      message.channel.send('There was an error processing your request');
      return;
    }

    this.dispatcher.on('start', () => {
      message.channel.send('Playing');
      message.channel.send(args[1]);
      console.log('song is now playing!');
      this.playing = true;
    });

    this.dispatcher.on('finish', () => {
      console.log('song has finished playing!');
      this.emit('finish');
      this.playing = false;
    });

    this.dispatcher.on('error', console.error);

  }
}

const find_song = (message, args, controller) => {
  let term = '';
  if (args[0].startsWith('https://')) {
    const index = args[0].indexOf('=');
    term = args[0].slice(index + 1, args[0].length);
  } else {
    term = args.join(' ');
  }
  search(term, opts, function (err, results) {
    let i = 0;
    if (err) return console.log(err);
    if (results.length === 0) message.reply('Couldn\'t find anything!');
    while (results[i].kind !== 'youtube#video' && i < results.length && typeof results[i].link === 'string') {
      if (i > 10) {
        message.reply('Something happened!');
        return;
      }
      i++;
    }
    const embed = create_Embed(results[i].title, results[i].link, results[i].thumbnails.default.url, results[i].description, message.author.username, message.author.avatarURL());
    const link = results[i].link;
    setImmediate(() => controller.play(message, [link, embed]).catch(e => {console.error(e)}));
  });
}

function* select_track(queue) {
  let i = 0;
  while (true) {
    yield queue[i];
    i++;
    if (i === queue.length) i = 0;
  }
}



const create_Embed = (title, url, thumbnail, description, author_name, author_avatar) => {
  return new Discord.MessageEmbed()
    .setColor('#9deb70')
    .setTitle(title)
    .setURL(url)
    .setAuthor(author_name, author_avatar)
    .setDescription(description)
    .setThumbnail(thumbnail);
};

