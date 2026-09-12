import { fetchReferenceImage } from '../image/reference-images.mjs';
import { splitForDiscord, truncateText } from '../utils/text.mjs';

async function sendResult(interaction, content) {
  const [first, ...rest] = splitForDiscord(content);
  await interaction.editReply({ content: first, allowedMentions: { parse: [] } });
  for (const chunk of rest) {
    await interaction.followUp({ content: chunk, allowedMentions: { parse: [] } });
  }
}

export function createReferenceHandler({ store, fetchImage = fetchReferenceImage, logger = console }) {
  return async function handleReference(interaction) {
    await interaction.deferReply();
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'list') {
        const profiles = await store.list();
        const lines = profiles.map(profile =>
          `${profile.displayName} | slug: ${profile.slug} | images: ${profile.images.length} | updatedAt: ${profile.updatedAt}`,
        );
        await sendResult(interaction, lines.length ? lines.join('\n') : '登録済み reference はありません。');
        return;
      }

      const name = interaction.options.getString('name', true);
      if (subcommand === 'add') {
        const attachments = [interaction.options.getAttachment('image', true)];
        for (const key of ['image2', 'image3', 'image4']) {
          const image = interaction.options.getAttachment(key);
          if (image) attachments.push(image);
        }
        const images = [];
        for (const attachment of attachments) images.push(await fetchImage(attachment));
        const replace = interaction.options.getBoolean('replace') === true;
        const profile = await store.add(name, images, { replace });
        await sendResult(interaction,
          `reference ${replace ? '置換' : '登録'}完了 | name: ${profile.displayName} | slug: ${profile.slug}` +
          ` | 登録枚数: ${images.length} | 現在総枚数: ${profile.images.length}`,
        );
        return;
      }

      if (subcommand === 'show') {
        const profile = await store.show(name);
        await sendResult(interaction, [
          `display name: ${profile.displayName}`,
          `slug: ${profile.slug}`,
          `createdAt: ${profile.createdAt}`,
          `updatedAt: ${profile.updatedAt}`,
          `image count: ${profile.images.length}`,
          ...profile.images.map(image =>
            `filename: ${image.filename} | originalName: ${image.originalName} | size: ${image.size} bytes`,
          ),
        ].join('\n'));
        return;
      }

      if (subcommand === 'delete') {
        const profile = await store.delete(name);
        await sendResult(interaction, `reference 削除完了 | name: ${profile.displayName} | slug: ${profile.slug}`);
        return;
      }
      throw new Error('未対応の reference 操作です。');
    } catch (error) {
      logger.error('reference error:', error);
      await sendResult(interaction, truncateText(`reference error: ${error.message}`, 1700));
    }
  };
}
