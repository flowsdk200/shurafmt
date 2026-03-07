import confessDb from '../../src/database/confess.js'
import { getTargetJid } from '../../src/utils/group.js'
import { normalizeJid } from '../../src/utils/jid.js'

const normalizeText = (value = '') => String(value || '').trim()

const normalizeDigits = (value = '') => String(value || '').replace(/[^0-9]/g, '')

const toWaJid = (jid = '') => {
    const normalized = String(normalizeJid(jid) || jid || '').trim()
    const user = normalized.split('@')[0].split(':')[0]
    if (!user) return ''
    return `${user}@s.whatsapp.net`
}

const sameUser = (a, b) => {
    const left = normalizeDigits(a)
    const right = normalizeDigits(b)
    return Boolean(left && right && left === right)
}

const maskNumber = (num = '') => {
    const value = normalizeDigits(num)
    if (!value) return 'Anonim'
    if (value.length <= 2) return `${value[0] || ''}*`
    if (value.length === 3) return `${value.slice(0, 2)}*`
    return `${value.slice(0, 2)}${'*'.repeat(value.length - 3)}${value.slice(-1)}`
}

const nowJakarta = () => new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
})

const getSession = (jid) => {
    if (!jid) return null
    return confessDb.getSessionByUser(jid)
}

const getTargetLabel = (jid) => toWaJid(jid).split('@')[0]

const buildInitMessage = (targetJid, maskedSender, message) => [
    `👋 Hey @${getTargetLabel(targetJid)}, ada confess anonim untukmu. Identitas pengirim disamarkan demi privasi.`,
    '',
    '=== PENGIRIM ===',
    `• Nomor: ${maskedSender}`,
    `• Waktu: ${nowJakarta()} WIB`,
    '',
    '=== PESAN ===',
    message,
    '',
    'CATATAN:',
    '• balas untuk terima & mulai sesi confess.',
    '• kirim tolakconfess untuk menolak confess.',
    '• kirim stopconfess untuk akhiri kapan saja.'
].join('\n')

const buildActiveMessage = (fromJid, text) => `💬 balasan dari (${maskNumber(fromJid)})\n\n${text}`

const stopSession = async ({ sock, msg, actor }) => {
    const session = await getSession(actor)
    if (!session) {
        return sock.sendMessage(msg.key.remoteJid, {
            text: '❌ Tidak ada sesi confess aktif.'
        }, { quoted: msg })
    }

    const other = sameUser(session.a, actor) ? session.b : session.a
    await confessDb.removeSession(session.id)

    await sock.sendMessage(msg.key.remoteJid, {
        text: '✅ Sesi confess dihentikan.'
    }, { quoted: msg })

    if (other && !sameUser(other, actor)) {
        await sock.sendMessage(other, {
            text: '❗ Sesi confess dihentikan oleh lawan bicara.'
        })
    }
}

const tolakSession = async ({ sock, msg, actor }) => {
    const session = await getSession(actor)
    if (!session) {
        return sock.sendMessage(msg.key.remoteJid, {
            text: '❌ Tidak ada sesi confess aktif.'
        }, { quoted: msg })
    }

    if (session.status === 'pending' && sameUser(session.b, actor)) {
        await confessDb.removeSession(session.id)
        await sock.sendMessage(msg.key.remoteJid, {
            text: '✅ Confess ditolak.'
        }, { quoted: msg })

        if (session.a) {
            await sock.sendMessage(session.a, {
                text: '❌ Confess kamu ditolak oleh target.'
            })
        }
        return
    }

    await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Hanya penerima yang bisa menolak saat sesi masih pending.'
    }, { quoted: msg })
}

const isDirectStopCommand = (text = '') => {
    const lower = normalizeText(text).toLowerCase()
    const parts = lower.split(/\s+/)
    return lower === 'stopconfess' || (parts[0] === 'confess' && parts[1] === 'stop')
}

const isDirectTolakCommand = (text = '') => {
    const lower = normalizeText(text).toLowerCase()
    const parts = lower.split(/\s+/)
    return lower === 'tolakconfess' || lower === 'tolak' || (parts[0] === 'confess' && parts[1] === 'tolak')
}

const isPrefixedConfessCommand = (text = '') => {
    const lower = normalizeText(text).toLowerCase()
    if (!lower) return false

    const firstChar = lower[0]
    if (!['!', '.', '/'].includes(firstChar)) return false

    const token = lower.slice(1).trim()
    const parts = token.split(/\s+/)
    const main = parts[0] || ''
    const second = parts[1] || ''

    if (main === 'confess') return second === '' || second === 'stop' || second === 'tolak'
    return main === 'stopconfess' || main === 'tolakconfess'
}

