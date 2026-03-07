export default {
    name: 'hidetag',
    aliases: ['ht', 'h'],
    description: 'Kirim pesan mention semua member tanpa tampil tag',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    execute: async ({ sock, msg, text, prefix, command, quotedMsg, quotedType, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid

        let messageText = String(text || '').trim()

        if (!messageText && quotedMsg && quotedType) {
            if (quotedType === 'conversation') messageText = String(quotedMsg.conversation || '').trim()
            else if (quotedType === 'extendedTextMessage') messageText = String(quotedMsg.extendedTextMessage?.text || '').trim()
            else if (quotedType === 'imageMessage') messageText = String(quotedMsg.imageMessage?.caption || '').trim()
            else if (quotedType === 'videoMessage') messageText = String(quotedMsg.videoMessage?.caption || '').trim()
        }

        if (!messageText) {
            return sock.sendMessage(jid, {
                text:
                    `Cara penggunaan:\n` +
                    `- ${prefix + command} teks\n` +
                    `- ${prefix + command} + reply pesan\n\n` +
                    `Contoh:\n` +
                    `- ${prefix + command} perhatian semua!`
            }, { quoted: msg })
        }

        const members = Array.isArray(groupMetadata?.participants)
            ? groupMetadata.participants.map((p) => p.id).filter(Boolean)
            : []

        if (!members.length) {
            return sock.sendMessage(jid, {
                text: '❌ Gagal mendapatkan data grup.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.sendMessage(jid, {
                text: messageText,
                mentions: [...new Set(members)]
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (error) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error.message}`
            }, { quoted: msg })
        }
    }
}
