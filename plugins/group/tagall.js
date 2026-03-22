export default {
    name: 'tagall',
    aliases: [],
    description: 'Tag semua anggota grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, prefix, command, groupMetadata, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Cara penggunaan:\n- ${prefix + command} perhatian semua anggota!`
            }, { quoted: msg })
        }

        const participants = Array.isArray(groupMetadata?.participants) ? groupMetadata.participants : []
        if (!participants.length) {
            return sock.sendMessage(jid, {
                text: '❌ Gagal mendapatkan data grup.'
            }, { quoted: msg })
        }

        const mentions = participants.map((p) => p.id).filter(Boolean)
        const memberList = mentions.map((id) => `@${id.split('@')[0]}`).join('\n')

        await react('⏳')

        try {
            await sock.sendMessage(jid, {
                text: `📢 ${q}\n\n${memberList}`,
                mentions
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