export default {
    name: 'confess',
    aliases: ['stopconfess', 'tolakconfess'],
    description: 'Kirim confess anonim ke user (private)',

    execute: async ({ sock, msg, text, args, sender, isGroup, prefix, command, botJid, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const cmd = normalizeText(command).toLowerCase()
        const firstArg = normalizeText(args?.[0]).toLowerCase()

        if (isGroup) {
            return sock.sendMessage(jid, {
                text: '❌ Confess hanya bisa digunakan di chat pribadi.'
            }, { quoted: msg })
        }

        if (cmd === 'stopconfess' || (cmd === 'confess' && firstArg === 'stop')) {
            return stopSession({ sock, msg, actor: sender })
        }

        if (cmd === 'tolakconfess' || (cmd === 'confess' && firstArg === 'tolak')) {
            return tolakSession({ sock, msg, actor: sender })
        }

        if (cmd !== 'confess') return

        if (!args.length) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + cmd} 628xxx pesan rahasia\n\n` +
                    `Tambahan:\n` +
                    `- ${prefix + cmd} stop (stop confess)\n` +
                    `- ${prefix + cmd} tolak (khusus penerima)`
            }, { quoted: msg })
        }

        const targetJid = toWaJid(getTargetJid(msg, text))
        const message = normalizeText(args.slice(1).join(' '))

        if (!targetJid) {
            return sock.sendMessage(jid, {
                text: '❌ Nomor tujuan tidak valid. Gunakan nomor WA, mention, atau reply target.'
            }, { quoted: msg })
        }

        if (!message) {
            return sock.sendMessage(jid, {
                text: '❌ Pesan confess tidak boleh kosong.'
            }, { quoted: msg })
        }

        const targetNum = normalizeDigits(targetJid)
        const senderNum = normalizeDigits(sender)
        const botNum = normalizeDigits(botJid)

        if (sameUser(targetJid, sender)) {
            return sock.sendMessage(jid, {
                text: '❌ Tidak bisa confess ke diri sendiri.'
            }, { quoted: msg })
        }

        if (botNum && targetNum === botNum) {
            return sock.sendMessage(jid, {
                text: '❌ Tidak bisa confess ke nomor bot.'
            }, { quoted: msg })
        }

        const activeAsSender = await getSession(sender)
        if (activeAsSender) {
            return sock.sendMessage(jid, {
                text: '❌ Kamu masih punya sesi confess aktif.'
            }, { quoted: msg })
        }

        const activeAsTarget = await getSession(targetJid)
        if (activeAsTarget) {
            return sock.sendMessage(jid, {
                text: '❌ Target sedang memiliki sesi confess aktif.'
            }, { quoted: msg })
        }

        await react('⏳')

        let session
        try {
            session = await confessDb.createSession({ a: sender, b: targetJid })
            await sock.sendMessage(targetJid, {
                text: buildInitMessage(targetJid, maskNumber(senderNum), message),
                contextInfo: {
                    mentionedJid: [targetJid]
                }
            })

            useLimit()
            await react('✅')
            return sock.sendMessage(jid, {
                text: '✅ Confess berhasil dikirim.\n\nTunggu balasannya untuk membuka sesi confess. identitas kamu tetap disamarkan.',
                quoted: msg
            })
        } catch (err) {
            if (session?.id) {
                await confessDb.removeSession(session.id).catch(() => {})
            }

            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal kirim confess: ${err.message}`
            }, { quoted: msg })
        }
    },

    onMessage: async ({ sock, msg, body, isGroup, sender }) => {
        if (isGroup) return
        const plain = normalizeText(body)
        if (!plain) return
        const actor = sender

        if (isDirectStopCommand(plain)) {
            return stopSession({ sock, msg, actor })
        }

        if (isDirectTolakCommand(plain)) {
            return tolakSession({ sock, msg, actor })
        }

        if (isPrefixedConfessCommand(plain)) return
        const session = await getSession(actor)
        if (!session) return

        const isA = sameUser(session.a, actor)
        const isB = sameUser(session.b, actor)
        if (!isA && !isB) return

        if (session.status === 'pending') {
            if (isB) {
                await confessDb.setStatus(session.id, 'active')
                await confessDb.updateSession(session.id, { acceptedAt: new Date() })

                await sock.sendMessage(session.a, {
                    text: buildActiveMessage(actor, plain),
                    contextInfo: { mentionedJid: [actor] }
                })

                return sock.sendMessage(msg.key.remoteJid, {
                    text: '✅ Balasan terkirim. sesi confess aktif dan kamu sudah terhubung.\n\nJika ingin mengakhiri kapan saja, ketik stopconfess.'
                }, { quoted: msg })
            }

            return sock.sendMessage(msg.key.remoteJid, {
                text: '✅ Confess berhasil dikirim.\n\nTunggu balasannya untuk membuka sesi confess. identitas kamu tetap disamarkan.'
            }, { quoted: msg })
        }

        if (session.status === 'active') {
            const target = isA ? session.b : session.a
            if (!target) return

            await sock.sendMessage(target, {
                text: buildActiveMessage(actor, plain)
            })
        }
    }
}
