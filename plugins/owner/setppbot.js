import { downloadContentFromMessage } from 'baileys'

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

export default {
    name: 'setppbot',
    aliases: ['setbotpp'],
    description: 'Set foto profil bot dari gambar',
    premiumOnly: true,
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        let image = null
        if (isQuoted && quotedType === 'imageMessage' && quotedMsg?.imageMessage) {
            image = quotedMsg.imageMessage
        } else if (msg.message?.imageMessage) {
            image = msg.message.imageMessage
        }

        if (!image) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- Kirim/reply foto lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(image, 'image')
            const media = await streamToBuffer(stream)
            await sock.updateProfilePicture(sock.user.id, media)

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: '✅ Foto profil bot berhasil diperbarui'
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: '❌ Gagal memperbarui foto profil, coba lagi nanti'
            }, { quoted: msg })
        }
    }
}
