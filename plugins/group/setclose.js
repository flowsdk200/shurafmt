export default {
    name: 'setclose',
    aliases: [],
    description: 'Ubah teks close grup',
    groupOnly: true,
    adminOnly: true,
    execute: async ({ sock, msg, text, groupsDb, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = String(text || '').trim()

        if (!input) {
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} Grup {group} resmi ditutup pada {time}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {group}\n` +
                    `- {time}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'closeText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks close berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'closeText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks close berhasil diubah.\n\nPreview:\n${input}`
        }, { quoted: msg })
    }
}
