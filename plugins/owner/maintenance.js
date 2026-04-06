import settingsDb from '../../src/database/settings.js'

const START_TEXT = `🚧 *MAINTENANCE BERLANGSUNG*

Bot sedang maintenance untuk perbaikan database user.
Beberapa fitur mungkin tidak merespons sementara.

Mohon tunggu sampai ada info maintenance selesai.`

const STOP_TEXT = `✅ *MAINTENANCE SELESAI*

Maintenance database user sudah selesai.
Semua fitur bot kembali normal.

Terima kasih sudah menunggu.`

const parseCustomText = (fullText = '') => String(fullText || '').trim().split(/\s+/).slice(1).join(' ').trim()

export default {
    name: 'maintenance',
    aliases: ['mtn'],
    description: 'Mode maintenance: .mtn start | .mtn stop | .mtn done | .mtn status',
    ownerOnly: true,
    execute: async ({ sock, msg, args, text, prefix, command, useLimit, config }) => {
        const jid = msg.key.remoteJid
        const sub = String(args?.[0] || '').toLowerCase()
        const customText = parseCustomText(text)

        if (!sub) {
            useLimit()
            return sock.sendMessage(jid, {
                text:
                    `Usage:\n` +
                    `- ${prefix + command} start\n` +
                    `- ${prefix + command} start <custom text>\n` +
                    `- ${prefix + command} stop\n` +
                    `- ${prefix + command} done\n` +
                    `- ${prefix + command} status`
            }, { quoted: msg })
        }

        if (sub === 'status') {
            useLimit()
            return sock.sendMessage(jid, {
                text: config.onlyOwner ? `Status: ON (maintenance mode active).` : `Status: OFF (maintenance mode inactive).`
            }, { quoted: msg })
        }

        if (sub === 'start') {
            await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: false, onlyOwner: true, onlyPremium: false })
            useLimit()
            return sock.sendMessage(jid, {
                text: customText || START_TEXT
            }, { quoted: msg })
        }

        if (sub === 'stop' || sub === 'done') {
            await settingsDb.setRestrictions({ onlyGroup: false, onlyPrivate: false, onlyOwner: false, onlyPremium: false })
            useLimit()
            return sock.sendMessage(jid, {
                text: customText || STOP_TEXT
            }, { quoted: msg })
        }

        return sock.sendMessage(jid, {
            text: `Subcommand tidak valid. Gunakan: ${prefix + command} start|stop|done|status`
        }, { quoted: msg })
    }
}
