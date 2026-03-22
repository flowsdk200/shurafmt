const formatNow = () => {
    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = now.toLocaleString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' })
    const year = now.toLocaleString('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' })
    const time = now.toLocaleString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).replace(':', '.')
    return `${day} ${month} ${year}, ${time}`
}

const renderOpenText = (template, groupName) => String(template || '')
    .replaceAll('{group}', groupName || '-')
    .replaceAll('{time}', formatNow())

export default {
    name: 'open',
    aliases: ['bukagrup', 'opengc', 'opengroup'],
    description: 'Buka grup semua member bisa kirim pesan',
    groupOnly: true,
    botAdmin: true,
    adminOnly: true,
    execute: async ({ sock, msg, groupMetadata, groupsDb, react, useLimit }) => {
        const jid = msg.key.remoteJid

        const isAlreadyOpen = groupMetadata?.announce === false
        if (isAlreadyOpen) {
            return sock.sendMessage(jid, {
                text: '⚠️ Grup sudah dalam kondisi terbuka.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            await sock.groupSettingUpdate(jid, 'not_announcement')
            useLimit()
            await react('✅')
            const customText = groupsDb.getSetting(jid, 'openText', '')
            const text = customText
                ? renderOpenText(customText, groupMetadata?.subject || jid)
                : '🔓 Grup dibuka. semua member kini bisa mengirim pesan di grup ini.'
            await sock.sendMessage(jid, {
                text
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg })
        }
    }
}
