export default {
    name: 'setwelcome',
    aliases: [],
    description: 'Ubah teks welcome grup',
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
                    `- ${prefix + command} Halo {user}, selamat datang di {group}\n` +
                    `- ${prefix + command} reset\n\n` +
                    `Variabel:\n` +
                    `- {user}\n` +
                    `- {group}\n` +
                    `- {time}\n` +
                    `- {members}\n` +
                    `- {before}\n` +
                    `- {after}`
            }, { quoted: msg })
        }

        if (/^(reset|default)$/i.test(input)) {
            groupsDb.setSetting(jid, 'welcomeText', '')
            useLimit()
            return sock.sendMessage(jid, {
                text: '✅ Teks welcome berhasil direset ke default.'
            }, { quoted: msg })
        }

        groupsDb.setSetting(jid, 'welcomeText', input)
        useLimit()
        return sock.sendMessage(jid, {
            text: `✅ Teks welcome berhasil diubah.\n\nPreview:\n${input}`
        }, { quoted: msg })
    }
}
