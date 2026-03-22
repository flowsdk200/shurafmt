import { normalizeJid } from '../../src/utils/jid.js'

export default {
    name: 'listgc',
    aliases: ['listgroup', 'gclist'],
    description: 'List grup bot (JID, owner, members, admins, creation, desc)',
    ownerOnly: true,
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid

        await react('⏳')

        try {
            const participating = await sock.groupFetchAllParticipating()
            const groups = Object.values(participating || {})

            if (!groups.length) {
                await react('✅')
                return sock.sendMessage(jid, {
                    text: '📭 Bot belum masuk ke grup manapun.'
                }, { quoted: msg })
            }

            useLimit()

            const formatCreation = (raw) => {
                const n = Number(raw)
                if (!Number.isFinite(n)) return '-'
                const ms = n < 1e12 ? n * 1000 : n
                const d = new Date(ms)
                if (Number.isNaN(d.getTime())) return String(raw)
                return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
            }

            const mentions = []

            const blocks = groups.map((group, i) => {
                const participants = Array.isArray(group.participants) ? group.participants : []
                const adminCount = participants.filter((p) => p?.admin === 'admin' || p?.admin === 'superadmin').length

                const ownerMention = group.ownerPn || normalizeJid(group.owner)
                const ownerTag = ownerMention && ownerMention !== 'Unknown' ? `@${ownerMention.split('@')[0]}` : 'Unknown'
                if (ownerMention && ownerMention.includes('@')) mentions.push(ownerMention)

                return (
                    `\`# ${i + 1} ${group.subject || '-'}\`\n` +
                    `• JID: ${group.id || 'Unknown'}\n` +
                    `• Owner: ${ownerTag}\n` +
                    `• Members: ${participants.length}\n` +
                    `• Admins: ${adminCount}\n` +
                    `• Created: ${formatCreation(group.creation ?? group.subjectTime)}\n` +
                    `• Desc: ${group.desc || 'Unknown'}`
                )
            })

            const report = `\`TOTAL GRUP: ${groups.length}\`\n\n${blocks.join('\n\n')}`.trim()
            const uniqueMentions = [...new Set(mentions)]
            await sock.sendMessage(jid, { text: report, mentions: uniqueMentions }, { quoted: msg })

            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal mengambil daftar grup: ${err.message}`
            }, { quoted: msg })
        }
    }
}
