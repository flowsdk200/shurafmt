export default {
    name: 'tobase64',
    aliases: ['base64'],
    description: 'Convert teks ke Base64',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
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
                text: `Contoh penggunaan:\n- ${prefix + command} halo dunia`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const encoded = Buffer.from(input, 'utf8').toString('base64')
            useLimit()
            await sock.sendMessage(jid, {
                text: encoded
            }, { quoted: msg })
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
