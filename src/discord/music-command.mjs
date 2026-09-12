import { SlashCommandBuilder } from 'discord.js';

export function buildMusicCommand() {
  return new SlashCommandBuilder().setName('music').setDescription('YuE2 / ACE-Stepで音楽を生成します。既定はYuE2です。')
    .addStringOption(o => o.setName('prompt').setDescription('曲調・楽器・歌声など').setRequired(true).setMaxLength(2000))
    .addStringOption(o => o.setName('model').setDescription('音楽モデル（省略時は管理者設定、既定YuE2）').addChoices(
      { name: 'YuE2（長さは目安・終了を優先）', value: 'yue2' }, { name: 'ACE-Step', value: 'ace-step' }))
    .addStringOption(o => o.setName('language').setDescription('歌唱言語（既定ja）').setMaxLength(80))
    .addStringOption(o => o.setName('lyrics').setDescription('歌詞（任意）'))
    .addIntegerOption(o => o.setName('duration').setDescription('秒数：YuE2は目安で前後します（既定120秒）').setMinValue(10).setMaxValue(600))
    .addIntegerOption(o => o.setName('bpm').setDescription('BPM（目安）').setMinValue(30).setMaxValue(300));
}
