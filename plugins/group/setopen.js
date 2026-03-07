export default {
    name: 'setopen',
    aliases: [],
    description: 'Ubah teks open grup',
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
                    `- ${prefix + command} Grup {group} resmi dibuka pada {time}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {group}\n` +
                    `- {time}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'openText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks open berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'openText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks open berhasil diubah.\n\nPreview:\n${input}`
        }, { quoted: msg })
    }
}
