export default {
    name: 'toqr',
    aliases: ['qr'],
    description: 'Convert teks atau link ke QR',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        let input = String(text || '').trim()
        if (!input && isQuoted && quotedMsg) {
            if (quotedType === 'conversation') input = String(quotedMsg.conversation || '').trim()
            else if (quotedType === 'extendedTextMessage') input = String(quotedMsg.extendedTextMessage?.text || '').trim()
            else if (quotedType === 'imageMessage') input = String(quotedMsg.imageMessage?.caption || '').trim()
            else if (quotedType === 'videoMessage') input = String(quotedMsg.videoMessage?.caption || '').trim()
        }

        if (!input) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} 085226344606\n` +
                    `- reply pesan lalu ketik ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(input)}`
            await sock.sendMessage(jid, {
                image: { url },
                caption: input
            }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
